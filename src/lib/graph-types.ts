// 图谱数据的纯类型与配色（T11）：数据层（src/lib/graph.ts，server-only）与
// 客户端渲染组件共用，因此单独成文件、不 import "server-only"。
//
// 图谱是 links 表的派生视图（ADR-0003 #4：反链/图谱/热度排序共用 links 表）：
//   - 节点 = 在线词条；视角正文的双链把「词条 × 词条」连成边；
//   - 边为无向聚合（同一对词条的双链数合计为权重），节点热度 = 触边权重之和；
//   - 饼图由各学派成员视角计数派生；学派只组织诠释者，
//     不直接挂词条——强弱类型边界，见 schema.ts 注释。

/** 图谱节点：一个在线词条。 */
export interface GraphNode {
  /** 词条 page id */
  id: number;
  title: string;
  slug: string;
  /** 词条枢纽页路径（/term/<slug>-<id>） */
  url: string;
  /** 热度权重：触边权重合计（词条间双链总数） */
  heat: number;
  /** 在线视角数 */
  perspectiveCount: number;
  /** 主导学派 page id；无学派成员视角的词条为 null */
  schoolId: number | null;
  /** 各学派成员的在线视角计数，可交叉；不是概念归属比例。 */
  schoolAffinities: { schoolId: number; count: number }[];
}

/** 图谱边：两词条间的无向聚合连接（source < target）。 */
export interface GraphEdge {
  source: number;
  target: number;
  /** 两词条间的双链总数（双向合计） */
  weight: number;
}

/** 学派图例项：颜色由服务端按学派 id 顺序分配，保证两个视图一致。 */
export interface GraphSchool {
  id: number;
  title: string;
  slug: string;
  color: string;
}

/** 全站图谱数据（只读端点 /api/graph/site 的载荷）。 */
export interface SiteGraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
  schools: GraphSchool[];
}

/** 词条页局部图谱数据（只读端点 /api/graph/local 的载荷）。 */
export interface LocalGraphData extends SiteGraphData {
  rootId: number;
  /** 邻居跳数（1 或 2） */
  hops: number;
  /** root 到各节点的 BFS 跳数（root 自身不在内）；客户端分环/分组直接使用 */
  hopsById: Record<number, 1 | 2>;
}

/** 学派配色盘（顺序分配）；未归属学派的词条用灰。 */
export const SCHOOL_PALETTE = [
  "#e11d48", // rose
  "#2563eb", // blue
  "#16a34a", // green
  "#d97706", // amber
  "#7c3aed", // violet
  "#0d9488", // teal
  "#db2777", // pink
  "#ca8a04", // yellow
  "#4f46e5", // indigo
  "#dc2626", // red
] as const;

export const UNSCHOOLED_COLOR = "#94a3b8";

/** 缺少学派成员视角的词条图例名，词条页与全站页共用。 */
export const UNSCHOOLED_LABEL = "暂无学派成员视角";
