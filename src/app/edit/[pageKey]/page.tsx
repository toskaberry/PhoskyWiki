import { hasAdminRole } from "@/lib/roles";
// 词条编辑全量信息框，视角编辑 Markdown；各自基于本页独立修订。

import Link from "next/link";
import { notFound } from "next/navigation";

import { SubmissionForm } from "@/components/submission-form";
import {
  getPerspectiveEditingState,
  getLivePage,
  getPerspectiveDetail,
} from "@/lib/content";
import { pageIdFromKey, pagePath } from "@/lib/slug";
import { getSessionUser } from "@/lib/session";
import { getTermEditingState, getInterpreterEditingState } from "@/lib/review";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ pageKey: string }> };

export default async function EditPage({ params }: Params) {
  const id = pageIdFromKey((await params).pageKey);
  if (!id) notFound();
  const page = await getLivePage(id);
  // 词条信息与视角正文共用提交管线，保持各自编辑边界。
  if (!page || (page.type !== "perspective" && page.type !== "term" && page.type !== "interpreter")) notFound();

  const sessionUser = await getSessionUser();
  if (!sessionUser) {
    return (
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8">
        <h1 className="text-2xl font-bold tracking-tight">需要登录才能编辑</h1>
        <p className="mt-3 text-sm text-muted-foreground">
          编辑以「提交」的形式进入审核队列；注册成为编者即可参与共建。
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

  if (page.type === "term" || page.type === "interpreter") {
    const { snapshot, baseRevisionId } = await (page.type === "term" ? getTermEditingState(id) : getInterpreterEditingState(id));
    return <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8">
      <Link href={pagePath(page.type, page.slug, id)} className="text-sm text-muted-foreground">返回词条 →</Link>
      <h1 className="mt-4 text-2xl font-bold">编辑页面信息：{page.title}</h1>
      <p className="my-4 text-sm text-muted-foreground">修改词条标题、简介和别名。正文请在对应具名诠释者的视角中编辑；别名仅用于展示。</p>
      <SubmissionForm variant={page.type === "term" ? "edit_term" : "edit_interpreter"} isAdmin={hasAdminRole(sessionUser.role)} pageId={id} initialMetadata={snapshot} baseRevisionId={baseRevisionId} />
    </main>;
  }

  const detail = await getPerspectiveDetail(id);
  if (!detail) notFound();
  const editingState = await getPerspectiveEditingState(id);
  // base 修订是并发防护的锚点（ADR-0004 #2），缺失即不可编辑
  if (!editingState) notFound();
  const { content, baseRevisionId, linkTargets } = editingState;

  const termHref = pagePath("term", detail.termSlug, detail.termId);

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8">
      <nav aria-label="面包屑" className="mb-4 text-sm text-muted-foreground">
        <Link href="/" className="hover:text-foreground">
          首页
        </Link>
        <span className="mx-1.5">/</span>
        <Link href={termHref} className="hover:text-foreground">
          {detail.termTitle}
        </Link>
        <span className="mx-1.5">/</span>
        <span aria-current="page">编辑 {detail.title}</span>
      </nav>

      <h1 className="text-2xl font-bold tracking-tight">编辑：{detail.title}</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        {hasAdminRole(sessionUser.role)
          ? "管理员提交不经审核，直接产生修订并重建双链。"
          : "提交进入审核队列，需管理员受理后生效。"}
      </p>

      <div className="mt-8">
        <SubmissionForm
          variant="edit"
          isAdmin={hasAdminRole(sessionUser.role)}
          pageId={id}
          initialContent={content}
          baseRevisionId={baseRevisionId}
          resolvedWikiLinks={[...linkTargets].filter(([, target]) => target.exists || target.unavailable)}
        />
      </div>
    </main>
  );
}
