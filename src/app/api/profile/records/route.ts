import { auth } from "@/lib/auth";
import { listMyRecords, type PersonalRecordKind } from "@/lib/personal-records";

/**
 * 个人界面的「评论与感想」读口（spec 0009 #76）：按类型聚合本人记录。
 * 就地删除与公开性切换走各自资源的写接口（页面评论 /api/comments/<id>、
 * 感想 /api/thoughts/<id>），两者都支持 `?returnTo=` 回到本筛选视图。
 */
export async function GET(request: Request) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) return Response.json({ error: "查看个人记录需要登录" }, { status: 401 });
  const kind = new URL(request.url).searchParams.get("kind");
  if (kind !== null && kind !== "comment" && kind !== "thought" && kind !== "reply") {
    return Response.json({ error: "记录类型无效" }, { status: 400 });
  }
  const records = await listMyRecords(session.user.id, (kind ?? undefined) as PersonalRecordKind | undefined);
  return Response.json(records, { headers: { "cache-control": "private, no-store" } });
}
