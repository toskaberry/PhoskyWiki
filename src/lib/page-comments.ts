import "server-only";
import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { getDb, type Db } from "@/db";
import { agrees, pageComments, pages, replies, user } from "@/db/schema";
import { hasAdminRole } from "@/lib/roles";
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

export interface PageCommentReplyView {
  id: number;
  content: string;
  createdAt: Date;
  authorId: string;
  authorName: string;
  deleted: boolean;
}

export interface PageCommentView {
  id: number;
  content: string;
  createdAt: Date;
  authorId: string;
  authorName: string;
  agreeCount: number;
  agreed: boolean;
  deleted: boolean;
  replies: PageCommentReplyView[];
}

/** 软删行不外发内容与作者信息（spec 0009「移除原内容与作者信息」），只留占位标记。 */
function deletedView(row: { content: string; authorId: string; authorName: string; deletedAt: Date | null }) {
  const deleted = row.deletedAt !== null;
  return {
    content: deleted ? "" : row.content,
    authorId: deleted ? "" : row.authorId,
    authorName: deleted ? "" : row.authorName,
    deleted,
  };
}

export async function listPageComments(pageId: number, viewerId?: string): Promise<PageCommentView[]> {
  const db = getDb();
  await requireCommentPage(db, pageId);
  const agreeCount = agreeCountSql(pageComments.id);
  const agreed = viewerId
    ? sql<boolean>`exists(select 1 from ${agrees} where ${agrees.userId} = ${viewerId} and ${agrees.targetType} = 'page_comment' and ${agrees.targetId} = ${pageComments.id})`
    : sql<boolean>`false`;
  // 排序升级（spec 0009）：赞同数降序，同票按发表时间新→旧；id 兜底保证稳定。
  // 软删评论保留占位：内容与作者不外发（spec 0009「移除原内容与作者信息」），回复继续随行返回。
  const comments = await db.select({
    id: pageComments.id, content: pageComments.content, deletedAt: pageComments.deletedAt,
    createdAt: pageComments.createdAt, authorId: pageComments.authorId, authorName: user.name,
    agreeCount, agreed,
  }).from(pageComments).innerJoin(user, eq(user.id, pageComments.authorId))
    .where(and(eq(pageComments.pageId, pageId), isPageVisible(pageComments.pageId)))
    .orderBy(desc(agreeCount), desc(pageComments.createdAt), desc(pageComments.id));
  const repliesByTarget = new Map<number, PageCommentReplyView[]>();
  if (comments.length) {
    const rows = await db.select({
      id: replies.id, targetId: replies.targetId, content: replies.content, deletedAt: replies.deletedAt,
      createdAt: replies.createdAt, authorId: replies.authorId, authorName: user.name,
    }).from(replies).innerJoin(user, eq(user.id, replies.authorId))
      .where(and(eq(replies.targetType, "page_comment"), inArray(replies.targetId, comments.map(comment => comment.id))))
      .orderBy(asc(replies.createdAt), asc(replies.id));
    for (const row of rows) {
      const bucket = repliesByTarget.get(row.targetId) ?? [];
      bucket.push({ id: row.id, createdAt: row.createdAt, ...deletedView(row) });
      repliesByTarget.set(row.targetId, bucket);
    }
  }
  return comments.map(comment => ({
    id: comment.id, createdAt: comment.createdAt, agreeCount: comment.agreeCount, agreed: comment.agreed,
    ...deletedView(comment),
    replies: repliesByTarget.get(comment.id) ?? [],
  }));
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

/**
 * 作者删除自己的评论（spec 0009 占位语义）：
 * 仍有回复 → 软删占位，原内容与作者信息不再外发，回复保留可读；
 * 无回复 → 物理移除（连同多态赞同行）。
 * 锁住评论行与回复写入互斥，避免「计数为零即硬删」与并发新回复交错。
 */
export async function deletePageComment(id: number, authorId: string) {
  return transactionWithSearchSync(getDb(), async tx => {
    const [comment] = await tx.select({ authorId: pageComments.authorId, deletedAt: pageComments.deletedAt })
      .from(pageComments).where(eq(pageComments.id, id)).for("update");
    if (!comment) throw new PageCommentError(404, "评论不存在");
    if (comment.authorId !== authorId) throw new PageCommentError(403, "只能删除自己的评论");
    const [counted] = await tx.select({ count: sql<number>`count(*)::int` }).from(replies)
      .where(and(eq(replies.targetType, "page_comment"), eq(replies.targetId, id)));
    if (counted.count > 0) {
      // 占位已立（重复删除）时幂等成功；软删评论退出搜索索引
      if (comment.deletedAt === null) {
        await tx.update(pageComments).set({ deletedAt: new Date(), deletedBy: authorId }).where(eq(pageComments.id, id));
      }
      queueCommentSync(tx, id);
      return;
    }
    await tx.delete(pageComments).where(and(eq(pageComments.id, id), eq(pageComments.authorId, authorId)));
    // 赞同目标无外键（多态），随评论删除一并清理
    await tx.delete(agrees).where(and(eq(agrees.targetType, "page_comment"), eq(agrees.targetId, id)));
    queueCommentSync(tx, id);
  });
}

/** 发表评论的扁平回复（spec 0009）：纯文本 ≤2000 字符；目标评论须在线且未删除。 */
export async function createPageCommentReply(commentId: number, input: unknown, authorId: string) {
  if (typeof input !== "string" || !input.trim()) throw new PageCommentError(400, "回复内容不能为空");
  if (input.length > 2000) throw new PageCommentError(400, "回复内容不能超过 2000 字符");
  return getDb().transaction(async tx => {
    const [comment] = await tx.select({ id: pageComments.id, pageId: pageComments.pageId, deletedAt: pageComments.deletedAt })
      .from(pageComments).where(eq(pageComments.id, commentId)).for("update");
    // 已删除/占位评论不可再回复
    if (!comment || comment.deletedAt !== null) throw new PageCommentError(404, "评论不存在或已删除，不能回复");
    await requireCommentPage(tx, comment.pageId);
    const [created] = await tx.insert(replies)
      .values({ targetType: "page_comment", targetId: commentId, authorId, content: input.trim() })
      .returning({ id: replies.id });
    return created;
  });
}

/**
 * 删除回复：作者删自己的发言即物理移除（任何角色对自己回复都是作者身份）；
 * 管理员处置他人回复为版务软删——内容与作者保留、渲染占位（与讨论区版务一致）。
 * 回复不进搜索索引，无需同步。
 */
export async function deletePageCommentReply(replyId: number, actorId: string) {
  return getDb().transaction(async tx => {
    const [reply] = await tx.select({ authorId: replies.authorId, deletedAt: replies.deletedAt })
      .from(replies).where(eq(replies.id, replyId)).for("update");
    if (!reply) throw new PageCommentError(404, "回复不存在");
    const [actor] = await tx.select({ role: user.role }).from(user).where(eq(user.id, actorId));
    if (!actor) throw new PageCommentError(401, "登录状态无效，请重新登录");
    if (reply.authorId !== actorId && !hasAdminRole(actor.role)) throw new PageCommentError(403, "只能删除自己的回复");
    if (reply.deletedAt !== null) return;
    // 版务处置他人回复留痕；作者（任何角色）删自己的发言即物理移除
    if (hasAdminRole(actor.role) && reply.authorId !== actorId) {
      await tx.update(replies).set({ deletedAt: new Date(), deletedBy: actorId }).where(eq(replies.id, replyId));
      return;
    }
    await tx.delete(replies).where(eq(replies.id, replyId));
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
    // 占位评论已退出公共讨论，不再可赞同
    const [comment] = await tx.select({ authorId: pageComments.authorId })
      .from(pageComments).innerJoin(pages, eq(pages.id, pageComments.pageId))
      .where(and(eq(pageComments.id, id), isNull(pageComments.deletedAt), isPageVisible(pages.id)));
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
