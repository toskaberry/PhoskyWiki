import { hasAdminRole } from "@/lib/roles";
import { notFound, redirect } from "next/navigation";
import { PageContainer } from "@/components/page-container";
import { TaskPageHeader } from "@/components/task-page";
import { getSessionUser } from "@/lib/session";
import { AccessManager } from "@/components/access-manager";
export const dynamic = "force-dynamic";
export const metadata = { title: "邀请与账号恢复", referrer: "no-referrer" as const };
export default async function AccessPage() {
  const actor = await getSessionUser();
  if (!actor) redirect("/login");
  if (!hasAdminRole(actor.role)) notFound();
  return <PageContainer className="max-w-3xl">
    <TaskPageHeader
      breadcrumb={[{ label: "首页", href: "/" }, { label: "邀请与恢复" }]}
      kicker="管理 · 访问"
      title="邀请与账号恢复"
      description="签发编者邀请与密码恢复的一次性链接；令牌只在签发时显示一次。"
    />
    <div className="mt-8"><AccessManager /></div>
  </PageContainer>;
}
