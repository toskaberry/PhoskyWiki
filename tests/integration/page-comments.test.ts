import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";
import { and, eq, inArray } from "drizzle-orm";
import { POST } from "@/app/api/comments/route";
import { GET } from "@/app/api/pages/[pageId]/comments/route";
import { DELETE } from "@/app/api/comments/[commentId]/route";
import { POST as AGREE, DELETE as CANCEL_AGREE } from "@/app/api/comments/[commentId]/agree/route";
import { POST as REPLY } from "@/app/api/comments/[commentId]/replies/route";
import { DELETE as REMOVE_REPLY } from "@/app/api/replies/[replyId]/route";
import { auth } from "@/lib/auth";
import { getDb } from "@/db";
import { agrees, pageComments, pages, replies, user } from "@/db/schema";
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

function agree(id: number, session = cookie) {
  return AGREE(new Request(`http://localhost/api/comments/${id}/agree`, { method: "POST", headers: { cookie: session } }), {
    params: Promise.resolve({ commentId: String(id) }),
  });
}

function cancelAgree(id: number, session = cookie) {
  return CANCEL_AGREE(new Request(`http://localhost/api/comments/${id}/agree`, { method: "DELETE", headers: { cookie: session } }), {
    params: Promise.resolve({ commentId: String(id) }),
  });
}

async function signUpCommenter(name: string) {
  const email = `agree-${randomUUID()}@example.com`;
  const password = "agree-test-password";
  const account = await fixtureSignUp({ body: { name, email, password } });
  const response = await auth.api.signInEmail({ body: { email, password }, asResponse: true });
  const session = response.headers.getSetCookie().map(value => value.split(";")[0]).join("; ");
  return { account, session, cleanup: () => getDb().delete(user).where(eq(user.id, account.user.id)) };
}

function reply(commentId: number, content: string, session = cookie) {
  return REPLY(new Request(`http://localhost/api/comments/${commentId}/replies`, {
    method: "POST", headers: { "content-type": "application/json", cookie: session },
    body: JSON.stringify({ content }),
  }), { params: Promise.resolve({ commentId: String(commentId) }) });
}

function removeReply(id: number, session = cookie) {
  return REMOVE_REPLY(new Request(`http://localhost/api/replies/${id}`, { method: "DELETE", headers: { cookie: session } }), {
    params: Promise.resolve({ replyId: String(id) }),
  });
}

async function signUpRole(name: string, role: "editor" | "admin") {
  const email = `reply-${randomUUID()}@example.com`;
  const password = "reply-test-password";
  const account = await fixtureSignUp({ body: { name, email, password } });
  if (role === "admin") await getDb().update(user).set({ role: "admin" }).where(eq(user.id, account.user.id));
  const response = await auth.api.signInEmail({ body: { email, password }, asResponse: true });
  const session = response.headers.getSetCookie().map(value => value.split(";")[0]).join("; ");
  return { account, session, cleanup: () => getDb().delete(user).where(eq(user.id, account.user.id)) };
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

it("赞同幂等且数据层唯一：游客 401、自赞 403、重复请求不重复计数、可反复切换、删评论连带清赞同", async () => {
  const { id } = await (await create(termId, "待赞同的评论")).json();
  const other = await signUpCommenter("赞同编者");
  try {
    expect((await agree(id, "")).status).toBe(401);
    expect((await cancelAgree(id, "")).status).toBe(401);
    expect((await agree(id)).status).toBe(403);
    // 赞同幂等：重复请求状态与计数不变，数据层拒绝重复行
    expect(await agree(id, other.session).then(r => r.json())).toEqual({ agreed: true, count: 1 });
    expect(await agree(id, other.session).then(r => r.json())).toEqual({ agreed: true, count: 1 });
    await expect(getDb().insert(agrees).values({
      userId: other.account.user.id, targetType: "page_comment", targetId: id,
    })).rejects.toThrow();
    expect((await read(termId)).find((row: { id: number }) => row.id === id)?.agreeCount).toBe(1);
    // 取消赞同同样幂等，计数回落；可反复切换
    expect(await cancelAgree(id, other.session).then(r => r.json())).toEqual({ agreed: false, count: 0 });
    expect(await cancelAgree(id, other.session).then(r => r.json())).toEqual({ agreed: false, count: 0 });
    expect(await agree(id, other.session).then(r => r.json())).toEqual({ agreed: true, count: 1 });
    // 删除评论连带清理赞同（赞同目标无外键）
    expect((await remove(id)).status).toBe(204);
    expect(await getDb().select().from(agrees).where(eq(agrees.targetId, id))).toEqual([]);
    // 不存在的评论与不可见页面不可赞同
    expect((await agree(id, other.session)).status).toBe(404);
    const { id: hidden } = await (await create(termId, "隐藏后不可赞同")).json();
    await getDb().update(pages).set({ deletedAt: new Date() }).where(eq(pages.id, termId));
    try { expect((await agree(hidden, other.session)).status).toBe(404); }
    finally { await getDb().update(pages).set({ deletedAt: null }).where(eq(pages.id, termId)); }
  } finally { await other.cleanup(); }
});

it("评论区按赞同数降序、同票按发表时间新→旧排列", async () => {
  const high = await (await create(perspectiveId, "两票旧评论")).json();
  const oldZero = await (await create(perspectiveId, "零票旧评论")).json();
  const newZero = await (await create(perspectiveId, "零票新评论")).json();
  const one = await (await create(perspectiveId, "一票新评论")).json();
  const first = await signUpCommenter("排序编者一");
  const second = await signUpCommenter("排序编者二");
  try {
    expect(await agree(high.id, first.session).then(r => r.json())).toMatchObject({ agreed: true, count: 1 });
    expect(await agree(high.id, second.session).then(r => r.json())).toMatchObject({ agreed: true, count: 2 });
    expect(await agree(one.id, first.session).then(r => r.json())).toMatchObject({ agreed: true, count: 1 });
    const rows = await read(perspectiveId);
    const ids = rows.filter((row: { id: number }) => [high.id, oldZero.id, newZero.id, one.id].includes(row.id))
      .map((row: { id: number }) => row.id);
    expect(ids).toEqual([high.id, one.id, newZero.id, oldZero.id]);
    expect(rows.find((row: { id: number }) => row.id === high.id)).toMatchObject({ agreeCount: 2, agreed: false });
  } finally {
    await remove(high.id); await remove(oldZero.id); await remove(newZero.id); await remove(one.id);
    await first.cleanup(); await second.cleanup();
  }
});

it("回复随评论返回且按发表时间升序，@ 前缀按纯文本原样展示，校验与游客限制生效", async () => {
  const { id } = await (await create(termId, "待回复的评论")).json();
  const other = await signUpRole("回复编者", "editor");
  try {
    expect((await reply(id, "游客回复", "")).status).toBe(401);
    expect((await reply(id, "   ")).status).toBe(400);
    expect((await reply(id, "字".repeat(2001))).status).toBe(400);
    expect((await reply(id, "字".repeat(2000))).status).toBe(201);
    expect((await reply(2147483647, "不存在的评论")).status).toBe(404);
    const first = await (await reply(id, "最早的回复")).json();
    const second = await (await reply(id, `回复 @回复编者：这就跟进了`, other.session)).json();
    // 扁平一层：所有回复都直接挂在评论下，没有可写入的嵌套结构
    const rows = await read(termId);
    const target = rows.find((row: { id: number }) => row.id === id);
    expect(target.replies.filter((row: { id: number }) => [first.id, second.id].includes(row.id))
      .map((row: { id: number }) => row.id)).toEqual([first.id, second.id]);
    const times = target.replies.filter((row: { id: number }) => [first.id, second.id].includes(row.id))
      .map((row: { createdAt: string }) => new Date(row.createdAt).getTime());
    expect(times[0]).toBeLessThanOrEqual(times[1]);
    expect(target.replies.find((row: { id: number }) => row.id === second.id))
      .toMatchObject({ authorName: "回复编者", content: "回复 @回复编者：这就跟进了" });
    expect(await removeReply(first.id, other.session)).toMatchObject({ status: 403 });
    expect((await removeReply(first.id, "")).status).toBe(401);
  } finally {
    // 各作者只能自删（上面已断言 403）；清理直接按目标清行，再删评论与账号
    await getDb().delete(replies).where(and(eq(replies.targetType, "page_comment"), eq(replies.targetId, id)));
    await remove(id);
    await other.cleanup();
  }
});

it("有回复的评论被作者删除后保留占位：内容与作者不再外发、回复可读、不可再回复与赞同、退出搜索", async () => {
  const marker = `placeholder${randomUUID().replaceAll("-", "")}`;
  const { id } = await (await create(perspectiveId, marker)).json();
  const commenter = await signUpRole("占位回复者", "editor");
  try {
    const { id: replyId } = await (await reply(id, "占位评论的回复", commenter.session)).json();
    expect(await searchPublicPages(marker).then(r => r.hits)).toHaveLength(1);
    expect((await remove(id)).status).toBe(204);
    // 占位保留：评论行还在，但内容与作者信息被移除；回复原样可读
    const rows = await read(perspectiveId);
    const placeholder = rows.find((row: { id: number }) => row.id === id);
    expect(placeholder).toMatchObject({ deleted: true, content: "", authorName: "", authorId: "" });
    expect(placeholder.replies).toEqual([expect.objectContaining({ deleted: false, content: "占位评论的回复", authorName: "占位回复者" })]);
    // 占位不可再回复、不可赞同；搜索索引同步移除
    expect((await reply(id, "占位不能再被回复")).status).toBe(404);
    expect((await agree(id, commenter.session)).status).toBe(404);
    expect((await searchPublicPages(marker)).hits).toEqual([]);
    // 版务留痕：软删评论与回复的数据行仍在；回复清零后占位不消失（占位语义在删除时定格）
    const [stored] = await getDb().select({ deletedBy: pageComments.deletedBy }).from(pageComments).where(eq(pageComments.id, id));
    expect(stored.deletedBy).toBe(authorId);
    // 回复作者自删自己的回复（物理移除），占位评论不随之消失
    expect((await removeReply(replyId, commenter.session)).status).toBe(204);
    expect((await read(perspectiveId)).find((row: { id: number }) => row.id === id)).toMatchObject({ deleted: true, replies: [] });
    await getDb().delete(replies).where(and(eq(replies.targetType, "page_comment"), eq(replies.targetId, id)));
    await getDb().delete(pageComments).where(eq(pageComments.id, id));
  } finally { await commenter.cleanup(); }
});

it("无回复的评论删除后直接移除，不产生占位行", async () => {
  const { id } = await (await create(perspectiveId, "无回复直接消失")).json();
  expect((await remove(id)).status).toBe(204);
  expect((await read(perspectiveId)).find((row: { id: number }) => row.id === id)).toBeUndefined();
  expect(await getDb().select().from(pageComments).where(eq(pageComments.id, id))).toEqual([]);
});

it("回复删除：作者自删物理移除，管理员处置他人回复软删占位留痕，重复删除幂等", async () => {
  const { id } = await (await create(termId, "待处置回复的评论")).json();
  const commenter = await signUpRole("被处置回复者", "editor");
  const admin = await signUpRole("版务管理员", "admin");
  try {
    const mine = await (await reply(id, "作者自己删的回复")).json();
    expect((await removeReply(mine.id)).status).toBe(204);
    expect(await getDb().select().from(replies).where(eq(replies.id, mine.id))).toEqual([]);
    const other = await (await reply(id, "版务处置的回复", commenter.session)).json();
    expect((await removeReply(other.id, admin.session)).status).toBe(204);
    const [stored] = await getDb().select().from(replies).where(eq(replies.id, other.id));
    expect(stored).toMatchObject({ content: "版务处置的回复", deletedBy: admin.account.user.id });
    expect(stored.deletedAt).not.toBeNull();
    const listed = (await read(termId)).find((row: { id: number }) => row.id === id);
    expect(listed.replies).toEqual([expect.objectContaining({ deleted: true, content: "", authorName: "" })]);
    // 已删除的回复重复删除幂等成功
    expect((await removeReply(other.id, admin.session)).status).toBe(204);
  } finally {
    await getDb().delete(replies).where(and(eq(replies.targetType, "page_comment"), eq(replies.targetId, id)));
    await remove(id);
    await commenter.cleanup();
    await admin.cleanup();
  }
});
