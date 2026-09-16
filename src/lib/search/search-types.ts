// SearchIndex 端口的类型与纯函数（ADR-0002：Meilisearch 是可丢的派生索引，藏在端口后）。
// 纯类型 + 标签表 + 参数解析，无服务端依赖，客户端组件可安全引用；
// 端口实现见 meili-index（真 Meili）、fake-index（主缝测试）、search-service（null 降级）。

import { pagePath } from "@/lib/slug";

/**
 * 可搜索的类型维度：词条、诠释者、视角与页面评论。
 */
export const SEARCH_TYPES = ["term", "interpreter", "perspective", "comment"] as const;

export type SearchableType = (typeof SEARCH_TYPES)[number];

export const SEARCH_TYPE_LABELS: Record<SearchableType, string> = {
  term: "词条",
  interpreter: "诠释者",
  perspective: "视角",
  comment: "页面评论",
};

/** 索引文档（PG → 索引的投影）：pageId 即 pages.id，作为索引主键（评论见 commentDocId）。 */
export interface SearchDocument {
  pageId: number;
  type: SearchableType;
  title: string;
  slug: string;
  /** 可检索正文：视角 = head 修订源文本；词条 = 简介 + 别名；诠释者 = 简介 */
  body: string;
}

export interface SearchHit {
  pageId: number;
  type: SearchableType;
  title: string;
  slug: string;
  /**
   * 命中片段；实现方给出的片段必须是 HTML 安全的（原文已转义、只含 mark 高亮
   * 标签，见 highlightHtml），可直接进 dangerouslySetInnerHTML。
   */
  snippet: string;
}

/**
 * 类型分面计数：当前查询按类型的命中数。
 * 契约：不受 options.type 过滤约束（选中某类型时其余类型的计数仍可见）。
 */
export type SearchFacets = Partial<Record<SearchableType, number>>;

export interface SearchQueryOptions {
  /** null = 不过滤类型 */
  type?: SearchableType | null;
  limit?: number;
  offset?: number;
}

export interface SearchResultPage {
  hits: SearchHit[];
  total: number;
  facets: SearchFacets;
}

/** 搜索索引端口：读路径（搜索/联想）与写路径（生效管线增量同步、全量校对）的唯一切缝。 */
export interface SearchIndex {
  /** 增量同步：按 pageId 主键 upsert（内容变更/恢复后重新可搜都走这里）。 */
  upsert(docs: SearchDocument[]): Promise<void>;
  /** 移出索引（软删除、页面类型不进索引）。 */
  remove(pageIds: number[]): Promise<void>;
  /** 空查询返回空结果（浏览全库不是搜索的职责）。 */
  search(query: string, options?: SearchQueryOptions): Promise<SearchResultPage>;
  /** 即打即搜联想：小结果集，输入前缀即可命中。 */
  suggest(query: string, limit: number): Promise<SearchHit[]>;
  /** 全量校对（定期兜底）：清空重灌，修复任何漂移。 */
  replaceAll(docs: SearchDocument[]): Promise<void>;
}

// 避开页面与旧讨论楼层的 int32 id 区间。
export const COMMENT_DOC_ID_OFFSET = 2 ** 32;
export function commentDocId(id: number): number { return COMMENT_DOC_ID_OFFSET + id; }
export function pageCommentId(docId: number): number { return docId - COMMENT_DOC_ID_OFFSET; }

/**
 * 命中页面的站内路径；页面评论定位到对应评论。
 */
export function searchHitHref(hit: { type: SearchableType; slug: string; pageId: number }): string {
  // 评论文档的 slug 存目标页面路径，由 PG 投影生成。
  if (hit.type === "comment") return `${hit.slug}#comment-${pageCommentId(hit.pageId)}`;
  return pagePath(hit.type, hit.slug, hit.pageId);
}

export interface ParsedSearchParams {
  /** 去首尾空白、限长后的查询词；空串 = 未搜索 */
  q: string;
  type: SearchableType | null;
  limit: number;
  offset: number;
}

const Q_MAX_LENGTH = 200;
/** 查询词上限（/search 页与 /api/search/suggest 共用，避免两处各写一个 200）。 */
export const SEARCH_QUERY_MAX_LENGTH = Q_MAX_LENGTH;
export const SEARCH_LIMIT_DEFAULT = 20;
export const SEARCH_LIMIT_MAX = 50;

/** 搜索参数解析（/search 页与 /api/search 共用）：白名单校验 + 夹取，非法值静默回退。 */
export function parseSearchParams(
  source: Record<string, string | string[] | undefined>,
): ParsedSearchParams {
  const first = (key: string): string | undefined => {
    const value = source[key];
    return Array.isArray(value) ? value[0] : value;
  };
  const q = (first("q") ?? "").trim().slice(0, Q_MAX_LENGTH);
  const rawType = first("type");
  const type = SEARCH_TYPES.find((candidate) => candidate === rawType) ?? null;
  const clampInt = (value: string | undefined, fallback: number, min: number, max: number) => {
    const n = Number(value);
    return Number.isSafeInteger(n) ? Math.min(max, Math.max(min, n)) : fallback;
  };
  return {
    q,
    type,
    limit: clampInt(first("limit"), SEARCH_LIMIT_DEFAULT, 1, SEARCH_LIMIT_MAX),
    offset: clampInt(first("offset"), 0, 0, 1_000_000),
  };
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * 高亮片段的安全管道：实现方给出的片段在原文上插了 <mark>，而原文（用户正文）
 * 可含任意字符——先整体转义，再只放行自家高亮标签，输出可安全进 dangerouslySetInnerHTML。
 * 注：原文里恰有字面 "&lt;mark&gt;" 会被还原成标签，但只可能是 mark、无属性可注入，接受。
 * 无高亮需求的实现（如 fake）也可用它做纯转义。
 */
export function highlightHtml(formatted: string): string {
  return escapeHtml(formatted)
    .replace(/&lt;mark&gt;/g, "<mark>")
    .replace(/&lt;\/mark&gt;/g, "</mark>");
}
