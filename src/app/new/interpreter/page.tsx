import { hasAdminRole } from "@/lib/roles";
// 新建诠释者（T06）：诠释者是给出诠释的思想家（不是页面撰写者），
// 名称 + 一句话简介，提交进审核队列。

import Link from "next/link";

import { SubmissionForm } from "@/components/submission-form";
import { getSessionUser } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function NewInterpreterPage() {
  const sessionUser = await getSessionUser();
  if (!sessionUser) {
    return (
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8">
        <h1 className="text-2xl font-bold tracking-tight">需要登录才能创建诠释者</h1>
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
        <span aria-current="page">新建诠释者</span>
      </nav>

      <h1 className="text-2xl font-bold tracking-tight">新建诠释者</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        诠释者是对词条给出诠释的思想家（如拉康、霍布斯鲍尔），可以已故；
        注意区分页面的撰写者（编者）。
        {hasAdminRole(sessionUser.role)
          ? "管理员提交不经审核，直接生效。"
          : "提交进入审核队列，需管理员受理后生效。"}
      </p>

      <div className="mt-8">
        <SubmissionForm
          variant="new_interpreter"
          isAdmin={hasAdminRole(sessionUser.role)}
        />
      </div>
    </main>
  );
}
