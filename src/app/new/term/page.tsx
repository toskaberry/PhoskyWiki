import { hasAdminRole } from "@/lib/roles";
// 新建词条向导：导航信息框，共用直编/审核管线。

import Link from "next/link";

import { PageContainer } from "@/components/page-container";
import { LoginRequired, TaskPageHeader } from "@/components/task-page";
import { SubmissionForm } from "@/components/submission-form";
import { getSessionUser } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function NewTermPage() {
  const sessionUser = await getSessionUser();
  if (!sessionUser) {
    return (
      <PageContainer className="max-w-3xl">
        <TaskPageHeader
          breadcrumb={[{ label: "首页", href: "/" }, { label: "新建词条" }]}
          kicker="编者任务 · 创建"
          title="需要登录才能创建词条"
          description="词条是概念的聚合枢纽；注册成为编者即可参与共建，创建申请经管理员受理后生效。"
        />
        <LoginRequired title="登录后开始创建词条" next="/new/term" />
      </PageContainer>
    );
  }

  return (
    <PageContainer className="max-w-3xl">
      <TaskPageHeader
        breadcrumb={[{ label: "首页", href: "/" }, { label: "新建词条" }]}
        kicker="编者任务 · 创建"
        title="新建词条"
        description={
          <>
            <p>填写名称、简介、别名和关键文本。解释正文请在词条创建后另行添加具名诠释者视角。</p>
            <p>
              {hasAdminRole(sessionUser.role)
                ? "管理员提交不经审核，直接生效。"
                : "提交进入审核队列，需管理员受理后生效。"}
            </p>
          </>
        }
      />

      <div className="mt-8">
        <SubmissionForm variant="new_term" isAdmin={hasAdminRole(sessionUser.role)} />
      </div>
      {hasAdminRole(sessionUser.role) && (
        <p className="mt-6 text-sm">
          <Link href="/admin/import" className="text-primary underline-offset-4 hover:underline">
            批量导入 JSON →
          </Link>
        </p>
      )}
    </PageContainer>
  );
}
