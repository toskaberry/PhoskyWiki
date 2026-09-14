import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { POST } from "@/app/api/comments/route";
import { GET } from "@/app/api/pages/[pageId]/comments/route";
import { DELETE } from "@/app/api/comments/[commentId]/route";
import { auth } from "@/lib/auth";
import { getDb } from "@/db";
import { pages, user } from "@/db/schema";
import { seedDatabase } from "@/db/seed";
import { fixtureSignUp } from "./auth-fixture";
import { FakeSearchIndex } from "@/lib/search/fake-index";
import { injectSearchIndex, resetSearchIndex } from "@/lib/search/search-service";
import { reindexAll, syncPages } from "@/lib/search/search-sync";
import { searchPublicPages, suggestPublicPages } from "@/lib/search/public-search";
import { searchHitHref } from "@/lib/search/search-types";

let cookie: string;
let authorId: string;
let termId: number;
let perspectiveId: number;
let index: FakeSearchIndex;
beforeEach(() => { index = new FakeSearchIndex(); injectSearchIndex(index); });
beforeAll(async () => {
  await seedDatabase();
  const email = `comments-${randomUUID()}@example.com`;
  const password = "comments-test-password";
  authorId = (await fixtureSignUp({ body: { name: "评论编者", email, password } })).user.id;
  const response = await auth.api.signInEmail({ body: { email, password }, asResponse: true });
  cookie = response.headers.getSetCookie().map(value => value.split(";")[0]).join("; ");
  const rows = await getDb().select().from(pages).where(inArray(pages.title, ["主体性", "拉康论主体性"]));
  termId = rows.find(row => row.title === "主体性")!.id;
  perspectiveId = rows.find(row => row.title === "拉康论主体性")!.id;
});
afterAll(async () => {
  resetSearchIndex();
  await seedDatabase();
  if (authorId) await getDb().delete(user).where(eq(user.id, authorId));
});

function create(pageId: number, content: string, session = cookie) {
  return POST(new Request("http://localhost/api/comments", {
    method: "POST", headers: { "content-type": "application/json", cookie: session },
    body: JSON.stringify({ pageId, content }),
  }));
}
async function read(pageId: number) {
  const response = await GET(new Request(`http://localhost/api/pages/${pageId}/comments`), { params: Promise.resolve({ pageId: String(pageId) }) });
  return response.json();
}

function remove(id: number, session = cookie) {
  return DELETE(new Request(`http://localhost/api/comments/${id}`, { method: "DELETE", headers: { cookie: session } }), {
    params: Promise.resolve({ commentId: String(id) }),
  });
}

it("注册用户可发表纯文本评论，词条与视角分别公开可读", async () => {
  const content = "**纯文本** <script>保留文字</script>";
  expect((await create(termId, content)).status).toBe(201);
  expect(await read(termId)).toEqual(expect.arrayContaining([expect.objectContaining({ content, authorId })]));
  expect(await read(perspectiveId)).toEqual([]);
});

it("作者删除自己的评论后从公开列表消失，游客写入返回 401，超长评论返回 400", async () => {
  expect((await create(termId, "guest", "")).status).toBe(401);
  expect((await create(termId, "字".repeat(2001))).status).toBe(400);
  const { id } = await (await create(perspectiveId, "待删除的评论")).json();
  expect((await remove(id, "")).status).toBe(401);
  const response = await remove(id);
  expect(response.status).toBe(204);
  expect(await read(perspectiveId)).toEqual([]);
});

it("页面评论可被全站搜索命中并定位到评论，重建保留、删除后移除", async () => {
  const content = `commentsearch${randomUUID().replaceAll("-", "")}`;
  const { id } = await (await create(perspectiveId, content)).json();
  let results = await searchPublicPages(content);
  expect(results.hits).toHaveLength(1);
  expect(searchHitHref(results.hits[0])).toMatch(new RegExp(`^/perspective/.+-${perspectiveId}#comment-${id}$`));
  await reindexAll();
  results = await searchPublicPages(content);
  expect(results.hits).toHaveLength(1);
  expect((await remove(id)).status).toBe(204);
  expect((await searchPublicPages(content)).hits).toEqual([]);
  expect((await index.search(content)).hits).toEqual([]);
});

it("索引尚未同步时，父词条隐藏也不泄露视角评论，恢复后可重新搜索", async () => {
  const content = `hiddencomment${randomUUID().replaceAll("-", "")}`;
  const { id } = await (await create(perspectiveId, content)).json();
  try {
    await getDb().update(pages).set({ deletedAt: new Date() }).where(eq(pages.id, termId));
    expect((await index.search(content)).hits).toHaveLength(1);
    expect((await searchPublicPages(content)).hits).toEqual([]);
    expect(await suggestPublicPages(content, 5)).toEqual([]);
    expect((await create(perspectiveId, "隐藏页面评论")).status).toBe(404);
    const response = await GET(new Request("http://localhost"), { params: Promise.resolve({ pageId: String(perspectiveId) }) });
    expect(response.status).toBe(404);
    await syncPages([termId]);
    expect((await index.search(content)).hits).toEqual([]);
  } finally {
    await getDb().update(pages).set({ deletedAt: null }).where(eq(pages.id, termId));
    await syncPages([termId]);
  }
  expect((await searchPublicPages(content)).hits).toHaveLength(1);
  await remove(id);
});

it("其他注册用户不能删除评论；发表与删除均受站点写限流", async () => {
  const email = `comments-other-${randomUUID()}@example.com`;
  const password = "comments-test-password";
  const other = await fixtureSignUp({ body: { name: "其他编者", email, password } });
  const response = await auth.api.signInEmail({ body: { email, password }, asResponse: true });
  const otherCookie = response.headers.getSetCookie().map(value => value.split(";")[0]).join("; ");
  const { id } = await (await create(termId, "只能作者删除")).json();
  const oldLimit = process.env.WRITE_LIMIT_COUNT;
  try {
    expect((await remove(id, otherCookie)).status).toBe(403);
    process.env.WRITE_LIMIT_COUNT = "1";
    expect((await create(termId, "限流评论", otherCookie)).status).toBe(429);
    expect((await remove(id, otherCookie)).status).toBe(429);
  } finally {
    if (oldLimit === undefined) delete process.env.WRITE_LIMIT_COUNT;
    else process.env.WRITE_LIMIT_COUNT = oldLimit;
    await remove(id);
    await getDb().delete(user).where(eq(user.id, other.user.id));
  }
});

it("2000 字符可发表，评论按新到旧排序，空白与非评论页面被拒绝", async () => {
  const first = await (await create(perspectiveId, "字".repeat(2000))).json();
  const second = await (await create(perspectiveId, "较新的评论")).json();
  try {
    expect((await read(perspectiveId)).slice(0, 2).map((row: { id: number }) => row.id)).toEqual([second.id, first.id]);
    expect((await create(termId, "   ")).status).toBe(400);
    const [interpreter] = await getDb().select().from(pages).where(eq(pages.type, "interpreter")).limit(1);
    expect((await create(interpreter.id, "不是词条或视角")).status).toBe(404);
    expect((await create(2147483647, "不存在的页面")).status).toBe(404);
  } finally { await remove(first.id); await remove(second.id); }
});
