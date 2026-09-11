// 图谱数据层集成测试（T11）：links 表聚合 → 词条级节点/边（只读派生视图）。
// 注意：seedDatabase 会 TRUNCATE 内容表，与其他集成测试文件同样串行执行。

import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { GET as getSiteRoute } from "@/app/api/graph/site/route";
import { GET as getLocalRoute } from "@/app/api/graph/local/route";
import { seedDatabase } from "@/db/seed";
import { getDb } from "@/db";
import { interpreters, links, pages, perspectives, terms } from "@/db/schema";
import { getSiteGraph, getLocalGraph } from "@/lib/graph";
import { listTerms } from "@/lib/content";
import { pagePath } from "@/lib/slug";

async function termIdByTitle(title: string): Promise<number> {
  const term = (await listTerms()).find((t) => t.title === title);
  if (!term) throw new Error(`种子缺少词条：${title}`);
  return term.id;
}

beforeAll(async () => {
  await seedDatabase();
});

// 夹具：词条 A 的视角正文链接 词条 B（直接落 links 行，等价于保存时解析的结果）
afterAll(async () => {
  await getDb().delete(pages).where(eq(pages.slug, "graph-fixture"));
});

describe("全站图谱：links 聚合的节点/边（含热度权重、学派着色）", () => {
  it("全站与局部保留一个词条的多学派成员视角计数", async () => {
    const graph = await getSiteGraph();
    const subject = graph.nodes.find(n => n.title === "主体性")!;
    const psychoanalysis = graph.schools.find(s => s.title === "精神分析")!;
    expect(subject.schoolAffinities).toContainEqual({ schoolId: psychoanalysis.id, count: 2 });
    expect(subject.schoolAffinities.length).toBeGreaterThan(1);
    const local = await getLocalGraph(subject.id, 1);
    expect(local!.nodes.find(n => n.id === subject.id)!.schoolAffinities).toEqual(subject.schoolAffinities);
    const usedSchools = new Set(local!.nodes.flatMap(n => n.schoolAffinities.map(a => a.schoolId)));
    expect(new Set(local!.schools.map(s => s.id))).toEqual(usedSchools);
  });
  it("种子扩容后 ≥100 词条全在图中，节点可寻址、边无自环且规范化无向", async () => {
    const graph = await getSiteGraph();

    expect(graph.nodes.length).toBeGreaterThanOrEqual(100);
    // 验收口径：≥100 词条种子下图元素（节点 + 边）达到千级，交互仍可用
    expect(graph.nodes.length + graph.edges.length).toBeGreaterThanOrEqual(1000);

    const subjectivity = graph.nodes.find((n) => n.title === "主体性")!;
    expect(subjectivity).toBeDefined();
    expect(subjectivity.url).toBe(
      pagePath("term", "主体性", await termIdByTitle("主体性")),
    );
    expect(subjectivity.perspectiveCount).toBeGreaterThanOrEqual(8);

    for (const edge of graph.edges) {
      expect(edge.source).toBeLessThan(edge.target);
      expect(edge.weight).toBeGreaterThanOrEqual(1);
    }
  });

  it("节点热度 = 触边权重合计；孤立词条也在图中（热度 0）", async () => {
    const db = getDb();
    const [isolated] = await db
      .insert(pages)
      .values({ type: "term", title: "孤立词条（图谱夹具）", slug: "graph-fixture" })
      .returning({ id: pages.id });
    await db.insert(terms).values({ pageId: isolated.id, summary: "无任何双链" });

    try {
      const graph = await getSiteGraph();
      const node = graph.nodes.find((n) => n.id === isolated.id)!;
      expect(node).toBeDefined();
      expect(node.heat).toBe(0);

      // 任一非孤立节点：热度等于触边权重合计
      const byId = new Map(graph.nodes.map((n) => [n.id, n]));
      const some = graph.nodes.find((n) => n.heat > 0)!;
      const touching = graph.edges
        .filter((e) => e.source === some.id || e.target === some.id)
        .reduce((sum, e) => sum + e.weight, 0);
      expect(some.heat).toBe(touching);
      // 所有边端点都是图内节点
      for (const e of graph.edges) {
        expect(byId.has(e.source)).toBe(true);
        expect(byId.has(e.target)).toBe(true);
      }
    } finally {
      await db.delete(pages).where(eq(pages.id, isolated.id));
    }
  });

  it("学派着色是派生数据：主体性由精神分析主导（拉康 + 弗洛伊德）", async () => {
    const graph = await getSiteGraph();
    const psychoanalysis = graph.schools.find((s) => s.title === "精神分析")!;
    expect(psychoanalysis).toBeDefined();
    expect(psychoanalysis.color).toMatch(/^#/);

    const subjectivity = graph.nodes.find((n) => n.title === "主体性")!;
    expect(subjectivity.schoolId).toBe(psychoanalysis.id);

    // 扩容种子带来新学派，图例含全部在线学派且颜色各异
    expect(graph.schools.length).toBeGreaterThanOrEqual(5);
    const colors = new Set(graph.schools.map((s) => s.color));
    expect(colors.size).toBe(graph.schools.length);
  });

  it("边派生规则：视角正文双链 → 词条 × 词条；软删除与红链、消歧义目标不进图", async () => {
    const db = getDb();
    const sourceTerm = await termIdByTitle("主体性");
    const targetTerm = await termIdByTitle("异化");
    const [disambigPage] = await db
      .select({ id: pages.id })
      .from(pages)
      .where(eq(pages.title, "价值"))
      .limit(1);

    // 找一个在 主体性 下还没有视角的诠释者（视角唯一约束）
    const [interpreter] = await db
      .select({ id: interpreters.pageId })
      .from(interpreters)
      .where(
        sql`not exists (
          select 1 from ${perspectives} fp
          where fp.term_id = ${sourceTerm} and fp.interpreter_id = ${interpreters.pageId}
        )`,
      )
      .limit(1);
    const [perspectivePage] = await db
      .insert(pages)
      .values({ type: "perspective", title: "图谱夹具视角", slug: "graph-fixture-p" })
      .returning({ id: pages.id });
    await db
      .insert(perspectives)
      .values({ pageId: perspectivePage.id, termId: sourceTerm, interpreterId: interpreter.id });
    // 一条可解析 + 一条红链 + 一条指向消歧义页的链接
    await db.insert(links).values([
      { sourcePageId: perspectivePage.id, targetPageId: targetTerm, targetName: "异化" },
      { sourcePageId: perspectivePage.id, targetPageId: null, targetName: "红链目标" },
      { sourcePageId: perspectivePage.id, targetPageId: disambigPage.id, targetName: "价值" },
    ]);

    async function edgeWeight(): Promise<number | undefined> {
      const graph = await getSiteGraph();
      return graph.edges
        .find((e) => e.source === Math.min(sourceTerm, targetTerm) && e.target === Math.max(sourceTerm, targetTerm))
        ?.weight;
    }

    try {
      const before = await edgeWeight();

      // 软删除引用方：边权重立即回落（与反链面板同一口径）
      await db.update(pages).set({ deletedAt: new Date() }).where(eq(pages.id, perspectivePage.id));
      expect(await edgeWeight()).toBe(
        (before ?? 1) - 1,
      );

      await db.update(pages).set({ deletedAt: null }).where(eq(pages.id, perspectivePage.id));
      expect(await edgeWeight()).toBe(before);

      // 统一词条价值进入图谱；红链仍不产生节点
      const graph = await getSiteGraph();
      expect(graph.nodes.some((n) => n.id === disambigPage.id)).toBe(true);
      expect(graph.nodes.some((n) => n.title === "价值")).toBe(true);
    } finally {
      await db.delete(pages).where(eq(pages.id, perspectivePage.id));
    }
  });
});

describe("词条局部图谱（1~2 跳邻居网络）", () => {
  it("一跳 = 直连邻居；两跳严格更大且含一跳全部节点", async () => {
    const subjectivity = await termIdByTitle("主体性");
    const oneHop = (await getLocalGraph(subjectivity, 1))!;
    const twoHop = (await getLocalGraph(subjectivity, 2))!;

    expect(oneHop.rootId).toBe(subjectivity);
    expect(oneHop.hops).toBe(1);

    const oneIds = new Set(oneHop.nodes.map((n) => n.id));
    expect(oneIds.has(subjectivity)).toBe(true);
    // 主体性 的视角直连 意识形态 / 异化 / 剩余价值
    for (const title of ["意识形态", "异化", "剩余价值"]) {
      expect(oneIds.has(await termIdByTitle(title))).toBe(true);
    }
    // 价值 只被其他词条引用，不在一跳内
    expect(oneIds.has(await termIdByTitle("价值"))).toBe(false);

    const twoIds = new Set(twoHop.nodes.map((n) => n.id));
    for (const id of oneIds) expect(twoIds.has(id)).toBe(true);
    expect(twoIds.size).toBeGreaterThan(oneIds.size);
    expect(twoIds.has(await termIdByTitle("价值"))).toBe(true);

    // 边是节点集的诱导子图：两端都在返回的节点里
    for (const graph of [oneHop, twoHop]) {
      for (const edge of graph.edges) {
        expect(graph.nodes.some((n) => n.id === edge.source)).toBe(true);
        expect(graph.nodes.some((n) => n.id === edge.target)).toBe(true);
      }
    }
  });

  it("孤立词条的局部图 = 仅根节点；不存在或已删除的词条返回 null", async () => {
    const db = getDb();
    const [isolated] = await db
      .insert(pages)
      .values({ type: "term", title: "孤立词条（图谱夹具）", slug: "graph-fixture" })
      .returning({ id: pages.id });
    await db.insert(terms).values({ pageId: isolated.id, summary: "" });

    try {
      const local = (await getLocalGraph(isolated.id, 2))!;
      expect(local.nodes.map((n) => n.id)).toEqual([isolated.id]);
      expect(local.edges).toEqual([]);

      expect(await getLocalGraph(999_999, 1)).toBeNull();
    } finally {
      await db.delete(pages).where(eq(pages.id, isolated.id));
    }

    const [deleted] = await db
      .insert(pages)
      .values({ type: "term", title: "已删词条（图谱夹具）", slug: "graph-fixture", deletedAt: new Date() })
      .returning({ id: pages.id });
    await db.insert(terms).values({ pageId: deleted.id, summary: "" });
    try {
      expect(await getLocalGraph(deleted.id, 1)).toBeNull();
    } finally {
      await db.delete(pages).where(eq(pages.id, deleted.id));
    }
  });
});

// 只读端点（主缝 = route handler 直调，与 pin 路由同款测法）
describe("GET /api/graph/site 与 /api/graph/local", () => {
  it("全站端点返回完整载荷（节点/边/学派图例）", async () => {
    const res = await getSiteRoute();
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const data = await res.json();
    expect(data.nodes.length).toBeGreaterThanOrEqual(100);
    expect(data.edges.length).toBeGreaterThan(0);
    expect(data.schools.length).toBeGreaterThanOrEqual(2);
    expect(data.nodes[0]).toMatchObject({ id: expect.any(Number), url: expect.stringMatching(/^\/term\//) });
  });

  it("局部端点：termId/hops 校验与 404", async () => {
    const subjectivity = await termIdByTitle("主体性");

    const ok = await getLocalRoute(
      new Request(`http://localhost/api/graph/local?termId=${subjectivity}&hops=2`),
    );
    expect(ok.status).toBe(200);
    expect(ok.headers.get("cache-control")).toBe("no-store");
    const data = await ok.json();
    expect(data.rootId).toBe(subjectivity);
    expect(data.hops).toBe(2);

    expect(
      (await getLocalRoute(new Request("http://localhost/api/graph/local"))).status,
    ).toBe(400);
    expect(
      (await getLocalRoute(new Request("http://localhost/api/graph/local?termId=abc"))).status,
    ).toBe(400);
    expect(
      (await getLocalRoute(new Request("http://localhost/api/graph/local?termId=1&hops=3"))).status,
    ).toBe(400);
    expect(
      (await getLocalRoute(new Request("http://localhost/api/graph/local?termId=999999"))).status,
    ).toBe(404);
  });
});
