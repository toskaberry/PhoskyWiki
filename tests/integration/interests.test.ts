import { fixtureSignUp } from "./auth-fixture";
// T12 兴趣标签与推荐：账号侧读写（主缝 = PUT /api/interests 直调）、
// 视角列表兴趣重排（lib 组合）与相关词条推荐（共同引用 + 兴趣匹配）。
// 种子自灌；注册用户按 email 级联清理（interest_tags 随 user 级联删除）。

import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PUT } from "@/app/api/interests/route";
import { auth } from "@/lib/auth";
import { seedDatabase } from "@/db/seed";
import { getDb } from "@/db";
import { interpreters, pages, user } from "@/db/schema";
import {
  listCategoryRows,
  listInterpreters,
  listPerspectivesOfTerm,
  listSchools,
  listTerms,
} from "@/lib/content";
import { getLocalGraph } from "@/lib/graph";
import {
  expandInterestedInterpreters,
  getInterestTags,
  saveInterestTags,
} from "@/lib/interests";
import { EMPTY_INTEREST_SET, reorderPerspectivesByInterest } from "@/lib/interest-tags";
import { listRelatedTerms } from "@/lib/recommend";

beforeAll(async () => {
  await seedDatabase();
});

const createdEmails: string[] = [];

afterAll(async () => {
  const db = getDb();
  for (const email of createdEmails) {
    await db.delete(user).where(eq(user.email, email));
  }
});

// 建号 + 登录，把 Set-Cookie 拼成 Cookie 头（route handler 直调的会话载体）
async function createEditor(password: string): Promise<{ cookie: string; userId: string }> {
  const email = `t12-${randomUUID()}@example.com`;
  createdEmails.push(email);
  const signUp = await fixtureSignUp({
    body: { name: "兴趣测试编者", email, password },
  });
  const res = await auth.api.signInEmail({
    body: { email, password },
    asResponse: true,
  });
  const cookie = res.headers
    .getSetCookie()
    .map((value) => value.split(";")[0])
    .join("; ");
  return { cookie, userId: signUp.user.id };
}

function putRequest(body: unknown, cookie?: string): Request {
  return new Request("http://localhost/api/interests", {
    method: "PUT",
    headers: {
      "content-type": "application/json",
      ...(cookie === undefined ? {} : { cookie }),
    },
    body: JSON.stringify(body),
  });
}

async function termIdByTitle(title: string): Promise<number> {
  const term = (await listTerms()).find((row) => row.title === title);
  if (!term) throw new Error(`种子缺少词条：${title}`);
  return term.id;
}

async function interpreterIdByName(name: string): Promise<number> {
  const interpreter = (await listInterpreters()).find((row) => row.name === name);
  if (!interpreter) throw new Error(`种子缺少诠释者：${name}`);
  return interpreter.pageId;
}

async function schoolIdByTitle(title: string): Promise<number> {
  const school = (await listSchools()).find((row) => row.title === title);
  if (!school) throw new Error(`种子缺少学派：${title}`);
  return school.id;
}

async function categoryIdByName(name: string): Promise<number> {
  const category = (await listCategoryRows()).find((row) => row.name === name);
  if (!category) throw new Error(`种子缺少分类：${name}`);
  return category.id;
}

/** 主体性 词条下的视角标题（默认序：热度 → 创建序）。 */
async function subjectivityTitles(): Promise<string[]> {
  return (await listPerspectivesOfTerm(await termIdByTitle("主体性"))).map((p) => p.title);
}

/** 词条页视角重排的组合路径（登录态服务端做的事）：账号兴趣 → 展开 → 重排。 */
async function orderedTitlesWithInterests(
  userId: string,
  termTitle: string,
  interests: Parameters<typeof saveInterestTags>[1],
): Promise<string[]> {
  const saved = await saveInterestTags(userId, interests);
  const expanded = await expandInterestedInterpreters(saved);
  const termId = await termIdByTitle(termTitle);
  const perspectives = await listPerspectivesOfTerm(termId);
  return reorderPerspectivesByInterest(perspectives, expanded).map((p) => p.title);
}

describe("PUT /api/interests（账号同步路径）", () => {
  it("未登录 401，不落任何行", async () => {
    const res = await PUT(putRequest({ interpreters: [1] }));
    expect(res.status).toBe(401);
    expect(await getInterestTags("no-such-user")).toEqual(EMPTY_INTEREST_SET);
  });

  it("登录保存生效；陈旧 id 静默丢弃；再次 PUT 全量替换", async () => {
    const { cookie, userId } = await createEditor("interest-pass-123");
    const deleuze = await interpreterIdByName("德勒兹");
    const psychoanalysis = await schoolIdByTitle("精神分析");

    const res = await PUT(
      putRequest(
        { interpreters: [deleuze, 999_999], schools: [psychoanalysis] },
        cookie,
      ),
    );
    expect(res.status).toBe(200);
    // 999_999 不存在：静默丢弃，保存本身成功
    expect(await getInterestTags(userId)).toEqual({
      interpreters: [deleuze],
      schools: [psychoanalysis],
      categories: [],
    });

    // 全量替换：第二次 PUT 只剩 马克思
    const lacan = await interpreterIdByName("拉康");
    const replace = await PUT(putRequest({ interpreters: [lacan] }, cookie));
    expect(replace.status).toBe(200);
    expect(await getInterestTags(userId)).toEqual({
      interpreters: [lacan],
      schools: [],
      categories: [],
    });

    // 清空也是合法的替换
    const clear = await PUT(putRequest({}, cookie));
    expect(clear.status).toBe(200);
    expect(await getInterestTags(userId)).toEqual(EMPTY_INTEREST_SET);
  });

  it("软删除的诠释者不再是有效兴趣目标", async () => {
    const db = getDb();
    // 直接造一个已软删除的诠释者页（不入种子序列，测试末尾物理删除，级联清负载行）
    const [deletedPage] = await db
      .insert(pages)
      .values({
        type: "interpreter",
        title: "T12软删除诠释者",
        slug: "t12-deleted-interpreter",
        deletedAt: new Date(),
      })
      .returning({ id: pages.id });
    await db.insert(interpreters).values({ pageId: deletedPage.id, summary: "" });

    const { cookie, userId } = await createEditor("interest-softdel-123");
    const live = await interpreterIdByName("拉康");
    const res = await PUT(
      putRequest({ interpreters: [live, deletedPage.id] }, cookie),
    );
    expect(res.status).toBe(200);
    expect(await getInterestTags(userId)).toEqual({
      interpreters: [live],
      schools: [],
      categories: [],
    });

    await db.delete(pages).where(eq(pages.id, deletedPage.id));
  });

  it("非法请求体 400", async () => {
    const { cookie } = await createEditor("interest-badbody-123");
    const cases: unknown[] = [
      { interpreters: "拉康" },
      { schools: [0] },
      { categories: [-1] },
      { interpreters: Array.from({ length: 51 }, (_, i) => i + 1) },
    ];
    for (const body of cases) {
      const res = await PUT(putRequest(body, cookie));
      expect(res.status).toBe(400);
      const data = (await res.json()) as { error: string };
      expect(data.error).toBeTruthy();
    }
  });
});

describe("视角列表兴趣重排（登录态服务端组合）", () => {
  let orderUser: { userId: string };

  beforeAll(async () => {
    orderUser = await createEditor("interest-order-123");
  });

  it("默认序：站内引用多的视角在前（未设兴趣不受影响）", async () => {
    const titles = await subjectivityTitles();
    expect(titles[0]).toBe("阿尔都塞论主体性");
    // 种子里唯一被显式视角链接引用的是 阿尔都塞论主体性（[[主体性|阿尔都塞论主体性@阿尔都塞]]）
    expect(titles.indexOf("阿尔都塞论主体性")).toBeLessThan(titles.indexOf("德勒兹论主体性"));
    // 空兴趣集 = 默认序
    expect(
      reorderPerspectivesByInterest(await listPerspectivesOfTerm(await termIdByTitle("主体性")), new Set()),
    ).toEqual(await listPerspectivesOfTerm(await termIdByTitle("主体性")));
  });

  it("兴趣诠释者的视角排前（集成验收：兴趣诠释者视角排前）", async () => {
    const before = await subjectivityTitles();
    const after = await orderedTitlesWithInterests(orderUser.userId, "主体性", {
      interpreters: [await interpreterIdByName("德勒兹")],
      schools: [],
      categories: [],
    });
    expect(after[0]).toBe("德勒兹论主体性"); // 兴趣诠释者紧随其后
    // 其余保持默认相对序
    expect(after.slice(1)).toEqual(before.filter((title) => title !== "德勒兹论主体性"));
  });

  it("学派兴趣蕴含成员：精神分析（弗洛伊德、拉康）的视角排前", async () => {
    const after = await orderedTitlesWithInterests(orderUser.userId, "主体性", {
      interpreters: [],
      schools: [await schoolIdByTitle("精神分析")],
      categories: [],
    });
    expect(after.slice(0, 2)).toEqual(["拉康论主体性", "弗洛伊德论主体性"]);
    // 拉康（创建序在前）与弗洛伊德（创建序在后，种子末段）都升到前面
    expect(after.indexOf("拉康论主体性")).toBeLessThan(after.indexOf("阿尔都塞论主体性"));
    expect(after.indexOf("弗洛伊德论主体性")).toBeLessThan(after.indexOf("阿尔都塞论主体性"));
  });


});

describe("相关词条推荐（共同引用 + 兴趣匹配）", () => {
  async function subjectivityGraph() {
    const graph = await getLocalGraph(await termIdByTitle("主体性"), 1);
    if (!graph) throw new Error("主体性 局部图谱为空");
    return graph;
  }

  it("默认（无兴趣）按共同引用强度排序", async () => {
    const related = await listRelatedTerms(await subjectivityGraph(), null, new Set());
    // 主体性 的 1 跳邻居：异化 > 意识形态 > 剩余价值（价值已无主体性入链）
    expect(related.map((term) => term.title)).toEqual([
      "异化",
      "意识形态",
      "剩余价值",
    ]);
    expect(related.every((term) => term.interestMatchCount === 0)).toBe(true);
    expect(related[0].commonRefCount).toBeGreaterThan(related[1].commonRefCount);
  });

  it("主题兴趣（政治经济学）把该分类的邻居顶到最前并带兴趣标记", async () => {
    const political = await categoryIdByName("政治经济学");
    const interests = { interpreters: [], schools: [], categories: [political] };
    const related = await listRelatedTerms(await subjectivityGraph(), interests, new Set());
    expect(related.map((term) => term.title)).toEqual([
      "剩余价值",
      "异化",
      "意识形态",
    ]);
    expect(related[0].interestMatchCount).toBeGreaterThan(0);
  });

  it("诠释者兴趣按「该诠释者在邻居词条的视角数」加分", async () => {
    const marcuse = await interpreterIdByName("马尔库塞");
    const interests = { interpreters: [marcuse], schools: [], categories: [] };
    const related = await listRelatedTerms(
      await subjectivityGraph(),
      interests,
      await expandInterestedInterpreters(interests),
    );
    // 马尔库塞只在 意识形态 有视角（马尔库塞论意识形态）→ 意识形态 第一
    expect(related[0].title).toBe("意识形态");
    expect(related[0].interestMatchCount).toBe(1);
  });
});
