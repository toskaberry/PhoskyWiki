import { randomUUID } from "node:crypto";
import { hashPassword } from "better-auth/crypto";
import { and, eq, sql } from "drizzle-orm";
import type { Db } from "@/db";
import { account, user } from "@/db/schema";
import { CREDENTIAL_ISSUER } from "@/lib/credential";
import { hasAdminRole } from "@/lib/roles";

export interface InitialAdmin { name: string; email: string; password: string }

/** Only called after CLI configuration/target validation. No demo seed imports. */
export async function bootstrapProduction(db: Db, admins: InitialAdmin[]) {
  return db.transaction(async tx => {
    await tx.execute(sql`select pg_advisory_xact_lock(73501, 1)`);
    // Also exclude racing registration/role changes until all preflight checks
    // and inserts commit. Always acquire these locks in this order.
    await tx.execute(sql`lock table "user", account in share row exclusive mode`);
    const existing = [];
    for (const admin of admins) {
      const matches = await tx.select().from(user).where(sql`lower(${user.email}) = ${admin.email}`);
      if (matches.length > 1 || (matches[0] && (!hasAdminRole(matches[0].role) || matches[0].email !== admin.email))) {
        throw new Error("ADMIN_CONFLICT: existing email is not an unambiguous administrator; no changes made");
      }
      const editor = matches[0];
      if (editor) {
        const credentials = await tx.select().from(account).where(and(eq(account.userId, editor.id), eq(account.providerId, "credential")));
        if (credentials.length !== 1 || credentials[0].accountId !== editor.id || credentials[0].issuer !== CREDENTIAL_ISSUER || !credentials[0].password) {
          throw new Error("ADMIN_CREDENTIAL_CONFLICT: existing administrator needs account recovery; no changes made");
        }
      }
      existing.push(editor);
    }
    let createdAdmins = 0;
    for (const [index, admin] of admins.entries()) {
      if (existing[index]) continue;
      const id = randomUUID();
      const password = await hashPassword(admin.password);
      await tx.insert(user).values({ id, name: admin.name, email: admin.email, role: "admin", emailVerified: true });
      await tx.insert(account).values({ userId: id, accountId: id, providerId: "credential", issuer: CREDENTIAL_ISSUER, password });
      createdAdmins++;
    }
    return { createdAdmins };
  });
}
