import "server-only";
import { and, asc, count, desc, eq, ilike, isNull, or } from "drizzle-orm";
import { getDb, type Db } from "@/db";
import { accessGrants, roleChanges, user } from "@/db/schema";
import { AccessError } from "@/lib/access-grants";
import { assignableRoles, type AssignableRole } from "@/lib/roles";
import { lockRoleManagement } from "@/lib/role-lock";
import { alias } from "drizzle-orm/pg-core";

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
async function superAdmin(tx: Tx, id: string) {
  const [actor] = await tx.select({ role: user.role }).from(user).where(eq(user.id, id));
  if (actor?.role !== "superadmin") throw new AccessError("需要超级管理员角色", 403);
}

export async function listUsers(actorId: string, q: string, requestedPage: string) {
  if (q.length > 100 || !/^[1-9]\d{0,5}$/.test(requestedPage)) throw new AccessError("搜索词或页码无效");
  const page = Number(requestedPage);
  const pageSize = 20;
  const query = q.trim().replace(/[\\%_]/g, "\\$&");
  return getDb().transaction(async tx => {
    await lockRoleManagement(tx);
    await superAdmin(tx, actorId);
    const filter = query ? or(ilike(user.name, `%${query}%`), ilike(user.email, `%${query}%`)) : undefined;
    const [total] = await tx.select({ count: count() }).from(user).where(filter);
    const users = await tx.select({ id: user.id, name: user.name, email: user.email, role: user.role }).from(user)
      .where(filter).orderBy(asc(user.name), asc(user.id)).limit(pageSize).offset((page - 1) * pageSize);
    const issuer = alias(user, "role_issuer");
    const target = alias(user, "role_target");
    const changes = await tx.select({
      id: roleChanges.id, actorId: roleChanges.actorId, targetUserId: roleChanges.targetUserId,
      actorName: issuer.name, targetName: target.name, previousRole: roleChanges.previousRole,
      newRole: roleChanges.newRole, createdAt: roleChanges.createdAt,
    }).from(roleChanges).leftJoin(issuer, eq(issuer.id, roleChanges.actorId))
      .leftJoin(target, eq(target.id, roleChanges.targetUserId)).orderBy(desc(roleChanges.id)).limit(20);
    return { users, total: total.count, page, pageSize, changes };
  });
}

export async function changeUserRole(actorId: string, targetId: unknown, requestedRole: unknown) {
  if (typeof targetId !== "string" || !targetId || targetId.length > 100 || typeof requestedRole !== "string" || !assignableRoles.includes(requestedRole as AssignableRole)) {
    throw new AccessError("请选择有效用户和权限级别");
  }
  const role = requestedRole as AssignableRole;
  return getDb().transaction(async tx => {
    await lockRoleManagement(tx);
    await superAdmin(tx, actorId);
    const [target] = await tx.select().from(user).where(eq(user.id, targetId)).for("update");
    if (!target) throw new AccessError("用户不存在", 404);
    if (target.role === role) return { user: { id: target.id, role } };
    if (target.id === actorId) throw new AccessError("不能降低自己的权限", 409);
    if (target.role === "superadmin") {
      const [remaining] = await tx.select({ count: count() }).from(user).where(eq(user.role, "superadmin"));
      if (remaining.count <= 1) throw new AccessError("必须保留至少一位超级管理员", 409);
    }
    await tx.update(user).set({ role, updatedAt: new Date() }).where(eq(user.id, targetId));
    await tx.insert(roleChanges).values({ actorId, targetUserId: targetId, previousRole: target.role, newRole: role });
    // Existing reset tokens must not become a route into newly granted powers.
    await tx.update(accessGrants).set({ revokedAt: new Date() }).where(and(
      isNull(accessGrants.consumedAt), isNull(accessGrants.revokedAt),
      or(eq(accessGrants.targetUserId, targetId), eq(accessGrants.issuedBy, targetId)),
    ));
    return { user: { id: targetId, role } };
  });
}
