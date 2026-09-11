import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { afterAll, expect, it } from "vitest";
import { GET, POST } from "@/app/api/admin/users/route";
import { auth } from "@/lib/auth";
import { getDb } from "@/db";
import { user, type UserRole } from "@/db/schema";
import { fixtureSignUp } from "./auth-fixture";
import { POST as submit } from "@/app/api/submissions/route";
import { POST as manage } from "@/app/api/admin/pages/[pageId]/route";
import { GET as history } from "@/app/api/pages/[pageId]/history/route";
import { POST as grants } from "@/app/api/admin/access/route";
import { POST as resetPassword } from "@/app/api/access/reset/route";
import { pages, submissions } from "@/db/schema";
import { seedDatabase } from "@/db/seed";
import { POST as vote } from "@/app/api/admin/submissions/[id]/review/route";
import { bootstrapSuperAdmin } from "@/db/bootstrap-superadmin";

const ids: string[] = [];
async function actor(role: UserRole) {
  const email = `roles-${randomUUID()}@example.com`;
  const password = "roles-test-password123";
  const signed = await fixtureSignUp({ body: { name: email, email, password } });
  ids.push(signed.user.id);
  await getDb().update(user).set({ role }).where(eq(user.id, signed.user.id));
  const response = await auth.api.signInEmail({ body: { email, password }, asResponse: true });
  return { id: signed.user.id, email, cookie: response.headers.getSetCookie().map(c => c.split(";")[0]).join("; ") };
}
function request(cookie = "", body?: unknown, query = "") {
  return new Request(`http://localhost:3000/api/admin/users${query}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { cookie, origin: "http://localhost:3000", "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
afterAll(async () => {
  if (ids.length) {
    await getDb().delete(pages).where(inArray(pages.createdBy, ids));
    await getDb().delete(submissions).where(inArray(submissions.submittedBy, ids));
  }
  if (ids.length) await getDb().delete(user).where(inArray(user.id, ids));
});

it("超级管理员可查找用户并调整角色，原会话在降级后的下一次请求失去权限", async () => {
  const owner = await actor("superadmin");
  const target = await actor("editor");
  for (const role of ["admin", "superadmin", "editor"]) {
    expect((await POST(request(owner.cookie, { userId: target.id, role }))).status).toBe(200);
    const listing = await GET(request(owner.cookie, undefined, `?q=${encodeURIComponent(target.email)}`));
    expect(listing.headers.get("cache-control")).toContain("no-store");
    const result = await listing.json();
    expect(result.users).toEqual([{ id: target.id, name: target.email, email: target.email, role }]);
    expect(result.changes[0]).toMatchObject({ actorId: owner.id, targetUserId: target.id, newRole: role });
    expect((await GET(request(target.cookie))).status).toBe(role === "superadmin" ? 200 : 403);
  }
  expect((await POST(request(owner.cookie, { userId: owner.id, role: "editor" }))).status).toBe(409);
  expect((await POST(request(owner.cookie, { userId: target.id, role: "trusted" }))).status).toBe(400);
  expect((await GET(request(owner.cookie, undefined, "?page=0"))).status).toBe(400);
});

it("两个超级管理员并发互相降级时只允许一方成功", async () => {
  const first = await actor("superadmin");
  const second = await actor("superadmin");
  const results = await Promise.all([
    POST(request(first.cookie, { userId: second.id, role: "editor" })),
    POST(request(second.cookie, { userId: first.id, role: "editor" })),
  ]);
  expect(results.map(r => r.status).sort()).toEqual([200, 403]);
  expect((await Promise.all([GET(request(first.cookie)), GET(request(second.cookie))])).filter(r => r.status === 200)).toHaveLength(1);
});

it("超级管理员直接发布并可删除恢复词条、查看删除后的历史", async () => {
  await seedDatabase();
  const owner = await actor("superadmin");
  const result = await submit(request(owner.cookie, { kind: "new_term", title: `超管-${randomUUID()}`, summary: "超管直接发布" }));
  expect(result.status).toBe(201);
  const created = await result.json();
  expect(created.outcome).toBe("direct");
  const pageId = String(created.pageId);
  const context = { params: Promise.resolve({ pageId }) };
  expect((await manage(request(owner.cookie, { action: "delete" }), context)).status).toBe(200);
  expect((await history(request(), context)).status).toBe(404);
  expect((await history(request(owner.cookie), context)).status).toBe(200);
  expect((await manage(request(owner.cookie, { action: "restore" }), context)).status).toBe(200);
  expect((await history(request(), context)).status).toBe(200);
});

it("管理员不能通过恢复令牌接管超级管理员，提权撤销此前签发的恢复令牌", async () => {
  const owner = await actor("superadmin");
  const admin = await actor("admin");
  const target = await actor("editor");
  expect((await grants(request(admin.cookie, { action: "issue", purpose: "reset", targetUserId: owner.id }))).status).toBe(403);
  const issued = await grants(request(admin.cookie, { action: "issue", purpose: "reset", targetUserId: target.id }));
  expect(issued.status).toBe(201);
  const { token } = await issued.json();
  expect((await POST(request(owner.cookie, { userId: target.id, role: "superadmin" }))).status).toBe(200);
  expect((await resetPassword(request("", { token, password: "new-password-12345" }))).status).toBe(400);
});

it("一位超级管理员和一位管理员组成两票审核，超级管理员只计一票", async () => {
  const original = await getDb().select({ id: user.id, role: user.role }).from(user);
  try {
    await getDb().update(user).set({ role: "editor" });
    const owner = await actor("superadmin");
    const admin = await actor("admin");
    const editor = await actor("editor");
    const result = await submit(request(editor.cookie, { kind: "new_term", title: `两票-${randomUUID()}`, summary: "需要两位管理员受理" }));
    const created = await result.json();
    expect(created).toMatchObject({ outcome: "pending", quorum: 2 });
    const context = { params: Promise.resolve({ id: String(created.submissionId) }) };
    const first = await vote(request(owner.cookie, { action: "approve" }), context);
    expect(await first.json()).toMatchObject({ outcome: "pending", approveCount: 1, quorum: 2 });
    expect((await vote(request(owner.cookie, { action: "approve" }), context)).status).toBe(409);
    expect(await (await vote(request(admin.cookie, { action: "approve" }), context)).json()).toMatchObject({ outcome: "approved" });
  } finally {
    for (const row of original) await getDb().update(user).set({ role: row.role }).where(eq(user.id, row.id));
  }
});

it("首次提权要求准确唯一账号，重试不改权限，已有超级管理员时拒绝再次初始化", async () => {
  const original = await getDb().select({ id: user.id, role: user.role }).from(user);
  try {
    await getDb().update(user).set({ role: "editor" });
    const owner = await actor("admin");
    const other = await actor("admin");
    await expect(bootstrapSuperAdmin(getDb(), other.id, owner.email)).rejects.toThrow("SUPERADMIN_TARGET");
    expect(await bootstrapSuperAdmin(getDb(), owner.id, owner.email)).toMatchObject({ promoted: true });
    expect(await bootstrapSuperAdmin(getDb(), owner.id, owner.email)).toMatchObject({ promoted: false, alreadySuperAdmin: true });
    await expect(bootstrapSuperAdmin(getDb(), other.id, other.email)).rejects.toThrow("SUPERADMIN_EXISTS");
    expect((await GET(request(owner.cookie))).status).toBe(200);
  } finally {
    for (const row of original) await getDb().update(user).set({ role: row.role }).where(eq(user.id, row.id));
  }
});

it("游客、编者和管理员都不能读取用户列表或修改权限", async () => {
  expect((await GET(request())).status).toBe(401);
  for (const role of ["editor", "admin"] as const) {
    const signed = await actor(role);
    expect((await GET(request(signed.cookie))).status).toBe(403);
    expect((await POST(request(signed.cookie, { userId: signed.id, role: "superadmin" }))).status).toBe(403);
  }
});
