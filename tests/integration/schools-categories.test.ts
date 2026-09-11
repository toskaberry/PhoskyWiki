// 学派轴与分类轴读路径集成测试：连真实 PG（docker），种子自灌（幂等）。
// 强弱类型边界（T03 验收）在 schema 层锁定：
//   学派只能挂诠释者（school_members.interpreter_id → interpreters），
//   分类只能挂词条（term_categories.term_id → terms），反向挂载被外键拒绝。
// 注意：seedDatabase 会 TRUNCATE 内容表，与 content.test.ts 依赖 vitest
// 关闭文件并行（见 vitest.config.ts 的 fileParallelism: false）。

import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";

import { seedDatabase } from "@/db/seed";
import { getDb } from "@/db";
import { categories, pages, schoolMembers, termCategories, terms } from "@/db/schema";
import {
  getCategoryDetailBySlug,
  getCategoryTree,
  getSchoolDetail,
  listCategoriesOfTerm,
  listSchoolCoreTerms,
  listSchoolMembers,
  listSchools,
  listSchoolsOfInterpreter,
} from "@/lib/content";

beforeAll(async () => {
  await seedDatabase();
});

/** 按标题查页面 id（种子内容专用便捷取法，不硬编码自增 id）。 */
async function pageIdByTitle(title: string): Promise<number> {
  const [row] = await getDb()
    .select({ id: pages.id })
    .from(pages)
    .where(eq(pages.title, title))
    .limit(1);
  if (!row) throw new Error(`种子缺少页面：${title}`);
  return row.id;
}

async function categoryIdByName(name: string): Promise<number> {
  const [row] = await getDb()
    .select({ id: categories.id })
    .from(categories)
    .where(eq(categories.name, name))
    .limit(1);
  if (!row) throw new Error(`种子缺少分类：${name}`);
  return row.id;
}

describe("种子与学派轴读路径（T03 验收：≥2 学派，成员与核心词条就位）", () => {
  it("学派列表 ≥2：精神分析与法兰克福学派，成员数与核心词条数就位", async () => {
    const schools = await listSchools();
    expect(schools.length).toBeGreaterThanOrEqual(2);

    const psychoanalysis = schools.find((s) => s.title === "精神分析")!;
    expect(psychoanalysis.memberCount).toBe(2);
    expect(psychoanalysis.coreTermCount).toBe(1);

    const frankfurt = schools.find((s) => s.title === "法兰克福学派")!;
    expect(frankfurt.memberCount).toBe(2);
    expect(frankfurt.coreTermCount).toBe(2);
  });

  it("学派详情 + 成员诠释者列表（软删除的诠释者视同退出学派）", async () => {
    const id = await pageIdByTitle("精神分析");
    const detail = await getSchoolDetail(id);
    expect(detail?.summary.length).toBeGreaterThan(0);

    const members = await listSchoolMembers(id);
    // 按诠释者页 id 排序：拉康（先插入）在弗洛伊德之前
    expect(members.map((m) => m.name)).toEqual(["拉康", "弗洛伊德"]);
    expect(members.find((m) => m.name === "拉康")?.birthYear).toBe(1901);
    expect(members.find((m) => m.name === "拉康")?.perspectiveCount).toBe(1);

    // 类型不匹配的详情查询返回 null
    expect(await getSchoolDetail(await pageIdByTitle("主体性"))).toBeNull();
  });

  it("学派核心词条由成员视角派生：精神分析→主体性×2；法兰克福→主体性、意识形态", async () => {
    const psychoanalysis = await listSchoolCoreTerms(await pageIdByTitle("精神分析"));
    expect(psychoanalysis.map((t) => t.title)).toEqual(["主体性"]);
    expect(psychoanalysis[0].perspectiveCount).toBe(2); // 弗洛伊德 + 拉康

    const frankfurt = await listSchoolCoreTerms(await pageIdByTitle("法兰克福学派"));
    expect(frankfurt.map((t) => t.title)).toEqual(["主体性", "意识形态"]); // 并列按词条 id
    expect(frankfurt.every((t) => t.perspectiveCount === 1)).toBe(true);
  });

  it("诠释者所属学派：拉康→精神分析；马克思无学派", async () => {
    const lacanSchools = await listSchoolsOfInterpreter(await pageIdByTitle("拉康"));
    expect(lacanSchools.map((s) => s.title)).toEqual(["精神分析"]);

    const marxSchools = await listSchoolsOfInterpreter(await pageIdByTitle("马克思"));
    expect(marxSchools).toEqual([]);
  });

  it("软删除成员或词条后，学派的派生计数随之收缩，恢复后回归", async () => {
    const db = getDb();
    const marcuseId = await pageIdByTitle("马尔库塞");
    const ideologyId = await pageIdByTitle("意识形态");
    try {
      // 法兰克福学派：阿多诺（主体性）+ 马尔库塞（意识形态）→ 2 成员 2 核心词条
      const before = (await listSchools()).find((s) => s.title === "法兰克福学派")!;
      expect([before.memberCount, before.coreTermCount]).toEqual([2, 2]);

      // 软删除成员：其视角不再派生核心词条
      await db.update(pages).set({ deletedAt: new Date() }).where(eq(pages.id, marcuseId));
      const shrunk = (await listSchools()).find((s) => s.title === "法兰克福学派")!;
      expect([shrunk.memberCount, shrunk.coreTermCount]).toEqual([1, 1]);
      await db.update(pages).set({ deletedAt: null }).where(eq(pages.id, marcuseId));

      // 软删除词条：挂在其下的视角不计入成员视角数
      await db.update(pages).set({ deletedAt: new Date() }).where(eq(pages.id, ideologyId));
      const members = await listSchoolMembers(await pageIdByTitle("法兰克福学派"));
      expect(members.find((m) => m.name === "马尔库塞")?.perspectiveCount).toBe(0);
      expect(members.find((m) => m.name === "阿多诺")?.perspectiveCount).toBe(1);
    } finally {
      await db.update(pages).set({ deletedAt: null }).where(eq(pages.id, marcuseId));
      await db.update(pages).set({ deletedAt: null }).where(eq(pages.id, ideologyId));
    }
  });
});

describe("分类轴读路径（弱类型标签树只组织词条）", () => {
  it("分类树：根/子层级正确，词条计数只算直接挂载的在线词条", async () => {
    const tree = await getCategoryTree();
    const roots = tree.map((n) => n.name);
    expect(roots).toContain("哲学");
    expect(roots).toContain("马克思主义");
    expect(roots).toContain("政治经济学");

    const philosophy = tree.find((n) => n.name === "哲学")!;
    expect(philosophy.children.map((n) => n.name)).toEqual(["主体理论"]);
    expect(philosophy.children[0].termCount).toBe(1);

    const marxism = tree.find((n) => n.name === "马克思主义")!;
    expect(marxism.children.map((n) => n.name)).toEqual(["意识形态批判", "异化理论"]);
    // 马克思主义直接挂了 主体性 与 剩余价值（多挂演示），子分类词条不计入
    expect(marxism.termCount).toBe(2);
  });

  it("分类详情：祖先链面包屑 + 子分类 + 词条列表；未知 slug 返回 null", async () => {
    const subjectTheory = await getCategoryDetailBySlug("主体理论");
    expect(subjectTheory?.path.map((c) => c.name)).toEqual(["哲学"]);
    expect(subjectTheory?.terms.map((t) => t.title)).toEqual(["主体性"]);
    expect(subjectTheory?.terms[0].summary.length).toBeGreaterThan(0);

    const marxism = await getCategoryDetailBySlug("马克思主义");
    expect(marxism?.children.length).toBe(2);
    expect(marxism?.terms.map((t) => t.title)).toEqual(["主体性", "剩余价值"]);

    expect(await getCategoryDetailBySlug("不存在的分类")).toBeNull();
  });

  it("词条所属分类：一个词条可挂多个分类", async () => {
    const cats = await listCategoriesOfTerm(await pageIdByTitle("主体性"));
    expect(cats.map((c) => c.name)).toEqual(["主体理论", "马克思主义"]);
  });

  it("软删除的词条从分类计数与分类词条列表消失，恢复后回归", async () => {
    const db = getDb();
    const philosophyId = await categoryIdByName("哲学");
    // 种子可能给「哲学」直挂词条（T04 起「价值（哲学）」），计数断言只看夹具带来的增量
    const baseline =
      (await getCategoryTree()).find((n) => n.name === "哲学")?.termCount ?? 0;
    const [fixture] = await db
      .insert(pages)
      .values({ type: "term", title: "边界测试词条（学派分类自建）", slug: "bian-jie-ce-shi" })
      .returning({ id: pages.id });
    await db.insert(terms).values({ pageId: fixture.id, summary: "" });
    await db.insert(termCategories).values({ termId: fixture.id, categoryId: philosophyId });

    try {
      const withLive = await getCategoryDetailBySlug("哲学");
      expect(withLive?.terms.map((t) => t.title)).toContain("边界测试词条（学派分类自建）");
      expect((await getCategoryTree()).find((n) => n.name === "哲学")?.termCount).toBe(
        baseline + 1,
      );

      await db.update(pages).set({ deletedAt: new Date() }).where(eq(pages.id, fixture.id));
      const withDeleted = await getCategoryDetailBySlug("哲学");
      expect(withDeleted?.terms.map((t) => t.title)).not.toContain("边界测试词条（学派分类自建）");
      expect((await getCategoryTree()).find((n) => n.name === "哲学")?.termCount).toBe(
        baseline,
      );

      await db.update(pages).set({ deletedAt: null }).where(eq(pages.id, fixture.id));
      const restored = await getCategoryDetailBySlug("哲学");
      expect(restored?.terms.map((t) => t.title)).toContain("边界测试词条（学派分类自建）");
    } finally {
      await db.delete(pages).where(eq(pages.id, fixture.id));
    }
  });
});

describe("强弱类型边界（schema 层锁定，T03 验收）", () => {
  // drizzle 把 pg 错误包在 DrizzleQueryError.cause 里；23503 = foreign_key_violation
  async function pgErrorCode(rejection: Promise<unknown>): Promise<string | undefined> {
    return rejection.then(
      () => undefined,
      (err: { code?: string; cause?: { code?: string } }) =>
        err.cause?.code ?? err.code,
    );
  }

  it("学派挂词条被外键拒绝：school_members.interpreter_id 只指向诠释者", async () => {
    const termId = await pageIdByTitle("主体性"); // 词条页 id，不在 interpreters 表
    const schoolId = await pageIdByTitle("精神分析");
    expect(
      await pgErrorCode(
        getDb().insert(schoolMembers).values({ schoolId, interpreterId: termId }),
      ),
    ).toBe("23503");
  });

  it("分类挂诠释者被外键拒绝：term_categories.term_id 只指向词条", async () => {
    const interpreterId = await pageIdByTitle("拉康"); // 诠释者页 id，不在 terms 表
    const categoryId = await categoryIdByName("哲学");
    expect(
      await pgErrorCode(
        getDb().insert(termCategories).values({ termId: interpreterId, categoryId }),
      ),
    ).toBe("23503");
  });
});
