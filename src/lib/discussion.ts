// 讨论区（T13）：词条级楼层 + 一层嵌套回复 + 视角锚点 + 版务。
// 语义见 schema 的讨论区注释与 spec 用户故事 43–45：
//   - 楼层即时可见（不经两票审核），内容保持纯文本——富格式（Markdown/双链）
//     只留给受审的页面内容；
//   - 游客只读：发言入口在路由层以会话挡下（401），读路径无需登录；
//   - 一层嵌套：parentId 只能指向同词条的顶层楼层，「回复的回复」在此拒绝；
//   - 版务（管理员）：软删楼层（内容保留、渲染占位）、锁定/解锁讨论区；
//   - 讨论楼层接入派生搜索索引（ADR-0002）：写路径经 queueDiscussionSync，
//     与页面索引同一套「事务提交后同步、失败只记日志」纪律。
// 回复通知是明确的二期项（spec Out of Scope），不在此实现。

import "server-only";

import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";

import { getDb, type Db } from "@/db";
import { isPageVisible } from "@/lib/page-visibility";
import {
  discussionPosts,
  pages,
  perspectives,
  termDiscussions,
  terms,
  user,
  type UserRole,
} from "@/db/schema";
import { queueDiscussionSync, transactionWithSearchSync } from "@/lib/search/search-sync";

/** 单楼层正文上限（字符）：论坛发言的常规量级，防超长灌水。 */
export const DISCUSSION_CONTENT_MAX_LENGTH = 2000;

/** 操作者（来自会话）：足够驱动讨论域的最小字段。 */
export interface DiscussionActor {
  id: string;
  role: UserRole;
}

/** 讨论域的业务错误：status 直接作为 HTTP 状态码。 */
export class DiscussionError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

/** 讨论路由共用的错误映射。返回 null = 不是讨论域的已知错误（向上抛）。 */
export function discussionErrorResponse(err: unknown): Response | null {
  if (err instanceof DiscussionError) {
    return Response.json({ error: err.message }, { status: err.status });
  }
  return null;
}

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

// ---------------------------------------------------------------------------
// 读路径
// ---------------------------------------------------------------------------

/** 视角锚点的渲染信息；live = 锚点视角页当前在线（软删除后只展示纯文本标题）。 */
export interface PerspectiveAnchor {
  pageId: number;
  title: string;
  slug: string;
  live: boolean;
}

export interface FloorView {
  id: number;
  content: string;
  createdAt: Date;
  deleted: boolean;
  authorId: string;
  authorName: string;
  perspective: PerspectiveAnchor | null;
  replies: ReplyView[];
}

export interface ReplyView {
  id: number;
  content: string;
  createdAt: Date;
  deleted: boolean;
  authorId: string;
  authorName: string;
}

/** 词条版务锁定的行级判定（无 term_discussions 行或 lockedAt 为空 = 开放）。
 *  讨论区与页面评论共用同一口径；事务内判定传事务句柄。 */
export async function termLockedAt(db: Pick<Db, "select">, termId: number): Promise<Date | null> {
  const [row] = await db
    .select({ lockedAt: termDiscussions.lockedAt })
    .from(termDiscussions)
    .where(eq(termDiscussions.termId, termId))
    .limit(1);
  return row?.lockedAt ?? null;
}

/** 词条是否被版务锁定。锁定按词条判定：同时覆盖讨论区楼层与页面评论（总评 + 各视角评论）。 */
export async function isDiscussionLocked(termId: number): Promise<boolean> {
  return (await termLockedAt(getDb(), termId)) !== null;
}

/**
 * 词条讨论区的未删除楼层数（词条页入口「讨论区（N 楼）」用）。
 * 只数顶层楼层：回复不计入——与讨论区页内「N 楼」编号同口径。
 */
export async function countDiscussionPosts(termId: number): Promise<number> {
  const [row] = await getDb()
    .select({ count: sql<number>`count(*)::int` })
    .from(discussionPosts)
    .where(
      and(
        eq(discussionPosts.termId, termId),
        isNull(discussionPosts.parentId),
        isNull(discussionPosts.deletedAt),
      ),
    );
  return row?.count ?? 0;
}

/**
 * 词条讨论区的全部楼层（顶层楼层 + 各自的一层嵌套回复），按发言序排列。
 * 软删楼层保留占位（作者可见、正文不外发）；视角锚点附带在线状态。
 */
export async function listDiscussionFloors(termId: number): Promise<FloorView[]> {
  const db = getDb();
  const rows = await db
    .select({
      id: discussionPosts.id,
      parentId: discussionPosts.parentId,
      content: discussionPosts.content,
      deletedAt: discussionPosts.deletedAt,
      createdAt: discussionPosts.createdAt,
      authorId: discussionPosts.authorId,
      authorName: user.name,
      perspectivePageId: discussionPosts.perspectiveId,
    })
    .from(discussionPosts)
    .innerJoin(user, eq(user.id, discussionPosts.authorId))
    .where(eq(discussionPosts.termId, termId))
    .orderBy(asc(discussionPosts.id));

  // 视角锚点：一次性取全部涉及的视角页（外键保证 perspectiveId 是有效视角）
  const anchorIds = [
    ...new Set(rows.map((row) => row.perspectivePageId).filter((id): id is number => id !== null)),
  ];
  const anchors = new Map<number, PerspectiveAnchor>();
  if (anchorIds.length > 0) {
    for (const row of await db
      .select({
        pageId: pages.id,
        title: pages.title,
        slug: pages.slug,
        live: isPageVisible(pages.id),
      })
      .from(pages)
      .where(inArray(pages.id, anchorIds))) {
      anchors.set(row.pageId, {
        pageId: row.pageId,
        title: row.title,
        slug: row.slug,
        live: row.live,
      });
    }
  }

  const toView = (row: (typeof rows)[number]) => ({
    id: row.id,
    content: row.deletedAt !== null ? "" : row.content,
    createdAt: row.createdAt,
    deleted: row.deletedAt !== null,
    authorId: row.authorId,
    authorName: row.authorName,
  });
  const floors: FloorView[] = [];
  const repliesByParent = new Map<number, ReplyView[]>();
  for (const row of rows) {
    if (row.parentId === null) {
      floors.push({
        ...toView(row),
        perspective: row.perspectivePageId !== null ? (anchors.get(row.perspectivePageId) ?? null) : null,
        replies: [],
      });
    } else {
      const bucket = repliesByParent.get(row.parentId) ?? [];
      bucket.push(toView(row));
      repliesByParent.set(row.parentId, bucket);
    }
  }
  for (const floor of floors) {
    floor.replies = repliesByParent.get(floor.id) ?? [];
  }
  return floors;
}

// ---------------------------------------------------------------------------
// 写路径
// ---------------------------------------------------------------------------

export interface CreateDiscussionPostInput {
  termId: number;
  /** 视角锚点：只能随顶层楼层（开楼）携带 */
  perspectiveId?: number;
  /** 父楼层：给出即为一层嵌套回复 */
  parentId?: number;
  content: string;
}

export interface CreateDiscussionPostResult {
  id: number;
  parentId: number | null;
  perspectiveId: number | null;
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
 * 发表楼层（parentId 为空）或对楼层的一层嵌套回复（parentId 给出）。
 * 登录校验在路由层（游客 401）；锁定讨论区对任何角色（含管理员）关闭发言。
 */
export async function createDiscussionPost(
  input: CreateDiscussionPostInput,
  actor: DiscussionActor,
): Promise<CreateDiscussionPostResult> {
  const content = input.content.trim();
  if (!content) throw new DiscussionError(400, "发言内容不能为空");
  if (content.length > DISCUSSION_CONTENT_MAX_LENGTH) {
    throw new DiscussionError(400, `发言内容不能超过 ${DISCUSSION_CONTENT_MAX_LENGTH} 字`);
  }
  if (input.perspectiveId !== undefined && input.parentId !== undefined) {
    throw new DiscussionError(400, "视角锚点只能随顶层楼层携带");
  }

  return transactionWithSearchSync(getDb(), async (tx) => {
    const term = await getLiveTermTx(tx, input.termId);
    if (!term) throw new DiscussionError(404, "词条不存在或已被删除");

    if ((await termLockedAt(tx, input.termId)) !== null) {
      throw new DiscussionError(403, "讨论区已被版务锁定，暂不能发言");
    }

    if (input.perspectiveId !== undefined) {
      const [anchor] = await tx
        .select({ pageId: perspectives.pageId })
        .from(perspectives)
        .innerJoin(pages, eq(pages.id, perspectives.pageId))
        .where(
          and(
            eq(perspectives.pageId, input.perspectiveId),
            eq(perspectives.termId, input.termId),
            isPageVisible(pages.id),
          ),
        )
        .limit(1);
      if (!anchor) throw new DiscussionError(400, "视角锚点必须指向该词条下的在线视角");
    }

    if (input.parentId !== undefined) {
      const [parent] = await tx
        .select({
          id: discussionPosts.id,
          termId: discussionPosts.termId,
          parentId: discussionPosts.parentId,
          deletedAt: discussionPosts.deletedAt,
        })
        .from(discussionPosts)
        .where(eq(discussionPosts.id, input.parentId))
        .limit(1);
      if (!parent || parent.termId !== input.termId) {
        throw new DiscussionError(400, "只能回复本讨论区的楼层");
      }
      if (parent.deletedAt !== null) {
        throw new DiscussionError(400, "楼层已被删除，不能回复");
      }
      // 一层嵌套：父楼层自身必须是顶层（parent 的 parent 为空）
      if (parent.parentId !== null) {
        throw new DiscussionError(400, "只支持一层嵌套回复");
      }
    }

    const [created] = await tx
      .insert(discussionPosts)
      .values({
        termId: input.termId,
        perspectiveId: input.perspectiveId ?? null,
        parentId: input.parentId ?? null,
        content,
        authorId: actor.id,
      })
      .returning({ id: discussionPosts.id });
    queueDiscussionSync(tx, created.id);
    return {
      id: created.id,
      parentId: input.parentId ?? null,
      perspectiveId: input.perspectiveId ?? null,
    };
  });
}

/**
 * 版务软删楼层（顶层或回复皆可）。返回 false = 楼层不存在；已删除时幂等成功。
 * 内容与作者保留（占位渲染），搜索索引随事务移除。
 */
export async function softDeleteDiscussionPost(
  postId: number,
  admin: DiscussionActor,
): Promise<boolean> {
  return transactionWithSearchSync(getDb(), async (tx) => {
    const [post] = await tx
      .select({ id: discussionPosts.id, deletedAt: discussionPosts.deletedAt })
      .from(discussionPosts)
      .where(eq(discussionPosts.id, postId))
      .limit(1);
    if (!post) return false;
    if (post.deletedAt !== null) return true;

    await tx
      .update(discussionPosts)
      .set({ deletedAt: new Date(), deletedBy: admin.id })
      .where(eq(discussionPosts.id, postId));
    queueDiscussionSync(tx, postId);
    return true;
  });
}

/**
 * 版务锁定/解锁词条（#71 扩展语义）。锁定后该词条讨论区与页面评论（总评 +
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
