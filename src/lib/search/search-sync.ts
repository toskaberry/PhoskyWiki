// 派生索引同步（ADR-0002 + ADR-0004 #8/#9）：生效管线「产生修订 → 重建 links → 同步索引」
// 的最后一步。事务内只 queueSearchSync 记页面 id；transactionWithSearchSync 在事务提交后
// 从 PG（只读、已提交状态）重建文档再写索引。索引写失败只记日志不回滚写路径——
// PG 是唯一内容存储，索引可随时由 reindexAll 重建。
// 改名（换 slug）尚未落地；接入时走同一管线即可获得索引同步。

import "server-only";

import { and, eq, inArray, isNull, sql, type SQLWrapper } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

import { getDb, type Db } from "@/db";
import {
  pageComments,
  interpreters,
  pages,
  perspectives,
  revisions,
  terms,
  type PageType,
} from "@/db/schema";
import { getSearchIndex, searchIsConfigured } from "@/lib/search/search-service";
import { withSearchLock, recordSearchFailure, recordSearchReindex, beginSearchReindex } from "@/lib/search/search-maintenance";
import { commentDocId, type SearchDocument } from "@/lib/search/search-types";
import { pagePath } from "@/lib/slug";
import { isPageVisible } from "@/lib/page-visibility";

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

/** 一期进索引的页面类型；页面评论经独立管线进索引；消歧义/学派页不进索引。 */
const INDEXED_TYPES: ReadonlySet<PageType> = new Set(["term", "interpreter", "perspective"]);

const pendingPageIds = new WeakMap<object, Set<number>>();
const pendingCommentIds = new WeakMap<object, Set<number>>();

export function queueCommentSync(tx: Tx, id: number): void {
  const ids = pendingCommentIds.get(tx) ?? new Set<number>();
  ids.add(id);
  pendingCommentIds.set(tx, ids);
}

/** 生效管线内调用（事务中）：记录事务提交后待同步的页面。 */
export function queueSearchSync(tx: Tx, ...pageIds: number[]): void {
  let set = pendingPageIds.get(tx);
  if (!set) {
    set = new Set();
    pendingPageIds.set(tx, set);
  }
  for (const id of pageIds) set.add(id);
}

/**
 * 受理/直编/回滚/软删除/恢复共用的写路径事务：fn 内 queueSearchSync / queueCommentSync
 * 记下的页面与评论，在事务提交后统一同步索引；事务回滚则什么都不同步。
 */
export async function transactionWithSearchSync<T>(
  db: Db,
  fn: (tx: Tx) => Promise<T>,
): Promise<T> {
  let pending: Set<number> | undefined;
  let pendingComments: Set<number> | undefined;
  const result = await db.transaction(async (tx) => {
    pending = new Set();
    pendingPageIds.set(tx, pending);
    pendingComments = new Set();
    pendingCommentIds.set(tx, pendingComments);
    return fn(tx);
  });
  if (pending && pending.size > 0) {
    await syncPages([...pending]);
  }
  if (pendingComments?.size) await syncPageComments([...pendingComments]);
  return result;
}

/** 提交后同步：可索引页面重建文档 upsert，其余（软删除/不进索引/已消失）remove。 */
export async function syncPages(pageIds: number[]): Promise<void> {
  if (pageIds.length === 0) return;
  try {
    await withSearchLock(false, async () => {
    // 词条/诠释者的可见性翻转连带其视角与页面评论（读路径同口径），同步集合按依赖扩展
    const { pageIds: allIds } = await expandWithDependencies(pageIds);
    const { docs, removeIds } = await buildSearchDocuments(allIds);
    const index = getSearchIndex();
    if (removeIds.length > 0) await index.remove(removeIds);
    if (docs.length > 0) await index.upsert(docs);
    const commentIds = (await getDb().select({ id: pageComments.id }).from(pageComments)
      .where(inArray(pageComments.pageId, allIds))).map(row => row.id);
    await syncPageCommentsUnlocked(commentIds);
    });
  } catch {
    await recordSearchFailure();
    console.error("SEARCH_INCREMENT_FAILED");
  }
}

/** 父页面的可见性变更同时扩展到子视角及各自的评论。 */
async function expandWithDependencies(pageIds: number[]): Promise<{
  pageIds: number[];
  termIds: number[];
}> {
  const db = getDb();
  const parents = await db
    .select({ id: pages.id, type: pages.type })
    .from(pages)
    .where(inArray(pages.id, pageIds));
  const termIds = parents.filter((row) => row.type === "term").map((row) => row.id);
  const interpreterIds = parents
    .filter((row) => row.type === "interpreter")
    .map((row) => row.id);
  if (termIds.length === 0 && interpreterIds.length === 0) return { pageIds, termIds };

  const dependents = new Set(pageIds);
  if (termIds.length > 0) {
    for (const row of await db
      .select({ pageId: perspectives.pageId })
      .from(perspectives)
      .where(inArray(perspectives.termId, termIds))) {
      dependents.add(row.pageId);
    }
  }
  if (interpreterIds.length > 0) {
    for (const row of await db
      .select({ pageId: perspectives.pageId })
      .from(perspectives)
      .where(inArray(perspectives.interpreterId, interpreterIds))) {
      dependents.add(row.pageId);
    }
  }
  return { pageIds: [...dependents], termIds };
}

/** 全量校对（手动 / 定时兜底）：从 PG 重灌全部文档、清空索引，修复任何漂移。 */
export async function reindexAll(): Promise<{ indexed: number }> {
  return withSearchLock(true, async () => {
    try {
      if (!searchIsConfigured()) throw new Error("SEARCH_NOT_CONFIGURED");
      const startedAt = await beginSearchReindex();
      const docs = [...(await buildAllSearchDocuments()), ...(await buildCommentDocuments())];
      await getSearchIndex().replaceAll(docs);
      await recordSearchReindex(startedAt);
      return { indexed: docs.length };
    } catch (error) {
      await recordSearchFailure(true);
      throw error;
    }
  });
}

// ---------------------------------------------------------------------------
// PG → 索引文档
// ---------------------------------------------------------------------------

interface PageRow {
  id: number;
  type: PageType;
  title: string;
  slug: string;
  deletedAt: Date | null;
}

/** 词根文档体：一句话简介 + 别名（别名是检索的常规入口，ADR-0003 #5）。 */
function termBody(summary: string, aliases: string[]): string {
  return [summary, ...aliases].filter(Boolean).join("\n");
}

/** 视角文档体的来源：head 修订内容的相关子查询（增量与全量构建共用）。 */
function headContentSql(pageIdExpr: SQLWrapper) {
  return sql<string>`(
    select content from ${revisions}
    where ${revisions.pageId} = ${pageIdExpr}
    order by ${revisions.id} desc limit 1
  )`;
}

/**
 * 增量同步的文档构建：返回可索引文档与应移除的 pageId。
 * 视角与其词条/诠释者任一软删除即不可见（与读路径同口径）→ remove。
 */
export async function buildSearchDocuments(pageIds: number[]): Promise<{
  docs: SearchDocument[];
  removeIds: number[];
}> {
  const db = getDb();
  const pageRows = await db
    .select({
      id: pages.id,
      type: pages.type,
      title: pages.title,
      slug: pages.slug,
      deletedAt: pages.deletedAt,
      visible: isPageVisible(pages.id),
    })
    .from(pages)
    .where(inArray(pages.id, pageIds));
  const rowById = new Map(pageRows.map((row) => [row.id, row]));

  const docs: SearchDocument[] = [];
  const removeIds: number[] = [];
  const liveByType = new Map<PageType, PageRow[]>();
  for (const id of pageIds) {
    const row = rowById.get(id);
    if (!row || !row.visible || !INDEXED_TYPES.has(row.type)) {
      removeIds.push(id);
      continue;
    }
    const bucket = liveByType.get(row.type) ?? [];
    bucket.push(row);
    liveByType.set(row.type, bucket);
  }

  const termIds = (liveByType.get("term") ?? []).map((row) => row.id);
  const interpreterIds = (liveByType.get("interpreter") ?? []).map((row) => row.id);
  const perspectiveIds = (liveByType.get("perspective") ?? []).map((row) => row.id);

  if (termIds.length > 0) {
    const payload = await db
      .select({ pageId: terms.pageId, summary: terms.summary, aliases: terms.aliases })
      .from(terms)
      .where(inArray(terms.pageId, termIds));
    const byPage = new Map(payload.map((row) => [row.pageId, row]));
    for (const row of liveByType.get("term") ?? []) {
      const detail = byPage.get(row.id);
      docs.push({
        pageId: row.id,
        type: "term",
        title: row.title,
        slug: row.slug,
        body: detail ? termBody(detail.summary, detail.aliases) : "",
      });
    }
  }

  if (interpreterIds.length > 0) {
    const payload = await db
      .select({ pageId: interpreters.pageId, summary: interpreters.summary })
      .from(interpreters)
      .where(inArray(interpreters.pageId, interpreterIds));
    const byPage = new Map(payload.map((row) => [row.pageId, row]));
    for (const row of liveByType.get("interpreter") ?? []) {
      docs.push({
        pageId: row.id,
        type: "interpreter",
        title: row.title,
        slug: row.slug,
        body: byPage.get(row.id)?.summary ?? "",
      });
    }
  }

  if (perspectiveIds.length > 0) {
    // 视角文档体 = head 修订源文本（搜索正文，spec「搜索：覆盖正文」）；
    // 词条/诠释者任一软删除则视角不可见，落 remove。
    const termPages = alias(pages, "search_term_pages");
    const interpreterPages = alias(pages, "search_interpreter_pages");
    const payload = await db
      .select({
        pageId: perspectives.pageId,
        headContent: headContentSql(perspectives.pageId),
        termDeletedAt: termPages.deletedAt,
        interpreterDeletedAt: interpreterPages.deletedAt,
      })
      .from(perspectives)
      .innerJoin(termPages, eq(termPages.id, perspectives.termId))
      .innerJoin(interpreterPages, eq(interpreterPages.id, perspectives.interpreterId))
      .where(inArray(perspectives.pageId, perspectiveIds));
    const byPage = new Map(payload.map((row) => [row.pageId, row]));
    for (const row of liveByType.get("perspective") ?? []) {
      const detail = byPage.get(row.id);
      if (!detail || detail.termDeletedAt !== null || detail.interpreterDeletedAt !== null) {
        removeIds.push(row.id);
        continue;
      }
      docs.push({
        pageId: row.id,
        type: "perspective",
        title: row.title,
        slug: row.slug,
        body: detail.headContent ?? "",
      });
    }
  }

  return { docs, removeIds };
}

/** 全量校对的文档构建：一期进索引的三类在线页面一次取全。 */
async function buildAllSearchDocuments(): Promise<SearchDocument[]> {
  const db = getDb();
  const termPages = alias(pages, "search_all_term_pages");
  const interpreterPages = alias(pages, "search_all_interpreter_pages");

  const [termDocs, interpreterDocs, perspectiveDocs] = await Promise.all([
    db
      .select({
        pageId: pages.id,
        title: pages.title,
        slug: pages.slug,
        summary: terms.summary,
        aliases: terms.aliases,
      })
      .from(pages)
      .innerJoin(terms, eq(terms.pageId, pages.id))
      .where(and(eq(pages.type, "term"), isNull(pages.deletedAt))),
    db
      .select({
        pageId: pages.id,
        title: pages.title,
        slug: pages.slug,
        summary: interpreters.summary,
      })
      .from(pages)
      .innerJoin(interpreters, eq(interpreters.pageId, pages.id))
      .where(and(eq(pages.type, "interpreter"), isNull(pages.deletedAt))),
    db
      .select({
        pageId: pages.id,
        title: pages.title,
        slug: pages.slug,
        headContent: headContentSql(pages.id),
      })
      .from(perspectives)
      .innerJoin(pages, eq(pages.id, perspectives.pageId))
      .innerJoin(termPages, eq(termPages.id, perspectives.termId))
      .innerJoin(interpreterPages, eq(interpreterPages.id, perspectives.interpreterId))
      .where(
        and(
          isNull(pages.deletedAt),
          isNull(termPages.deletedAt),
          isNull(interpreterPages.deletedAt),
        ),
      ),
  ]);

  return [
    ...termDocs.map((row): SearchDocument => ({
      pageId: row.pageId,
      type: "term",
      title: row.title,
      slug: row.slug,
      body: termBody(row.summary, row.aliases),
    })),
    ...interpreterDocs.map((row): SearchDocument => ({
      pageId: row.pageId,
      type: "interpreter",
      title: row.title,
      slug: row.slug,
      body: row.summary,
    })),
    ...perspectiveDocs.map((row): SearchDocument => ({
      pageId: row.pageId,
      type: "perspective",
      title: row.title,
      slug: row.slug,
      body: row.headContent ?? "",
    })),
  ];
}

/** 评论索引始终从当前在线页面投影；全量与增量采用同一可见性条件。软删占位评论退出索引。 */
async function buildCommentDocuments(ids?: number[]): Promise<SearchDocument[]> {
  const rows = await getDb().select({
    id: pageComments.id, pageId: pages.id, type: pages.type,
    title: pages.title, slug: pages.slug, content: pageComments.content,
  }).from(pageComments).innerJoin(pages, eq(pages.id, pageComments.pageId))
    .where(and(isPageVisible(pages.id), isNull(pageComments.deletedAt), ids ? inArray(pageComments.id, ids) : undefined));
  return rows.map(row => ({
    pageId: commentDocId(row.id), type: "comment", title: `「${row.title}」的评论`,
    slug: pagePath(row.type, row.slug, row.pageId), body: row.content,
  }));
}

async function syncPageCommentsUnlocked(ids: number[]) {
  if (!ids.length) return;
  const docs = await buildCommentDocuments(ids);
  const liveIds = new Set(docs.map(doc => doc.pageId));
  const index = getSearchIndex();
  const removed = ids.map(commentDocId).filter(id => !liveIds.has(id));
  if (removed.length) await index.remove(removed);
  if (docs.length) await index.upsert(docs);
}

async function syncPageComments(ids: number[]) {
  try { await withSearchLock(false, () => syncPageCommentsUnlocked(ids)); }
  catch {
    await recordSearchFailure();
    console.error("SEARCH_COMMENT_INCREMENT_FAILED");
  }
}
