import { hasAdminRole } from "@/lib/roles";
// 审核队列（T06，仅管理员）：待审列表 + 当前版 vs 提案 diff（现算，ADR-0004 #1）
// + 受理/驳回操作。非管理员（含游客）只见访问受限面板，不泄露队列内容。

import Link from "next/link";

import { ContentDiff } from "@/components/content-diff";
import { TermMetadataDiff } from "@/components/term-metadata-diff";
import { KeyTexts } from "@/components/key-texts";
import { WikiContent } from "@/components/wiki-content";
import { renderMarkdown } from "@/lib/markdown";
import { ReviewActions } from "@/components/review-actions";
import type { QueueItem } from "@/lib/review";
import type { SubmissionKind } from "@/db/schema";
import { formatWhen } from "@/lib/format";
import { listQueue } from "@/lib/review";
import { getSessionUser } from "@/lib/session";

export const dynamic = "force-dynamic";

const kindLabels: Record<SubmissionKind, string> = {
  edit: "编辑视角",
  new_term: "新建词条",
  new_perspective: "新建视角",
  new_interpreter: "新建诠释者",
};

function QueueEntry({ item }: { item: QueueItem }) {
  const target =
    item.kind === "edit"
      ? item.targetTitle
        ? `《${item.targetTitle}》`
        : "（目标页缺失）"
      : item.kind === "new_perspective"
        ? `${item.interpreterName ?? "?"} 论 ${item.termTitle ?? "?"}`
        : item.title;

  return (
    <li
      data-submission-id={item.id}
      className="rounded-lg border border-border bg-card p-4"
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
        <span className="rounded bg-secondary px-1.5 py-0.5 text-xs">
          {item.currentMetadata ? "编辑词条信息" : kindLabels[item.kind]}
        </span>
        <span className="font-medium">{target}</span>
        {item.targetHref && (
          <Link
            href={item.targetHref}
            className="text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
          >
            查看当前版 →
          </Link>
        )}
        <span className="text-muted-foreground">
          {item.submitterName} 提交于 {formatWhen(item.createdAt)}
        </span>
        <span className="ml-auto rounded bg-muted px-1.5 py-0.5 text-xs">
          批准 {item.approverNames.length}/{item.quorum}
          {item.approverNames.length > 0 && `（${item.approverNames.join("、")}）`}
        </span>
        {item.staleBase && (
          <span data-testid="stale-badge" className="rounded bg-amber-500/15 px-1.5 py-0.5 text-xs text-amber-700 dark:text-amber-400">
            base 过期
          </span>
        )}
      </div>

      <details className="mt-3">
        <summary className="cursor-pointer text-sm text-muted-foreground hover:text-foreground">
          对比当前版与提案
        </summary>
        <div className="mt-3">
          {item.keyTexts && item.kind !== "edit" && <KeyTexts items={item.keyTexts} />}
          {item.currentMetadata ? (
            <TermMetadataDiff from={item.currentMetadata} to={{ ...item.currentMetadata, title: item.title!, summary: item.summary ?? "", ...(item.currentMetadata.type === "term" ? { aliases: item.aliases } : {}), keyTexts: item.keyTexts ?? item.currentMetadata.keyTexts }} />
          ) : item.kind === "edit" && item.currentContent !== null ? (
            <ContentDiff oldText={item.currentContent} newText={item.content} />
          ) : (
            <div className="flex flex-col gap-2 rounded-md border border-border p-3 text-sm">
              {item.title && (
                <p>
                  <span className="text-muted-foreground">标题：</span>
                  {item.title}
                </p>
              )}
              {item.summary && (
                <p>
                  <span className="text-muted-foreground">简介：</span>
                  {item.summary}
                </p>
              )}
              {item.content && (
                <pre className="overflow-x-auto rounded-md border border-border bg-muted/40 p-3 font-mono text-xs leading-5 whitespace-pre-wrap">
                  {item.content}
                </pre>
              )}
            </div>
          )}
          {item.aliases.length > 0 && <p className="mt-2 text-sm">别名：{item.aliases.join("、")}</p>}
          {item.content && <section aria-label="提案预览" className="mt-3 rounded border p-3"><WikiContent html={renderMarkdown(item.content, () => ({ href: "", exists: false }))} /></section>}
          {item.staleBase && (
            <p className="mt-2 text-xs text-amber-700 dark:text-amber-400">
              页面在提交后已有新的修订：点「受理」会自动驳回并提示提交者基于新版重新提交。
            </p>
          )}
        </div>
      </details>

      <div className="mt-4">
        <ReviewActions submissionId={item.id} />
      </div>
    </li>
  );
}

export default async function ReviewQueuePage() {
  const sessionUser = await getSessionUser();
  if (!sessionUser || !hasAdminRole(sessionUser.role)) {
    return (
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8">
        <h1 className="text-2xl font-bold tracking-tight">审核队列</h1>
        <p className="mt-3 text-sm text-muted-foreground">
          只有管理员可以查看审核队列与受理/驳回提交。
        </p>
      </main>
    );
  }

  const items = await listQueue();

  return (
    <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-8">
      <h1 className="text-2xl font-bold tracking-tight">
        审核队列（{items.length}）
      </h1>
      <p className="mt-2 text-sm text-muted-foreground">
        受理票数在提交创建时快照（min(2, 当时的管理员数)）；驳回必填理由，任一驳回即终态。
      </p>

      {items.length === 0 ? (
        <p className="mt-8 text-sm text-muted-foreground">队列空空如也。</p>
      ) : (
        <ul className="mt-6 flex flex-col gap-4">
          {items.map((item) => (
            <QueueEntry key={item.id} item={item} />
          ))}
        </ul>
      )}
    </main>
  );
}
