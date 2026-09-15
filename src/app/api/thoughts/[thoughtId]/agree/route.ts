import { auth } from "@/lib/auth";
import { setThoughtAgree, thoughtId, thoughtResponse } from "@/lib/passage-thoughts";

type Context = { params: Promise<{ thoughtId: string }> };

/** 赞同与取消都是「设定」而非翻转：重复请求幂等，不能赞同自己的感想（spec 0009 Q23）。 */
async function apply(req: Request, context: Context, agree: boolean) {
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session) return Response.json({ error: "赞同需要登录" }, { status: 401 });
  return thoughtResponse(async () =>
    Response.json(await setThoughtAgree(thoughtId((await context.params).thoughtId), session.user.id, agree)));
}

export async function POST(req: Request, context: Context) {
  return apply(req, context, true);
}

export async function DELETE(req: Request, context: Context) {
  return apply(req, context, false);
}
