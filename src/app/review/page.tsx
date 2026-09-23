import { hasAdminRole } from "@/lib/roles";
// 审核队列（T06，仅管理员）：待审列表 + 当前版 vs 提案 diff（现算，ADR-0004 #1）
// + 受理/驳回操作。非管理员（含游客）只见访问受限面板，不泄露队列内容。

import Link from "next/link";

import { PageContainer } from "@/components/page-container";
import { Callout, StatusChip, TaskPageHeader } from "@/components/task-page";
import { ContentDiff } from "@/components/content-diff";
import { TermMetadataDiff } from "@/components/term-metadata-diff";
import { KeyTexts } from "@/components/key-texts";
import { WikiContent } from "@/components/wiki-content";
import { getEditorCatalog, type EditorCatalog } from "@/lib/editor-catalog";
import { getWikiLinkTargets } from "@/lib/content";
import { pageIdFromKey } from "@/lib/slug";
import { renderMarkdown, previewWikiLinkResolver } from "@/lib/markdown";
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

async function QueueEntry({ item, catalog }: { item: QueueItem; catalog: EditorCatalog }) {
  const sourceId = item.targetHref ? pageIdFromKey(item.targetHref.split("/").pop() ?? "") : null;
  const resolvedTargets = sourceId !== null ? await getWikiLinkTargets(sourceId) : undefined;
  const previewHtml = renderMarkdown(item.content, previewWikiLinkResolver(catalog.targets, resolvedTargets));
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
      className="rounded-lg border border-border bg-card p-4 sm:p-5"
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm">
        <StatusChip>{item.currentMetadata ? "编辑词条信息" : kindLabels[item.kind]}</StatusChip>
        <span className="min-w-0 break-words text-base font-medium">{target}</span>
        <StatusChip tone="outline">
          批准 {item.approverNames.length}/{item.quorum}
          {item.approverNames.length > 0 && `（${item.approverNames.join("、")}）`}
        </StatusChip>
        {item.staleBase && (
          <span data-testid="stale-badge" className="inline-flex items-center rounded bg-amber-500/15 px-1.5 py-0.5 text-xs leading-5 text-amber-700 dark:text-amber-400">
            原稿已有新修订
          </span>
        )}
      </div>
      <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <span>
          {item.submitterName} 提交于 <time dateTime={item.createdAt.toISOString()}>{formatWhen(item.createdAt)}</time>
        </span>
        {item.targetHref && (
          <Link
            href={item.targetHref}
            className="underline-offset-4 hover:text-foreground hover:underline"
          >
            查看当前版 →
          </Link>
        )}
      </p>

      <details className="mt-4 border-t border-border pt-3">
        <summary className="min-h-11 cursor-pointer py-1 text-sm text-muted-foreground hover:text-foreground">
          对比当前版与提案
        </summary>
        <div className="mt-3 flex flex-col gap-4">
          {item.keyTexts && item.kind !== "edit" && (
            <section aria-label="提案关键文本" className="text-sm">
              <h3 className="text-sm font-medium">关键文本（提案）</h3>
              <div className="mt-2"><KeyTexts items={item.keyTexts} /></div>
            </section>
          )}
          {item.currentMetadata ? (
            <section aria-label="词条信息差异" className="text-sm">
              <h3 className="mb-2 text-sm font-medium">词条信息差异</h3>
              <TermMetadataDiff from={item.currentMetadata} to={{ ...item.currentMetadata, title: item.title!, summary: item.summary ?? "", ...(item.currentMetadata.type === "term" ? { aliases: item.aliases } : {}), keyTexts: item.keyTexts ?? item.currentMetadata.keyTexts }} />
            </section>
          ) : item.kind === "edit" && item.currentContent !== null ? (
            <section aria-label="正文差异" className="text-sm">
              <h3 className="mb-2 text-sm font-medium">正文差异（当前版 → 提案）</h3>
              <ContentDiff oldText={item.currentContent} newText={item.content} />
            </section>
          ) : (
            <section aria-label="新建提案内容" className="flex flex-col gap-2 rounded-md border border-border p-3 text-sm">
              <h3 className="text-sm font-medium">提案内容</h3>
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
            </section>
          )}
          {item.aliases.length > 0 && <p className="text-sm">别名：{item.aliases.join("、")}</p>}
          {item.content && (
            <section aria-label="提案预览" className="rounded-lg border border-border p-4">
              <h3 className="mb-2 text-sm font-medium text-muted-foreground">提案预览</h3>
              <WikiContent html={previewHtml} />
            </section>
          )}
          {item.staleBase && (
            <Callout tone="warning" className="text-xs">
              页面在提交后已有新的修订：点「受理」会自动驳回并提示提交者基于新版重新提交。
            </Callout>
          )}
        </div>
      </details>

      <div className="mt-4 border-t border-border pt-4">
        <ReviewActions submissionId={item.id} />
      </div>
    </li>
  );
}

export default async function ReviewQueuePage() {
  const sessionUser = await getSessionUser();
  if (!sessionUser || !hasAdminRole(sessionUser.role)) {
    return (
      <PageContainer className="max-w-3xl">
        <TaskPageHeader
          breadcrumb={[{ label: "首页", href: "/" }, { label: "审核队列" }]}
          kicker="管理 · 审核"
          title="审核队列"
          description="只有管理员可以查看审核队列与受理/驳回提交。"
        />
        <Callout tone="neutral" className="mt-8 max-w-xl">
          <p>当前账号没有管理权限，无法查看待审提交。</p>
          {sessionUser ? (
            <div className="mt-3">
              <p className="text-muted-foreground">编者可在个人主页跟踪自己提交的审核进度。</p>
              <Link href="/profile" className="mt-1 inline-block text-primary underline-offset-4 hover:underline">前往个人主页 →</Link>
            </div>
          ) : (
            <div className="mt-3">
              <Link href="/login" className="text-primary underline-offset-4 hover:underline">登录 →</Link>
            </div>
          )}
        </Callout>
      </PageContainer>
    );
  }

  const [items, catalog] = await Promise.all([listQueue(), getEditorCatalog()]);

  return (
    <PageContainer className="max-w-4xl">
      <TaskPageHeader
        breadcrumb={[{ label: "首页", href: "/" }, { label: "审核队列" }]}
        kicker="管理 · 审核"
        title={`审核队列（${items.length}）`}
        description="通常需两位管理员受理；提交时仅有一位管理员的，需一位受理。具体人数见每条提案。驳回时须填写理由，驳回后本次审核结束。"
      />

      {items.length === 0 ? (
        <div className="mt-8 rounded-lg border border-border bg-card p-6 text-sm">
          <p className="font-medium">队列空空如也。</p>
          <p className="mt-2 text-muted-foreground">
            没有待审提交；编者新提交后会出现在这里。
          </p>
        </div>
      ) : (
        <ul className="mt-8 flex flex-col gap-4">
          {items.map((item) => (
            <QueueEntry key={item.id} item={item} catalog={catalog} />
          ))}
        </ul>
      )}
    </PageContainer>
  );
}
