import { hasAdminRole } from "@/lib/roles";
import { formatKeyTexts } from "@/lib/key-texts";
import { notFound } from "next/navigation";
import { PageContainer } from "@/components/page-container";
import { StatusChip, TaskPageHeader } from "@/components/task-page";
import { PageAction } from "@/components/page-action";
import { RevisionDiff } from "@/components/revision-diff";
import { TermMetadataDiff } from "@/components/term-metadata-diff";
import { Button } from "@/components/ui/button";
import { compareRevisions, getPageHistory, historyId } from "@/lib/history";
import { ReviewError } from "@/lib/review";
import { getSessionUser } from "@/lib/session";
import { pagePath } from "@/lib/slug";
import { legacyTermHistoryNote, missingKeyTextsNote, revisionSourceLabels } from "@/lib/revision-snapshot";

export const dynamic = "force-dynamic";
export const metadata = { title: "修订历史" };

export default async function HistoryPage({ params, searchParams }: {
  params: Promise<{ pageId: string }>;
  searchParams: Promise<{ from?: string | string[]; to?: string | string[] }>;
}) {
  const user = await getSessionUser();
  const isAdmin = hasAdminRole(user?.role);
  const query = await searchParams;
  let history;
  let comparison;
  try {
    history = await getPageHistory(historyId((await params).pageId), isAdmin);
    comparison = query.from !== undefined || query.to !== undefined
      ? compareRevisions(history, historyId(query.from), historyId(query.to))
      : null;
  } catch (error) {
    if (error instanceof ReviewError) notFound();
    throw error;
  }
  const { page, revisions } = history;
  return (
    <PageContainer className="max-w-5xl">
      <TaskPageHeader
        breadcrumb={[
          { label: "首页", href: "/" },
          ...(page.deletedAt
            ? [{ label: "已删除页面", href: "/admin/deleted" }]
            : [{ label: page.title, href: pagePath(page.type, page.slug, page.id) }]),
          { label: "修订历史" },
        ]}
        kicker="修订 · 历史"
        title={`${page.title} · 修订历史`}
      />
      {isAdmin && <div className="mt-6 flex flex-wrap items-center gap-3 border-b border-border pb-6">
        <PageAction pageId={page.id} action={page.deletedAt ? "restore" : "delete"} />
        <p className="text-sm text-muted-foreground">{page.deletedAt ? "页面已删除，读者不可见；内容与历史仍完整保留。" : "回滚会产生新修订；软删除可恢复，并保留全部历史。"}</p>
      </div>}
      {revisions.length ? <>
        <form action={`/history/${page.id}`} method="get" className="mt-6 flex flex-wrap items-end gap-4">
          {(["from", "to"] as const).map((side) => <label key={side} className="flex flex-col gap-1 text-sm font-medium">
            {side === "from" ? "起始修订" : "目标修订"}
            <select aria-label={side === "from" ? "起始修订" : "目标修订"} name={side} defaultValue={comparison?.[side].id ?? revisions[side === "from" && revisions.length > 1 ? 1 : 0].id} className="h-9 max-w-full rounded-md border border-input bg-background px-3 text-sm font-normal outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50">
              {revisions.map((revision) => <option key={revision.id} value={revision.id}>#{revision.id} · {revision.createdAt.toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" })}</option>)}
            </select>
          </label>)}
          <Button type="submit" className="mb-0.5">对比修订</Button>
        </form>
        {comparison && <section aria-label="修订对比" className="mb-8 mt-8">
          <h2 className="border-t border-border pt-6 text-xl font-semibold tracking-tight">修订 #{comparison.from.id} → #{comparison.to.id}</h2>
          <div className="mt-4">
            {comparison.kind === "term"
              ? comparison.from.snapshot && comparison.to.snapshot
                ? <TermMetadataDiff from={comparison.from.snapshot} to={comparison.to.snapshot} fromLabel="起始修订" toLabel="目标修订" />
                : <p className="text-sm text-muted-foreground">无法比较词条信息：{comparison.limitation}</p>
              : <RevisionDiff oldText={comparison.from.content} newText={comparison.to.content} />}
          </div>
        </section>}
        <ol aria-label="全部修订" className="mt-8 divide-y divide-border border-t border-border">
          {revisions.map((revision, index) => <li key={revision.id} className="flex flex-col gap-2 py-5" data-testid="history-revision">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
              <strong className="text-sm">修订 #{revision.id}</strong>
              {index === 0 && <StatusChip tone="accent">当前修订</StatusChip>}
              <StatusChip tone="outline">{revisionSourceLabels[revision.source]}</StatusChip>
              {revision.rollbackFromId && <StatusChip tone="outline">回滚自 #{revision.rollbackFromId}</StatusChip>}
              <time dateTime={revision.createdAt.toISOString()} className="text-xs text-muted-foreground">{revision.createdAt.toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" })}</time>
              {isAdmin && !page.deletedAt && ((page.type !== "term" && page.type !== "interpreter") || revision.snapshot) && <PageAction pageId={page.id} action="rollback" revisionId={revision.id} />}
            </div>
            {revision.snapshot
              ? <details className="text-sm"><summary className="min-h-11 cursor-pointer py-1 text-muted-foreground hover:text-foreground">查看词条信息快照</summary>
                <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 rounded-md border border-border bg-muted/40 p-3 text-sm">
                  <dt className="text-muted-foreground">标题</dt><dd className="min-w-0 whitespace-pre-wrap break-words">{revision.snapshot.title}</dd>
                  <dt className="text-muted-foreground">简介</dt><dd className="min-w-0 whitespace-pre-wrap break-words">{revision.snapshot.summary || "（空）"}</dd>
                  {revision.snapshot.type === "term" && <><dt className="text-muted-foreground">别名</dt><dd className="min-w-0 whitespace-pre-wrap break-words">{revision.snapshot.aliases.length ? revision.snapshot.aliases.map((alias, i) => <div key={i}>{alias}</div>) : "（空）"}</dd></>}
                  <dt className="text-muted-foreground">关键文本</dt><dd className="whitespace-pre-wrap">{formatKeyTexts(revision.snapshot.keyTexts)}</dd>
                </dl>
                {revision.snapshot.keyTexts === undefined && <p className="mt-2 text-sm text-muted-foreground">{missingKeyTextsNote}</p>}
              </details>
              : <>
                {page.type === "term" && <p className="text-sm text-muted-foreground">{legacyTermHistoryNote}</p>}
                <details className="text-sm"><summary className="min-h-11 cursor-pointer py-1 text-muted-foreground hover:text-foreground">查看修订正文</summary><pre className="mt-2 whitespace-pre-wrap break-words rounded-md border border-border bg-muted/40 p-3 text-sm [overflow-wrap:anywhere]">{revision.content}</pre></details>
                </>}
          </li>)}
        </ol>
      </> : <p className="mt-8 text-sm text-muted-foreground">此页面暂无正文修订。</p>}
    </PageContainer>
  );
}
