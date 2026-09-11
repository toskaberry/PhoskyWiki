import { and, eq, isNull, or, sql } from "drizzle-orm";
import type { Db } from "@/db";
import { accessGrants, roleChanges, user } from "@/db/schema";
import { lockRoleManagement } from "@/lib/role-lock";

/** Maintenance CLI only: exact identity, first assignment only, replay-safe. */
export async function bootstrapSuperAdmin(db: Db, id: string, name: string) {
  return db.transaction(async tx => {
    await lockRoleManagement(tx);
    const matches = await tx.select().from(user).where(sql`lower(${user.name}) = lower(${name})`);
    const target = matches[0];
    if (matches.length !== 1 || target.id !== id || target.name !== name || !["admin", "superadmin"].includes(target.role)) {
      throw new Error("SUPERADMIN_TARGET: exact unique administrator name and ID required");
    }
    if (target.role === "superadmin") return { promoted: false, alreadySuperAdmin: true, userId: id };
    const existing = await tx.select({ id: user.id }).from(user).where(eq(user.role, "superadmin")).limit(1);
    if (existing.length) throw new Error("SUPERADMIN_EXISTS: use the existing super administrator to assign roles");
    await tx.update(user).set({ role: "superadmin", updatedAt: new Date() }).where(eq(user.id, id));
    await tx.insert(roleChanges).values({ actorId: "maintenance:initial-superadmin", targetUserId: id, previousRole: target.role, newRole: "superadmin" });
    await tx.update(accessGrants).set({ revokedAt: new Date() }).where(and(isNull(accessGrants.consumedAt), isNull(accessGrants.revokedAt), or(eq(accessGrants.targetUserId, id), eq(accessGrants.issuedBy, id))));
    return { promoted: true, alreadySuperAdmin: false, userId: id };
  });
}
