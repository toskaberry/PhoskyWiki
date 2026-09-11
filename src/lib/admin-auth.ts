import { writeLimitResponse } from "./write-limits";
// 管理员操作的准入（T05 会话角色）：请求经 better-auth 解析数据库会话，
// 未登录 401、已登录但非 admin 403——游客与普通编者都进不了管理员操作。

import { auth } from "@/lib/auth";
import type { UserRole } from "@/db/schema";
import { hasAdminRole } from "@/lib/roles";
import { getDb } from "@/db";
import { user } from "@/db/schema";
import { eq } from "drizzle-orm";

/**
 * 校验管理员身份。返回 null = 通过；否则返回应直接作为响应的错误 Response。
 */
export async function requireAdmin(req: Request): Promise<Response | null> {
  const result = await requireAdminUser(req);
  return result instanceof Response ? result : null;
}

/**
 * 校验管理员身份并返回该管理员（投票去重等需要具体用户 id 的场景）。
 * 返回 Response = 应直接作为响应的错误；否则 { user } 为通过。
 */
export async function requireAdminUser(
  req: Request,
): Promise<{ user: { id: string; role: UserRole } } | Response> {
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session) {
    return Response.json({ error: "管理员操作需要登录" }, { status: 401 });
  }
  // additionalFields 的 role 类型是 string；取值域由 user_role 枚举保证
  const [current] = await getDb().select({ role: user.role }).from(user).where(eq(user.id, session.user.id));
  const role = current?.role;
  if (!role || !hasAdminRole(role)) {
    return Response.json({ error: "需要管理员角色" }, { status: 403 });
  }
  if (!["GET", "HEAD", "OPTIONS"].includes(req.method)) {
    const limited = await writeLimitResponse(session.user.id);
    if (limited) return limited;
  }
  return { user: { id: session.user.id, role } };
}

export async function requireSuperAdminUser(req: Request) {
  const actor = await requireAdminUser(req);
  if (actor instanceof Response) return actor;
  return actor.user.role === "superadmin" ? actor : Response.json({ error: "需要超级管理员角色" }, { status: 403 });
}
