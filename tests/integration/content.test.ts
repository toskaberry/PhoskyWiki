// 读路径数据层集成测试：连真实 PG（docker），种子自灌（幂等）。
// 注意：seedDatabase 会 TRUNCATE 内容表——同批并行的测试文件不得依赖既有内容行
//（healthz 只碰 pg_extension 与探活路由，不受影响）。反链/同名聚合
// 测试也放在本文件：共享同一份种子，避免并行 TRUNCATE 互踩。


import { eq, inArray, isNotNull, isNull } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";

import { seedDatabase } from "@/db/seed";
import { getDb } from "@/db";
import { links, pages, perspectives, terms } from "@/db/schema";
import {
  getHeadContent,
  getInterpreterDetail,
  getLivePage,
  getPerspectiveDetail,
  getWikiLinkTargets,
  listBacklinks,
  listPerspectivesOfInterpreter,
  listPerspectivesOfTerm,
  listTerms,
} from "@/lib/content";
import { pagePath } from "@/lib/slug";

beforeAll(async () => {
  await seedDatabase();
});

// 便捷取种子里词条的 id（不硬编码数据库自增 id）
async function termIdByTitle(title: string): Promise<number> {
  const all = await listTerms();
  const term = all.find((t) => t.title === title);
  if (!term) throw new Error(`种子缺少词条：${title}`);
  return term.id;
}

describe("种子完整性（T02 验收：≥3 词条、≥3 诠释者、≥4 视角、跨词条双链 + 红链）", () => {
  it("词条 ≥3 且带简介与视角数", async () => {
    const all = await listTerms();
    expect(all.length).toBeGreaterThanOrEqual(3);
    for (const term of all) {
      expect(term.summary.length).toBeGreaterThan(0);
      expect(term.perspectiveCount).toBeGreaterThan(0);
    }
    expect(all.map((t) => t.title)).toContain("主体性");
  });

  it("视角 ≥4：主体性 词条下多个具名诠释者视角", async () => {
    const subjectivity = await termIdByTitle("主体性");
    const perspectives = await listPerspectivesOfTerm(subjectivity);
    expect(perspectives.length).toBeGreaterThanOrEqual(4);
    const titles = perspectives.map((p) => p.title);
    expect(titles).toContain("拉康论主体性");
    expect(titles).toContain("福柯论主体性");
  });

  it("每个视角都有 head 修订内容（Markdown 源文本）", async () => {
    const subjectivity = await termIdByTitle("主体性");
    const perspectives = await listPerspectivesOfTerm(subjectivity);
    for (const p of perspectives) {
      const content = await getHeadContent(p.pageId);
      expect(content?.length ?? 0).toBeGreaterThan(20);
    }
  });

  it("跨词条双链已解析落 page_id，未创建词条为红链（target 为空 + 名称快照）", async () => {
    const db = getDb();
    const resolvedCount = await db.$count(links, isNotNull(links.targetPageId));
    const redCount = await db.$count(links, isNull(links.targetPageId));
    expect(resolvedCount).toBeGreaterThanOrEqual(10);
    expect(redCount).toBeGreaterThanOrEqual(1);

    // 拉康论主体性：意识形态/异化 已解析，镜像阶段 红链
    const subjectivity = await termIdByTitle("主体性");
    const lacan = (await listPerspectivesOfTerm(subjectivity)).find(
      (p) => p.interpreterName === "拉康",
    )!;
    const targets = await getWikiLinkTargets(lacan.pageId);

    const ideology = targets.get("意识形态")!;
    expect(ideology.exists).toBe(true);
    expect(ideology.href).toBe(pagePath("term", "意识形态", await termIdByTitle("意识形态")));

    expect(targets.get("异化")!.exists).toBe(true);
    expect(targets.get("镜像阶段")).toEqual({ href: "", exists: false });
  });

  it("视角排序：按引用热度（links 统计）降序、并列按创建序", async () => {
    const subjectivity = await termIdByTitle("主体性");
    const perspectives = await listPerspectivesOfTerm(subjectivity);

    const rest = perspectives.map((p) => p.linkCount);
    for (let i = 1; i < rest.length; i++) {
      expect(rest[i - 1]).toBeGreaterThanOrEqual(rest[i]);
    }
  });

  it("视角排序：被站内双链引用的视角排在同词条其他视角之前", async () => {
    const db = getDb();
    const subjectivity = await termIdByTitle("主体性");
    const perspectives = await listPerspectivesOfTerm(subjectivity);
    const byTitle = new Map(perspectives.map((p) => [p.title, p]));
    const source = byTitle.get("拉康论主体性")!;
    const hot = byTitle.get("德勒兹论主体性")!; // 种子里引用数为 0

    // 造一条指向德勒兹视角的入链，使其与种子里已有 1 条引用的阿尔都塞视角并列
    await db.insert(links).values({
      sourcePageId: source.pageId,
      targetPageId: hot.pageId,
      targetName: `德勒兹论主体性-${hot.pageId}`,
    });
    try {
      const reordered = await listPerspectivesOfTerm(subjectivity);
      // 并列热度 1，按创建序：阿尔都塞（种子早于新增入链目标）在前
      expect(reordered[0].title).toBe("阿尔都塞论主体性");
      expect(reordered[1].title).toBe("德勒兹论主体性");
      expect(reordered[1].linkCount).toBe(1);
      expect(reordered.slice(2).map((p) => p.linkCount)).toEqual(
        reordered.slice(2).map(() => 0),
      );
    } finally {
      await db
        .delete(links)
        .where(eq(links.targetPageId, hot.pageId));
    }
  });
});

describe("页面解析与软删除", () => {
  it("getLivePage 返回在线页面；软删除后不可见", async () => {
    const db = getDb();
    const [fixture] = await db
      .insert(pages)
      .values({
        type: "term",
        title: "测试词条（集成自建）",
        slug: "ce-shi-ci-tiao",
        deletedAt: new Date(),
      })
      .returning({ id: pages.id });
    await db.insert(terms).values({ pageId: fixture.id, summary: "" });

    try {
      expect(await getLivePage(fixture.id)).toBeNull();
      expect((await listTerms()).map((t) => t.title)).not.toContain(
        "测试词条（集成自建）",
      );

      // 恢复（清除标记）后可见，再验证在线路径
      await db.update(pages).set({ deletedAt: null }).where(eq(pages.id, fixture.id));
      const live = await getLivePage(fixture.id);
      expect(live?.title).toBe("测试词条（集成自建）");
      expect((await listTerms()).map((t) => t.title)).toContain("测试词条（集成自建）");
    } finally {
      await db.delete(pages).where(eq(pages.id, fixture.id));
    }
  });

  it("类型不匹配的详情查询返回 null", async () => {
    const subjectivity = await termIdByTitle("主体性");
    expect(await getPerspectiveDetail(subjectivity)).toBeNull();
    expect(await getInterpreterDetail(subjectivity)).toBeNull();
  });
});

describe("诠释者轴读路径", () => {
  it("诠释者详情 + 全部视角索引", async () => {
    const db = getDb();
    const [lacanPage] = await db
      .select({ id: pages.id, slug: pages.slug })
      .from(pages)
      .where(eq(pages.title, "拉康"))
      .limit(1);

    const detail = await getInterpreterDetail(lacanPage.id);
    expect(detail?.birthYear).toBe(1901);
    expect(detail?.deathYear).toBe(1981);

    const index = await listPerspectivesOfInterpreter(lacanPage.id);
    expect(index.map((p) => p.title)).toEqual(["拉康论主体性"]);
    expect(index[0].termTitle).toBe("主体性");

    // 拉康论主体性 的详情反向联到词条与诠释者
    const perspectiveDetail = await getPerspectiveDetail(index[0].pageId);
    expect(perspectiveDetail?.termTitle).toBe("主体性");
    expect(perspectiveDetail?.interpreterName).toBe("拉康");
  });

  it("种子不包含编委会页面", async () => {
    expect(await getDb().select().from(pages).where(eq(pages.title, "编委会"))).toEqual([]);
  });
});

describe("反链面板（T04：词条页与视角页共用 links 直查）", () => {
  it("词条反链 = 引用该词条的视角列表，含所属词条上下文", async () => {
    const subjectivity = await termIdByTitle("主体性");
    const backlinks = await listBacklinks(subjectivity);

    const titles = backlinks.map((b) => b.title);
    expect(titles).toEqual(expect.arrayContaining(["黑格尔论异化", "马尔库塞论意识形态"]));
    for (const item of backlinks) {
      expect(item.termTitle.length).toBeGreaterThan(0);
      // 反链项可寻址：视角页与所属词条页路径都能生成
      expect(pagePath("perspective", item.slug, item.pageId)).toMatch(/\/perspective\//);
      expect(pagePath("term", item.termSlug, item.termId)).toMatch(/\/term\//);
    }
  });

  it("视角反链 = 显式视角语法的入链（词条@诠释者 键落视角 page_id）", async () => {
    const subjectivity = await termIdByTitle("主体性");
    const althusser = (await listPerspectivesOfTerm(subjectivity)).find(
      (p) => p.title === "阿尔都塞论主体性",
    )!;
    const backlinks = await listBacklinks(althusser.pageId);

    expect(backlinks.map((b) => b.title)).toEqual(["阿尔都塞论意识形态"]);
    expect(backlinks[0].termTitle).toBe("意识形态");

    // 落库形态：阿尔都塞论意识形态 的 links 里，显式键已解析到视角页
    const targets = await getWikiLinkTargets(backlinks[0].pageId);
    expect(targets.get("主体性@阿尔都塞")).toEqual({
      href: pagePath("perspective", althusser.slug, althusser.pageId),
      exists: true,
    });
  });

  it("红链的显式视角语法：诠释者不存在时 target 为空、键保留名称快照", async () => {
    const subjectivity = await termIdByTitle("主体性");
    const lacan = (await listPerspectivesOfTerm(subjectivity)).find(
      (p) => p.interpreterName === "拉康",
    )!;
    const targets = await getWikiLinkTargets(lacan.pageId);
    expect(targets.get("主体性@德里达")).toEqual({ href: "", exists: false });
  });

  it("软删除的引用方不进反链；恢复后重新出现", async () => {
    const db = getDb();
    const subjectivity = await termIdByTitle("主体性");
    const before = await listBacklinks(subjectivity);
    const source = before.find((b) => b.title === "黑格尔论异化")!;
    expect(source).toBeDefined();

    await db.update(pages).set({ deletedAt: new Date() }).where(eq(pages.id, source.pageId));
    try {
      expect(
        (await listBacklinks(subjectivity)).some((b) => b.pageId === source.pageId),
      ).toBe(false);
    } finally {
      await db.update(pages).set({ deletedAt: null }).where(eq(pages.id, source.pageId));
    }
    expect(
      (await listBacklinks(subjectivity)).some((b) => b.pageId === source.pageId),
    ).toBe(true);
  });
});

describe("同名概念在词条内聚合", () => {
  it("价值只有一个枢纽，解释由具名视角承载", async () => {
    const matches = (await listTerms()).filter(t => t.title.startsWith("价值"));
    expect(matches.map(t => t.title)).toEqual(["价值"]);
    const viewpoints = await listPerspectivesOfTerm(matches[0].id);
    expect(viewpoints.map(p => p.interpreterName)).toEqual(["马克思"]);
    const content = await getHeadContent(viewpoints[0].pageId);
    expect(content).toContain("价值");
    const surplus = await termIdByTitle("剩余价值");
    const marx = (await listPerspectivesOfTerm(surplus)).find(p => p.interpreterName === "马克思")!;
    expect((await getWikiLinkTargets(marx.pageId)).get("价值")).toEqual({ exists: true, href: pagePath("term", matches[0].slug, matches[0].id) });
  });
});

describe("软删除视角不出现在任何计数里", () => {
  async function termRow(title: string) {
    const row = (await listTerms()).find((t) => t.title === title);
    if (!row) throw new Error(`种子缺少词条：${title}`);
    return row;
  }

  it("词条视角数（首页列表）的 perspectiveCount 不含软删除视角", async () => {
    const db = getDb();
    const title = "价值";
    const before = await termRow(title);
    expect(before.perspectiveCount).toBeGreaterThanOrEqual(1);

    // 成员本体（词条页）在线，软删除的只是它的视角页

    const livePageIds = (await listPerspectivesOfTerm(before.id)).map((p) => p.pageId);
    try {
      await db
        .update(pages)
        .set({ deletedAt: new Date() })
        .where(inArray(pages.id, livePageIds));

      expect((await termRow(title)).perspectiveCount).toBe(0);

    } finally {
      await db
        .update(pages)
        .set({ deletedAt: null })
        .where(inArray(pages.id, livePageIds));
    }
  });

  it("热度 linkCount 不含软删除引用方的双链（与反链面板同一口径）", async () => {
    const db = getDb();
    const subjectivity = await termIdByTitle("主体性");
    const foucaultBefore = (await listPerspectivesOfTerm(subjectivity)).find(
      (p) => p.title === "福柯论主体性",
    )!;

    // 两个在线夹具视角页各发一条指向福柯视角的双链：热度 +2
    const fixtureIds: number[] = [];
    try {
      for (let i = 0; i < 2; i++) {
        const [fixture] = await db
          .insert(pages)
          .values({
            type: "perspective",
            title: `热度夹具（软删除回归）${i}`,
            slug: `heat-fixture-${Date.now()}-${i}`,
          })
          .returning({ id: pages.id });
        fixtureIds.push(fixture.id);
        const [term] = await db.insert(pages).values({
          type: "term", title: `热度夹具词条 ${fixture.id}`, slug: `heat-term-${fixture.id}`,
        }).returning({ id: pages.id });
        fixtureIds.push(term.id);
        await db.insert(terms).values({ pageId: term.id });
        await db.insert(perspectives).values({
          pageId: fixture.id, termId: term.id, interpreterId: foucaultBefore.interpreterId,
        });
        await db.insert(links).values({
          sourcePageId: fixture.id,
          targetPageId: foucaultBefore.pageId,
          targetName: `主体性@福柯-${i}`,
        });
      }
      const heated = (await listPerspectivesOfTerm(subjectivity)).find(
        (p) => p.title === "福柯论主体性",
      )!;
      expect(heated.linkCount).toBe(foucaultBefore.linkCount + 2);

      // 软删除一个引用方：它的双链立刻不再加热——软删除页不给别人加热
      await db
        .update(pages)
        .set({ deletedAt: new Date() })
        .where(eq(pages.id, fixtureIds[0]!));
      const cooled = (await listPerspectivesOfTerm(subjectivity)).find(
        (p) => p.title === "福柯论主体性",
      )!;
      expect(cooled.linkCount).toBe(foucaultBefore.linkCount + 1);
    } finally {
      if (fixtureIds.length > 0) {
        await db.delete(links).where(inArray(links.sourcePageId, fixtureIds));
        await db.delete(pages).where(inArray(pages.id, fixtureIds));
      }
    }
  });
});
