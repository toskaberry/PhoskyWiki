import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, it } from "vitest";
import { desc, eq, inArray } from "drizzle-orm";
import { getDb } from "@/db";
import { pageComments, pages, passageThoughts, replies, revisions, user } from "@/db/schema";
import { seedDatabase } from "@/db/seed";
import { auth } from "@/lib/auth";
import { canonicalMarkdownText } from "@/lib/passage-body";
import { listMyRecords } from "@/lib/personal-records";
import { GET } from "@/app/api/profile/records/route";
import { fixtureSignUp } from "./auth-fixture";

let ownerId: string;
let otherId: string;
let cookie: string;
let termId: number;
let perspectiveId: number;
let baseRevisionId: number;
let quote: string;

beforeAll(async () => {
  await seedDatabase();
  const email = `records-${randomUUID()}@example.com`;
  const password = "records-password123";
  ownerId = (await fixtureSignUp({ body: { name: "记录编者", email, password } })).user.id;
  otherId = (await fixtureSignUp({ body: { name: "其他编者", email: `records-${randomUUID()}@example.com`, password } })).user.id;
  const response = await auth.api.signInEmail({ body: { email, password }, asResponse: true });
  cookie = response.headers.getSetCookie().map(value => value.split(";")[0]).join("; ");
  const rows = await getDb().select().from(pages).where(inArray(pages.title, ["主体性", "拉康论主体性"]));
  termId = rows.find(row => row.title === "主体性")!.id;
  perspectiveId = rows.find(row => row.title === "拉康论主体性")!.id;
  const [head] = await getDb().select().from(revisions).where(eq(revisions.pageId, perspectiveId)).orderBy(desc(revisions.id)).limit(1);
  baseRevisionId = head.id;
  quote = canonicalMarkdownText(head.content).slice(0, 6);
});

afterAll(async () => {
  await seedDatabase();
  await getDb().delete(user).where(inArray(user.id, [ownerId, otherId].filter(Boolean)));
});

async function thought(authorId = ownerId, visibility: "public" | "private" = "public") {
  const [row] = await getDb().insert(passageThoughts).values({
    pageId: perspectiveId, authorId, content: `感想-${randomUUID()}`, visibility,
    quote, anchorStart: 0, anchorEnd: quote.length, baseRevisionId,
  }).returning();
  return row;
}

it("个人记录仅按登录账号返回，三类筛选互不混入且没有固定条数截断", async () => {
  const ownThought = await thought(ownerId, "private");
  const otherThought = await thought(otherId);
  const comments = await getDb().insert(pageComments).values(Array.from({ length: 65 }, (_, i) => ({
    pageId: termId, authorId: ownerId, content: `自己的评论 ${i}`,
  }))).returning();
  const [foreignComment] = await getDb().insert(pageComments).values({ pageId: termId, authorId: otherId, content: "他人的评论" }).returning();
  const [ownReply] = await getDb().insert(replies).values({ targetType: "page_comment", targetId: foreignComment.id, authorId: ownerId, content: "自己的回复" }).returning();
  const all = await listMyRecords(ownerId);
  expect(all.filter(row => row.kind === "comment")).toHaveLength(65);
  expect(all.some(row => row.kind === "thought" && row.id === otherThought.id)).toBe(false);
  expect(all.find(row => row.kind === "thought" && row.id === ownThought.id)).toMatchObject({ visibility: "private", quote, targetTitle: "拉康论主体性", status: "available" });
  expect((await listMyRecords(ownerId, "comment")).map(row => row.id)).toEqual(comments.map(row => row.id).reverse());
  expect(await listMyRecords(ownerId, "reply")).toEqual([expect.objectContaining({ id: ownReply.id, kind: "reply", content: "自己的回复", href: expect.stringContaining(`#comment-${foreignComment.id}`) })]);
  const response = await GET(new Request(`http://localhost/api/profile/records?kind=thought&userId=${otherId}`, { headers: { cookie } }));
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toContain("no-store");
  expect(await response.json()).toEqual([expect.objectContaining({ id: ownThought.id, kind: "thought", visibility: "private" })]);
});

it("游客不可读个人记录，未知筛选返回 400", async () => {
  expect((await GET(new Request("http://localhost/api/profile/records"))).status).toBe(401);
  expect((await GET(new Request("http://localhost/api/profile/records?kind=unknown", { headers: { cookie } }))).status).toBe(400);
});

it("他人的感想改为私密后保留自己的回复，不返回父感想正文或引用也不提供跳转", async () => {
  const parent = await thought(otherId);
  const [ownReply] = await getDb().insert(replies).values({ targetType: "passage_thought", targetId: parent.id, authorId: ownerId, content: "保留我的回应" }).returning();
  await getDb().insert(replies).values({ targetType: "passage_thought", targetId: parent.id, authorId: otherId, content: "另一条私密回复" });
  await getDb().update(passageThoughts).set({ visibility: "private" }).where(eq(passageThoughts.id, parent.id));
  const response = await GET(new Request("http://localhost/api/profile/records?kind=reply", { headers: { cookie } }));
  const rows = await response.json();
  expect(rows.find((row: { id: number }) => row.id === ownReply.id)).toMatchObject({
    content: "保留我的回应", targetTitle: "拉康论主体性", status: "thought-private", href: null, quote: null,
  });
  expect(JSON.stringify(rows)).not.toContain(parent.content);
  expect(JSON.stringify(rows)).not.toContain(quote);
  expect(JSON.stringify(rows)).not.toContain("另一条私密回复");
});

it("页面或父词条软删除后仍保留记录与页面标题，但禁用跳转", async () => {
  const ownThought = await thought();
  const [ownComment] = await getDb().insert(pageComments).values({ pageId: perspectiveId, authorId: ownerId, content: "隐藏页面评论" }).returning();
  const [ownReply] = await getDb().insert(replies).values({ targetType: "page_comment", targetId: ownComment.id, authorId: ownerId, content: "隐藏页面回复" }).returning();
  for (const pageId of [perspectiveId, termId]) {
    try {
      await getDb().update(pages).set({ deletedAt: new Date() }).where(eq(pages.id, pageId));
      const records = await listMyRecords(ownerId);
      for (const [kind, id] of [["thought", ownThought.id], ["comment", ownComment.id], ["reply", ownReply.id]] as const) {
        expect(records.find(row => row.kind === kind && row.id === id)).toMatchObject({ status: "page-deleted", href: null, targetTitle: "拉康论主体性" });
      }
    } finally {
      await getDb().update(pages).set({ deletedAt: null }).where(eq(pages.id, pageId));
    }
  }
});

it("引用原文消失时保留自己的感想及回复并显示失效状态", async () => {
  const ownThought = await thought();
  const [ownReply] = await getDb().insert(replies).values({ targetType: "passage_thought", targetId: ownThought.id, authorId: ownerId, content: "失效原文回复" }).returning();
  const [changed] = await getDb().insert(revisions).values({ pageId: perspectiveId, content: "全新且不同的正文。" }).returning();
  try {
    const records = await listMyRecords(ownerId);
    expect(records.find(row => row.kind === "thought" && row.id === ownThought.id)).toMatchObject({ quote, content: ownThought.content, status: "original-changed", href: null });
    expect(records.find(row => row.kind === "reply" && row.id === ownReply.id)).toMatchObject({ status: "original-changed", href: null });
  } finally { await getDb().delete(revisions).where(eq(revisions.id, changed.id)); }
});
