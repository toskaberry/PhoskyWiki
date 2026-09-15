import { auth } from "@/lib/auth";
import { afterMutation } from "@/lib/redirect-after-mutation";
import { deleteThought, setThoughtVisibility, thoughtId, thoughtResponse } from "@/lib/passage-thoughts";

type Context = { params: Promise<{ thoughtId: string }> };

/** 删除感想：作者删自己的，管理员软删任何公开感想（占位语义，spec 0009 #71/#73）。 */
export async function DELETE(req: Request, context: Context) {
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session) return Response.json({ error: "删除感想需要登录" }, { status: 401 });
  return thoughtResponse(async () => {
    await deleteThought(thoughtId((await context.params).thoughtId), session.user.id);
    return afterMutation(req);
  });
}

/** 切换可见性（公开 ↔ 仅自己可见）：只有作者本人，转私密即整串退出公共视图（spec 0009 #74）。 */
export async function PATCH(req: Request, context: Context) {
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session) return Response.json({ error: "调整感想需要登录" }, { status: 401 });
  return thoughtResponse(async () => {
    const body = await req.json().catch(() => null);
    const visibility = (body ?? {}) as { visibility?: unknown };
    await setThoughtVisibility(thoughtId((await context.params).thoughtId), visibility.visibility, session.user.id);
    return afterMutation(req);
  });
}
