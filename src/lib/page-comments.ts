import "server-only";
import { and, desc, eq, inArray } from "drizzle-orm";
import { getDb, type Db } from "@/db";
import { pageComments, pages, user } from "@/db/schema";
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

export async function listPageComments(pageId: number) {
  const db = getDb();
  await requireCommentPage(db, pageId);
  return db.select({
    id: pageComments.id, content: pageComments.content, createdAt: pageComments.createdAt,
    authorId: pageComments.authorId, authorName: user.name,
  }).from(pageComments).innerJoin(user, eq(user.id, pageComments.authorId))
    .where(and(eq(pageComments.pageId, pageId), isPageVisible(pageComments.pageId)))
    .orderBy(desc(pageComments.createdAt), desc(pageComments.id));
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
    queueCommentSync(tx, id);
  });
}

export async function commentResponse(action: () => Promise<Response>) {
  try { return await action(); }
  catch (error) {
    if (error instanceof PageCommentError) return Response.json({ error: error.message }, { status: error.status });
    throw error;
  }
}
