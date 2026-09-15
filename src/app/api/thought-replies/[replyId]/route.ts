import { auth } from "@/lib/auth";
import { afterMutation } from "@/lib/redirect-after-mutation";
import { writeLimitResponse } from "@/lib/write-limits";
import { deleteThoughtReply, thoughtId, thoughtResponse } from "@/lib/passage-thoughts";

type Context = { params: Promise<{ replyId: string }> };

/** 删除感想下的回复：作者物理移除，管理员软删占位（他人私密感想下的回复不可处置）。 */
export async function DELETE(req: Request, context: Context) {
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session) return Response.json({ error: "删除回复需要登录" }, { status: 401 });
  const limited = await writeLimitResponse(session.user.id);
  if (limited) return limited;
  return thoughtResponse(async () => {
    await deleteThoughtReply(thoughtId((await context.params).replyId), session.user.id);
    return afterMutation(req);
  });
}
