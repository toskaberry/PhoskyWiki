// 图谱读路径数据层（T11）：links 表聚合出的词条级节点/边派生视图。
// 反链/热度排序/图谱共用 links 表（ADR-0003 #4）；本模块只做读取聚合：
//
//   - 边派生：视角正文的双链（source = 视角页）→「视角所属词条 × 目标词条」。
//     目标是词条页时直接取其 id；目标是显式视角语法落下的视角页时取其所属词条；
//     红链（target 为空）与消歧义页目标不是图谱节点，不进图。
//     同一对词条的双链合计为无向边权重（source < target 规范化）。
//   - 热度权重：节点触边权重合计。
//   - 学派着色：派生数据——词条的「主导学派」= 成员诠释者在该词条视角数最多的学派
//     （并列取学派 id 较小者，保证确定性；无学派成员视角的词条不着色）。
//
// 可见性口径不宽于反链面板（引用方/目标页、两侧词条任一软删除即不可见），
// 两侧视角及其词条、诠释者使用与正文和反链相同的可见性判定。
//
// 局部图谱复用全量聚合后在内存 BFS（词条量千级内单次聚合查询仅毫秒级，
// 换取两个视图严格同一份边集）；结果取 BFS 节点集的诱导子图。

import "server-only";

import { isPageVisible } from "@/lib/page-visibility";

import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

import { getDb } from "@/db";
import {
  interpreters,
  links,
  pages,
  perspectives,
  schoolMembers,
  schools,
  terms,
} from "@/db/schema";
import {
  SCHOOL_PALETTE,
  type GraphEdge,
  type GraphNode,
  type GraphSchool,
  type LocalGraphData,
  type SiteGraphData,
} from "@/lib/graph-types";
import { pagePath } from "@/lib/slug";

/** 局部图谱的节点上限（BFS 发现序截断，防御将来的超大规模邻居网络）。 */
const MAX_LOCAL_NODES = 400;

/** links → 有向词条对聚合（词条 A 的在线视角正文共链到 词条 B 多少次）。 */
async function aggregateTermPairs(): Promise<Map<number, Map<number, number>>> {
  const sourcePages = alias(pages, "graph_source_pages");
  const sourceInterpreters = alias(interpreters, "graph_source_interpreters");
  const sourceInterpreterPages = alias(pages, "graph_source_interpreter_pages");
  const sourceTermPages = alias(pages, "graph_source_term_pages");
  const targetPages = alias(pages, "graph_target_pages");
  const targetPerspectives = alias(perspectives, "graph_target_perspectives");
  const targetInterpreterPages = alias(pages, "graph_target_interpreter_pages");
  const targetTermPages = alias(pages, "graph_target_term_pages");
  const targetTermId = sql<number>`coalesce(${targetPerspectives.termId}, ${targetPages.id})`;

  const rows = await getDb()
    .select({
      sourceTermId: perspectives.termId,
      targetTermId: targetTermId.mapWith(Number),
      count: sql<number>`count(*)`.mapWith(Number),
    })
    .from(links)
    .innerJoin(sourcePages, eq(sourcePages.id, links.sourcePageId))
    .innerJoin(perspectives, eq(perspectives.pageId, links.sourcePageId))
    .innerJoin(sourceTermPages, eq(sourceTermPages.id, perspectives.termId))
    .innerJoin(
      sourceInterpreters,
      eq(sourceInterpreters.pageId, perspectives.interpreterId),
    )
    .innerJoin(
      sourceInterpreterPages,
      eq(sourceInterpreterPages.id, sourceInterpreters.pageId),
    )
    .innerJoin(targetPages, eq(targetPages.id, links.targetPageId))
    // 目标是视角页时沿负载表找到所属词条（FK 保证行存在，inner join 不丢行）
    .leftJoin(targetPerspectives, eq(targetPerspectives.pageId, links.targetPageId))
    .leftJoin(
      targetInterpreterPages,
      eq(targetInterpreterPages.id, targetPerspectives.interpreterId),
    )
    .innerJoin(targetTermPages, eq(targetTermPages.id, targetTermId))
    .where(
      and(
        inArray(targetPages.type, ["term", "perspective"]),
        isPageVisible(sourcePages.id),
        isNull(sourceTermPages.deletedAt),
        isNull(sourceInterpreterPages.deletedAt),
        isPageVisible(targetPages.id),
        isNull(targetTermPages.deletedAt),
        // 目标是视角页时，其诠释者须在线（term 目标不适用）
        sql`(${targetPerspectives.pageId} is null or ${targetInterpreterPages.id} is null or ${targetInterpreterPages.deletedAt} is null)`,
      ),
    )
    .groupBy(perspectives.termId, targetTermId)
    // 稳定输出顺序：邻接/边数组与 BFS 发现序（MAX_LOCAL_NODES 截断依据）逐次一致
    .orderBy(asc(perspectives.termId), targetTermId);

  const adjacency = new Map<number, Map<number, number>>();
  for (const row of rows) {
    if (row.sourceTermId === row.targetTermId) continue;
    let targets = adjacency.get(row.sourceTermId);
    if (!targets) {
      targets = new Map();
      adjacency.set(row.sourceTermId, targets);
    }
    targets.set(row.targetTermId, (targets.get(row.targetTermId) ?? 0) + row.count);
  }
  return adjacency;
}

/** Agent 沿入链和出链取一跳，精确视角链接归属到词条；不采用图谱展示截断。 */
export async function getOneHopTermIds(termId: number): Promise<number[]> {
  const pairs = await aggregateTermPairs();
  const neighbors = new Set(pairs.get(termId)?.keys());
  for (const [source, targets] of pairs) {
    if (targets.has(termId)) neighbors.add(source);
  }
  neighbors.delete(termId);
  return [termId, ...[...neighbors].sort((a, b) => a - b)];
}

/** 全部在线词条的基础信息（视角数为在线视角计数；诠释者页软删除的视角不计，比首页列表更严）。 */
async function listTermNodes(): Promise<
  { id: number; title: string; slug: string; perspectiveCount: number }[]
> {
  return getDb()
    .select({
      id: pages.id,
      title: pages.title,
      slug: pages.slug,
      perspectiveCount: sql<number>`(
        select count(*) from ${perspectives} pc
        join ${pages} pcPage on pcPage.id = pc.page_id
        join ${interpreters} pci on pci.page_id = pc.interpreter_id
        join ${pages} pciPage on pciPage.id = pci.page_id
        where pc.term_id = ${pages.id}
          and pcPage.deleted_at is null and pciPage.deleted_at is null
      )`.mapWith(Number),
    })
    .from(pages)
    .innerJoin(terms, eq(terms.pageId, pages.id))
    .where(and(eq(pages.type, "term"), isNull(pages.deletedAt)))
    .orderBy(asc(pages.id));
}

/** 词条 × 学派的视角计数（主导学派着色的派生源）。 */
async function countTermPerspectivesBySchool(): Promise<
  Map<number, { schoolId: number; count: number }[]>
> {
  const perspectivePages = alias(pages, "graph_perspective_pages");
  const termPages = alias(pages, "graph_term_pages");
  const interpreterPages = alias(pages, "graph_interpreter_pages");
  const schoolPages = alias(pages, "graph_school_pages");

  const rows = await getDb()
    .select({
      termId: perspectives.termId,
      schoolId: schools.pageId,
      count: sql<number>`count(*)`.mapWith(Number),
    })
    .from(perspectives)
    .innerJoin(perspectivePages, eq(perspectivePages.id, perspectives.pageId))
    .innerJoin(termPages, eq(termPages.id, perspectives.termId))
    .innerJoin(
      interpreterPages,
      eq(interpreterPages.id, perspectives.interpreterId),
    )
    .innerJoin(schoolMembers, eq(schoolMembers.interpreterId, perspectives.interpreterId))
    .innerJoin(schools, eq(schools.pageId, schoolMembers.schoolId))
    .innerJoin(schoolPages, eq(schoolPages.id, schools.pageId))
    .where(
      and(
        isNull(perspectivePages.deletedAt),
        isNull(termPages.deletedAt),
        isNull(interpreterPages.deletedAt),
        isNull(schoolPages.deletedAt),
      ),
    )
    .groupBy(perspectives.termId, schools.pageId);

  const byTerm = new Map<number, { schoolId: number; count: number }[]>();
  for (const row of rows) {
    let list = byTerm.get(row.termId);
    if (!list) {
      list = [];
      byTerm.set(row.termId, list);
    }
    list.push({ schoolId: row.schoolId, count: row.count });
  }
  return byTerm;
}

/** 全部在线学派图例（颜色按学派 id 顺序分配，两个视图共用一份）。 */
async function listGraphSchools(): Promise<GraphSchool[]> {
  const rows = await getDb()
    .select({ id: pages.id, title: pages.title, slug: pages.slug })
    .from(pages)
    .innerJoin(schools, eq(schools.pageId, pages.id))
    .where(and(eq(pages.type, "school"), isNull(pages.deletedAt)))
    .orderBy(asc(pages.id));
  return rows.map((row, index) => ({
    ...row,
    color: SCHOOL_PALETTE[index % SCHOOL_PALETTE.length]!,
  }));
}

/** links 聚合的核心：全站图谱数据（节点热度/边权重的唯一来源）。 */
async function buildSiteGraph(adjacency: Map<number, Map<number, number>>): Promise<SiteGraphData> {
  const [termNodes, schoolCounts, schoolList] = await Promise.all([
    listTermNodes(),
    countTermPerspectivesBySchool(),
    listGraphSchools(),
  ]);

  // 有向邻接 → 规范化无向边 + 节点触边热度
  const undirected = new Map<number, Map<number, number>>();
  const heat = new Map<number, number>();
  for (const [source, targets] of adjacency) {
    for (const [target, weight] of targets) {
      const [lo, hi] = source < target ? [source, target] : [target, source];
      let hiMap = undirected.get(lo);
      if (!hiMap) {
        hiMap = new Map();
        undirected.set(lo, hiMap);
      }
      hiMap.set(hi, (hiMap.get(hi) ?? 0) + weight);
      heat.set(lo, (heat.get(lo) ?? 0) + weight);
      heat.set(hi, (heat.get(hi) ?? 0) + weight);
    }
  }

  const nodes: GraphNode[] = termNodes.map((term) => {
    // 主导学派：视角数最多，并列取学派 id 较小者（确定性）
    const counts = schoolCounts.get(term.id);
    let schoolId: number | null = null;
    if (counts && counts.length > 0) {
      schoolId = counts.reduce((best, cur) =>
        cur.count > best.count || (cur.count === best.count && cur.schoolId < best.schoolId)
          ? cur
          : best,
      ).schoolId;
    }
    return {
      id: term.id,
      title: term.title,
      slug: term.slug,
      url: pagePath("term", term.slug, term.id),
      heat: heat.get(term.id) ?? 0,
      perspectiveCount: term.perspectiveCount,
      schoolId,
      schoolAffinities: [...(counts ?? [])].sort((a, b) => a.schoolId - b.schoolId),
    };
  });

  const edges: GraphEdge[] = [];
  for (const [lo, hiMap] of undirected) {
    for (const [hi, weight] of hiMap) {
      edges.push({ source: lo, target: hi, weight });
    }
  }

  return { nodes, edges, schools: schoolList };
}

/** 全站图谱：全部在线词条为节点（含孤立词条），词条间双链为无向边。 */
export async function getSiteGraph(): Promise<SiteGraphData> {
  return buildSiteGraph(await aggregateTermPairs());
}

/**
 * 词条页局部图谱：以 root 为中心的 1~2 跳邻居网络。
 * 词条不存在或已软删除返回 null；结果 = BFS 节点集的诱导子图。
 */
export async function getLocalGraph(
  termId: number,
  hops: 1 | 2,
): Promise<LocalGraphData | null> {
  return readLocalGraph(termId, hops, MAX_LOCAL_NODES);
}

/** 推荐在完整一跳候选集上计分，不能使用图谱的显示上限。 */
export async function getDiscoveryGraph(termId: number): Promise<LocalGraphData | null> {
  return readLocalGraph(termId, 1, Infinity);
}

async function readLocalGraph(
  termId: number,
  hops: 1 | 2,
  maxNodes: number,
): Promise<LocalGraphData | null> {
  const [term] = await getDb()
    .select({ id: pages.id })
    .from(pages)
    .innerJoin(terms, eq(terms.pageId, pages.id))
    .where(and(eq(pages.id, termId), eq(pages.type, "term"), isNull(pages.deletedAt)))
    .limit(1);
  if (!term) return null;

  const site = await getSiteGraph();
  const adjacency = new Map<number, Set<number>>();
  for (const edge of site.edges) {
    addAdjacent(adjacency, edge.source, edge.target);
    addAdjacent(adjacency, edge.target, edge.source);
  }

  // BFS 收集 ≤hops 的节点（发现序截断到上限，root 永远保留）
  const depth = new Map<number, number>([[termId, 0]]);
  let frontier = [termId];
  for (let hop = 1; hop <= hops; hop++) {
    const next: number[] = [];
    for (const current of frontier) {
      for (const neighbor of adjacency.get(current) ?? []) {
        if (depth.has(neighbor)) continue;
        depth.set(neighbor, hop);
        next.push(neighbor);
      }
    }
    frontier = next;
  }

  const kept =
    depth.size <= maxNodes
      ? [...depth.keys()]
      : [termId, ...[...depth.entries()].filter(([id]) => id !== termId)
          .sort((a, b) => a[1] - b[1])
          .slice(0, maxNodes - 1)
          .map(([id]) => id)];
  const keptSet = new Set(kept);

  const nodesById = new Map(site.nodes.map((node) => [node.id, node]));
  const schoolIdsWithTerms = new Set(
    site.nodes.filter(n => keptSet.has(n.id)).flatMap(n => n.schoolAffinities.map(a => a.schoolId)),
  );

  return {
    rootId: termId,
    hops,
    nodes: kept.flatMap((id) => {
      const node = nodesById.get(id);
      return node ? [node] : [];
    }),
    // 诱导子图：两端都在节点集内的边；图例收窄到实际出现的学派
    edges: site.edges.filter((e) => keptSet.has(e.source) && keptSet.has(e.target)),
    schools: site.schools.filter((school) => schoolIdsWithTerms.has(school.id)),
    hopsById: Object.fromEntries(
      kept.flatMap((id): [number, 1 | 2][] => {
        const hop = depth.get(id);
        return hop === 1 || hop === 2 ? [[id, hop]] : [];
      }),
    ),
  };
}

function addAdjacent(adjacency: Map<number, Set<number>>, a: number, b: number): void {
  let set = adjacency.get(a);
  if (!set) {
    set = new Set();
    adjacency.set(a, set);
  }
  set.add(b);
}
