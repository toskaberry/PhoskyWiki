import { auth } from "@/lib/auth";
import { writeLimitResponse } from "@/lib/write-limits";
import { commentId, commentResponse, createPageComment, PageCommentError } from "@/lib/page-comments";

export async function POST(req: Request) {
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session) return Response.json({ error: "评论需要登录" }, { status: 401 });
  const limited = await writeLimitResponse(session.user.id);
  if (limited) return limited;
  return commentResponse(async () => {
    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new PageCommentError(400, "请求体必须是 JSON 对象");
    return Response.json(await createPageComment(commentId(body.pageId), body.content, session.user.id), { status: 201 });
  });
}
