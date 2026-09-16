import "server-only";

import { and, inArray, isNull } from "drizzle-orm";
import { getDb } from "@/db";
import { pageComments, pages } from "@/db/schema";
import { isPageVisible } from "@/lib/page-visibility";
import { getSearchIndex } from "@/lib/search/search-service";
import { commentDocId, pageCommentId, SEARCH_TYPES, type SearchHit, type SearchQueryOptions } from "@/lib/search/search-types";

/** 索引同步可失败或延迟；公开内容始终由 PG 的当前可见性兜底。 */
async function visibleHits(hits: SearchHit[]): Promise<SearchHit[]> {
  if (!hits.length) return [];
  hits = hits.filter(hit => SEARCH_TYPES.includes(hit.type));
  const pageIds = hits.filter((hit) => hit.type !== "comment").map((hit) => hit.pageId);
  const commentIds = hits.filter(hit => hit.type === "comment").map(hit => pageCommentId(hit.pageId));
  const [livePages, liveComments] = await Promise.all([
    pageIds.length ? getDb().select({ id: pages.id }).from(pages)
      .where(and(inArray(pages.id, pageIds), isPageVisible(pages.id))) : [],
    commentIds.length ? getDb().select({ id: pageComments.id }).from(pageComments)
      .where(and(inArray(pageComments.id, commentIds), isPageVisible(pageComments.pageId), isNull(pageComments.deletedAt))) : [],
  ]);
  const ids = new Set([...livePages.map((row) => row.id), ...liveComments.map(row => commentDocId(row.id))]);
  return hits.filter((hit) => ids.has(hit.pageId));
}

export async function searchPublicPages(query: string, options?: SearchQueryOptions) {
  const result = await getSearchIndex().search(query, options);
  // 分面/分页仍为派生索引的计数；隐藏命中不输出标题、摘要或地址。
  return { ...result, hits: await visibleHits(result.hits) };
}

export async function suggestPublicPages(query: string, limit: number) {
  return visibleHits(await getSearchIndex().suggest(query, limit));
}
