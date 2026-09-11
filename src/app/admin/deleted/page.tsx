import { hasAdminRole } from "@/lib/roles";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
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
  return <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8">
    <h1 className="text-3xl font-bold">已删除页面</h1>
    <p className="my-4 text-muted-foreground">内容与修订历史均已保留，可查看历史或恢复页面。</p>
    <ul className="divide-y divide-border">{pages.map((page) => <li key={page.id} className="flex flex-wrap items-center justify-between gap-3 py-4">
      <Link href={`/history/${page.id}`} className="underline-offset-4 hover:underline">{page.title} · 修订历史</Link>
      <PageAction pageId={page.id} action="restore" />
    </li>)}</ul>
    {!pages.length && <p>暂无已删除页面。</p>}
  </main>;
}
