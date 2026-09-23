import { hasAdminRole } from "@/lib/roles";
// 新建诠释者（T06）：诠释者是给出诠释的思想家（不是页面撰写者），
// 名称 + 一句话简介，提交进审核队列。

import { PageContainer } from "@/components/page-container";
import { LoginRequired, TaskPageHeader } from "@/components/task-page";
import { SubmissionForm } from "@/components/submission-form";
import { getSessionUser } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function NewInterpreterPage() {
  const sessionUser = await getSessionUser();
  if (!sessionUser) {
    return (
      <PageContainer className="max-w-3xl">
        <TaskPageHeader
          breadcrumb={[{ label: "首页", href: "/" }, { label: "新建诠释者" }]}
          kicker="编者任务 · 创建"
          title="需要登录才能创建诠释者"
          description="注册成为编者即可参与共建，创建申请经管理员受理后生效。"
        />
        <LoginRequired title="登录后开始创建诠释者" next="/new/interpreter" />
      </PageContainer>
    );
  }

  return (
    <PageContainer className="max-w-3xl">
      <TaskPageHeader
        breadcrumb={[{ label: "首页", href: "/" }, { label: "新建诠释者" }]}
        kicker="编者任务 · 创建"
        title="新建诠释者"
        description={
          <>
            <p>
              诠释者是对词条给出诠释的思想家（如拉康、霍布斯鲍尔），可以已故；
              注意区分页面的撰写者（编者）。
            </p>
            <p>
              {hasAdminRole(sessionUser.role)
                ? "管理员提交不经审核，直接生效。"
                : "提交进入审核队列，需管理员受理后生效。"}
            </p>
          </>
        }
      />

      <div className="mt-8">
        <SubmissionForm
          variant="new_interpreter"
          isAdmin={hasAdminRole(sessionUser.role)}
        />
      </div>
    </PageContainer>
  );
}
