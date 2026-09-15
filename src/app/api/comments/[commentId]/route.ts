import { auth } from "@/lib/auth";
import { writeLimitResponse } from "@/lib/write-limits";
import { commentId, commentResponse, deletePageComment } from "@/lib/page-comments";

export async function DELETE(req: Request, ctx: { params: Promise<{ commentId: string }> }) {
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session) return Response.json({ error: "删除评论需要登录" }, { status: 401 });
  const limited = await writeLimitResponse(session.user.id);
  if (limited) return limited;
  return commentResponse(async () => {
    await deletePageComment(commentId((await ctx.params).commentId), session.user.id);
    return new Response(null, { status: 204 });
  });
}
