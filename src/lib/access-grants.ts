import "server-only";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { hashPassword } from "better-auth/crypto";
import { z } from "zod";
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { getDb, type Db } from "@/db";
import { accessGrants, account, session, user } from "@/db/schema";
import { CREDENTIAL_ISSUER } from "@/lib/credential";
import { administratorRoles, hasAdminRole } from "@/lib/roles";
import { lockRoleManagement } from "@/lib/role-lock";

type Purpose = "invitation" | "reset";
export class AccessError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}
const digest = (purpose: Purpose, token: string) => createHash("sha256").update(`${purpose}:${token}`).digest("hex");
function lifetime(purpose: Purpose) {
  const seconds = Number(process.env[purpose === "invitation" ? "INVITATION_TTL_SECONDS" : "PASSWORD_RESET_TTL_SECONDS"] ?? (purpose === "invitation" ? 604800 : 3600));
  if (!Number.isSafeInteger(seconds) || seconds < 1 || seconds > 31536000) throw new AccessError("令牌有效期配置错误", 503);
  return seconds * 1000;
}
function passwordInput(value: unknown): string {
  if (typeof value !== "string" || value.length < 8 || value.length > 128) throw new AccessError("密码须为 8–128 位");
  return value;
}
function tokenInput(value: unknown): string {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(value)) throw new AccessError("邀请或恢复令牌无效，请联系管理员");
  return value;
}
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
async function consume(tx: Tx, purpose: Purpose, token: string) {
  const [grant] = await tx.select().from(accessGrants).where(eq(accessGrants.digest, digest(purpose, token))).for("update");
  if (!grant || grant.purpose !== purpose) throw new AccessError("邀请或恢复令牌无效，请联系管理员");
  if (grant.revokedAt) throw new AccessError("令牌已撤销，请联系管理员");
  if (grant.consumedAt) throw new AccessError("令牌已使用，请联系管理员");
  if (grant.expiresAt.getTime() <= Date.now()) throw new AccessError("令牌已过期，请联系管理员");
  await tx.update(accessGrants).set({ consumedAt: new Date() }).where(eq(accessGrants.id, grant.id));
  return grant;
}

export async function issueGrant(purpose: Purpose, issuedBy: string, targetUserId?: string) {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + lifetime(purpose));
  return getDb().transaction(async tx => {
    await lockRoleManagement(tx);
    const [issuer] = await tx.select({ role: user.role }).from(user).where(eq(user.id, issuedBy));
    if (!hasAdminRole(issuer?.role)) throw new AccessError("需要管理员角色", 403);
    if (purpose === "reset") {
      const [target] = await tx.select({ role: user.role }).from(user).where(eq(user.id, targetUserId ?? ""));
      if (!target) throw new AccessError("找不到目标账号", 404);
      if (target.role === "superadmin" && issuer.role !== "superadmin") throw new AccessError("恢复超级管理员需要超级管理员权限", 403);
    }
    const [grant] = await tx.insert(accessGrants).values({ purpose, issuedBy, targetUserId: purpose === "reset" ? targetUserId : null, digest: digest(purpose, token), expiresAt }).returning({ id: accessGrants.id });
    return { id: grant.id, token, expiresAt };
  });
}
export async function listGrants() {
  return getDb().select({ id: accessGrants.id, purpose: accessGrants.purpose, targetUserId: accessGrants.targetUserId, createdAt: accessGrants.createdAt, expiresAt: accessGrants.expiresAt, consumedAt: accessGrants.consumedAt, revokedAt: accessGrants.revokedAt }).from(accessGrants).orderBy(desc(accessGrants.createdAt)).limit(100);
}
export async function revokeGrant(id: string) {
  const rows = await getDb().update(accessGrants).set({ revokedAt: new Date() }).where(and(eq(accessGrants.id, id), isNull(accessGrants.consumedAt), isNull(accessGrants.revokedAt))).returning({ id: accessGrants.id });
  if (!rows.length) throw new AccessError("令牌不存在或已失效", 409);
}
export async function registerInvited(input: Record<string, unknown>) {
  const token = tokenInput(input.token);
  const password = passwordInput(input.password);
  if (typeof input.name !== "string" || !input.name.trim() || input.name.length > 100) throw new AccessError("请填写名称（最多 100 字）");
  // Match Better Auth's login validator so registration cannot create unusable accounts.
  if (typeof input.email !== "string" || input.email.length > 254 || !z.email().safeParse(input.email.trim()).success) throw new AccessError("请填写有效邮箱");
  const email = input.email.trim().toLowerCase();
  const name = input.name.trim();
  return getDb().transaction(async tx => {
    await consume(tx, "invitation", token);
    const [existing] = await tx.select({ id: user.id }).from(user).where(sql`lower(${user.email}) = ${email}`);
    if (existing) throw new AccessError("邮箱已注册，请登录或联系管理员恢复账号", 422);
    const passwordHash = await hashPassword(password);
    const [editor] = await tx.insert(user).values({ id: randomUUID(), email, name, role: "editor", emailVerified: false }).onConflictDoNothing().returning();
    if (!editor) throw new AccessError("邮箱已注册，请登录或联系管理员恢复账号", 422);
    await tx.insert(account).values({ userId: editor.id, accountId: editor.id, providerId: "credential", issuer: CREDENTIAL_ISSUER, password: passwordHash });
    return { user: { id: editor.id, email, name, role: editor.role, emailVerified: false } };
  });
}

async function replacePassword(tx: Tx, id: string, password: string) {
  const updated = await tx.update(account).set({ password, updatedAt: new Date() }).where(and(eq(account.userId, id), eq(account.providerId, "credential"), eq(account.issuer, CREDENTIAL_ISSUER), eq(account.accountId, id))).returning({ id: account.id });
  if (updated.length !== 1) throw new AccessError("账号凭据异常，请联系维护者", 409);
  await tx.delete(session).where(eq(session.userId, id));
}
export async function resetWithGrant(input: Record<string, unknown>) {
  const token = tokenInput(input.token);
  const password = passwordInput(input.password);
  await getDb().transaction(async tx => {
    await lockRoleManagement(tx);
    const grant = await consume(tx, "reset", token);
    const [issuer] = await tx.select({ role: user.role }).from(user).where(eq(user.id, grant.issuedBy ?? ""));
    const [target] = await tx.select({ role: user.role }).from(user).where(eq(user.id, grant.targetUserId ?? ""));
    if (!hasAdminRole(issuer?.role) || !target || (target.role === "superadmin" && issuer.role !== "superadmin")) throw new AccessError("恢复资格已失效，请联系管理员", 403);
    await replacePassword(tx, grant.targetUserId!, await hashPassword(password));
  });
}
/** Only the target-validated maintenance process calls this; no HTTP route. */
export async function recoverAdministrator(db: Db, id: string, email: string, newPassword: unknown) {
  const password = await hashPassword(passwordInput(newPassword));
  await db.transaction(async tx => {
    await lockRoleManagement(tx);
    const [target] = await tx.select().from(user).where(and(eq(user.id, id), eq(user.email, email), inArray(user.role, [...administratorRoles]))).for("update");
    if (!target) throw new AccessError("RECOVERY_TARGET: exact administrator ID and email required");
    await replacePassword(tx, id, password);
    await tx.update(accessGrants).set({ revokedAt: new Date() }).where(and(eq(accessGrants.targetUserId, id), isNull(accessGrants.consumedAt), isNull(accessGrants.revokedAt)));
  });
}
