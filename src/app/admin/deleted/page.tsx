import { hasAdminRole } from "@/lib/roles";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { PageContainer } from "@/components/page-container";
import { TaskPageHeader } from "@/components/task-page";
import { PageAction } from "@/components/page-action";
import { listDeletedPages } from "@/lib/history";
import { getSessionUser } from "@/lib/session";

export const dynamic = "force-dynamic";
export const metadata = { title: "已删除页面" };

export default async function DeletedPages() {
  const user = await getSessionUser();
  if (!user) redirect("/login?next=/admin/deleted");
  if (!hasAdminRole(user.role)) notFound();
  const pages = await listDeletedPages(user);
  return <PageContainer className="max-w-4xl">
    <TaskPageHeader
      breadcrumb={[{ label: "首页", href: "/" }, { label: "已删除页面" }]}
      kicker="管理 · 回收站"
      title="已删除页面"
      description="内容与修订历史均已保留，可查看历史或恢复页面。"
    />
    {pages.length ? <ul className="mt-8 divide-y divide-border border-t border-border">
      {pages.map((page) => <li key={page.id} className="flex flex-wrap items-center justify-between gap-3 py-4">
        <Link href={`/history/${page.id}`} className="min-w-0 underline-offset-4 hover:underline [overflow-wrap:anywhere]">
          <span className="font-medium">{page.title}</span>
          <span className="ml-2 text-sm text-muted-foreground">修订历史</span>
        </Link>
        <PageAction pageId={page.id} action="restore" />
      </li>)}
    </ul> : <div className="mt-8 rounded-lg border border-border bg-card p-6 text-sm">
      <p className="font-medium">暂无已删除页面。</p>
      <p className="mt-2 text-muted-foreground">软删除的词条与页面会集中出现在这里，供恢复。</p>
    </div>}
  </PageContainer>;
}
