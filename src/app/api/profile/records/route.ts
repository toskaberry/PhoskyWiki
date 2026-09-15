import { auth } from "@/lib/auth";
import { listMyRecords } from "@/lib/personal-records";

export async function GET(request: Request) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) return Response.json({ error: "查看个人记录需要登录" }, { status: 401 });
  const kind = new URL(request.url).searchParams.get("kind");
  if (kind !== null && kind !== "comment" && kind !== "thought" && kind !== "reply") {
    return Response.json({ error: "记录类型无效" }, { status: 400 });
  }
  return Response.json(await listMyRecords(session.user.id, kind ?? undefined), { headers: { "cache-control": "private, no-store" } });
}
