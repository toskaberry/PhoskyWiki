import { hasAdminRole } from "@/lib/roles";
// 新建词条向导：导航信息框，共用直编/审核管线。

import Link from "next/link";

import { SubmissionForm } from "@/components/submission-form";
import { getSessionUser } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function NewTermPage() {
  const sessionUser = await getSessionUser();
  if (!sessionUser) {
    return (
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8">
        <h1 className="text-2xl font-bold tracking-tight">需要登录才能创建词条</h1>
        <div className="mt-6 flex gap-3 text-sm">
          <Link
            href="/login"
            className="rounded-md border border-border px-3 py-1.5 hover:bg-muted"
          >
            登录
          </Link>
          <Link
            href="/register"
            className="rounded-md border border-border px-3 py-1.5 hover:bg-muted"
          >
            注册
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8">
      <nav aria-label="面包屑" className="mb-4 text-sm text-muted-foreground">
        <Link href="/" className="hover:text-foreground">
          首页
        </Link>
        <span className="mx-1.5">/</span>
        <span aria-current="page">新建词条</span>
      </nav>

      <h1 className="text-2xl font-bold tracking-tight">新建词条</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        填写名称、简介、别名和关键文本。解释正文请在词条创建后另行添加具名诠释者视角。
        {hasAdminRole(sessionUser.role)
          ? "管理员提交不经审核，直接生效。"
          : "提交进入审核队列，需管理员受理后生效。"}
      </p>

      <div className="mt-8">
        <SubmissionForm variant="new_term" isAdmin={hasAdminRole(sessionUser.role)} />
      </div>
      {hasAdminRole(sessionUser.role) && <Link href="/admin/import" className="mt-6 inline-block text-sm underline">批量导入 JSON →</Link>}
    </main>
  );
}
