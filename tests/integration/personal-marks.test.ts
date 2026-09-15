// 个人标记（划线）数据层与 API 的集成测试（spec 0009 #72）：
// 云端随账号保存、三样式、相交并集合并（删旧建新）、样式偏好记忆、
// 跨修订重定位/「原文已变更」、隐私边界（他人与游客不可见/不可写）、版务锁定不影响划线。

import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, it } from "vitest";
import { desc, eq } from "drizzle-orm";
import { POST } from "@/app/api/marks/route";
import { DELETE } from "@/app/api/marks/[markId]/route";
import { auth } from "@/lib/auth";
import { getDb } from "@/db";
import { pages, personalMarks, revisions, termDiscussions, user, userMarkStyle } from "@/db/schema";
import { seedDatabase } from "@/db/seed";
import { listPersonalMarks } from "@/lib/passage-marks";
import { canonicalMarkdownText } from "@/lib/passage-body";
import { fixtureSignUp } from "./auth-fixture";

let cookie: string;
let authorId: string;
let termId: number;
let perspectiveId: number;
let head: { id: number; content: string };
let bodyText: string;

beforeAll(async () => {
  await seedDatabase();
  const email = `marks-${randomUUID()}@example.com`;
  const password = "marks-test-password";
  authorId = (await fixtureSignUp({ body: { name: "划线编者", email, password } })).user.id;
  const response = await auth.api.signInEmail({ body: { email, password }, asResponse: true });
  cookie = response.headers.getSetCookie().map(value => value.split(";")[0]).join("; ");
  const rows = await getDb().select().from(pages).where(eq(pages.title, "拉康论主体性"));
  perspectiveId = rows[0].id;
  const [term] = await getDb().select().from(pages).where(eq(pages.title, "主体性"));
  termId = term.id;
  await reloadHead();
});

afterAll(async () => {
  await seedDatabase();
  if (authorId) await getDb().delete(user).where(eq(user.id, authorId));
});

/** 取视角当前 head 修订并重建规范化文本（测试中途可能插入新修订）。 */
async function reloadHead() {
  const [row] = await getDb().select({ id: revisions.id, content: revisions.content })
    .from(revisions).where(eq(revisions.pageId, perspectiveId))
    .orderBy(desc(revisions.id)).limit(1);
  head = row!;
  bodyText = canonicalMarkdownText(head.content);
}

function anchorOf(needle: string) {
  const start = bodyText.indexOf(needle);
  expect(start).toBeGreaterThanOrEqual(0);
  return { start, end: start + needle.length, quote: needle, baseRevisionId: String(head.id) };
}

function create(anchor: unknown, style: unknown, session = cookie, pageId = perspectiveId) {
  return POST(new Request("http://localhost/api/marks", {
    method: "POST",
    headers: { "content-type": "application/json", cookie: session },
    body: JSON.stringify({ pageId, anchor, style }),
  }));
}

function remove(markId: number, session = cookie, pageId = perspectiveId) {
  return DELETE(new Request(`http://localhost/api/marks/${markId}?pageId=${pageId}`, {
    method: "DELETE",
    headers: { cookie: session },
  }), { params: Promise.resolve({ markId: String(markId) }) });
}

async function createOk(anchor: unknown, style: unknown) {
  const response = await create(anchor, style);
  expect(response.status).toBe(201);
  return response.json() as Promise<ReturnType<typeof listPersonalMarks>>;
}

async function cleanupMarks() {
  await getDb().delete(personalMarks).where(eq(personalMarks.userId, authorId));
  await getDb().delete(userMarkStyle).where(eq(userMarkStyle.userId, authorId));
}

it("登录用户可在视角正文建标：引用与偏移锚定 head 修订，首次默认样式为马克笔", async () => {
  try {
    const state = await createOk(anchorOf("无意识像语言一样被结构"), "highlight");
    expect(state.revisionId).toBe(head.id);
    expect(state.defaultStyle).toBe("highlight");
    expect(state.marks).toEqual([expect.objectContaining({
      style: "highlight", quote: "无意识像语言一样被结构", status: "located",
    })]);
    const [row] = await getDb().select().from(personalMarks).where(eq(personalMarks.userId, authorId));
    expect(row).toMatchObject({ baseRevisionId: head.id, anchorStart: bodyText.indexOf("无意识像语言一样被结构") });
  } finally { await cleanupMarks(); }
});

it("游客 401、未知样式与非法锚 400、非视角页与非法 id 404", async () => {
  expect((await create(anchorOf("无意识像语言一样被结构"), "highlight", "")).status).toBe(401);
  expect((await remove(1, "")).status).toBe(401);
  expect((await create(anchorOf("无意识像语言一样被结构"), "fancy")).status).toBe(400);
  expect((await create({ start: 9, end: 3, quote: "x", baseRevisionId: "1" }, "highlight")).status).toBe(400);
  expect((await create({ start: 3, end: 9, quote: "x", baseRevisionId: "abc" }, "highlight")).status).toBe(400);
  expect((await create(null, "highlight")).status).toBe(400);
  // 词条页没有可划线正文（标记只属于视角）
  expect((await create(anchorOf("无意识像语言一样被结构"), "highlight", cookie, termId)).status).toBe(404);
  expect((await create(anchorOf("无意识像语言一样被结构"), "highlight", cookie, 2147483647)).status).toBe(404);
});

it("相交选区按范围并集合并（删旧建新不叠画），相邻与不相交标记保留", async () => {
  try {
    await createOk(anchorOf("主体不是先于语言的存在"), "highlight");
    // 新选区从旧标记内部起、延伸到旧标记之外：合并为一条并集标记
    const unionPhrase = "先于语言的存在，而是在能指链中被构成的";
    const state = await createOk(anchorOf(unionPhrase), "squiggle");
    const expected = bodyText.slice(bodyText.indexOf("主体不是先于语言的存在"), bodyText.indexOf(unionPhrase) + unionPhrase.length);
    expect(state.marks).toHaveLength(1);
    expect(state.marks[0]).toMatchObject({ style: "squiggle", status: "located", quote: expected });
    // 不相交的新标记独立保留
    const disjoint = await createOk(anchorOf("言说的「我」永远无法与被言说的「我」重合"), "underline");
    expect(disjoint.marks).toHaveLength(2);
    expect(await getDb().select().from(personalMarks).where(eq(personalMarks.userId, authorId))).toHaveLength(2);
  } finally { await cleanupMarks(); }
});

it("样式偏好随账号云端保存：上次选择成为新标记默认样式", async () => {
  try {
    const first = await createOk(anchorOf("无意识像语言一样被结构"), "squiggle");
    expect(first.defaultStyle).toBe("squiggle");
    const [stored] = await getDb().select().from(userMarkStyle).where(eq(userMarkStyle.userId, authorId));
    expect(stored.style).toBe("squiggle");
    const second = await listPersonalMarks(perspectiveId, authorId);
    expect(second.defaultStyle).toBe("squiggle");
    // 其他账号的偏好互不影响：新用户默认马克笔
    const email = `marks-other-${randomUUID()}@example.com`;
    const other = await fixtureSignUp({ body: { name: "另一位划线者", email, password: "marks-test-password" } });
    try {
      expect((await listPersonalMarks(perspectiveId, other.user.id)).defaultStyle).toBe("highlight");
    } finally { await getDb().delete(user).where(eq(user.id, other.user.id)); }
  } finally { await cleanupMarks(); }
});

it("隐私边界：标记仅本人列表可见，他人不能删除；作者删除后清空", async () => {
  const email = `marks-privacy-${randomUUID()}@example.com`;
  const other = await fixtureSignUp({ body: { name: "隐私边界编者", email, password: "marks-test-password" } });
  const signIn = await auth.api.signInEmail({ body: { email, password: "marks-test-password" }, asResponse: true });
  const otherCookie = signIn.headers.getSetCookie().map(value => value.split(";")[0]).join("; ");
  try {
    const state = await createOk(anchorOf("无意识像语言一样被结构"), "highlight");
    const markId = state.marks[0].id;
    expect((await listPersonalMarks(perspectiveId, other.user.id)).marks).toEqual([]);
    expect((await remove(markId, otherCookie)).status).toBe(404);
    const after = await remove(markId);
    expect(after.status).toBe(200);
    expect((await after.json()).marks).toEqual([]);
    expect((await remove(markId)).status).toBe(404);
  } finally {
    await cleanupMarks();
    await getDb().delete(user).where(eq(user.id, other.user.id));
  }
});

it("词条版务锁定不影响划线（spec 0009 Q19）", async () => {
  try {
    await getDb().insert(termDiscussions).values({ termId, lockedAt: new Date(), lockedBy: authorId });
    const state = await createOk(anchorOf("无意识像语言一样被结构"), "underline");
    expect(state.marks).toHaveLength(1);
  } finally {
    await getDb().delete(termDiscussions).where(eq(termDiscussions.termId, termId));
    await cleanupMarks();
  }
});

it("跨修订：旧锚点对齐新 head 落库；重定位失败返回 409；读取标记原文已变更", async () => {
  const original = head.content;
  const originalId = head.id;
  const needle = "主体不是先于语言的存在";
  const originalStart = bodyText.indexOf(needle);
  try {
    // head 前插入一句：偏移整体漂移，旧锚点应成功重定位
    const prefix = "开场先补一句。\n\n";
    await getDb().insert(revisions).values({ pageId: perspectiveId, content: prefix + original, source: "direct", createdBy: authorId });
    const staleAnchor = {
      start: originalStart, end: originalStart + needle.length, quote: needle,
      baseRevisionId: String(originalId),
    };
    const state = await createOk(staleAnchor, "highlight");
    const shifted = state.marks[0];
    expect(shifted.status).toBe("located");
    expect(shifted.start).toBe(originalStart + canonicalMarkdownText(prefix).length);
    // 引用被篡改的锚点拒绝保存
    const tampered = await create({ ...staleAnchor, quote: "篡改的引用" }, "highlight");
    expect(tampered.status).toBe(409);
    // 改写标记所在句：读取时标记进入「原文已变更」，原引用保留
    const rewritten = original.replace(needle, "被完全改写的句子");
    await getDb().insert(revisions).values({ pageId: perspectiveId, content: rewritten, source: "direct", createdBy: authorId });
    const located = await listPersonalMarks(perspectiveId, authorId);
    expect(located.marks).toEqual([expect.objectContaining({ status: "original-changed", quote: needle, start: null })]);
    // 「原文已变更」的标记不参与相交合并：新标记（落在未改动的句子）独立创建
    const fresh = await createOk(anchorOf("言说的「我」永远无法与被言说的「我」重合"), "highlight");
    expect(fresh.marks).toHaveLength(2);
  } finally {
    // 还原正文 head，避免影响其他用例
    await getDb().insert(revisions).values({ pageId: perspectiveId, content: original, source: "rollback", createdBy: authorId });
    await cleanupMarks();
    await reloadHead();
  }
});
