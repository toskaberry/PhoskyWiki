import { fixtureSignUp } from "./auth-fixture";
// 审核流核心集成测试（T06 验收）：提交状态机全转移、两票受理（含冷启动退化与
// quorum 快照）、base 过期并发防护、驳回必填理由、受理产生修订、
// 管理员直编。主缝 = route handlers 直调，
// 连真实 PG。管理员数量用 setAdminsExactly 精确控制（quorum 依赖它），恢复原状后清理。

import { randomUUID } from "node:crypto";

import { and, eq, inArray, notInArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { POST as submitRoute } from "@/app/api/submissions/route";
import { POST as reviewRoute } from "@/app/api/admin/submissions/[id]/review/route";
import { auth } from "@/lib/auth";
import { seedDatabase } from "@/db/seed";
import { getDb } from "@/db";
import {
  pages,
  submissions,
  submissionVotes,
  user,
} from "@/db/schema";
import { GET as historyRoute } from "@/app/api/pages/[pageId]/history/route";

// 页面 DOM 的队列、提交详情、反链和引用热度回归在 tests/e2e/review-behavior.spec.ts。
// 本文件的观察口径仅为 HTTP 响应；数据库访问仅限种子定位、角色夹具和清理。

interface TestUser {
  id: string;
  email: string;
  cookie: string;
}

const createdEmails: string[] = [];
/** setAdminsExactly 动过的非测试用户，按原角色恢复（测试用户随 afterAll 删除）。 */
const roleBackup: { id: string; role: string }[] = [];

let editor1: TestUser;
let editor2: TestUser;
let admin1: TestUser;
let admin2: TestUser;

async function createUser(
  role: "editor" | "admin",
  password: string,
  name: string,
): Promise<TestUser> {
  const email = `t06-${randomUUID()}@example.com`;
  createdEmails.push(email);
  const signUp = await fixtureSignUp({ body: { name, email, password } });
  if (role === "admin") {
    await getDb().update(user).set({ role: "admin" }).where(eq(user.id, signUp.user.id));
  }
  const signIn = await auth.api.signInEmail({
    body: { email, password },
    asResponse: true,
  });
  const cookie = signIn.headers
    .getSetCookie()
    .map((entry) => entry.split(";")[0])
    .join("; ");
  return { id: signUp.user.id, email, cookie };
}

/** 把站内管理员精确设置为一组 id（quorum 快照的前置条件），非测试用户记录原角色。 */
async function setAdminsExactly(ids: string[]): Promise<void> {
  const db = getDb();
  const testIds = (
    await db.select({ id: user.id }).from(user).where(inArray(user.email, createdEmails))
  ).map((row) => row.id);
  const admins = await db.select({ id: user.id }).from(user).where(eq(user.role, "admin"));
  for (const admin of admins) {
    if (
      !ids.includes(admin.id) &&
      !testIds.includes(admin.id) &&
      !roleBackup.some((row) => row.id === admin.id)
    ) {
      const [row] = await db
        .select({ role: user.role })
        .from(user)
        .where(eq(user.id, admin.id));
      roleBackup.push({ id: admin.id, role: row.role });
    }
  }
  await db
    .update(user)
    .set({ role: "editor" })
    .where(
      ids.length
        ? and(eq(user.role, "admin"), notInArray(user.id, ids))
        : eq(user.role, "admin"),
    );
  if (ids.length) {
    await db.update(user).set({ role: "admin" }).where(inArray(user.id, ids));
  }
}

beforeAll(async () => {
  await seedDatabase();
  editor1 = await createUser("editor", "editor1-pass-123", "T06 编者一");
  editor2 = await createUser("editor", "editor2-pass-123", "T06 编者二");
  admin1 = await createUser("admin", "admin1-pass-123", "T06 管理员一");
  admin2 = await createUser("admin", "admin2-pass-123", "T06 管理员二");
});

afterAll(async () => {
  const db = getDb();
  for (const { id, role } of roleBackup) {
    await db
      .update(user)
      .set({ role: role as "editor" | "admin" | "trusted" })
      .where(eq(user.id, id));
  }
  // 测试用户建过的页面与提交先清（submittedBy/createdBy 无级联），再删用户
  const testIds = (
    await db.select({ id: user.id }).from(user).where(inArray(user.email, createdEmails))
  ).map((row) => row.id);
  if (testIds.length) {
    await db.delete(pages).where(inArray(pages.createdBy, testIds));
    await db.delete(submissionVotes).where(inArray(submissionVotes.adminId, testIds));
    await db.delete(submissions).where(inArray(submissions.submittedBy, testIds));
    await db.delete(user).where(inArray(user.id, testIds));
  }
});

// ---- 主缝调用助手 -----------------------------------------------------------

/** 路由响应体的宽松形状（只取测试断言用到的字段；submissionId 只在 201 路径读取）。 */
interface RouteData {
  submissionId: number;
  outcome?: string;
  quorum?: number;
  approveCount?: number;
  error?: string;
  href?: string;
}

async function submit(
  body: unknown,
  cookie?: string,
): Promise<{ status: number; data: RouteData }> {
  const res = await submitRoute(
    new Request("http://localhost/api/submissions", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(cookie ? { cookie } : {}),
      },
      body: JSON.stringify(body),
    }),
  );
  return { status: res.status, data: (await res.json().catch(() => null)) ?? {} };
}

async function review(
  id: number,
  body: unknown,
  cookie?: string,
): Promise<{ status: number; data: RouteData & { staleBase?: boolean; message?: string } }> {
  const res = await reviewRoute(
    new Request(`http://localhost/api/admin/submissions/${id}/review`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(cookie ? { cookie } : {}),
      },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: String(id) }) },
  );
  return { status: res.status, data: (await res.json().catch(() => null)) ?? {} };
}

// ---- 内容夹具 ---------------------------------------------------------------

async function pageIdByTitle(title: string): Promise<number> {
  const [page] = await getDb().select({ id: pages.id }).from(pages).where(eq(pages.title, title));
  if (!page) throw new Error(`种子缺少页面：${title}`);
  return page.id;
}

const termIdByTitle = pageIdByTitle;
const perspectiveIdOf = (termTitle: string, interpreterName: string) =>
  pageIdByTitle(`${interpreterName}论${termTitle}`);

async function history(pageId: number): Promise<{ revisions: { id: number; content: string }[] }> {
  const response = await historyRoute(new Request(`http://localhost/api/pages/${pageId}/history`), {
    params: Promise.resolve({ pageId: String(pageId) }),
  });
  expect(response.status).toBe(200);
  return response.json();
}

async function headContent(pageId: number) {
  return (await history(pageId)).revisions[0].content;
}

async function headRevisionId(pageId: number) {
  return (await history(pageId)).revisions[0].id;
}

/** 对某视角页发起编辑提交，base 取当前 head（编辑提交的常规形态）。 */
async function submitEdit(
  actor: TestUser,
  pageId: number,
  content: string,
  supersedes?: number,
): Promise<{ status: number; data: RouteData }> {
  return submit(
    {
      kind: "edit",
      pageId,
      content,
      baseRevisionId: await headRevisionId(pageId),
      ...(supersedes !== undefined ? { supersedes } : {}),
    },
    actor.cookie,
  );
}

// ---- 测试 -------------------------------------------------------------------

describe("提交状态机（T06：pending → approved/rejected 均终态，重提 = 新建）", () => {
  it("编者提交进 pending（quorum 快照随创建）；受理后产生修订进入读路径；终态再投 409", async () => {
    await setAdminsExactly([admin1.id]);
    const pageId = await perspectiveIdOf("主体性", "福柯");

    const created = await submitEdit(editor1, pageId, "福柯视角的受理版内容。");
    expect(created.status).toBe(201);
    expect(created.data).toMatchObject({ outcome: "pending", quorum: 1 });

    const approved = await review(created.data.submissionId, { action: "approve" }, admin1.cookie);
    expect(approved.status).toBe(200);
    expect(approved.data).toEqual({ outcome: "approved" });

    // 受理后的内容立即进入读路径
    expect(await headContent(pageId)).toBe("福柯视角的受理版内容。");

    // 终态不可再投
    const again = await review(created.data.submissionId, { action: "approve" }, admin1.cookie);
    expect(again.status).toBe(409);
  });

  it("驳回必填理由；驳回是终态；修改重提 = 新建提交（supersedes 谱系）", async () => {
    await setAdminsExactly([admin1.id]);
    const pageId = await perspectiveIdOf("主体性", "福柯");
    const before = await headContent(pageId);

    const created = await submitEdit(editor1, pageId, "有争议的重写版本。");
    const id = created.data.submissionId as number;

    const noReason = await review(id, { action: "reject" }, admin1.cookie);
    expect(noReason.status).toBe(400);
    expect(noReason.data.error).toContain("理由");

    const rejected = await review(id, { action: "reject", reason: "论据不足，请补充文献。" }, admin1.cookie);
    expect(rejected.data).toMatchObject({ outcome: "rejected", staleBase: false });
    expect(await headContent(pageId)).toBe(before); // 未生效

    // 终态后再投 409
    expect((await review(id, { action: "approve" }, admin1.cookie)).status).toBe(409);

    // 修改重提 = 新建提交，旧提交保持 rejected
    const resubmitted = await submitEdit(editor1, pageId, "补充论据后的重提版本。", id);
    expect(resubmitted.status).toBe(201);
    const newId = resubmitted.data.submissionId as number;
    expect(newId).not.toBe(id);
    expect((await review(id, { action: "approve" }, admin1.cookie)).status).toBe(409);

    const approved = await review(newId, { action: "approve" }, admin1.cookie);
    expect(approved.data).toEqual({ outcome: "approved" });
    expect(await headContent(pageId)).toBe("补充论据后的重提版本。");
  });

  it("输入校验：非法 kind / 空 content / 缺 base / 非视角页目标", async () => {
    await setAdminsExactly([admin1.id]);
    const pageId = await perspectiveIdOf("主体性", "福柯");
    const termId = await termIdByTitle("主体性");

    expect((await submit({ kind: "bogus" }, editor1.cookie)).status).toBe(400);
    expect(
      (
        await submit(
          { kind: "edit", pageId, content: "  ", baseRevisionId: await headRevisionId(pageId) },
          editor1.cookie,
        )
      ).status,
    ).toBe(400);
    expect((await submit({ kind: "edit", pageId, content: "x" }, editor1.cookie)).status).toBe(400);
    // 词条是聚合枢纽，正文在视角页里（一期编辑对象只有视角页）
    expect(
      (
        await submit(
          { kind: "edit", pageId: termId, content: "x", baseRevisionId: 1 },
          editor1.cookie,
        )
      ).status,
    ).toBe(400);
    // supersedes 只能指向已驳回的提交
    expect(
      (
        await submit(
          {
            kind: "edit",
            pageId,
            content: "x",
            baseRevisionId: await headRevisionId(pageId),
            supersedes: 999999,
          },
          editor1.cookie,
        )
      ).status,
    ).toBe(400);
  });
});

describe("两票受理（顺序批准、任一驳回即终态）", () => {
  it("quorum=2：首票记票不生效，第二票凑满生效；同一管理员重复投票 409", async () => {
    await setAdminsExactly([admin1.id, admin2.id]);
    const pageId = await perspectiveIdOf("意识形态", "阿尔都塞");

    const created = await submitEdit(editor1, pageId, "意识形态：两票受理版。");
    expect(created.data.quorum).toBe(2);
    const id = created.data.submissionId as number;
    const before = await history(pageId);

    const first = await review(id, { action: "approve" }, admin1.cookie);
    expect(first.data).toEqual({ outcome: "pending", approveCount: 1, quorum: 2 });
    expect(await history(pageId)).toEqual(before); // 记票未生效，历史也不增加

    const dup = await review(id, { action: "approve" }, admin1.cookie);
    expect(dup.status).toBe(409);
    expect(await history(pageId)).toEqual(before);

    const second = await review(id, { action: "approve" }, admin2.cookie);
    expect(second.data).toEqual({ outcome: "approved" });
    expect(await headContent(pageId)).toBe("意识形态：两票受理版。");
    const after = await history(pageId);
    expect(after.revisions).toHaveLength(before.revisions.length + 1);
    expect(after.revisions.slice(1)).toEqual(before.revisions);

    // 两名不同管理员的 HTTP 结果证明两票生效；重复/终态请求不能再产生修订。
    const acceptedHistory = await history(pageId);
    expect((await review(id, { action: "approve" }, admin2.cookie)).status).toBe(409);
    expect(await history(pageId)).toEqual(acceptedHistory);
  });

  it("一准一驳 = 驳回终态：先投的批准票作废，内容不生效", async () => {
    await setAdminsExactly([admin1.id, admin2.id]);
    const pageId = await perspectiveIdOf("意识形态", "阿尔都塞");
    const before = await headContent(pageId);

    const created = await submitEdit(editor1, pageId, "一准一驳的版本。");
    const id = created.data.submissionId as number;

    expect((await review(id, { action: "approve" }, admin1.cookie)).data.outcome).toBe("pending");
    const rejected = await review(id, { action: "reject", reason: "口径与词条定位不符。" }, admin2.cookie);
    expect(rejected.data).toMatchObject({ outcome: "rejected", staleBase: false });

    expect(await headContent(pageId)).toBe(before);
    expect((await review(id, { action: "approve" }, admin2.cookie)).status).toBe(409);
  });

  it("准入：游客提交 401；编者审核 403；不存在的提交 404", async () => {
    await setAdminsExactly([admin1.id]);
    const pageId = await perspectiveIdOf("意识形态", "阿尔都塞");

    expect(
      (await submit({ kind: "edit", pageId, content: "x", baseRevisionId: 1 })).status,
    ).toBe(401);
    const created = await submitEdit(editor1, pageId, "准入测试版本。");
    expect((await review(created.data.submissionId, { action: "approve" }, editor2.cookie)).status).toBe(403);
    expect((await review(999_999, { action: "approve" }, admin1.cookie)).status).toBe(404);
  });

  it("晋升为管理员的提交者不能受理自己的提交（403），他人可受理", async () => {
    await setAdminsExactly([admin1.id]);
    const pageId = await perspectiveIdOf("意识形态", "阿尔都塞");
    const created = await submitEdit(editor2, pageId, "等待自己被晋升的版本。");
    const id = created.data.submissionId as number;

    // 提交后提交者被晋升为管理员——仍不能自审
    await setAdminsExactly([admin1.id, editor2.id]);
    expect((await review(id, { action: "approve" }, editor2.cookie)).status).toBe(403);

    const approved = await review(id, { action: "approve" }, admin1.cookie);
    expect(approved.data).toEqual({ outcome: "approved" });
  });
});

describe("冷启动退化与 quorum 快照（min(2, 管理员数)，创建时定格）", () => {
  it("恰一名管理员：quorum=1，单票即生效", async () => {
    await setAdminsExactly([admin1.id]);
    const pageId = await perspectiveIdOf("异化", "马克思");

    const created = await submitEdit(editor1, pageId, "冷启动单管理员版。");
    expect(created.data.quorum).toBe(1);
    const approved = await review(created.data.submissionId, { action: "approve" }, admin1.cookie);
    expect(approved.data).toEqual({ outcome: "approved" });
    expect(await headContent(pageId)).toBe("冷启动单管理员版。");
  });

  it("quorum 在提交创建时快照：之后管理员人数增减不追溯已存在的提交", async () => {
    const pageId = await perspectiveIdOf("异化", "马克思");

    // 提交时只有一名管理员（quorum=1）——之后增员，一票仍生效
    await setAdminsExactly([admin1.id]);
    const submittedWhenOne = await submitEdit(editor1, pageId, "单管理员期提交的内容。");
    expect(submittedWhenOne.data.quorum).toBe(1);
    await setAdminsExactly([admin1.id, admin2.id]);
    const promoted = await review(
      submittedWhenOne.data.submissionId,
      { action: "approve" },
      admin1.cookie,
    );
    expect(promoted.data).toEqual({ outcome: "approved" });

    // 反向：两名管理员期提交（quorum=2）——之后减员，仍差一票、保持 pending
    const submittedWhenTwo = await submitEdit(editor2, pageId, "双管理员期提交的内容。");
    expect(submittedWhenTwo.data.quorum).toBe(2);
    await setAdminsExactly([admin1.id]);
    const beforePartial = await history(pageId);
    const partial = await review(
      submittedWhenTwo.data.submissionId,
      { action: "approve" },
      admin1.cookie,
    );
    expect(partial.data).toEqual({ outcome: "pending", approveCount: 1, quorum: 2 });
    expect(await history(pageId)).toEqual(beforePartial);
  });
});

describe("并发防护（base 过期自动驳回，ADR-0004 #2）", () => {
  it("页面 head 越过 base 后受理：自动驳回并提示基于新版重新提交", async () => {
    await setAdminsExactly([admin1.id]);
    const pageId = await perspectiveIdOf("剩余价值", "马克思");
    const base = await headRevisionId(pageId);

    // 编者基于 r1 提交；随后管理员直编使页面前进到 r2
    const created = await submit(
      {
        kind: "edit",
        pageId,
        content: "编者基于旧版的内容。",
        baseRevisionId: base,
      },
      editor1.cookie,
    );
    const direct = await submit(
      {
        kind: "edit",
        pageId,
        content: "管理员抢先直编的内容。",
        baseRevisionId: base,
      },
      admin1.cookie,
    );
    expect(direct.data.outcome).toBe("direct");
    expect(await headRevisionId(pageId)).not.toBe(base);

    // 受理编者的提交：base 过期 → 该票无法通过，自动驳回
    const outcome = await review(created.data.submissionId, { action: "approve" }, admin1.cookie);
    expect(outcome.data).toMatchObject({ outcome: "rejected", staleBase: true });
    expect(outcome.data.message).toContain("重新提交");

    // 读路径保持管理员的版本，编者的旧 base 内容未覆盖
    expect(await headContent(pageId)).toBe("管理员抢先直编的内容。");

    // 编者基于新版（当前 head）重提 → 正常受理生效
    const resubmitted = await submitEdit(editor1, pageId, "编者基于新版的内容。");
    const approved = await review(resubmitted.data.submissionId, { action: "approve" }, admin1.cookie);
    expect(approved.data).toEqual({ outcome: "approved" });
    expect(await headContent(pageId)).toBe("编者基于新版的内容。");
  });

  it("base 未过期（head == base）时正常通过", async () => {
    await setAdminsExactly([admin1.id]);
    const pageId = await perspectiveIdOf("剩余价值", "马克思");
    const created = await submitEdit(editor1, pageId, "base 未过期的正常受理。");
    const outcome = await review(created.data.submissionId, { action: "approve" }, admin1.cookie);
    expect(outcome.data).toEqual({ outcome: "approved" });
  });
});

describe("管理员直编（不经队列，与受理共用修订管线）", () => {
  it("同一端点：管理员提交直接生效，返回阅读地址并追加修订", async () => {
    await setAdminsExactly([admin1.id]);
    const pageId = await perspectiveIdOf("价值", "马克思");
    const before = await history(pageId);

    const result = await submitEdit(admin1, pageId, "管理员直编的通俗视角。");
    expect(result.status).toBe(201);
    expect(result.data.outcome).toBe("direct");
    expect(result.data.href).toMatch(new RegExp(`/perspective/.+-${pageId}$`));
    expect(await headContent(pageId)).toBe("管理员直编的通俗视角。");
    expect(result.data).not.toHaveProperty("submissionId");
    const after = await history(pageId);
    expect(after.revisions).toHaveLength(before.revisions.length + 1);
    expect(after.revisions.slice(1)).toEqual(before.revisions);
  });
});
