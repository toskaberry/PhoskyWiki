import Link from "next/link";
import { listPageComments } from "@/lib/page-comments";
import { PageCommentComposer, DeletePageComment } from "@/components/page-comment-actions";

export async function PageComments({ pageId, href, title, userId }: {
  pageId: number; href: string; title: string; userId?: string;
}) {
  const comments = await listPageComments(pageId);
  return <section id="comments" aria-label={title} className="mt-10 scroll-mt-8 border-t border-border pt-6">
    <h2 className="text-xl font-semibold">{title}</h2>
    <p className="mt-1 text-sm text-muted-foreground">{comments.length} 条评论 · 最新发表在前</p>
    <div className="mt-4 hidden md:block">
      {userId ? <PageCommentComposer pageId={pageId} /> : <p className="text-sm text-muted-foreground">
        <Link href={`/login?redirect=${encodeURIComponent(`${href}#comments`)}`} className="text-primary hover:underline">登录</Link>后即可发表评论。
      </p>}
    </div>
    <p className="mt-4 text-sm text-muted-foreground md:hidden">移动端仅供阅读，请在桌面端发表评论。</p>
    {comments.length === 0 ? <p className="mt-6 text-sm text-muted-foreground">暂无评论。</p> :
      <ol className="mt-6 space-y-4">
        {comments.map(comment => <li key={comment.id} id={`comment-${comment.id}`} className="scroll-mt-8 rounded-lg border border-border p-4">
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <span className="font-medium">{comment.authorName}</span>
            <time dateTime={comment.createdAt.toISOString()} className="text-xs text-muted-foreground">
              {comment.createdAt.toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" })}
            </time>
            {userId === comment.authorId && <DeletePageComment id={comment.id} />}
          </div>
          <p className="mt-2 whitespace-pre-wrap break-words [overflow-wrap:anywhere] text-sm leading-relaxed">{comment.content}</p>
        </li>)}
      </ol>}
  </section>;
}
