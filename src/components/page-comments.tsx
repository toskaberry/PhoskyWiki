import Link from "next/link";
import type { SessionUser } from "@/lib/session";
import { hasAdminRole } from "@/lib/roles";
import { listPageComments } from "@/lib/page-comments";
import { AgreePageComment, PageCommentComposer, DeletePageComment } from "@/components/page-comment-actions";
import { PageCommentReplies } from "@/components/page-comment-replies";

export async function PageComments({ pageId, href, title, user }: {
  pageId: number; href: string; title: string; user?: SessionUser | null;
}) {
  const userId = user?.id;
  const comments = await listPageComments(pageId, userId);
  const loginRedirect = `/login?redirect=${encodeURIComponent(`${href}#comments`)}`;
  const viewer = userId ? { id: user.id, isAdmin: hasAdminRole(user.role) } : null;
  return <section id="comments" aria-label={title} className="mt-10 scroll-mt-8 border-t border-border pt-6">
    <h2 className="text-xl font-semibold">{title}</h2>
    <p className="mt-1 text-sm text-muted-foreground">{comments.length} 条评论 · 按赞同数排序，同票新在前</p>
    <div className="mt-4 hidden md:block">
      {userId ? <PageCommentComposer pageId={pageId} /> : <p className="text-sm text-muted-foreground">
        <Link href={loginRedirect} className="text-primary hover:underline">登录</Link>后即可发表评论。
      </p>}
    </div>
    <p className="mt-4 text-sm text-muted-foreground md:hidden">移动端仅供阅读，请在桌面端发表评论。</p>
    {comments.length === 0 ? <p className="mt-6 text-sm text-muted-foreground">暂无评论。</p> :
      <ol className="mt-6 space-y-4">
        {comments.map(comment => <li key={comment.id} id={`comment-${comment.id}`} className="scroll-mt-8 rounded-lg border border-border p-4">
          {comment.deleted ? <p className="text-sm italic text-muted-foreground">该评论已删除。</p> : <>
            <div className="flex flex-wrap items-center gap-3 text-sm">
              <span className="font-medium">{comment.authorName}</span>
              <time dateTime={comment.createdAt.toISOString()} className="text-xs text-muted-foreground">
                {comment.createdAt.toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" })}
              </time>
              {userId === comment.authorId && <DeletePageComment id={comment.id} />}
              <div className="ml-auto flex items-center gap-3 text-xs text-muted-foreground">
                <span>{comment.agreeCount} 赞同</span>
                {userId !== comment.authorId && <span className="hidden md:inline">
                  {userId ? <AgreePageComment id={comment.id} agreed={comment.agreed} />
                    : <Link href={loginRedirect} title="登录后可赞同" className="hover:text-foreground">赞同</Link>}
                </span>}
              </div>
            </div>
            <p className="mt-2 whitespace-pre-wrap break-words [overflow-wrap:anywhere] text-sm leading-relaxed">{comment.content}</p>
          </>}
          <PageCommentReplies commentId={comment.id} replyable={!comment.deleted} viewer={viewer} replies={comment.replies.map(reply => ({
            id: reply.id, content: reply.content, createdAt: reply.createdAt.toISOString(),
            authorId: reply.authorId, authorName: reply.authorName, deleted: reply.deleted,
          }))} loginRedirect={loginRedirect} />
        </li>)}
      </ol>}
  </section>;
}
