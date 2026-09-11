import { hasAdminRole } from "@/lib/roles";
import "server-only";

import { and, desc, eq, isNotNull, isNull } from "drizzle-orm";
import { getDb } from "@/db";
import { pages, revisions } from "@/db/schema";
import { applyContentChange, applyTermMetadataChange, applyInterpreterMetadataChange, isUniqueViolation, lockLivePage, ReviewError, type Actor } from "@/lib/review";
import { queueSearchSync, transactionWithSearchSync } from "@/lib/search/search-sync";
import { diffLines } from "@/lib/diff";
import { getLivePage } from "@/lib/content";
import { compareTermMetadata, legacyTermHistoryNote } from "@/lib/revision-snapshot";

export function historyId(value: unknown): number {
  if (typeof value !== "string" && typeof value !== "number") {
    throw new ReviewError(400, "页面和修订 id 必须为正整数");
  }
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id <= 0 || id > 2_147_483_647) {
    throw new ReviewError(400, "页面和修订 id 必须为正整数");
  }
  return id;
}

/** 删除页的历史只对管理员开放；在读取任何快照前校验页面可见性。 */
export async function getPageHistory(pageId: number, isAdmin = false) {
  const db = getDb();
  const [page] = await db.select({
    id: pages.id, type: pages.type, title: pages.title, slug: pages.slug, deletedAt: pages.deletedAt,
  }).from(pages).where(and(eq(pages.id, pageId), isAdmin ? undefined : isNull(pages.deletedAt)));
  if (!page) throw new ReviewError(404, "页面不存在");
  if (!isAdmin && !(await getLivePage(pageId))) throw new ReviewError(404, "页面不存在");
  const history = await db.select().from(revisions).where(eq(revisions.pageId, pageId))
    .orderBy(desc(revisions.createdAt), desc(revisions.id));
  return { page, revisions: history };
}

export function compareRevisions(history: Awaited<ReturnType<typeof getPageHistory>>, fromId: number, toId: number) {
  const from = history.revisions.find((revision) => revision.id === fromId);
  const to = history.revisions.find((revision) => revision.id === toId);
  if (!from || !to) throw new ReviewError(404, "修订不存在或不属于此页面");
  if (history.page.type === "term" || history.page.type === "interpreter") {
    return {
      kind: "term" as const, from, to,
      metadataRows: from.snapshot && to.snapshot ? compareTermMetadata(from.snapshot, to.snapshot) : null,
      limitation: from.snapshot && to.snapshot ? null : legacyTermHistoryNote,
    };
  }
  return { kind: "content" as const, from, to, rows: diffLines(from.content, to.content) };
}

export async function rollbackPage(pageId: number, revisionId: number, actor: Actor) {
  if (!hasAdminRole(actor.role)) throw new ReviewError(403, "需要管理员角色");
  return transactionWithSearchSync(getDb(), async (tx) => {
    const page = await lockLivePage(tx, pageId);
    const [target] = await tx.select().from(revisions)
      .where(and(eq(revisions.pageId, pageId), eq(revisions.id, revisionId)));
    if (!target) throw new ReviewError(404, "修订不存在或不属于此页面");
    if ((page.type === "term" || page.type === "interpreter") && !target.snapshot) {
      throw new ReviewError(409, legacyTermHistoryNote);
    }
    const id = page.type === "term" && target.snapshot?.type === "term"
      ? await applyTermMetadataChange(tx, pageId, target.snapshot, target.id, { createdBy: actor.id })
      : page.type === "interpreter" && target.snapshot?.type === "interpreter"
      ? await applyInterpreterMetadataChange(tx, pageId, target.snapshot, target.id, { createdBy: actor.id })
      : await applyContentChange(tx, pageId, target.content, target.id, { createdBy: actor.id });
    return { revisionId: id };
  }).catch((error: unknown) => {
    if (isUniqueViolation(error)) throw new ReviewError(409, "回滚失败：历史标题已存在于另一词条，当前词条信息保持不变。");
    throw error;
  });
}

/** 只改可见性，不改变 head 或任何既有修订；所有页面类型共用。 */
export async function setPageDeleted(pageId: number, deleted: boolean, actor: Actor) {
  if (!hasAdminRole(actor.role)) throw new ReviewError(403, "需要管理员角色");
  return transactionWithSearchSync(getDb(), async (tx) => {
    const [page] = await tx.select().from(pages).where(eq(pages.id, pageId)).for("update");
    if (!page) throw new ReviewError(404, "页面不存在");
    if (Boolean(page.deletedAt) === deleted) return { deleted };
    await tx.update(pages).set({ deletedAt: deleted ? new Date() : null, updatedAt: new Date() })
      .where(eq(pages.id, pageId));
    // 删除/恢复只改变可见性。出链与入链都保留保存时解析的 id，
    // 读路径过滤隐藏来源/目标；按名称重建会在目标改名后破坏关系身份。
    // 删除 → 索引移除；恢复 → 文档重建 upsert（同一同步入口，ADR-0004 #8）
    queueSearchSync(tx, pageId);
    return { deleted };
  });
}

export async function listDeletedPages(actor: Actor) {
  if (!hasAdminRole(actor.role)) throw new ReviewError(403, "需要管理员角色");
  return getDb().select({ id: pages.id, title: pages.title, type: pages.type, deletedAt: pages.deletedAt })
    .from(pages).where(isNotNull(pages.deletedAt)).orderBy(desc(pages.deletedAt), desc(pages.id));
}
