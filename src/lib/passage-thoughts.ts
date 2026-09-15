// 划线感想数据层（spec 0009 #73/#74）：视角正文选文上的公开/私密想法。
//
// 与个人标记（lib/passage-marks.ts）共用同一套锚定语义（quote + 偏移 + base_revision_id，
// 见 docs/passage-anchors.md 与 ADR-0008），差别在归属与生命周期：
//   - 感想是讨论：公开感想进入句子面板（按赞同数降序），可被回复与赞同；
//   - 感想不随正文修订重锚：发表时的引用与基准修订永久保留，读到现行正文上
//     靠 relocateAnchor 重新定位，定位失败即「原文已变更」，讨论不删除（ADR-0008）；
//   - 发表时若 head 已不是选区基准修订，先回 409 让界面确认（Q18/Q19），
//     确认后按读者看到的版本保存。
//
// 写入路径的准入（与页面评论一致）：页面在线、视角页、词条未版务锁定；
// 锁定只挡回复（与评论同口径），不影响发表感想与划线（spec 0009 Q33）。

import "server-only";

import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";

import { getDb, type Db } from "@/db";
import {
  agrees,
  pages,
  passageThoughts,
  personalMarks,
  perspectives,
  replies,
  revisions,
  user,
  userMarkStyle,
  type ThoughtVisibility,
} from "@/db/schema";
import { hasAdminRole } from "@/lib/roles";
import { isMarkStyle, type MarkStyle } from "@/lib/mark-styles";
import { termLockedAt } from "@/lib/term-lock";
import { isPageVisible } from "@/lib/page-visibility";
import { canonicalMarkdownText } from "@/lib/passage-body";
import { relocateAnchor } from "@/lib/passage-anchors";
import { positiveId, PassageMarkError } from "@/lib/passage-marks";
import type { PageThoughtsState, ThoughtReplyView, ThoughtView } from "@/lib/thought-types";

type Reader = Pick<Db, "select">;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
type AnyReader = Db | Tx;

/** 感想内容与页面评论同限长（纯文本，不做 Markdown）。 */
const CONTENT_MAX_LENGTH = 2000;

export class PassageThoughtError extends Error {
  constructor(public status: number, message: string, public code?: string) { super(message); }
}

export function thoughtId(value: unknown): number {
  return positiveId(value, "感想");
}

interface Anchor {
  start: number;
  end: number;
  quote: string;
  baseRevisionId: string;
}

/** 客户端序列化的选区锚（passage-anchors.serializeSelection 的产物）；形状与标记锚一致。 */
function parseAnchor(value: unknown): Anchor {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new PassageThoughtError(400, "选区格式不正确");
  }
  const { start, end, quote, baseRevisionId } = value as Record<string, unknown>;
  for (const offset of [start, end]) {
    if (!Number.isSafeInteger(offset) || (offset as number) < 0) throw new PassageThoughtError(400, "选区格式不正确");
  }
  if ((start as number) >= (end as number)) throw new PassageThoughtError(400, "选区格式不正确");
  if (typeof quote !== "string" || !quote.trim() || quote.length > 10000) throw new PassageThoughtError(400, "选区格式不正确");
  if (typeof baseRevisionId !== "string" || !/^\d+$/.test(baseRevisionId) || Number(baseRevisionId) <= 0) {
    throw new PassageThoughtError(400, "选区格式不正确");
  }
  return { start: start as number, end: end as number, quote, baseRevisionId };
}

/** 感想只属于在线视角页正文（与个人标记同一写入边界）。 */
async function requirePerspectivePage(db: Reader, pageId: number, lock = false) {
  const query = db.select({ id: pages.id }).from(pages)
    .where(and(eq(pages.id, pageId), eq(pages.type, "perspective"), isPageVisible(pages.id)));
  const [row] = lock ? await query.for("update") : await query;
  if (!row) throw new PassageThoughtError(404, "页面不存在或不可发表感想");
}

/** 页面 head 修订：发表时的「基准」与读取时的「现行」共用同一取法。 */
async function loadHead(db: Reader, pageId: number): Promise<{ id: number; content: string } | null> {
  const [row] = await db.select({ id: revisions.id, content: revisions.content })
    .from(revisions).where(eq(revisions.pageId, pageId)).orderBy(desc(revisions.id)).limit(1);
  return row ?? null;
}

async function loadText(db: Reader, revisionId: number, pageId: number): Promise<string | null> {
  const [row] = await db.select({ content: revisions.content }).from(revisions)
    .where(and(eq(revisions.id, revisionId), eq(revisions.pageId, pageId)));
  return row ? canonicalMarkdownText(row.content) : null;
}

/** 意见的治理词条：视角页所属词条（版务锁定按词条判定，与页面评论同口径）。 */
async function thoughtTermId(db: Reader, pageId: number): Promise<number | null> {
  const [row] = await db.select({ termId: perspectives.termId }).from(perspectives)
    .where(and(eq(perspectives.pageId, pageId), isPageVisible(perspectives.termId)));
  return row?.termId ?? null;
}

/** 词条被版务锁定时禁止新增回复（发表感想与划线不受影响，spec 0009 Q33）。 */
async function requireReplyablePage(db: Reader, pageId: number) {
  const termId = await thoughtTermId(db, pageId);
  if (termId === null) throw new PassageThoughtError(404, "页面不存在或不可回复");
  if (await termLockedAt(db, termId) !== null) {
    throw new PassageThoughtError(403, "词条评论已被版务锁定，暂不能回复");
  }
}

// ---------------------------------------------------------------------------
// 定位：把存储的引用对齐到现行 head（与个人标记同一算法）
// ---------------------------------------------------------------------------

interface ThoughtRow {
  id: number;
  pageId: number;
  content: string;
  visibility: ThoughtVisibility;
  anchorStart: number;
  anchorEnd: number;
  quote: string;
  baseRevisionId: number;
  deletedAt: Date | null;
  createdAt: Date;
  authorId: string;
  authorName: string;
  authorImage: string | null;
  agreeCount: number;
  agreed: boolean;
}

const thoughtColumns = {
  id: passageThoughts.id, pageId: passageThoughts.pageId, content: passageThoughts.content,
  visibility: passageThoughts.visibility, anchorStart: passageThoughts.anchorStart,
  anchorEnd: passageThoughts.anchorEnd, quote: passageThoughts.quote,
  baseRevisionId: passageThoughts.baseRevisionId, deletedAt: passageThoughts.deletedAt,
  createdAt: passageThoughts.createdAt, authorId: passageThoughts.authorId,
  authorName: user.name, authorImage: user.image,
};

/**
 * 单行感想在现行 head 上的定位（页面渲染与个人记录共用）：
 * 存储的引用 + 基准修订 → 现行偏移，或「原文已变更」（ADR-0008）。
 */
export async function locateThoughtAnchor(
  row: { pageId: number; baseRevisionId: number; anchorStart: number; anchorEnd: number; quote: string },
  db: Reader = getDb(),
): Promise<{ status: "located"; start: number; end: number } | { status: "original-changed" }> {
  const head = await loadHead(db, row.pageId);
  if (!head) return { status: "original-changed" };
  const currentText = canonicalMarkdownText(head.content);
  if (row.baseRevisionId === head.id) {
    const valid = row.anchorStart >= 0 && row.anchorEnd > row.anchorStart && row.anchorEnd <= currentText.length
      && currentText.slice(row.anchorStart, row.anchorEnd) === row.quote;
    return valid ? { status: "located", start: row.anchorStart, end: row.anchorEnd } : { status: "original-changed" };
  }
  const baseText = await loadText(db, row.baseRevisionId, row.pageId);
  if (baseText === null) return { status: "original-changed" };
  const outcome = relocateAnchor(
    { start: row.anchorStart, end: row.anchorEnd, quote: row.quote, baseRevisionId: String(row.baseRevisionId) },
    { revisionId: String(row.baseRevisionId), text: baseText },
    currentText,
  );
  return outcome.status === "located"
    ? { status: "located", start: outcome.range.start, end: outcome.range.end }
    : { status: "original-changed" };
}

/** 现行偏移：同 head 直接校验引用，跨修订走 relocateAnchor，失败即「原文已变更」。 */
async function locateThoughts(db: Reader, pageId: number, head: { id: number; content: string }, rows: ThoughtRow[]) {
  const currentText = canonicalMarkdownText(head.content);
  const foreignIds = [...new Set(rows.filter(row => row.baseRevisionId !== head.id).map(row => row.baseRevisionId))];
  const baseTexts = new Map<number, string>();
  for (const id of foreignIds) {
    const text = await loadText(db, id, pageId);
    if (text !== null) baseTexts.set(id, text);
  }
  return rows.map(row => {
    let range: { start: number; end: number } | null = null;
    if (row.baseRevisionId === head.id) {
      if (row.anchorStart >= 0 && row.anchorEnd > row.anchorStart && row.anchorEnd <= currentText.length
        && currentText.slice(row.anchorStart, row.anchorEnd) === row.quote) {
        range = { start: row.anchorStart, end: row.anchorEnd };
      }
    } else {
      const baseText = baseTexts.get(row.baseRevisionId);
      if (baseText !== undefined) {
        const outcome = relocateAnchor(
          { start: row.anchorStart, end: row.anchorEnd, quote: row.quote, baseRevisionId: String(row.baseRevisionId) },
          { revisionId: String(row.baseRevisionId), text: baseText },
          currentText,
        );
        if (outcome.status === "located") range = outcome.range;
      }
    }
    return { row, range };
  });
}

/** 公开（含本人私密）感想的单条视图；软删行不外发内容与作者（占位语义）。 */
function thoughtView(
  row: ThoughtRow,
  range: { start: number; end: number } | null,
  viewerId: string | undefined,
  agreeState: { count: number; agreed: boolean },
): ThoughtView {
  const deleted = row.deletedAt !== null;
  return {
    id: row.id,
    pageId: row.pageId,
    content: deleted ? "" : row.content,
    quote: row.quote,
    baseRevisionId: row.baseRevisionId,
    visibility: row.visibility,
    authorId: deleted ? "" : row.authorId,
    authorName: deleted ? "" : row.authorName,
    authorImage: deleted ? null : row.authorImage,
    createdAt: row.createdAt.toISOString(),
    deleted,
    agreeCount: deleted ? 0 : agreeState.count,
    agreed: deleted ? false : agreeState.agreed,
    status: range ? "located" : "original-changed",
    start: range?.start ?? null,
    end: range?.end ?? null,
    canDelete: !deleted && (row.authorId === viewerId || false),
    replyable: !deleted,
    replies: [],
  };
}

/**
 * 读取视角页的感想：游客与读者只见公开感想，本人私密感想随登录可见（spec 0009 #74）。
 * 排序与页面评论同口径——赞同数降序、同票新→旧、id 兜底。读路径与写后回读共用本实现。
 */
export async function listPageThoughts(pageId: number, viewerId?: string): Promise<PageThoughtsState> {
  const db = getDb();
  await requirePerspectivePage(db, pageId);
  return loadThoughts(db, pageId, viewerId);
}

/** 读路径共用实现：可跑在连接池上，也可跑在写入事务内（listPageThoughtsWith）。 */
async function loadThoughts(db: AnyReader, pageId: number, viewerId?: string): Promise<PageThoughtsState> {
  const head = await loadHead(db, pageId);
  if (!head) throw new PassageThoughtError(404, "页面不存在或不可发表感想");
  const agreeCount = sql<number>`(select count(*)::int from ${agrees} where ${agrees.targetType} = 'passage_thought' and ${agrees.targetId} = ${passageThoughts.id})`;
  const agreed = viewerId
    ? sql<boolean>`exists(select 1 from ${agrees} where ${agrees.userId} = ${viewerId} and ${agrees.targetType} = 'passage_thought' and ${agrees.targetId} = ${passageThoughts.id})`
    : sql<boolean>`false`;
  const rows = await db.select({ ...thoughtColumns, agreeCount, agreed })
    .from(passageThoughts).innerJoin(user, eq(user.id, passageThoughts.authorId))
    .where(and(
      eq(passageThoughts.pageId, pageId),
      isPageVisible(passageThoughts.pageId),
      viewerId
        ? sql`(${passageThoughts.visibility} = 'public' or ${passageThoughts.authorId} = ${viewerId})`
        : eq(passageThoughts.visibility, "public"),
    ))
    .orderBy(desc(agreeCount), desc(passageThoughts.createdAt), desc(passageThoughts.id));
  const located = await locateThoughts(db, pageId, head, rows);
  const thoughts = located
    .map(({ row, range }) => thoughtView(row, range, viewerId, { count: row.agreeCount, agreed: row.agreed }))
    .sort((a, b) => b.agreeCount - a.agreeCount || b.createdAt.localeCompare(a.createdAt) || b.id - a.id);
  const repliesByTarget = await loadThoughtReplies(thoughts.map(thought => thought.id), viewerId);
  return {
    thoughts: thoughts.map(thought => ({ ...thought, replies: repliesByTarget.get(thought.id) ?? [] })),
    revisionId: head.id,
  };
}

/** 回复随感想一并返回（时间升序）；管理员的处置权限不延伸到他人私密感想（spec 0009 #74）。 */
async function loadThoughtReplies(thoughtIds: number[], viewerId: string | undefined) {
  const byTarget = new Map<number, ThoughtReplyView[]>();
  if (!thoughtIds.length) return byTarget;
  const db = getDb();
  const rows = await db.select({
    id: replies.id, targetId: replies.targetId, content: replies.content, deletedAt: replies.deletedAt,
    createdAt: replies.createdAt, authorId: replies.authorId, authorName: user.name,
  }).from(replies).innerJoin(user, eq(user.id, replies.authorId))
    .where(and(eq(replies.targetType, "passage_thought"), inArray(replies.targetId, thoughtIds)))
    .orderBy(asc(replies.createdAt), asc(replies.id));
  for (const row of rows) {
    const deleted = row.deletedAt !== null;
    const bucket = byTarget.get(row.targetId) ?? [];
    bucket.push({
      id: row.id,
      content: deleted ? "" : row.content,
      authorId: deleted ? "" : row.authorId,
      authorName: deleted ? "" : row.authorName,
      createdAt: row.createdAt.toISOString(),
      deleted,
      canDelete: !deleted && row.authorId === viewerId,
    });
    byTarget.set(row.targetId, bucket);
  }
  return byTarget;
}

// ---------------------------------------------------------------------------
// 写入
// ---------------------------------------------------------------------------

export interface CreateThoughtInput {
  pageId: unknown;
  anchor: unknown;
  content: unknown;
  visibility: unknown;
  style: unknown;
  confirmRevisionChange: unknown;
}

/**
 * 发表感想：一条事务内完成三件事——校验选区确实锚在读者看到的修订文本上、
 * 落感想（保留发表时的引用与基准修订）、按所选样式补一条个人划线（自动划线，
 * 划线不进讨论也不受锁定影响）。基准修订落后于 head 时先回 409（除非读者已确认），
 * 确认后仍按原选取与基准保存：引用不丢，读取端据 relocateAnchor 标注定位状态。
 */
export async function createThought(input: CreateThoughtInput, authorId: string): Promise<PageThoughtsState> {
  const pageId = positiveId(input.pageId, "页面");
  const anchor = parseAnchor(input.anchor);
  if (typeof input.content !== "string" || !input.content.trim()) throw new PassageThoughtError(400, "感想内容不能为空");
  const content = input.content.trim();
  if (content.length > CONTENT_MAX_LENGTH) throw new PassageThoughtError(400, `感想内容不能超过 ${CONTENT_MAX_LENGTH} 字符`);
  if (input.visibility !== "public" && input.visibility !== "private") throw new PassageThoughtError(400, "感想可见性无效");
  const visibility: ThoughtVisibility = input.visibility;
  if (!isMarkStyle(input.style)) throw new PassageThoughtError(400, "未知划线样式");
  const style: MarkStyle = input.style;
  const confirmed = input.confirmRevisionChange === true;

  const db = getDb();
  return db.transaction(async tx => {
    await requirePerspectivePage(tx, pageId, true);
    const head = await loadHead(tx, pageId);
    if (!head) throw new PassageThoughtError(404, "页面不存在或不可发表感想");
    const baseRevisionId = Number(anchor.baseRevisionId);
    const baseText = await loadText(tx, baseRevisionId, pageId);
    if (baseText === null) throw new PassageThoughtError(404, "选区锚定的修订不存在，请刷新页面后重试");
    // 选区必须真的是基准修订上的一段原文（客户端引用快照不可伪造）
    if (anchor.end > baseText.length || baseText.slice(anchor.start, anchor.end) !== anchor.quote) {
      throw new PassageThoughtError(400, "选区与正文不一致，请重新选择");
    }
    if (baseRevisionId !== head.id && !confirmed) {
      throw new PassageThoughtError(409, "正文已更新，感想将按你看到的版本保存", "revision-changed");
    }
    const currentText = canonicalMarkdownText(head.content);
    const outcome = relocateAnchor(
      { start: anchor.start, end: anchor.end, quote: anchor.quote, baseRevisionId: anchor.baseRevisionId },
      { revisionId: anchor.baseRevisionId, text: baseText },
      currentText,
    );
    await tx.insert(passageThoughts).values({
      pageId, authorId, content, visibility,
      anchorStart: anchor.start, anchorEnd: anchor.end, quote: anchor.quote, baseRevisionId,
    });
    // 写感想即自动划线（spec 0009 Q12）：只在能对上现行正文时补，落库锚定 head
    if (outcome.status === "located") {
      await mergePersonalMark(tx, pageId, authorId, style, outcome.range, currentText, head.id);
      await tx.insert(userMarkStyle).values({ userId: authorId, style })
        .onConflictDoUpdate({ target: userMarkStyle.userId, set: { style, updatedAt: new Date() } });
    }
    return listPageThoughtsIn(tx, pageId, authorId);
  });
}

/**
 * 划线合并（与 lib/passage-marks.createPersonalMark 同规则）：新选区与既有可定位标记
 * 相交时取并集，删旧建新不叠画。此处只服务「写感想自动划线」，样式取浮条当前选择。
 */
async function mergePersonalMark(
  tx: Tx,
  pageId: number,
  userId: string,
  style: MarkStyle,
  range: { start: number; end: number },
  currentText: string,
  headRevisionId: number,
) {
  const rows = await tx.select({
    id: personalMarks.id, anchorStart: personalMarks.anchorStart, anchorEnd: personalMarks.anchorEnd,
    quote: personalMarks.quote, baseRevisionId: personalMarks.baseRevisionId,
  }).from(personalMarks).where(and(eq(personalMarks.pageId, pageId), eq(personalMarks.userId, userId)));
  const union = { start: range.start, end: range.end };
  const merging = rows.filter(row => row.baseRevisionId === headRevisionId
    && row.anchorStart < union.end && row.anchorEnd > union.start
    && currentText.slice(row.anchorStart, row.anchorEnd) === row.quote);
  for (const row of merging) {
    union.start = Math.min(union.start, row.anchorStart);
    union.end = Math.max(union.end, row.anchorEnd);
  }
  if (merging.length) await tx.delete(personalMarks).where(inArray(personalMarks.id, merging.map(row => row.id)));
  await tx.insert(personalMarks).values({
    pageId, userId, style,
    anchorStart: union.start, anchorEnd: union.end,
    quote: currentText.slice(union.start, union.end),
    baseRevisionId: headRevisionId,
  });
}

/**
 * 删除感想（spec 0009 占位语义 + 版务）：作者删自己的，管理员处置任何公开感想。
 * 有回复 → 软删占位（内容与作者不外发，回复保留可读）；无回复 → 物理移除
 * （连同多态赞同；回复不可能存在）。划线不受影响（spec 0009 Q17）。
 * 他人私密感想不在管理员的处置范围内——不可见即不可处置（spec 0009 #74）。
 */
export async function deleteThought(id: number, actorId: string): Promise<void> {
  const db = getDb();
  await db.transaction(async tx => {
    const [thought] = await tx.select({
      authorId: passageThoughts.authorId, visibility: passageThoughts.visibility, deletedAt: passageThoughts.deletedAt,
    }).from(passageThoughts).where(eq(passageThoughts.id, id)).for("update");
    if (!thought) throw new PassageThoughtError(404, "感想不存在");
    const [actor] = await tx.select({ role: user.role }).from(user).where(eq(user.id, actorId));
    if (!actor) throw new PassageThoughtError(401, "登录状态无效，请重新登录");
    const isAuthor = thought.authorId === actorId;
    if (!isAuthor && (!hasAdminRole(actor.role) || thought.visibility !== "public")) {
      throw new PassageThoughtError(403, "只能删除自己的感想");
    }
    if (thought.deletedAt !== null) return;
    const [counted] = await tx.select({ count: sql<number>`count(*)::int` }).from(replies)
      .where(and(eq(replies.targetType, "passage_thought"), eq(replies.targetId, id)));
    if (counted.count > 0) {
      await tx.update(passageThoughts).set({ deletedAt: new Date(), deletedBy: actorId }).where(eq(passageThoughts.id, id));
      return;
    }
    await tx.delete(passageThoughts).where(eq(passageThoughts.id, id));
    await tx.delete(agrees).where(and(eq(agrees.targetType, "passage_thought"), eq(agrees.targetId, id)));
  });
}

/**
 * 切换可见性（spec 0009 Q25/Q26）：公开 → 仅自己可见即整串（含回复）退出公共视图，
 * 只对作者可见；回复保留在作者的个人记录里，其他人的记录按「原始感想已转私密」标注。
 * 私密 → 公开恢复公开展示。只有作者本人可切换。
 */
export async function setThoughtVisibility(id: number, visibility: unknown, actorId: string): Promise<void> {
  if (visibility !== "public" && visibility !== "private") throw new PassageThoughtError(400, "感想可见性无效");
  const db = getDb();
  await db.transaction(async tx => {
    const [thought] = await tx.select({ authorId: passageThoughts.authorId })
      .from(passageThoughts).where(eq(passageThoughts.id, id)).for("update");
    if (!thought) throw new PassageThoughtError(404, "感想不存在");
    if (thought.authorId !== actorId) throw new PassageThoughtError(403, "只能调整自己的感想");
    await tx.update(passageThoughts).set({ visibility }).where(eq(passageThoughts.id, id));
  });
}

/**
 * 赞同与取消（spec 0009 Q23）：不能赞同自己的感想，重复请求幂等；
 * 只有公开且未删除的感想可被赞同——私密感想对他人不存在（404 而非 403，不泄露存在性）。
 */
export async function setThoughtAgree(id: number, userId: string, agree: boolean): Promise<{ agreed: boolean; count: number }> {
  const db = getDb();
  return db.transaction(async tx => {
    const [thought] = await tx.select({ authorId: passageThoughts.authorId })
      .from(passageThoughts).where(and(
        eq(passageThoughts.id, id),
        eq(passageThoughts.visibility, "public"),
        isNull(passageThoughts.deletedAt),
        isPageVisible(passageThoughts.pageId),
      ));
    if (!thought) throw new PassageThoughtError(404, "感想不存在或不可赞同");
    if (thought.authorId === userId) throw new PassageThoughtError(403, "不能赞同自己的感想");
    if (agree) {
      await tx.insert(agrees).values({ userId, targetType: "passage_thought", targetId: id }).onConflictDoNothing();
    } else {
      await tx.delete(agrees).where(and(
        eq(agrees.userId, userId), eq(agrees.targetType, "passage_thought"), eq(agrees.targetId, id),
      ));
    }
    const [counted] = await tx.select({ count: sql<number>`count(*)::int` }).from(agrees)
      .where(and(eq(agrees.targetType, "passage_thought"), eq(agrees.targetId, id)));
    return { agreed: agree, count: counted?.count ?? 0 };
  });
}

/** 回复感想（扁平，@ 提及为正文前缀）：目标未删除、页面在线、词条未锁定。 */
export async function createThoughtReply(id: number, input: unknown, authorId: string): Promise<ThoughtReplyView> {
  if (typeof input !== "string" || !input.trim()) throw new PassageThoughtError(400, "回复内容不能为空");
  if (input.length > CONTENT_MAX_LENGTH) throw new PassageThoughtError(400, `回复内容不能超过 ${CONTENT_MAX_LENGTH} 字符`);
  const db = getDb();
  return db.transaction(async tx => {
    const [thought] = await tx.select({
      id: passageThoughts.id, pageId: passageThoughts.pageId, deletedAt: passageThoughts.deletedAt,
      visibility: passageThoughts.visibility, authorId: passageThoughts.authorId,
    }).from(passageThoughts).where(eq(passageThoughts.id, id)).for("update");
    // 私密感想对他人不存在；已删除（占位）的感想不可再回复
    if (!thought || thought.deletedAt !== null) throw new PassageThoughtError(404, "感想不存在或已删除，不能回复");
    if (thought.visibility === "private" && thought.authorId !== authorId) {
      throw new PassageThoughtError(404, "感想不存在或已删除，不能回复");
    }
    await requireReplyablePage(tx, thought.pageId);
    const [created] = await tx.insert(replies)
      .values({ targetType: "passage_thought", targetId: id, authorId, content: input.trim() })
      .returning({ id: replies.id, createdAt: replies.createdAt });
    return {
      id: created.id, content: input.trim(), authorId, authorName: "", createdAt: created.createdAt.toISOString(),
      deleted: false, canDelete: true,
    };
  });
}

/** 删除回复：作者物理移除自己的发言，管理员处置（软删占位）他人公开感想下的回复。 */
export async function deleteThoughtReply(replyId: number, actorId: string): Promise<void> {
  const db = getDb();
  await db.transaction(async tx => {
    const [reply] = await tx.select({
      authorId: replies.authorId, deletedAt: replies.deletedAt, targetId: replies.targetId,
    }).from(replies).where(and(eq(replies.id, replyId), eq(replies.targetType, "passage_thought"))).for("update");
    if (!reply) throw new PassageThoughtError(404, "回复不存在");
    const [actor] = await tx.select({ role: user.role }).from(user).where(eq(user.id, actorId));
    if (!actor) throw new PassageThoughtError(401, "登录状态无效，请重新登录");
    if (reply.authorId !== actorId && !hasAdminRole(actor.role)) throw new PassageThoughtError(403, "只能删除自己的回复");
    if (reply.deletedAt !== null) return;
    if (reply.authorId !== actorId) {
      // 管理员的处置不延伸到他人私密感想下的回复：不可见即不可处置（spec 0009 #74）
      const [thought] = await tx.select({
        visibility: passageThoughts.visibility, authorId: passageThoughts.authorId, deletedAt: passageThoughts.deletedAt,
      }).from(passageThoughts).where(eq(passageThoughts.id, reply.targetId));
      if (thought && (thought.visibility === "private" || thought.deletedAt !== null)) {
        throw new PassageThoughtError(403, "只能删除自己的回复");
      }
      await tx.update(replies).set({ deletedAt: new Date(), deletedBy: actorId }).where(eq(replies.id, replyId));
      return;
    }
    await tx.delete(replies).where(eq(replies.id, replyId));
  });
}

/** 事务内的读取（发表后立即回传整表，复用同一排序与可见性口径）。 */
async function listPageThoughtsIn(tx: Tx, pageId: number, viewerId: string): Promise<PageThoughtsState> {
  return loadThoughts(tx, pageId, viewerId);
}

export async function thoughtResponse(action: () => Promise<Response>) {
  try { return await action(); }
  catch (error) {
    if (error instanceof PassageThoughtError) {
      return Response.json({ error: error.message, ...(error.code ? { code: error.code } : {}) }, { status: error.status });
    }
    if (error instanceof PassageMarkError) {
      return Response.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }
}

