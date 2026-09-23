import { hasAdminRole } from "@/lib/roles";
import Link from "next/link";
import { PageContainer } from "@/components/page-container";
import { TaskPageHeader } from "@/components/task-page";
import { getSessionUser } from "@/lib/session";
import { ImportForm } from "./import-form";

export const dynamic = "force-dynamic";
export const metadata = { title: "批量导入" };

export default async function ImportPage() {
  const actor = await getSessionUser();
  return <PageContainer className="max-w-3xl">
    <TaskPageHeader
      breadcrumb={[{ label: "首页", href: "/" }, { label: "批量导入" }]}
      kicker="管理 · 导入"
      title="JSON 批量导入"
      description="一次性导入词条与诠释者的导航信息；整批成功后直接发布。"
    />
    <p className="mt-6 text-sm">
      <Link href="/new/term" className="text-muted-foreground underline-offset-4 hover:text-foreground hover:underline">新建词条</Link>
    </p>
    {hasAdminRole(actor?.role)
      ? <div className="mt-6"><ImportForm /></div>
      : <p className="mt-6 rounded-lg border border-border bg-card p-6 text-sm">需要管理员角色才能导入。</p>}
  </PageContainer>;
}
