import { randomUUID } from "node:crypto";
import { beforeAll, beforeEach, expect, it } from "vitest";
import { and, eq, inArray } from "drizzle-orm";
import { getDb } from "@/db";
import { seedDatabase } from "@/db/seed";
import { agrees, pages, passageThoughts, personalMarks, replies, revisions, termDiscussions, user } from "@/db/schema";
import { auth } from "@/lib/auth";
import { fixtureSignUp } from "./auth-fixture";
import { canonicalMarkdownText } from "@/lib/passage-body";
import { POST } from "@/app/api/thoughts/route";
import { GET } from "@/app/api/pages/[pageId]/thoughts/route";
import { DELETE, PATCH } from "@/app/api/thoughts/[thoughtId]/route";
import { POST as AGREE, DELETE as UNAGREE } from "@/app/api/thoughts/[thoughtId]/agree/route";
import { POST as REPLY } from "@/app/api/thoughts/[thoughtId]/replies/route";
import { DELETE as DELETE_REPLY } from "@/app/api/replies/[replyId]/route";

let author: { id: string; cookie: string }, other: typeof author, admin: typeof author;
let pageId: number, termId: number;
let anchor: { start: number; end: number; quote: string; baseRevisionId: string };
beforeAll(async () => {
  async function account(name: string) {
    const email = `${randomUUID()}@example.com`, password = "thought-test-password";
    const created = await fixtureSignUp({ body: { name, email, password } });
    const response = await auth.api.signInEmail({ body: { email, password }, asResponse: true });
    return { id: created.user.id, cookie: response.headers.getSetCookie().map(v => v.split(";")[0]).join("; ") };
  }
  author = await account("感想作者"); other = await account("感想读者"); admin = await account("版务");
  await getDb().update(user).set({ role: "admin" }).where(eq(user.id, admin.id));
});
beforeEach(async () => {
  await seedDatabase();
  const rows = await getDb().select().from(pages).where(inArray(pages.title, ["主体性", "拉康论主体性"]));
  pageId = rows.find(r => r.type === "perspective")!.id; termId = rows.find(r => r.type === "term")!.id;
  const [revision] = await getDb().select().from(revisions).where(eq(revisions.pageId, pageId));
  const text = canonicalMarkdownText(revision.content);
  anchor = { start: 0, end: 5, quote: text.slice(0, 5), baseRevisionId: String(revision.id) };
});
const context = (id: number) => ({ params: Promise.resolve({ thoughtId: String(id) }) });
function request(path: string, method: string, cookie = author.cookie, body?: object) {
  return new Request(`http://localhost${path}`, { method, headers: { cookie, "content-type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) });
}
async function create(visibility = "public", extra: object = {}, cookie = author.cookie) {
  return POST(request("/api/thoughts", "POST", cookie, { pageId, anchor, visibility, content: "我的阅读感想", style: "highlight", ...extra }));
}
async function read(cookie = "") {
  const response = await GET(request(`/api/pages/${pageId}/thoughts`, "GET", cookie), { params: Promise.resolve({ pageId: String(pageId) }) });
  expect(response.status).toBe(200); return response.json();
}
async function change(id: number, visibility: string, cookie = author.cookie) {
  return PATCH(request(`/api/thoughts/${id}`, "PATCH", cookie, { visibility }), context(id));
}
async function reply(id: number, cookie = other.cookie) {
  return REPLY(request(`/api/thoughts/${id}/replies`, "POST", cookie, { content: "回复 @感想作者：我的回复" }), context(id));
}

it("creates a public thought and personal mark atomically, preserving quote and revision", async () => {
  const result = await create(); expect(result.status).toBe(201);
  const { id } = await result.json(); const listed = await read();
  expect(listed.thoughts).toEqual([expect.objectContaining({ id, quote: anchor.quote, baseRevisionId: Number(anchor.baseRevisionId), status: "located", authorName: "感想作者" })]);
  const marks = await getDb().select().from(personalMarks).where(eq(personalMarks.userId, author.id));
  expect(marks).toHaveLength(1); expect(marks[0].quote).toBe(anchor.quote);
});
it("private thoughts, replies and personal author details never reach visitors, other readers or admins", async () => {
  const { id } = await (await create("private")).json();
  expect((await read(author.cookie)).thoughts).toHaveLength(1);
  for (const cookie of ["", other.cookie, admin.cookie]) expect((await read(cookie)).thoughts).toEqual([]);
  expect((await reply(id)).status).toBe(404);
  expect((await DELETE(request(`/api/thoughts/${id}`, "DELETE", admin.cookie), context(id))).status).toBe(403);
});
it("visibility change removes the whole conversation publicly and restores it on publication", async () => {
  const { id } = await (await create()).json(); expect((await reply(id)).status).toBe(201);
  expect((await change(id, "private")).status).toBe(204);
  expect((await read(other.cookie)).thoughts).toEqual([]);
  expect((await read(author.cookie)).thoughts[0].replies).toHaveLength(1);
  expect((await change(id, "public")).status).toBe(204);
  expect((await read()).thoughts[0].replies).toHaveLength(1);
  expect((await change(id, "private", other.cookie)).status).toBe(403);
});
it("agrees are unique/idempotent, cannot target self or private thoughts, and order thoughts", async () => {
  const first = await (await create()).json(); await create("public", { content: "较新的感想" });
  expect((await AGREE(request("/", "POST"), context(first.id))).status).toBe(403);
  for (let i = 0; i < 2; i++) expect((await AGREE(request("/", "POST", other.cookie), context(first.id))).status).toBe(200);
  expect((await read()).thoughts[0]).toMatchObject({ id: first.id, agreeCount: 1 });
  for (let i = 0; i < 2; i++) expect((await UNAGREE(request("/", "DELETE", other.cookie), context(first.id))).status).toBe(200);
  expect((await read()).thoughts[0].content).toBe("较新的感想");
  await change(first.id, "private"); expect((await AGREE(request("/", "POST", other.cookie), context(first.id))).status).toBe(404);
});
it("deletion keeps replies as a redacted placeholder, removes empty thoughts and never removes marks", async () => {
  const { id } = await (await create()).json(); await reply(id);
  expect((await DELETE(request("/", "DELETE"), context(id))).status).toBe(204);
  const deleted = (await read()).thoughts[0]; expect(deleted).toMatchObject({ deleted: true, content: "", authorId: "", authorName: "", authorImage: null });
  expect(deleted.replies).toHaveLength(1); expect((await reply(id)).status).toBe(404);
  expect(await getDb().select().from(personalMarks).where(eq(personalMarks.userId, author.id))).toHaveLength(1);
  const empty = await (await create()).json(); await DELETE(request("/", "DELETE"), context(empty.id));
  expect((await read()).thoughts).toHaveLength(1);
});
it("moderation cannot reach another author's private reply thread; reply author can still delete their own record", async () => {
  const { id } = await (await create()).json(); const response = await reply(id); const replyRow = await response.json();
  await change(id, "private");
  const ctx = { params: Promise.resolve({ replyId: String(replyRow.id) }) };
  expect((await DELETE_REPLY(request("/", "DELETE", admin.cookie), ctx)).status).toBe(403);
  expect((await DELETE_REPLY(request("/", "DELETE", other.cookie), ctx)).status).toBe(204);
});
it("lock blocks replies including admins but allows creating thoughts and marks", async () => {
  await getDb().insert(termDiscussions).values({ termId, lockedAt: new Date(), lockedBy: admin.id });
  const result = await create(); expect(result.status).toBe(201); const { id } = await result.json();
  expect((await reply(id)).status).toBe(403); expect((await reply(id, admin.cookie)).status).toBe(403);
});
it("stale publication requires confirmation then preserves the old quote even if the original is gone", async () => {
  const [base] = await getDb().select().from(revisions).where(eq(revisions.id, Number(anchor.baseRevisionId)));
  await getDb().insert(revisions).values({ ...base, id: undefined, content: "完全改写后的新正文。", createdAt: new Date() });
  const rejected = await create(); expect(rejected.status).toBe(409); expect(await rejected.json()).toMatchObject({ code: "revision-changed" });
  expect(await getDb().select().from(passageThoughts)).toEqual([]);
  expect((await create("public", { confirmRevisionChange: true })).status).toBe(201);
  expect((await read()).thoughts[0]).toMatchObject({ quote: anchor.quote, baseRevisionId: base.id, status: "original-changed", start: null, end: null });
});
it("rejects forged anchors, foreign revisions, invalid visibility, long/empty content and unauthenticated writes", async () => {
  expect((await create("public", {}, "")).status).toBe(401);
  for (const extra of [{ content: " " }, { content: "x".repeat(2001) }, { anchor: { ...anchor, quote: "伪造" } }, { pageId: termId }]) expect((await create("public", extra)).status).toBeGreaterThanOrEqual(400);
  expect((await create("unlisted")).status).toBe(400);
  expect(await getDb().select().from(passageThoughts)).toEqual([]);
});
it("page deletion hides the whole thread while authors can manage their own retained records", async () => {
  const { id } = await (await create()).json(); await getDb().update(pages).set({ deletedAt: new Date() }).where(eq(pages.id, termId));
  const response = await GET(request("/", "GET", author.cookie), { params: Promise.resolve({ pageId: String(pageId) }) });
  expect(response.status).toBe(404);
  expect((await change(id, "private")).status).toBe(204);
  expect((await DELETE(request("/", "DELETE"), context(id))).status).toBe(204);
  expect(await getDb().select().from(agrees).where(and(eq(agrees.targetType, "passage_thought"), eq(agrees.targetId, id)))).toEqual([]);
  expect(await getDb().select().from(replies).where(eq(replies.targetType, "passage_thought"))).toEqual([]);
});
