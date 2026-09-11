import { hasAdminRole } from "@/lib/roles";
// 新建视角：选词条 × 诠释者，编辑正文后提交进审核队列。
// 入口在词条页（「撰写视角」，带 term 预选）。

import Link from "next/link";

import { SubmissionForm } from "@/components/submission-form";
import { listInterpreters, listPerspectivePairs, listTerms } from "@/lib/content";
import { getSessionUser } from "@/lib/session";

export const dynamic = "force-dynamic";

type Params = { searchParams: Promise<{ term?: string }> };

export default async function NewPerspectivePage({ searchParams }: Params) {
  const sessionUser = await getSessionUser();
  if (!sessionUser) {
    return (
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8">
        <h1 className="text-2xl font-bold tracking-tight">需要登录才能撰写视角</h1>
        <p className="mt-3 text-sm text-muted-foreground">
          视角是站内的原子知识单位；注册成为编者即可参与共建。
        </p>
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

  const [terms, interpreters, existingPerspectives] = await Promise.all([
    listTerms(), listInterpreters(), listPerspectivePairs(),
  ]);
  const termParam = Number((await searchParams).term);
  const presetTermId =
    Number.isSafeInteger(termParam) && terms.some((term) => term.id === termParam)
      ? termParam
      : null;

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8">
      <nav aria-label="面包屑" className="mb-4 text-sm text-muted-foreground">
        <Link href="/" className="hover:text-foreground">
          首页
        </Link>
        <span className="mx-1.5">/</span>
        <span aria-current="page">新建视角</span>
      </nav>

      <h1 className="text-2xl font-bold tracking-tight">新建视角</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        视角 =「诠释者 × 词条」的一次完整诠释；同一诠释者对同一词条只能有一个视角。
        {hasAdminRole(sessionUser.role)
          ? "管理员提交不经审核，直接产生修订并重建双链。"
          : "提交进入审核队列，需管理员受理后生效。"}
      </p>

      <div className="mt-8">
        <SubmissionForm
          variant="new_perspective"
          isAdmin={hasAdminRole(sessionUser.role)}
          terms={terms.map((term) => ({ id: term.id, label: term.title }))}
          interpreters={interpreters
            .map((interpreter) => ({ id: interpreter.pageId, label: interpreter.name }))}
          presetTermId={presetTermId}
          existingPerspectives={existingPerspectives}
        />
      </div>
    </main>
  );
}
