import { auth } from "@/lib/auth";
import { writeLimitResponse } from "@/lib/write-limits";
import { commentId, commentResponse, setCommentAgree } from "@/lib/page-comments";

/** POST 确保赞同、DELETE 确保取消：两个意图各自幂等，重复请求不重复计数。 */
async function handle(req: Request, commentIdValue: string, agree: boolean, notLoggedInMessage: string) {
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session) return Response.json({ error: notLoggedInMessage }, { status: 401 });
  const limited = await writeLimitResponse(session.user.id);
  if (limited) return limited;
  return commentResponse(async () =>
    Response.json(await setCommentAgree(commentId(commentIdValue), session.user.id, agree)));
}

export async function POST(req: Request, ctx: { params: Promise<{ commentId: string }> }) {
  return handle(req, (await ctx.params).commentId, true, "赞同需要登录");
}

export async function DELETE(req: Request, ctx: { params: Promise<{ commentId: string }> }) {
  return handle(req, (await ctx.params).commentId, false, "取消赞同需要登录");
}
