import { auth } from "@/lib/auth";
import { writeLimitResponse } from "@/lib/write-limits";
import { createPersonalMark, markResponse, positiveId } from "@/lib/passage-marks";

export async function POST(req: Request) {
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session) return Response.json({ error: "划线需要登录" }, { status: 401 });
  const limited = await writeLimitResponse(session.user.id);
  if (limited) return limited;
  return markResponse(async () => {
    // 请求体形状与各字段由 createPersonalMark 统一校验（markResponse 转 4xx 响应）
    const body = await req.json().catch(() => null);
    const { pageId, anchor, style } = (body ?? {}) as Record<string, unknown>;
    return Response.json(
      await createPersonalMark(positiveId(pageId, "页面"), { anchor, style }, session.user.id),
      { status: 201 },
    );
  });
}
