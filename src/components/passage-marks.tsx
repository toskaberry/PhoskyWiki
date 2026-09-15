"use client";

// 个人标记（划线）交互层（spec 0009 #72）：微信读书式选区浮条 + 三样式渲染。
// 正文 HTML 由服务端渲染（WikiContent），本组件在挂载后对正文 DOM 做三件事：
//   1. indexPassage 建立规范化文本索引（与 lib/passage-body.ts 的服务端投影一致）；
//   2. 把已定位标记反序列化为 DOM 区间，切分文本节点后包进 span.pw-mark 渲染样式；
//   3. 监听 selectionchange，在选区上方浮出工具条（复制 / 马克笔 / 直线 / 波浪线，
//      选中已有标记时附加「删除标记」），写操作走 /api/marks 并整表回传刷新。
// 桌面优先（≥md 显示浮条，移动端只读不出现，spec 0009 Q21）；游客点样式按钮引导登录。
// 可达性：浮条 role=toolbar 可聚焦，Enter 应用默认样式（上次选择的样式），按钮均有 aria-label。

import { Check, Copy, Highlighter, Trash2, Underline, Waves } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { WikiContent } from "@/components/wiki-content";
import {
  isLocatedMark,
  markStyles,
  markStyleLabels,
  type LocatedMarkView,
  type MarkStyle,
  type PersonalMarkView,
  type PersonalMarksState,
} from "@/lib/mark-styles";
import {
  deserializeSelection,
  indexPassage,
  serializeSelection,
  type IndexedPassage,
  type PassageAnchor,
  type PassagePoint,
} from "@/lib/passage-anchors";

const styleIcons: Record<MarkStyle, typeof Highlighter> = {
  highlight: Highlighter,
  underline: Underline,
  squiggle: Waves,
};

interface ToolbarState {
  anchor: PassageAnchor;
  deletableIds: number[];
}

function textNodesUnder(root: Element): Text[] {
  const nodes: Text[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) nodes.push(node as Text);
  return nodes;
}

/** 元素回退边界点：借 Range 把 (元素, 子下标) 翻译成文档序中相邻的文本边界。 */
function resolveTextBoundary(point: PassagePoint, texts: Text[], wantStart: boolean): { text: Text; offset: number } | null {
  if (point.node.nodeType === 3) {
    const text = point.node as Text;
    return { text, offset: Math.min(point.offset, text.length) };
  }
  const probe = document.createRange();
  probe.setStart(point.node as Node, Math.min(point.offset, point.node.childNodes.length));
  for (let index = 0; index < texts.length; index++) {
    const candidate = document.createRange();
    candidate.setStart(texts[index], 0);
    if (candidate.compareBoundaryPoints(Range.START_TO_START, probe) >= 0) {
      if (wantStart) return { text: texts[index], offset: 0 };
      const previous = texts[index - 1];
      return previous ? { text: previous, offset: previous.length } : null;
    }
  }
  const last = texts[texts.length - 1];
  return wantStart ? null : (last ? { text: last, offset: last.length } : null);
}

/** 把一个已定位标记包进 span.pw-mark：切分边界文本节点后逐节点包裹（标记互不相交）。 */
function applyMarkToDom(root: Element, index: IndexedPassage, mark: LocatedMarkView) {
  const points = deserializeSelection(index, { start: mark.start, end: mark.end });
  if (!points) return;
  const startBoundary = resolveTextBoundary(points.start, textNodesUnder(root), true);
  const endBoundary = resolveTextBoundary(points.end, textNodesUnder(root), false);
  if (!startBoundary || !endBoundary) return;
  let covered: Text[];
  if (startBoundary.text === endBoundary.text) {
    const text = startBoundary.text;
    text.splitText(endBoundary.offset);
    covered = [text.splitText(startBoundary.offset)];
  } else {
    // 终点先切：返回的新尾段在覆盖区间之外，原节点恰好在终点收口
    endBoundary.text.splitText(endBoundary.offset);
    const startNode = startBoundary.text.splitText(startBoundary.offset);
    const nodes = textNodesUnder(root);
    const from = nodes.indexOf(startNode);
    const to = nodes.indexOf(endBoundary.text);
    if (from < 0 || to < 0 || from > to) return;
    covered = nodes.slice(from, to + 1);
  }
  for (const text of covered) {
    if (!text.data) continue;
    const span = document.createElement("span");
    span.className = `pw-mark pw-mark--${mark.style}`;
    span.dataset.markId = String(mark.id);
    text.parentNode?.insertBefore(span, text);
    span.appendChild(text);
  }
}

/** 解开旧包装并合并文本节点，保证正文 DOM 可反复应用标记（canonical 文本始终不变）。 */
function unwrapMarks(root: Element) {
  for (const span of Array.from(root.querySelectorAll("span.pw-mark"))) {
    const parent = span.parentNode;
    if (!parent) continue;
    while (span.firstChild) parent.insertBefore(span.firstChild, span);
    parent.removeChild(span);
    parent.normalize();
  }
}

export function PassageMarks({
  html,
  pageId,
  revisionId,
  initialMarks,
  initialDefaultStyle,
  loggedIn,
  loginHref,
}: {
  html: string;
  pageId: number;
  revisionId: number | null;
  initialMarks: PersonalMarkView[];
  initialDefaultStyle: MarkStyle;
  loggedIn: boolean;
  loginHref: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const indexRef = useRef<IndexedPassage | null>(null);
  const selectionRangeRef = useRef<Range | null>(null);
  const [marks, setMarks] = useState(initialMarks);
  const marksRef = useRef(marks);
  useEffect(() => { marksRef.current = marks; }, [marks]);
  const [defaultStyle, setDefaultStyle] = useState(initialDefaultStyle);
  const [toolbar, setToolbar] = useState<ToolbarState | null>(null);
  const [pos, setPos] = useState<{ x: number; y: number; below: boolean } | null>(null);
  const [isDesktop, setIsDesktop] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const bodyRoot = useCallback(
    () => containerRef.current?.querySelector<HTMLElement>(":scope > .wiki-content") ?? null,
    [],
  );

  // 一期桌面优先：≥md 才出现选区浮条，移动端只读（spec 0009 Q21）
  useEffect(() => {
    const query = window.matchMedia("(min-width: 768px)");
    const update = () => setIsDesktop(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  const renderMarks = useCallback((list: PersonalMarkView[]) => {
    const root = bodyRoot();
    if (!root) return;
    unwrapMarks(root);
    const located = list.filter(isLocatedMark).sort((a, b) => a.start - b.start);
    // 每个标记应用前重建索引：前一个包裹会切分文本节点，旧边界图随即失效
    for (const mark of located) applyMarkToDom(root, indexPassage(root), mark);
    indexRef.current = indexPassage(root);
  }, [bodyRoot]);

  useEffect(() => { renderMarks(marks); }, [renderMarks, marks, html]);

  const toolbarRef = useRef<HTMLDivElement>(null);

  /** 浮条贴位于选区上方（放不下时翻到下方）；尺寸实测优先，通知文案变宽后也会重新贴位。 */
  const positionToolbar = useCallback(() => {
    const range = selectionRangeRef.current;
    if (!range) return;
    const rect = range.getBoundingClientRect();
    const element = toolbarRef.current;
    const width = element?.offsetWidth || 300;
    const height = element?.offsetHeight || 44;
    const x = Math.min(Math.max(rect.left + rect.width / 2 - width / 2, 8), Math.max(window.innerWidth - width - 8, 8));
    const above = rect.top - height - 10;
    const next = above >= 8 ? { x, y: above, below: false } : { x, y: rect.bottom + 10, below: true };
    setPos(previous =>
      previous && previous.x === next.x && previous.y === next.y && previous.below === next.below ? previous : next);
  }, []);

  // 浮条内容变化（复制反馈/错误通知/删除入口）改变尺寸后重新贴位；等值守卫保证收敛
  useEffect(() => {
    if (toolbar) positionToolbar();
  });

  /** 评估当前选区：可序列化的正文选区拉起浮条，否则收起。 */
  const evaluateSelection = useCallback(() => {
    const root = bodyRoot();
    const index = indexRef.current;
    const selection = document.getSelection();
    const anchorNode = selection?.anchorNode ?? null;
    const focusNode = selection?.focusNode ?? null;
    const dismiss = () => {
      selectionRangeRef.current = null;
      setToolbar(null);
      setPos(null);
    };
    if (!root || !index || !selection || selection.rangeCount === 0 || selection.isCollapsed
      || !anchorNode || !focusNode || !root.contains(anchorNode) || !root.contains(focusNode)) {
      dismiss();
      return;
    }
    const anchor = serializeSelection(
      index,
      { node: anchorNode, offset: selection.anchorOffset },
      { node: focusNode, offset: selection.focusOffset },
      String(revisionId ?? ""),
    );
    if (!anchor) {
      dismiss();
      return;
    }
    selectionRangeRef.current = selection.getRangeAt(0).cloneRange();
    setToolbar({
      anchor,
      deletableIds: marksRef.current
        .filter(mark => isLocatedMark(mark) && mark.start < anchor.end && mark.end > anchor.start)
        .map(mark => mark.id),
    });
    positionToolbar();
  }, [bodyRoot, positionToolbar, revisionId]);

  useEffect(() => {
    if (!isDesktop) return;
    let frame = 0;
    const onSelectionChange = () => {
      if (!frame) frame = requestAnimationFrame(() => {
        frame = 0;
        evaluateSelection();
      });
    };
    document.addEventListener("selectionchange", onSelectionChange);
    window.addEventListener("scroll", positionToolbar, { passive: true });
    window.addEventListener("resize", positionToolbar);
    // 监听就位时先评估一次现行选区：水合/进入桌面宽度之前完成的选文也要能拉起浮条
    evaluateSelection();
    return () => {
      document.removeEventListener("selectionchange", onSelectionChange);
      window.removeEventListener("scroll", positionToolbar);
      window.removeEventListener("resize", positionToolbar);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [evaluateSelection, isDesktop, positionToolbar]);

  const commitState = useCallback((state: PersonalMarksState) => {
    setMarks(state.marks);
    setDefaultStyle(state.defaultStyle);
    selectionRangeRef.current = null;
    setToolbar(null);
    setPos(null);
    document.getSelection()?.removeAllRanges();
  }, []);

  const applyStyle = useCallback(async (style: MarkStyle) => {
    if (!toolbar || busy) return;
    setNotice(null);
    if (!loggedIn) {
      window.location.href = loginHref;
      return;
    }
    setBusy(true);
    try {
      const response = await fetch("/api/marks", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ pageId, anchor: toolbar.anchor, style }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        setNotice(data?.error ?? "标记保存失败，请重试");
        return;
      }
      commitState(data as PersonalMarksState);
    } catch {
      setNotice("网络异常，标记未保存，请重试");
    } finally {
      setBusy(false);
    }
  }, [busy, commitState, loggedIn, loginHref, pageId, toolbar]);

  const removeMarks = useCallback(async () => {
    if (!toolbar?.deletableIds.length || busy) return;
    setNotice(null);
    setBusy(true);
    try {
      let state: PersonalMarksState | null = null;
      for (const id of toolbar.deletableIds) {
        const response = await fetch(`/api/marks/${id}?pageId=${pageId}`, { method: "DELETE" });
        const data: unknown = await response.json().catch(() => null);
        if (!response.ok) {
          setNotice((data as { error?: string } | null)?.error ?? "标记删除失败，请重试");
          return;
        }
        state = data as PersonalMarksState;
      }
      if (state) commitState(state);
    } catch {
      setNotice("网络异常，标记未删除，请重试");
    } finally {
      setBusy(false);
    }
  }, [busy, commitState, pageId, toolbar]);

  const copyQuote = useCallback(async () => {
    if (!toolbar) return;
    try {
      await navigator.clipboard.writeText(toolbar.anchor.quote);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      setNotice("复制失败，请手动复制");
    }
  }, [toolbar]);

  const changedCount = marks.filter(mark => mark.status === "original-changed").length;

  return (
    <div ref={containerRef} className="relative">
      {changedCount > 0 && (
        <p className="mb-4 rounded-lg border border-border bg-muted px-4 py-2 text-sm text-muted-foreground">
          原文已修订：你有 {changedCount} 处划线无法在当前版本定位，建标时的引用仍随账号保留（ADR-0008）。
        </p>
      )}
      <WikiContent html={html} />
      {isDesktop && toolbar && pos && (
        <div
          ref={toolbarRef}
          role="toolbar"
          tabIndex={0}
          aria-label="划线工具条"
          // 浮条上的 mousedown 不折叠正文选区：否则按下瞬间选区消失、浮条随之
          // 拆卸，click 落空（富文本工具条的标准做法）
          onMouseDown={(event) => event.preventDefault()}
          onKeyDown={(event) => {
            // 浮条本体聚焦时 Enter/空格应用默认样式；按钮自身的键盘激活不走这里
            if ((event.key === "Enter" || event.key === " ") && event.target === event.currentTarget) {
              event.preventDefault();
              void applyStyle(defaultStyle);
            }
          }}
          className="pw-selection-toolbar fixed z-50 flex select-none items-center gap-0.5 rounded-lg border border-border bg-popover p-1 text-sm text-popover-foreground shadow-lg"
          style={{ left: pos.x, top: pos.y }}
        >
          <button
            type="button"
            onClick={() => void copyQuote()}
            aria-label="复制所选文字"
            className="flex items-center gap-1 rounded-md px-2 py-1.5 hover:bg-accent hover:text-accent-foreground"
          >
            {copied ? <Check aria-hidden className="size-4" /> : <Copy aria-hidden className="size-4" />}
            {copied ? "已复制" : "复制"}
          </button>
          <span aria-hidden className="mx-1 h-4 w-px bg-border" />
          {markStyles.map((style) => {
            const Icon = styleIcons[style];
            const isDefault = style === defaultStyle;
            return (
              <button
                key={style}
                type="button"
                disabled={busy}
                data-default={isDefault ? "true" : undefined}
                onClick={() => void applyStyle(style)}
                aria-label={`${markStyleLabels[style]}划线${isDefault ? "（默认样式）" : ""}`}
                title={isDefault ? `${markStyleLabels[style]}（默认样式）` : markStyleLabels[style]}
                className="pw-style-button flex items-center gap-1 rounded-md px-2 py-1.5 hover:bg-accent hover:text-accent-foreground focus-visible:outline-2 disabled:opacity-50"
              >
                <Icon aria-hidden className="size-4" />
                {markStyleLabels[style]}
              </button>
            );
          })}
          {toolbar.deletableIds.length > 0 && (
            <button
              type="button"
              disabled={busy}
              onClick={() => void removeMarks()}
              aria-label="删除标记"
              className="flex items-center gap-1 rounded-md px-2 py-1.5 text-destructive hover:bg-accent disabled:opacity-50"
            >
              <Trash2 aria-hidden className="size-4" />
              删除标记
            </button>
          )}
          {notice && (
            <span role="alert" className="max-w-40 px-2 text-xs text-destructive">
              {notice}
            </span>
          )}
          <span
            aria-hidden
            className={`pw-selection-toolbar-caret ${pos.below ? "pw-selection-toolbar-caret--below" : ""}`}
          />
        </div>
      )}
    </div>
  );
}
