import { hasAdminRole } from "@/lib/roles";
// 词条编辑全量信息框，视角编辑 Markdown；各自基于本页独立修订。

import Link from "next/link";
import { notFound } from "next/navigation";

import { PageContainer } from "@/components/page-container";
import { LoginRequired, TaskPageHeader } from "@/components/task-page";
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
      <PageContainer className="max-w-3xl">
        <TaskPageHeader
          breadcrumb={[{ label: "首页", href: "/" }, { label: `编辑 ${page.title}` }]}
          kicker="编者任务 · 编辑"
          title="需要登录才能编辑"
          description="编辑以「提交」的形式进入审核队列；注册成为编者即可参与共建。"
        />
        <LoginRequired title="登录后开始编辑" next={`/edit/${(await params).pageKey}`} />
      </PageContainer>
    );
  }

  if (page.type === "term" || page.type === "interpreter") {
    const { snapshot, baseRevisionId } = await (page.type === "term" ? getTermEditingState(id) : getInterpreterEditingState(id));
    const pageHref = pagePath(page.type, page.slug, id);
    return <PageContainer className="max-w-3xl">
      <TaskPageHeader
        breadcrumb={[{ label: "首页", href: "/" }, { label: page.title, href: pageHref }, { label: "编辑页面信息" }]}
        kicker="编者任务 · 编辑"
        title={`编辑页面信息：${page.title}`}
        description={
          <>
            <p>修改词条标题、简介和别名。正文请在对应具名诠释者的视角中编辑；别名仅用于展示。</p>
            <p>
              {hasAdminRole(sessionUser.role)
                ? "管理员提交不经审核，直接产生修订并重建双链。"
                : "提交进入审核队列，需管理员受理后生效。"}
            </p>
          </>
        }
      />
      <div className="mt-8">
        <SubmissionForm variant={page.type === "term" ? "edit_term" : "edit_interpreter"} isAdmin={hasAdminRole(sessionUser.role)} pageId={id} initialMetadata={snapshot} baseRevisionId={baseRevisionId} />
      </div>
      <p className="mt-6 text-sm">
        <Link href={pageHref} className="text-muted-foreground underline-offset-4 hover:text-foreground hover:underline">
          返回{page.type === "term" ? "词条" : "诠释者"} →
        </Link>
      </p>
    </PageContainer>;
  }

  const detail = await getPerspectiveDetail(id);
  if (!detail) notFound();
  const editingState = await getPerspectiveEditingState(id);
  // base 修订是并发防护的锚点（ADR-0004 #2），缺失即不可编辑
  if (!editingState) notFound();
  const { content, baseRevisionId, linkTargets } = editingState;

  const termHref = pagePath("term", detail.termSlug, detail.termId);

  return (
    <PageContainer className="max-w-3xl">
      <TaskPageHeader
        breadcrumb={[
          { label: "首页", href: "/" },
          { label: detail.termTitle, href: termHref },
          { label: `编辑 ${detail.title}` },
        ]}
        kicker="编者任务 · 编辑"
        title={`编辑：${detail.title}`}
        description={
          <p>
            {hasAdminRole(sessionUser.role)
              ? "管理员提交不经审核，直接产生修订并重建双链。"
              : "提交进入审核队列，需管理员受理后生效。"}
          </p>
        }
      />

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
    </PageContainer>
  );
}
