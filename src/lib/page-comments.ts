import "server-only";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { getDb, type Db } from "@/db";
import { agrees, pageComments, pages, user } from "@/db/schema";
import { isPageVisible } from "@/lib/page-visibility";
import { queueCommentSync, transactionWithSearchSync } from "@/lib/search/search-sync";

type Reader = Pick<Db, "select">;

export class PageCommentError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export function commentId(value: unknown): number {
  if ((typeof value !== "string" && typeof value !== "number") || !/^\d+$/.test(String(value))) {
    throw new PageCommentError(400, "页面或评论 id 必须是正整数");
  }
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id <= 0 || id > 2147483647) {
    throw new PageCommentError(400, "页面或评论 id 必须是正整数");
  }
  return id;
}

export async function requireCommentPage(db: Reader, pageId: number) {
  const [page] = await db.select({ id: pages.id }).from(pages).where(and(
    eq(pages.id, pageId), inArray(pages.type, ["term", "perspective"]), isPageVisible(pages.id),
  ));
  if (!page) throw new PageCommentError(404, "页面不存在或不可评论");
}

/** 赞同计数的关联子查询（列出与排序共用同一口径）。 */
function agreeCountSql(commentColumn: typeof pageComments.id) {
  return sql<number>`(select count(*)::int from ${agrees} where ${agrees.targetType} = 'page_comment' and ${agrees.targetId} = ${commentColumn})`;
}

export async function listPageComments(pageId: number, viewerId?: string) {
  const db = getDb();
  await requireCommentPage(db, pageId);
  const agreeCount = agreeCountSql(pageComments.id);
  const agreed = viewerId
    ? sql<boolean>`exists(select 1 from ${agrees} where ${agrees.userId} = ${viewerId} and ${agrees.targetType} = 'page_comment' and ${agrees.targetId} = ${pageComments.id})`
    : sql<boolean>`false`;
  // 排序升级（spec 0009）：赞同数降序，同票按发表时间新→旧；id 兜底保证稳定
  return db.select({
    id: pageComments.id, content: pageComments.content, createdAt: pageComments.createdAt,
    authorId: pageComments.authorId, authorName: user.name, agreeCount, agreed,
  }).from(pageComments).innerJoin(user, eq(user.id, pageComments.authorId))
    .where(and(eq(pageComments.pageId, pageId), isPageVisible(pageComments.pageId)))
    .orderBy(desc(agreeCount), desc(pageComments.createdAt), desc(pageComments.id));
}

export async function createPageComment(pageId: number, input: unknown, authorId: string) {
  if (typeof input !== "string" || !input.trim()) throw new PageCommentError(400, "评论内容不能为空");
  if (input.length > 2000) throw new PageCommentError(400, "评论内容不能超过 2000 字符");
  return transactionWithSearchSync(getDb(), async tx => {
    await requireCommentPage(tx, pageId);
    const [created] = await tx.insert(pageComments).values({ pageId, authorId, content: input.trim() })
      .returning({ id: pageComments.id });
    queueCommentSync(tx, created.id);
    return created;
  });
}

export async function deletePageComment(id: number, authorId: string) {
  return transactionWithSearchSync(getDb(), async tx => {
    const [comment] = await tx.select().from(pageComments).where(eq(pageComments.id, id));
    if (!comment) throw new PageCommentError(404, "评论不存在");
    if (comment.authorId !== authorId) throw new PageCommentError(403, "只能删除自己的评论");
    await tx.delete(pageComments).where(and(eq(pageComments.id, id), eq(pageComments.authorId, authorId)));
    // 赞同目标无外键（多态），随评论删除一并清理
    await tx.delete(agrees).where(and(eq(agrees.targetType, "page_comment"), eq(agrees.targetId, id)));
    queueCommentSync(tx, id);
  });
}

/**
 * 赞同与取消（spec 0009：不能赞同自己的内容，重复请求幂等）。
 * API 语义是设定而非翻转：POST 确保已赞同、DELETE 确保已取消，重试/重复请求不改变结果；
 * 数据层 (用户, 目标) 唯一，onConflictDoNothing / 按条件删除保证不重复计数。
 * UI 按钮按当前状态在两个意图之间切换（可反复切换）。
 */
export async function setCommentAgree(id: number, userId: string, agree: boolean): Promise<{ agreed: boolean; count: number }> {
  const db = getDb();
  return db.transaction(async tx => {
    const [comment] = await tx.select({ authorId: pageComments.authorId })
      .from(pageComments).innerJoin(pages, eq(pages.id, pageComments.pageId))
      .where(and(eq(pageComments.id, id), isPageVisible(pages.id)));
    if (!comment) throw new PageCommentError(404, "评论不存在或不可赞同");
    if (comment.authorId === userId) throw new PageCommentError(403, "不能赞同自己的评论");
    if (agree) {
      await tx.insert(agrees).values({ userId, targetType: "page_comment", targetId: id }).onConflictDoNothing();
    } else {
      await tx.delete(agrees).where(and(
        eq(agrees.userId, userId), eq(agrees.targetType, "page_comment"), eq(agrees.targetId, id),
      ));
    }
    const counted = await tx.select({ count: agreeCountSql(pageComments.id) })
      .from(pageComments).where(eq(pageComments.id, id));
    return { agreed: agree, count: counted[0]?.count ?? 0 };
  });
}

export async function commentResponse(action: () => Promise<Response>) {
  try { return await action(); }
  catch (error) {
    if (error instanceof PageCommentError) return Response.json({ error: error.message }, { status: error.status });
    throw error;
  }
}
