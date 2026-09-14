import { auth } from "@/lib/auth";
import { writeLimitResponse } from "@/lib/write-limits";
import { commentId, commentResponse, deletePageCommentReply } from "@/lib/page-comments";

export async function DELETE(req: Request, ctx: { params: Promise<{ replyId: string }> }) {
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session) return Response.json({ error: "删除回复需要登录" }, { status: 401 });
  const limited = await writeLimitResponse(session.user.id);
  if (limited) return limited;
  return commentResponse(async () => {
    await deletePageCommentReply(commentId((await ctx.params).replyId), session.user.id);
    return new Response(null, { status: 204 });
  });
}
