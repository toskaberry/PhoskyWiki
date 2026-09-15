import { auth } from "@/lib/auth";
import { writeLimitResponse } from "@/lib/write-limits";
import { createThoughtReply, thoughtId, thoughtResponse } from "@/lib/passage-thoughts";

type Context = { params: Promise<{ thoughtId: string }> };

/** 感想下的扁平回复（spec 0009 #73）：目标未删除、页面在线、词条未锁定。 */
export async function POST(req: Request, context: Context) {
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session) return Response.json({ error: "回复需要登录" }, { status: 401 });
  const limited = await writeLimitResponse(session.user.id);
  if (limited) return limited;
  return thoughtResponse(async () => {
    const body = await req.json().catch(() => null);
    const { content } = (body ?? {}) as { content?: unknown };
    return Response.json(
      await createThoughtReply(thoughtId((await context.params).thoughtId), content, session.user.id),
      { status: 201 },
    );
  });
}
