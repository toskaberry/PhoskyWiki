import { auth } from "@/lib/auth";
import { writeLimitResponse } from "@/lib/write-limits";
import { deletePersonalMark, markResponse, positiveId } from "@/lib/passage-marks";

export async function DELETE(req: Request, ctx: { params: Promise<{ markId: string }> }) {
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session) return Response.json({ error: "删除标记需要登录" }, { status: 401 });
  const limited = await writeLimitResponse(session.user.id);
  if (limited) return limited;
  return markResponse(async () => {
    const { markId } = await ctx.params;
    const pageId = positiveId(new URL(req.url).searchParams.get("pageId"), "页面");
    return Response.json(await deletePersonalMark(positiveId(markId, "标记"), pageId, session.user.id));
  });
}
