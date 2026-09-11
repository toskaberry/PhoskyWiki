import { hasAdminRole } from "@/lib/roles";
// 词条讨论区页（T13）：楼层 + 一层嵌套回复 + 视角锚点 + 版务。
// 游客只读；编者可发言（锁定除外）；管理员可软删楼层、锁定/解锁。
// ?perspective=<pageId> 由视角页「就这个视角发起讨论」带出：预填发言框锚点，
// 只接受本词条的在线视角，其余静默忽略（写路径仍有同一校验兜底）。

import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";

import { DiscussionComposer, type ComposerAnchor } from "@/components/discussion-composer";
import { DiscussionReplyForm } from "@/components/discussion-reply-form";
import {
  DeletePostButton,
  LockDiscussionButton,
} from "@/components/discussion-moderation";
import { getTermDetail, getPerspectiveDetail } from "@/lib/content";
import {
  DISCUSSION_CONTENT_MAX_LENGTH,
  isDiscussionLocked,
  listDiscussionFloors,
} from "@/lib/discussion";
import { formatWhen } from "@/lib/format";
import { pageIdFromKey, pageKey, pagePath } from "@/lib/slug";
import { resolveLivePage } from "@/lib/resolve-page";
import { getSessionUser } from "@/lib/session";

export const dynamic = "force-dynamic";

type Params = {
  params: Promise<{ pageKey: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const id = pageIdFromKey((await params).pageKey);
  if (!id) return {};
  const term = await getTermDetail(id);
  return term ? { title: `「${term.title}」的讨论区` } : {};
}

/** ?perspective= 预填锚点：只认本词条的在线视角（服务端校验，非法静默忽略）。 */
async function resolveComposerAnchor(
  termId: number,
  raw: string | string[] | undefined,
): Promise<ComposerAnchor | null> {
  const value = Array.isArray(raw) ? raw[0] : raw;
  const perspectiveId = Number(value);
  if (value === undefined || !Number.isSafeInteger(perspectiveId) || perspectiveId <= 0) {
    return null;
  }
  const detail = await getPerspectiveDetail(perspectiveId);
  if (!detail || detail.termId !== termId) return null;
  return {
    pageId: detail.id,
    title: detail.title,
    href: pagePath("perspective", detail.slug, detail.id),
  };
}

export default async function TermDiscussionPage({ params, searchParams }: Params) {
  const page = await resolveLivePage("term", (await params).pageKey);
  const term = await getTermDetail(page.id);
  if (!term) notFound();

  const [floors, locked, sessionUser, anchor] = await Promise.all([
    listDiscussionFloors(page.id),
    isDiscussionLocked(page.id),
    getSessionUser(),
    resolveComposerAnchor(page.id, (await searchParams).perspective),
  ]);
  const isAdmin = hasAdminRole(sessionUser?.role);
  const canPost = sessionUser !== null && !locked;
  // 游客登录后回到本讨论区（带 ?perspective= 预填锚点一起带回）
  const loginHref = `/login?redirect=${encodeURIComponent(
    `/term/${pageKey(page.slug, page.id)}/discussion${
      anchor ? `?perspective=${anchor.pageId}` : ""
    }`,
  )}`;

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8">
      <nav aria-label="面包屑" className="mb-4 text-sm text-muted-foreground">
        <Link href="/" className="hover:text-foreground">
          首页
        </Link>
        <span className="mx-1.5">/</span>
        <Link href={pagePath("term", page.slug, page.id)} className="hover:text-foreground">
          {term.title}
        </Link>
        <span className="mx-1.5">/</span>
        <span aria-current="page">讨论区</span>
      </nav>

      <div className="mb-6 flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-2xl font-bold tracking-tight">「{term.title}」的讨论区</h1>
        {isAdmin && <LockDiscussionButton termId={page.id} locked={locked} />}
      </div>

      {locked && (
        <p
          role="note"
          className="mb-6 rounded-md border border-border bg-muted/50 px-4 py-2 text-sm text-muted-foreground"
        >
          本讨论区已被版务锁定：楼层保持可读，暂不能发言。
        </p>
      )}

      {canPost ? (
        <DiscussionComposer
          termId={page.id}
          anchor={anchor}
          maxLength={DISCUSSION_CONTENT_MAX_LENGTH}
        />
      ) : (
        sessionUser === null && (
          <p className="mb-6 rounded-md border border-border bg-card px-4 py-3 text-sm text-muted-foreground">
            讨论区对所有人可读；<Link href={loginHref} className="text-foreground underline-offset-4 hover:underline">登录</Link>
            后即可发言。
          </p>
        )
      )}

      {floors.length === 0 ? (
        <p className="mt-8 text-sm text-muted-foreground">还没有人开楼——来发第一层吧。</p>
      ) : (
        <ol className="mt-8 flex flex-col gap-4" data-testid="discussion-floors">
          {floors.map((floor, index) => (
            <li key={floor.id}>
              <article
                id={`floor-${floor.id}`}
                className="scroll-mt-20 rounded-lg border border-border bg-card px-4 py-3"
              >
                <header className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                  <span className="font-medium text-foreground">{index + 1} 楼</span>
                  <span>{floor.authorName}</span>
                  <time dateTime={floor.createdAt.toISOString()}>
                    {formatWhen(floor.createdAt)}
                  </time>
                  {floor.perspective &&
                    (floor.perspective.live ? (
                      <Link
                        href={pagePath(
                          "perspective",
                          floor.perspective.slug,
                          floor.perspective.pageId,
                        )}
                        className="rounded bg-secondary px-1.5 py-0.5 underline-offset-4 hover:underline"
                      >
                        锚点 · {floor.perspective.title}
                      </Link>
                    ) : (
                      <span className="rounded bg-muted px-1.5 py-0.5">
                        锚点 · {floor.perspective.title}（视角已删除）
                      </span>
                    ))}
                  {isAdmin && !floor.deleted && <DeletePostButton postId={floor.id} />}
                </header>

                {floor.deleted ? (
                  <p className="mt-2 text-sm italic text-muted-foreground">
                    该楼层已被版务删除。
                  </p>
                ) : (
                  <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-relaxed">
                    {floor.content}
                  </p>
                )}

                {canPost && !floor.deleted && (
                  <div className="mt-2">
                    <DiscussionReplyForm
                      termId={page.id}
                      parentId={floor.id}
                      maxLength={DISCUSSION_CONTENT_MAX_LENGTH}
                    />
                  </div>
                )}

                {floor.replies.length > 0 && (
                  <ul className="mt-3 flex flex-col gap-3 border-l-2 border-border pl-4">
                    {floor.replies.map((reply) => (
                      <li key={reply.id} id={`floor-${reply.id}`} className="scroll-mt-20 text-sm">
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                          <span>{reply.authorName}</span>
                          <time dateTime={reply.createdAt.toISOString()}>
                            {formatWhen(reply.createdAt)}
                          </time>
                          {isAdmin && !reply.deleted && (
                            <DeletePostButton postId={reply.id} />
                          )}
                        </div>
                        {reply.deleted ? (
                          <p className="mt-1 italic text-muted-foreground">
                            该回复已被版务删除。
                          </p>
                        ) : (
                          <p className="mt-1 whitespace-pre-wrap break-words leading-relaxed">
                            {reply.content}
                          </p>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </article>
            </li>
          ))}
        </ol>
      )}
    </main>
  );
}
