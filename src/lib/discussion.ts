// 词条版务锁定沿用旧表，覆盖该词条与各视角的页面评论。
import "server-only";
import { and, eq, isNull } from "drizzle-orm";
import { getDb, type Db } from "@/db";
import { pages, terms, termDiscussions, type UserRole } from "@/db/schema";
import { transactionWithSearchSync } from "@/lib/search/search-sync";

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
interface DiscussionActor { id: string; role: UserRole }

/** 词条版务锁定的行级判定（无 term_discussions 行或 lockedAt 为空 = 开放）。
 *  页面评论使用同一口径；事务内判定传事务句柄。 */
export async function termLockedAt(db: Pick<Db, "select">, termId: number): Promise<Date | null> {
  const [row] = await db
    .select({ lockedAt: termDiscussions.lockedAt })
    .from(termDiscussions)
    .where(eq(termDiscussions.termId, termId))
    .limit(1);
  return row?.lockedAt ?? null;
}

/** 词条是否被版务锁定。锁定按词条判定：覆盖页面评论（总评 + 各视角评论）。 */
export async function isDiscussionLocked(termId: number): Promise<boolean> {
  return (await termLockedAt(getDb(), termId)) !== null;
}

async function getLiveTermTx(
  tx: Tx,
  termId: number,
): Promise<{ id: number } | null> {
  const [term] = await tx
    .select({ id: terms.pageId })
    .from(terms)
    .innerJoin(pages, eq(pages.id, terms.pageId))
    .where(and(eq(terms.pageId, termId), isNull(pages.deletedAt)))
    .limit(1);
  return term ?? null;
}

/**
 * 版务锁定/解锁词条（#71 扩展语义）。锁定后该词条页面评论（总评 +
 * 各视角评论）对任何角色（含管理员）关闭新增，已有内容仍可读，解锁即恢复。
 * 返回 false = 词条不存在或已软删除。
 */
export async function setDiscussionLocked(
  termId: number,
  locked: boolean,
  admin: DiscussionActor,
): Promise<boolean> {
  return transactionWithSearchSync(getDb(), async (tx) => {
    const term = await getLiveTermTx(tx, termId);
    if (!term) return false;

    await tx
      .insert(termDiscussions)
      .values({
        termId,
        lockedAt: locked ? new Date() : null,
        lockedBy: locked ? admin.id : null,
      })
      .onConflictDoUpdate({
        target: termDiscussions.termId,
        set: { lockedAt: locked ? new Date() : null, lockedBy: locked ? admin.id : null },
      });
    return true;
  });
}
