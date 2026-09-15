import { randomUUID } from "node:crypto";
// 评论版务（#71，主缝 = route handlers 直调）：管理员软删他人评论
// （有回复占位、无回复移除、删除者留痕）与词条版务锁定——锁定后该词条
// 总评论区与各视角评论区对任何角色（含管理员）关闭新增评论与回复，
// 已有内容仍可读，解锁即恢复。划线感想不受锁定影响：感想写路径尚未落地
// （后续工单），锁定判定只落在评论/回复创建处即保证不波及。

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { POST as CREATE_COMMENT } from "@/app/api/comments/route";
import { GET as LIST_COMMENTS } from "@/app/api/pages/[pageId]/comments/route";
import { DELETE as DELETE_COMMENT } from "@/app/api/comments/[commentId]/route";
import { POST as CREATE_REPLY } from "@/app/api/comments/[commentId]/replies/route";
import { POST as AGREE } from "@/app/api/comments/[commentId]/agree/route";
import { POST as LOCK_ROUTE } from "@/app/api/admin/discussion/[termId]/lock/route";
import { DELETE as UNLOCK_ROUTE } from "@/app/api/admin/discussion/[termId]/lock/route";
import { auth } from "@/lib/auth";
import { getDb } from "@/db";
import { agrees, pageComments, pages, replies, termDiscussions, user } from "@/db/schema";
import { seedDatabase } from "@/db/seed";
import { fixtureSignUp } from "./auth-fixture";
import { FakeSearchIndex } from "@/lib/search/fake-index";
import { injectSearchIndex, resetSearchIndex } from "@/lib/search/search-service";

interface Account {
  id: string;
  cookie: string;
  cleanup: () => Promise<unknown>;
}

let author: Account;
let editor: Account;
let admin: Account;
let termId: number;
let perspectiveId: number;
let otherTermId: number;
let index: FakeSearchIndex;

async function signUp(name: string, role: "editor" | "admin"): Promise<Account> {
  const email = `moderation-${randomUUID()}@example.com`;
  const password = "moderation-test-password";
  const account = await fixtureSignUp({ body: { name, email, password } });
  if (role === "admin") {
    await getDb().update(user).set({ role: "admin" }).where(eq(user.id, account.user.id));
  }
  const response = await auth.api.signInEmail({ body: { email, password }, asResponse: true });
  const cookie = response.headers.getSetCookie().map(value => value.split(";")[0]).join("; ");
  return { id: account.user.id, cookie, cleanup: () => getDb().delete(user).where(eq(user.id, account.user.id)) };
}

function create(pageId: number, content: string, session?: string) {
  return CREATE_COMMENT(new Request("http://localhost/api/comments", {
    method: "POST",
    headers: { "content-type": "application/json", ...(session ? { cookie: session } : {}) },
    body: JSON.stringify({ pageId, content }),
  }));
}

function remove(id: number, session?: string) {
  return DELETE_COMMENT(new Request(`http://localhost/api/comments/${id}`, {
    method: "DELETE",
    headers: session ? { cookie: session } : {},
  }), { params: Promise.resolve({ commentId: String(id) }) });
}

function reply(commentId: number, content: string, session?: string) {
  return CREATE_REPLY(new Request(`http://localhost/api/comments/${commentId}/replies`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(session ? { cookie: session } : {}) },
    body: JSON.stringify({ content }),
  }), { params: Promise.resolve({ commentId: String(commentId) }) });
}

interface CommentRow {
  id: number;
  content: string;
  deleted: boolean;
  authorId: string;
  authorName: string;
  replies: Array<{ id: number; content: string; deleted: boolean }>;
}

async function read(pageId: number): Promise<CommentRow[]> {
  const response = await LIST_COMMENTS(new Request(`http://localhost/api/pages/${pageId}/comments`), {
    params: Promise.resolve({ pageId: String(pageId) }),
  });
  return response.json();
}

async function setLock(targetTermId: number, locked: boolean, session = admin.cookie) {
  const handler = locked ? LOCK_ROUTE : UNLOCK_ROUTE;
  return handler(new Request(`http://localhost/api/admin/discussion/${targetTermId}/lock`, {
    method: locked ? "POST" : "DELETE",
    headers: session ? { cookie: session } : {},
  }), { params: Promise.resolve({ termId: String(targetTermId) }) });
}

beforeAll(async () => {
  await seedDatabase();
  author = await signUp("版务评论作者", "editor");
  editor = await signUp("版务旁观编者", "editor");
  admin = await signUp("版务管理员", "admin");
  const rows = await getDb().select().from(pages).where(inArray(pages.title, ["主体性", "拉康论主体性", "异化"]));
  termId = rows.find(row => row.title === "主体性")!.id;
  perspectiveId = rows.find(row => row.title === "拉康论主体性")!.id;
  otherTermId = rows.find(row => row.title === "异化")!.id;
});

// 每个用例自建评论与锁定态，互不依赖：进入用例前清空评论族与锁定行
beforeEach(async () => {
  const db = getDb();
  await db.delete(replies);
  await db.delete(agrees);
  await db.delete(pageComments);
  await db.delete(termDiscussions);
  index = new FakeSearchIndex();
  injectSearchIndex(index);
});

// seedDatabase 清空内容表（评论/回复/锁定行随 TRUNCATE 消失），测试账号随后删除
afterAll(async () => {
  resetSearchIndex();
  await seedDatabase();
  for (const account of [author, editor, admin]) await account.cleanup();
});

describe("管理员软删他人评论", () => {
  it("有回复时占位：呈现与作者删除一致，删除者留痕，回复可读，重复删除幂等", async () => {
    const { id } = await (await create(perspectiveId, "待版务处置的评论", author.cookie)).json();
    await reply(id, "版务评论下的回复", editor.cookie);

    // 非作者、非管理员不能删除；管理员可以
    expect((await remove(id, editor.cookie)).status).toBe(403);
    expect((await remove(id, admin.cookie)).status).toBe(204);
    // 幂等：重复删除仍成功
    expect((await remove(id, admin.cookie)).status).toBe(204);

    // 与作者删除呈现一致：占位（内容与作者不外发、回复保留可读）
    const rows = await read(perspectiveId);
    const placeholder = rows.find(row => row.id === id);
    expect(placeholder).toMatchObject({ deleted: true, content: "", authorId: "", authorName: "" });
    expect(placeholder!.replies).toEqual([expect.objectContaining({ deleted: false, content: "版务评论下的回复" })]);
    // 删除者留痕：deletedBy 记录执行处置的管理员
    const [stored] = await getDb().select({ deletedBy: pageComments.deletedBy, deletedAt: pageComments.deletedAt })
      .from(pageComments).where(eq(pageComments.id, id));
    expect(stored.deletedBy).toBe(admin.id);
    expect(stored.deletedAt).not.toBeNull();
  });

  it("无回复时直接移除，赞同随评论清理", async () => {
    const { id } = await (await create(termId, "无回复的版务评论", author.cookie)).json();
    expect((await AGREE(new Request(`http://localhost/api/comments/${id}/agree`, {
      method: "POST", headers: { cookie: editor.cookie },
    }), { params: Promise.resolve({ commentId: String(id) }) })).status).toBe(200);

    expect((await remove(id, admin.cookie)).status).toBe(204);
    expect((await read(termId)).find(row => row.id === id)).toBeUndefined();
    expect(await getDb().select().from(pageComments).where(eq(pageComments.id, id))).toEqual([]);
    expect(await getDb().select().from(agrees).where(eq(agrees.targetId, id))).toEqual([]);
  });
});

describe("词条版务锁定（覆盖总评论区与各视角评论区）", () => {
  it("锁定后任何角色不能新增评论与回复，已有内容仍可读，解锁后恢复", async () => {
    const { id: existingId } = await (await create(termId, "锁定前的既有评论", author.cookie)).json();
    const { id: existingReply } = await (await reply(existingId, "锁定前的既有回复", editor.cookie)).json();
    const { id: existingPerspectiveComment } = await (await create(perspectiveId, "锁定前的视角评论", author.cookie)).json();

    expect((await setLock(termId, true)).status).toBe(204);
    try {
      // 编辑者不能在总评论区/视角评论区新增评论，也不能回复
      expect((await create(termId, "锁定后编辑者想评论", editor.cookie)).status).toBe(403);
      expect((await create(perspectiveId, "锁定后编辑者想评视角", editor.cookie)).status).toBe(403);
      expect((await reply(existingId, "锁定后编辑者想回复", editor.cookie)).status).toBe(403);
      // 管理员同样被锁
      expect((await create(termId, "锁定后管理员也被锁", admin.cookie)).status).toBe(403);
      expect((await reply(existingId, "锁定后管理员想回复", admin.cookie)).status).toBe(403);

      // 已有内容仍可读
      const termRows = await read(termId);
      expect(termRows.find(row => row.id === existingId)).toMatchObject({ deleted: false, content: "锁定前的既有评论" });
      expect(termRows.find(row => row.id === existingId)!.replies.find(row => row.id === existingReply))
        .toMatchObject({ deleted: false, content: "锁定前的既有回复" });
      expect((await read(perspectiveId)).find(row => row.id === existingPerspectiveComment)).toBeTruthy();

      // 其他词条不受影响
      const unaffected = await (await create(otherTermId, "未锁定词条照常评论", editor.cookie)).json();
      await remove(unaffected.id, editor.cookie);

      // 解锁后发言恢复
      expect((await setLock(termId, false)).status).toBe(204);
      expect((await create(termId, "解锁后恢复评论", editor.cookie)).status).toBe(201);
      expect((await reply(existingId, "解锁后恢复回复", editor.cookie)).status).toBe(201);
    } finally {
      await setLock(termId, false);
    }
  });

  it("锁定状态沿用既有词条锁定数据：历史锁定行同样挡住页面评论", async () => {
    // 直接落一条既有语义的锁定行（模拟 #71 之前的历史数据），写路径同样被挡
    await getDb().insert(termDiscussions).values({ termId, lockedAt: new Date(), lockedBy: admin.id });
    expect((await create(termId, "历史锁定行挡住评论", editor.cookie)).status).toBe(403);
    expect((await create(perspectiveId, "历史锁定行挡住视角评论", editor.cookie)).status).toBe(403);
    // 解锁（走版务路由，锁定行平滑映射到新语义）后恢复
    expect((await setLock(termId, false)).status).toBe(204);
    expect((await create(termId, "解锁后即可评论", editor.cookie)).status).toBe(201);
  });

  it("锁定只挡新增：作者与管理员仍可删除既有评论", async () => {
    const mine = await (await create(termId, "锁定期间可删除的评论", author.cookie)).json();
    const others = await (await create(termId, "锁定期间待版务处置的评论", editor.cookie)).json();
    await setLock(termId, true);
    try {
      expect((await remove(mine.id, author.cookie)).status).toBe(204);
      expect((await remove(others.id, admin.cookie)).status).toBe(204);
      expect((await read(termId)).find(row => [mine.id, others.id].includes(row.id))).toBeUndefined();
    } finally { await setLock(termId, false); }
  });
});
