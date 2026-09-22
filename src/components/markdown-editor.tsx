"use client";

import { defaultKeymap, history, historyKeymap, isolateHistory, redo, undo } from "@codemirror/commands";
import { autocompletion, insertCompletionText, pickedCompletion, startCompletion, type CompletionSource } from "@codemirror/autocomplete";
import { markdown } from "@codemirror/lang-markdown";
import { HighlightStyle, syntaxHighlighting, syntaxTree } from "@codemirror/language";
import { tags } from "@lezer/highlight";
import { Compartment, EditorSelection, EditorState, Transaction } from "@codemirror/state";
import { EditorView, keymap, placeholder } from "@codemirror/view";
import { useEffect, useEffectEvent, useMemo, useRef, useState } from "react";

import { WikiContent } from "@/components/wiki-content";
import { ImageUpload } from "@/components/image-upload";
import { renderMarkdown, previewWikiLinkResolver, type WikiLinkTarget } from "@/lib/markdown";
import type { EditorCatalog } from "@/lib/editor-catalog";

function wikiCompletions(catalog: EditorCatalog): CompletionSource {
  return (context) => {
    const match = context.matchBefore(/\[\[[^[\]|\n]*$/);
    if (!match) return null;
    for (let node = syntaxTree(context.state).resolveInner(context.pos, -1); node; node = node.parent!) {
      if (["FencedCode", "CodeBlock", "InlineCode"].includes(node.name)) return null;
    }
    const query = match.text.slice(2).trim();
    const matches = catalog.terms.filter(({ title }) => title.includes(query)).slice(0, 20);
    const choices = matches.map(({ title }) => ({ label: title, detail: undefined as string | undefined }));
    if (query && !catalog.terms.some(({ title }) => title === query)) {
      choices.push({ label: query, detail: "将创建红链" });
    }
    return {
      from: match.from + 2,
      filter: false,
      options: choices.map((choice) => ({
        ...choice,
        apply(editor, completion, from, to) {
          // 在已有双链中补全时保留别名/显式视角，且不重复插入闭括号。
          const tail = editor.state.sliceDoc(to, editor.state.doc.lineAt(to).to);
          const closedLink = tail.match(/^([^[\]|\n]*)(?:\|[^\[\]\n]*)?\]\]/);
          const end = to + (closedLink?.[1].length ?? 0);
          // 普通文本中的 | 不是别名；只有完整双链后缀才保留而不补闭括号。
          const closing = closedLink ? "" : tail.startsWith("]") ? "]" : "]]";
          editor.dispatch({
            ...insertCompletionText(editor.state, completion.label + closing, from, end),
            annotations: pickedCompletion.of(completion),
          });
        },
      })),
    };
  };
}

const editorTheme = EditorView.theme({
  "&": { backgroundColor: "var(--background)", color: "var(--foreground)", fontSize: "16px" },
  "&.cm-focused": { outline: "2px solid var(--ring)", outlineOffset: "-2px" },
  ".cm-content": { minHeight: "20rem", padding: "12px", overflowWrap: "anywhere" },
  ".cm-scroller": { fontFamily: "var(--font-code)", overflow: "auto" },
  ".cm-cursor": { borderLeftColor: "var(--foreground)" },
  ".cm-selectionBackground, &.cm-focused .cm-selectionBackground": { backgroundColor: "var(--accent)" },
  ".cm-tooltip": { backgroundColor: "var(--popover)", color: "var(--popover-foreground)", borderColor: "var(--border)", maxWidth: "calc(100vw - 32px)" },
  ".cm-tooltip-autocomplete > ul": { maxWidth: "100%" },
  ".cm-tooltip-autocomplete ul li": { padding: "8px", whiteSpace: "normal", overflowWrap: "anywhere" },
  ".cm-tooltip-autocomplete ul li[aria-selected=true]": { backgroundColor: "var(--accent)", color: "var(--accent-foreground)" },
});

// The built-in highlight style uses fixed colors for light backgrounds. CSS
// variables let an open editor change theme without rebuilding its state/undo history.
const editorHighlightStyle = HighlightStyle.define([
  { tag: [tags.meta, tags.comment, tags.processingInstruction], color: "var(--muted-foreground)" },
  { tag: tags.heading, color: "var(--foreground)", fontWeight: "bold" },
  { tag: tags.strong, fontWeight: "bold" },
  { tag: tags.emphasis, fontStyle: "italic" },
  { tag: tags.strikethrough, textDecoration: "line-through" },
  { tag: [tags.link, tags.url], color: "var(--primary)", textDecoration: "underline" },
  { tag: [tags.quote, tags.monospace], color: "var(--foreground)" },
  { tag: tags.invalid, color: "var(--destructive)" },
]);

const formats = [
  { label: "标题", before: "\n## ", after: "\n", fallback: "小节标题" },
  { label: "粗体", before: "**", after: "**", fallback: "文字" },
  { label: "斜体", before: "*", after: "*", fallback: "文字" },
  { label: "引用", before: "\n> ", after: "\n", fallback: "引用文字" },
  { label: "列表", before: "\n- ", after: "\n", fallback: "列表项" },
  { label: "双链", before: "[[", after: "]]", fallback: "词条名" },
];

export function MarkdownEditor({ value, onChange, resolvedWikiLinks }: {
  value: string;
  onChange: (value: string) => void;
  /** 该页已有的目标身份优先于当前名称目录，包括暂不可用的已解析目标。 */
  resolvedWikiLinks?: [string, WikiLinkTarget][];
}) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const initialValue = useRef(value);
  const completionConfig = useRef(new Compartment());
  const [catalog, setCatalog] = useState<EditorCatalog | null>(null);
  const [catalogError, setCatalogError] = useState(false);
  const [reload, setReload] = useState(0);
  const notifyChange = useEffectEvent(onChange);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/editor/catalog", { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("目录加载失败");
        const data: EditorCatalog = await response.json();
        if (!controller.signal.aborted) { setCatalog(data); setCatalogError(false); }
      })
      .catch(() => { if (!controller.signal.aborted) setCatalogError(true); });
    return () => controller.abort();
  }, [reload]);

  useEffect(() => {
    const editor = new EditorView({
      parent: host.current!,
      state: EditorState.create({
        doc: initialValue.current,
        extensions: [
          markdown(), history(), syntaxHighlighting(editorHighlightStyle),
          completionConfig.current.of([]),
          keymap.of([...defaultKeymap, ...historyKeymap]),
          EditorView.lineWrapping, editorTheme,
          placeholder("支持 [[词条名]] 与 [[词条名|视角@诠释者]]"),
          EditorView.contentAttributes.of({ "aria-label": "正文（Markdown）", "aria-multiline": "true" }),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) notifyChange(update.state.doc.toString());
          }),
        ],
      }),
    });
    view.current = editor;
    return () => { view.current = null; editor.destroy(); };
  }, []);

  useEffect(() => {
    const editor = view.current;
    if (catalog && editor) {
      editor.dispatch({
        effects: completionConfig.current.reconfigure(autocompletion({ override: [wikiCompletions(catalog)], icons: false })),
      });
      // 目录到达前已输入 [[ 时也立即补全，无需再输入一个字符。
      if (editor.hasFocus) startCompletion(editor);
    }
  }, [catalog]);

  // 本地草稿恢复由表单驱动，不重建编辑器，也不加入撤销历史。
  useEffect(() => {
    const editor = view.current;
    if (editor && editor.state.doc.toString() !== value) {
      editor.dispatch({
        changes: { from: 0, to: editor.state.doc.length, insert: value },
        annotations: Transaction.addToHistory.of(false),
      });
    }
  }, [value]);

  function insert(before: string, after = "", fallback = "文字") {
    const editor = view.current;
    if (!editor) return;
    const { from, to } = editor.state.selection.main;
    const selected = editor.state.sliceDoc(from, to) || fallback;
    editor.dispatch({
      changes: { from, to, insert: before + selected + after },
      selection: EditorSelection.range(from + before.length, from + before.length + selected.length),
      annotations: isolateHistory.of("full"),
      scrollIntoView: true,
    });
    editor.focus();
  }

  const html = useMemo(() => {
    if (!catalog) return null;
    return renderMarkdown(value, previewWikiLinkResolver(catalog.targets, resolvedWikiLinks));
  }, [value, catalog, resolvedWikiLinks]);
  const buttonClass = "min-h-11 rounded px-3 text-sm hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring";

  return (
    <div className="min-w-0 space-y-3">
      <p className="text-sm font-medium">正文（Markdown）</p>
      <div className="overflow-hidden rounded-md border border-border">
        <div role="group" aria-label="Markdown 工具栏" className="flex flex-wrap gap-1 border-b border-border bg-muted/40 p-1">
          {formats.map(({ label, before, after, fallback }) => (
            <button key={label} type="button" onClick={() => insert(before, after, fallback)} className={buttonClass}>
              {label}
            </button>
          ))}
          <button type="button" className={buttonClass} onClick={() => { if (view.current) { undo(view.current); view.current.focus(); } }}>撤销</button>
          <button type="button" className={buttonClass} onClick={() => { if (view.current) { redo(view.current); view.current.focus(); } }}>重做</button>
        </div>
        <div ref={host} />
      </div>
      <p className="text-xs text-muted-foreground">输入 [[ 补全词条；Tab 移至下一个控件。</p>
      <ImageUpload onUploaded={(src) => insert("![", `](${src})`, "图片说明")} />
      <section aria-label="实时预览" className="min-w-0 rounded-md border border-border p-4 [overflow-wrap:anywhere]">
        <h2 className="mb-3 text-sm font-medium text-muted-foreground">实时预览</h2>
        {catalogError ? (
          <p role="status" className="text-sm text-destructive">
            词条目录加载失败，补全和预览暂不可用；正文仍可编辑和提交。
            <button type="button" onClick={() => setReload((count) => count + 1)} className="ml-2 min-h-11 underline">重试加载</button>
          </p>
        ) : html === null ? (
          <p role="status" className="text-sm text-muted-foreground">正在加载词条目录…</p>
        ) : value ? <WikiContent html={html} /> : <p className="text-sm text-muted-foreground">输入正文后在这里预览。</p>}
      </section>
    </div>
  );
}
