"use client";

// 编辑/新建提议经同一审核流提交；正文使用 CodeMirror 编辑器。
// 草稿在客户端 localStorage 自动保存（ADR-0004 #6：服务端只见 pending）；
// 管理员提交不经审核直接生效（ADR-0004 #9）。

import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MarkdownEditor } from "@/components/markdown-editor";
import type { CreateSubmissionResult } from "@/lib/review-types";
import type { WikiLinkTarget } from "@/lib/markdown";
import { KeyTextsEditor } from "@/components/key-texts";
import type { KeyText } from "@/lib/key-texts";
import type { MetadataSnapshot } from "@/lib/revision-snapshot";
import { formatAliasInput, parseAliasInput } from "@/lib/alias-input";

type Option = {
  id: number;
  label: string;
};
const NO_ALIASES: string[] = [];

/**
 * 正文字段的本地草稿：与它所基于的页面修订绑定（ADR-0004 #6 草稿在客户端；
 * base 前进后保留旧草稿，并要求对照最新版人工确认后才能提交）。
 */
interface ContentDraft {
  content: string;
  baseRevisionId: number | null;
  title?: string;
  summary?: string;
  aliases?: string;
  keyTexts?: KeyText[];
  needsConfirmation?: boolean;
  aliasesFormat?: "quoted-v1";
  termId?: string;
  interpreterId?: string;
}

export type SubmissionFormProps = { resubmission?: {
  id: number; ownerId: string; reason: string; stale: boolean; unavailable?: string;
  proposal: { keyTexts?: KeyText[] | null; content: string; title: string | null; summary: string | null; aliases: string[]; termId: number | null; interpreterId: number | null };
} } & (
  | { variant: "edit_term" | "edit_interpreter"; isAdmin: boolean; pageId: number; initialMetadata: MetadataSnapshot; baseRevisionId: number }
  | {
      variant: "edit";
      isAdmin: boolean;
      pageId: number;
      initialContent: string;
      baseRevisionId: number;
      resolvedWikiLinks?: [string, WikiLinkTarget][];
    }
  | { variant: "new_term"; isAdmin: boolean }
  | { variant: "new_interpreter"; isAdmin: boolean }
  | {
      variant: "new_perspective";
      isAdmin: boolean;
      terms: Option[];
      interpreters: Option[];
      presetTermId: number | null;
      existingPerspectives: { termId: number; interpreterId: number }[];
    });

export function SubmissionForm(props: SubmissionFormProps) {
  const { variant, isAdmin } = props;
  const retry = props.resubmission;
  const metadataEdit = variant === "edit_term" || variant === "edit_interpreter";
  const initialAliases = retry ? retry.proposal.aliases : metadataEdit && props.initialMetadata.type === "term" ? props.initialMetadata.aliases : NO_ALIASES;
  // 编辑/新视角保存正文；词条向导同时保存信息框。
  const draftKey =
    retry ? `phoskywiki:draft:resubmit:${retry.ownerId}:${retry.id}` : variant === "edit" || metadataEdit
      ? `phoskywiki:draft:${variant}:${props.pageId}`
      : variant === "new_perspective"
        ? "phoskywiki:draft:new-perspective"
        : variant === "new_term"
          ? "phoskywiki:draft:new-term-metadata"
        : "phoskywiki:draft:new-interpreter";

  const [content, setContent] = useState(
    retry ? retry.proposal.content : variant === "edit" ? props.initialContent : "",
  );
  const [title, setTitle] = useState(retry ? retry.proposal.title ?? "" : metadataEdit ? props.initialMetadata.title : "");
  const [summary, setSummary] = useState(retry ? retry.proposal.summary ?? "" : metadataEdit ? props.initialMetadata.summary : "");
  const [keyTexts, setKeyTexts] = useState<KeyText[]>(retry?.proposal.keyTexts ?? (metadataEdit ? props.initialMetadata.keyTexts : undefined) ?? []);
  const [aliases, setAliases] = useState(formatAliasInput(initialAliases));
  const [termId, setTermId] = useState(
    retry ? String(retry.proposal.termId ?? "") : variant === "new_perspective" ? (props.presetTermId ?? "") : "",
  );
  const [interpreterId, setInterpreterId] = useState(String(retry?.proposal.interpreterId ?? ""));
  const [needsConfirmation, setNeedsConfirmation] = useState(retry?.stale ?? false);
  const [confirmed, setConfirmed] = useState(false);
  const duplicatePerspective = variant === "new_perspective" && props.existingPerspectives.some(
    (pair) => pair.termId === Number(termId) && pair.interpreterId === Number(interpreterId),
  );
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [existingHref, setExistingHref] = useState<string | null>(null);
  const [result, setResult] = useState<CreateSubmissionResult | null>(null);
  const [draftSavedAt, setDraftSavedAt] = useState<string | null>(null);
  const [savedDraft, setSavedDraft] = useState<string | null>(null);
  const initialContent = variant === "edit" ? props.initialContent : null;
  // 草稿基于的修订：编辑 = 表单加载时的 head；新建视角无修订概念，恒 null
  const draftBase = variant === "edit" || metadataEdit ? props.baseRevisionId : null;
  const draftSnapshot = JSON.stringify({ content, baseRevisionId: draftBase, title, summary, aliases, keyTexts, needsConfirmation: needsConfirmation && !confirmed, aliasesFormat: "quoted-v1", termId: String(termId), interpreterId } satisfies ContentDraft);

  // 恢复本地草稿：延后到 hydration 之后（render 期不读 localStorage）；
  // 只在与当前 base 同源时可信，页面已前进则弃用
  useEffect(() => {
    if (!draftKey) return;
    let raw: string | null;
    try { raw = window.localStorage.getItem(draftKey); } catch { return; }
    if (!raw) return;
    let draft: ContentDraft | null = null;
    try {
      draft = JSON.parse(raw) as ContentDraft;
    } catch {
      draft = null;
    }
    if (!draft || typeof draft.content !== "string") return;
    if (variant === "edit_term" && (typeof draft.title !== "string" || typeof draft.summary !== "string" || typeof draft.aliases !== "string")) return;
    const restored = draft;
    const timer = setTimeout(() => {
      setContent(restored.content);
      if (Array.isArray(restored.keyTexts)) setKeyTexts(restored.keyTexts);
      if (restored.baseRevisionId !== draftBase || restored.needsConfirmation) setNeedsConfirmation(true);
      if (variant === "new_term" || metadataEdit || variant === "new_interpreter") {
        setTitle(typeof restored.title === "string" ? restored.title : "");
        setSummary(typeof restored.summary === "string" ? restored.summary : "");
        const storedAliases = typeof restored.aliases === "string" ? restored.aliases : "";
        const originalText = initialAliases.join(retry ? "," : "、");
        // Old drafts used lossy joins. Unchanged prefill can recover its exact original array.
        setAliases(restored.aliasesFormat === "quoted-v1" ? storedAliases : formatAliasInput(
          storedAliases === originalText ? initialAliases : storedAliases.split(variant === "edit_term" ? /[、，,\n]/ : /[，,\n]/).map(s => s.trim()).filter(Boolean),
        ));
      }
      if (variant === "new_perspective") {
        if (typeof restored.termId === "string") setTermId(restored.termId);
        if (typeof restored.interpreterId === "string") setInterpreterId(restored.interpreterId);
      }
    }, 0);
    return () => clearTimeout(timer);
  }, [draftKey, draftBase, variant, retry, initialAliases, metadataEdit]);

  // 自动保存草稿（防抖 500ms；提交成功后停笔）
  useEffect(() => {
    if (!draftKey || result || (!retry && variant === "edit" && content === initialContent)) return;
    const timer = setTimeout(() => {
      try { window.localStorage.setItem(
        draftKey,
        draftSnapshot,
      ); } catch { return; }
      setDraftSavedAt(new Date().toLocaleTimeString());
      setSavedDraft(draftSnapshot);
    }, 500);
    return () => clearTimeout(timer);
  }, [content, draftKey, draftSnapshot, result, initialContent, variant, retry]);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (duplicatePerspective || (needsConfirmation && !confirmed) || (retry?.unavailable && variant !== "new_perspective")) return;
    try { window.localStorage.setItem(draftKey, draftSnapshot); } catch { /* Storage may be unavailable. */ }
    setError(null);
    setExistingHref(null);
    const parsedAliases = parseAliasInput(aliases);
    if ((metadataEdit || variant === "new_term") && parsedAliases.error) {
      setError(parsedAliases.error);
      return;
    }
    setPending(true);
    const payload =
      metadataEdit
        ? { kind: "edit", pageId: props.pageId, baseRevisionId: props.baseRevisionId, title, summary, aliases: parsedAliases.aliases, keyTexts }
        : variant === "edit"
        ? {
            kind: "edit",
            pageId: props.pageId,
            content,
            baseRevisionId: props.baseRevisionId,
          }
        : variant === "new_term"
          ? { kind: "new_term", title, summary, aliases: parsedAliases.aliases, content, keyTexts }
          : variant === "new_interpreter"
            ? { kind: "new_interpreter", title, summary, keyTexts }
            : {
                kind: "new_perspective",
                termId: termId === "" ? undefined : Number(termId),
                interpreterId: interpreterId === "" ? undefined : Number(interpreterId),
                content,
              };
    try {
    const res = await fetch("/api/submissions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...payload, ...(retry ? { supersedes: retry.id, confirmedBaseRevisionId: confirmed ? draftBase : undefined } : {}) }),
    });
    const data = (await res.json().catch(() => null)) as
      | (CreateSubmissionResult & { error?: string; href?: string })
      | null;
    setPending(false);
    if (!res.ok || !data || (data.outcome !== "pending" && data.outcome !== "direct")) {
      setError(data?.error ?? "提交失败，请稍后再试");
      setExistingHref(data?.href ?? null);
      return;
    }
    if (draftKey) { try { window.localStorage.removeItem(draftKey); } catch { /* Submission still succeeded. */ } }
    setResult(data);
    } catch {
      setError("网络连接失败，草稿已保留，请重试。");
    } finally { setPending(false); }
  }

  if (result) {
    return (
      <div
        data-testid="submit-success"
        className="rounded-lg border border-border bg-card p-6 text-sm"
      >
        {result.outcome === "pending" ? (
          <>
            <p className="font-medium">已提交，等待审核。</p>
            <p className="mt-2 text-muted-foreground">
              需 {result.quorum} 位管理员受理后生效；可在个人主页查看提交进度与审核结果。
            </p>
            <Link href="/profile" className="mt-2 inline-block text-primary underline-offset-4 hover:underline">
              查看提交历史 →
            </Link>
          </>
        ) : (
          <>
            <p className="font-medium">已直接生效（管理员提交不经审核）。</p>
            <Link
              href={result.href}
              className="mt-2 inline-block text-primary underline-offset-4 hover:underline"
            >
              查看页面 →
            </Link>
          </>
        )}
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-5" noValidate>
      {retry && <p className="text-sm">驳回理由：<span>{retry.reason}</span></p>}
      {retry?.unavailable && <p role="alert">{retry.unavailable} 草稿会保留；请等待恢复{variant === "new_perspective" ? "或调整词条与诠释者" : "后再重提"}。</p>}
      {needsConfirmation && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} />我已对照最新版与原提案，人工整理并确认本次内容</label>}
      {needsConfirmation && !retry && <details open className="rounded border p-3"><summary>最新版（请与下方保留的草稿对照）</summary><pre className="whitespace-pre-wrap">{variant === "edit" ? props.initialContent : metadataEdit ? JSON.stringify(props.initialMetadata, null, 2) : ""}</pre></details>}
      {variant === "new_perspective" && (
        <>
          <label className="flex flex-col gap-2 text-sm font-medium">
            所属词条
            <select
              name="term"
              required
              value={termId}
              onChange={(e) => { setTermId(e.target.value); setError(null); }}
              aria-invalid={duplicatePerspective}
              aria-describedby={duplicatePerspective ? "perspective-conflict" : undefined}
              className="h-9 rounded-md border border-border bg-background px-3 text-sm font-normal outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              <option value="">选择词条…</option>
              {props.terms.map((term) => (
                <option key={term.id} value={term.id}>
                  {term.label}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-2 text-sm font-medium">
            诠释者
            <select
              name="interpreter"
              required
              value={interpreterId}
              onChange={(e) => { setInterpreterId(e.target.value); setError(null); }}
              aria-invalid={duplicatePerspective}
              aria-describedby={duplicatePerspective ? "perspective-conflict" : undefined}
              className="h-9 rounded-md border border-border bg-background px-3 text-sm font-normal outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              <option value="">选择诠释者…</option>
              {props.interpreters.map((interpreter) => (
                <option key={interpreter.id} value={interpreter.id}>
                  {interpreter.label}
                </option>
              ))}
            </select>
          </label>
          <p className="text-xs text-muted-foreground">
            视角标题按「诠释者论词条」自动生成（如「德勒兹论主体性」）。
          </p>
          {duplicatePerspective && (
            <p id="perspective-conflict" role="alert" className="text-sm text-destructive">
              该诠释者在此词条下已有视角，请编辑已有视角；若已删除，请联系管理员恢复。
            </p>
          )}
        </>
      )}

      {(variant === "new_term" || variant === "new_interpreter" || metadataEdit) && (
        <label className="flex flex-col gap-2 text-sm font-medium">
          {variant === "new_term" || variant === "edit_term" ? "词条标题" : "诠释者名称"}
          <Input
            name="title"
            type="text"
            required
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={
              variant === "new_term" || variant === "edit_term"
                ? "如「物化」；不同领域或含义请在同一视角内分章"
                : "如「卢卡奇」"
            }
          />
        </label>
      )}

      {(variant === "new_term" || variant === "new_interpreter" || metadataEdit) && (
        <label className="flex flex-col gap-2 text-sm font-medium">
          一句话简介（信息框用）
          <Input
            name="summary"
            type="text"
            value={summary}
            onChange={(e) => setSummary(e.target.value)}
            placeholder="列表页与信息框展示的一句话"
          />
        </label>
      )}

      {(variant === "new_term" || variant === "edit_term") && (
        <>
          <label className="flex flex-col gap-2 text-sm font-medium">
            别名（信息框用，以逗号分隔）
            <Input name="aliases" value={aliases} onChange={(e) => setAliases(e.target.value)} aria-describedby="aliases-help" />
          </label>
          <p id="aliases-help" className="text-xs text-muted-foreground">以中英文逗号分隔，顿号属于别名内容。含逗号的单个别名用英文双引号包住，例如 <code>{'"Alpha, Beta",甲、乙'}</code>；引号内用 <code>{'\\"'}</code> 表示双引号、<code>{'\\\\'}</code> 表示反斜杠。</p>
          {variant === "new_term" && <p className="text-sm text-muted-foreground">词条仅保存导航信息。创建后可另行添加具名诠释者的视角。</p>}
        </>
      )}
      {(metadataEdit || variant === "new_term" || variant === "new_interpreter") && <KeyTextsEditor value={keyTexts} onChange={setKeyTexts} />}
      {(variant === "edit" || variant === "new_perspective") && (
        <MarkdownEditor value={content} onChange={setContent} resolvedWikiLinks={variant === "edit" ? props.resolvedWikiLinks : undefined} />
      )}

      {error && (
        <p data-testid="form-error" role="alert" className="text-sm text-destructive">
          {error}
          {existingHref && <Link href={existingHref} className="ml-2 underline">前往已有页面</Link>}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" size="lg" disabled={pending || duplicatePerspective || (needsConfirmation && !confirmed) || Boolean(retry?.unavailable && variant !== "new_perspective")}>
          {pending ? "提交中…" : isAdmin ? "提交（直接生效）" : "提交审核"}
        </Button>
        {draftKey && draftSavedAt && savedDraft === draftSnapshot && !pending && (
          <span className="text-xs text-muted-foreground">草稿已自动保存 {draftSavedAt}</span>
        )}
      </div>
      <p className="text-xs text-muted-foreground">
        {isAdmin
          ? "管理员提交不经审核，直接产生修订并重建双链。"
          : "提交进入审核队列，受理后内容才会出现在读路径。草稿自动保存在浏览器本地。"}
      </p>
    </form>
  );
}
