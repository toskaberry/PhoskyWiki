import { auth } from "@/lib/auth";
import { writeLimitResponse } from "@/lib/write-limits";
import { createThought, thoughtResponse } from "@/lib/passage-thoughts";

export async function POST(req: Request) {
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session) return Response.json({ error: "写想法需要登录" }, { status: 401 });
  const limited = await writeLimitResponse(session.user.id);
  if (limited) return limited;
  return thoughtResponse(async () => {
    // 请求体各字段由 createThought 统一校验（thoughtResponse 转 4xx 响应）
    const body = await req.json().catch(() => null);
    const { pageId, anchor, content, visibility, style, confirmRevisionChange } = (body ?? {}) as Record<string, unknown>;
    return Response.json(
      await createThought({ pageId, anchor, content, visibility, style, confirmRevisionChange }, session.user.id),
      { status: 201 },
    );
  });
}
