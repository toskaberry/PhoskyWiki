// 个人标记（划线）数据层（spec 0009 #72）：随账号云端保存、默认仅自己可见。
// 读写都只涉及作者本人的行（多租隔离在 where 条件），不做版务锁定判定
// （spec 0009 Q19：划线不受词条锁定影响），也不进搜索索引（私密内容）。
//
// 锚定语义：客户端把选区序列化为 {start, end, quote, baseRevisionId}（读者加载
// 页面时的 head 修订）。写入端用 relocateAnchor 把锚点对齐到写入时刻的 head：
// 成功则按现行偏移落库（重锚到新 head），失败返回 409「原文已变更」——不模糊
// 匹配、不静默丢弃（ADR-0008）。读取端同样重定位：定位失败的标记保留原始引用、
// 视图标记 original-changed，不参与渲染与相交合并。

import "server-only";

import { and, asc, desc, eq, inArray } from "drizzle-orm";

import { getDb, type Db } from "@/db";
import { pages, personalMarks, revisions, userMarkStyle } from "@/db/schema";
import { isLocatedMark, isMarkStyle, type LocatedMarkView, type MarkStyle, type PersonalMarkView, type PersonalMarksState } from "@/lib/mark-styles";
import { isPageVisible } from "@/lib/page-visibility";
import { canonicalMarkdownText } from "@/lib/passage-body";
import { relocateAnchor, type ContentRange } from "@/lib/passage-anchors";

type Reader = Pick<Db, "select">;

export class PassageMarkError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

/** 解析正整数 id（页面 id / 标记 id 共用的路由参数校验）。 */
export function positiveId(value: unknown, label = "页面或标记"): number {
  if ((typeof value !== "string" && typeof value !== "number") || !/^\d+$/.test(String(value))) {
    throw new PassageMarkError(400, `${label} id 必须是正整数`);
  }
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id <= 0 || id > 2147483647) {
    throw new PassageMarkError(400, `${label} id 必须是正整数`);
  }
  return id;
}

/** 标记只属于视角正文：页面必须是在线视角页（词条/诠释者页没有可划线正文）。 */
async function requirePerspectivePage(db: Reader, pageId: number) {
  const [row] = await db.select({ id: pages.id }).from(pages)
    .where(and(eq(pages.id, pageId), eq(pages.type, "perspective"), isPageVisible(pages.id)));
  if (!row) throw new PassageMarkError(404, "页面不存在或不可划线");
}

/** 校验同上并锁页面行：同页标记的「读相交集 → 删旧 → 建新」串行，不被并发交错。 */
async function lockPerspectivePage(db: Reader, pageId: number) {
  const [row] = await db.select({ id: pages.id }).from(pages)
    .where(and(eq(pages.id, pageId), eq(pages.type, "perspective"), isPageVisible(pages.id)))
    .for("update");
  if (!row) throw new PassageMarkError(404, "页面不存在或不可划线");
}

/** 建标/合并重锚都锚定到写入时刻的 head 修订，读取与写入共用同一取法。 */
async function loadHead(db: Reader, pageId: number): Promise<{ id: number; content: string } | null> {
  const [row] = await db.select({ id: revisions.id, content: revisions.content })
    .from(revisions).where(eq(revisions.pageId, pageId)).orderBy(desc(revisions.id)).limit(1);
  return row ?? null;
}

interface MarkRow {
  id: number;
  style: MarkStyle;
  anchorStart: number;
  anchorEnd: number;
  quote: string;
  baseRevisionId: number;
  createdAt: Date;
}

/** 读取标记行的公共列清单（loadState 与 createPersonalMark 共用）。 */
const markRowColumns = {
  id: personalMarks.id, style: personalMarks.style, anchorStart: personalMarks.anchorStart,
  anchorEnd: personalMarks.anchorEnd, quote: personalMarks.quote,
  baseRevisionId: personalMarks.baseRevisionId, createdAt: personalMarks.createdAt,
};

/**
 * 把存储的标记行定位到现行 head：同行快路径只校验引用，跨修订走 relocateAnchor。
 * 修订内容按需批量加载（同一页的历史修订，跨页修订不存在——外键 + 页面边界）。
 */
async function locateMarkRows(db: Reader, pageId: number, head: { id: number; content: string }, rows: MarkRow[]): Promise<PersonalMarkView[]> {
  const currentText = canonicalMarkdownText(head.content);
  const foreignIds = [...new Set(rows.filter(row => row.baseRevisionId !== head.id).map(row => row.baseRevisionId))];
  const baseTexts = new Map<number, string>();
  if (foreignIds.length) {
    const loaded = await db.select({ id: revisions.id, content: revisions.content })
      .from(revisions).where(and(eq(revisions.pageId, pageId), inArray(revisions.id, foreignIds)));
    for (const row of loaded) baseTexts.set(row.id, canonicalMarkdownText(row.content));
  }
  const located: (PersonalMarkView & { start: number; end: number })[] = [];
  const changed: PersonalMarkView[] = [];
  for (const row of rows) {
    let range: ContentRange | null = null;
    if (row.baseRevisionId === head.id) {
      // 同修订快路径：偏移与引用直接对现行文本校验（防御存储层不一致）
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
    const base = { id: row.id, style: row.style, quote: row.quote, createdAt: row.createdAt.toISOString() };
    if (range) located.push({ ...base, status: "located", start: range.start, end: range.end });
    else changed.push({ ...base, status: "original-changed", start: null, end: null });
  }
  located.sort((a, b) => a.start - b.start || a.id - b.id);
  changed.sort((a, b) => b.id - a.id);
  return [...located, ...changed];
}

async function loadUserStyle(db: Reader, userId: string): Promise<MarkStyle> {
  const [row] = await db.select({ style: userMarkStyle.style }).from(userMarkStyle).where(eq(userMarkStyle.userId, userId));
  return row?.style ?? "highlight";
}

async function loadState(db: Reader, pageId: number, userId: string): Promise<PersonalMarksState> {
  await requirePerspectivePage(db, pageId);
  const head = await loadHead(db, pageId);
  if (!head) throw new PassageMarkError(404, "页面不存在或不可划线");
  const rows = await db.select(markRowColumns).from(personalMarks)
    .where(and(eq(personalMarks.pageId, pageId), eq(personalMarks.userId, userId)))
    .orderBy(asc(personalMarks.anchorStart), asc(personalMarks.id));
  return {
    revisionId: head.id,
    marks: await locateMarkRows(db, pageId, head, rows),
    defaultStyle: await loadUserStyle(db, userId),
  };
}

/** 本人视角页的标记与默认样式（视角页渲染入口用；游客不会调用）。 */
export async function listPersonalMarks(pageId: number, viewerId: string): Promise<PersonalMarksState> {
  return loadState(getDb(), pageId, viewerId);
}

/** 客户端序列化的选区锚（passage-anchors.serializeSelection 的产物；修订 id 以字符串传输）。 */
function parseAnchor(value: unknown): { start: number; end: number; quote: string; baseRevisionId: string } {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new PassageMarkError(400, "标记选区格式不正确");
  }
  const { start, end, quote, baseRevisionId } = value as Record<string, unknown>;
  for (const offset of [start, end]) {
    if (!Number.isSafeInteger(offset) || (offset as number) < 0) throw new PassageMarkError(400, "标记选区格式不正确");
  }
  if ((start as number) >= (end as number)) throw new PassageMarkError(400, "标记选区格式不正确");
  if (typeof quote !== "string" || !quote.trim()) throw new PassageMarkError(400, "标记选区格式不正确");
  if (quote.length > 10000) throw new PassageMarkError(400, "标记选区过长");
  if (typeof baseRevisionId !== "string" || !/^\d+$/.test(baseRevisionId) || Number(baseRevisionId) <= 0) {
    throw new PassageMarkError(400, "标记选区格式不正确");
  }
  return { start: start as number, end: end as number, quote, baseRevisionId };
}

/**
 * 新建标记（含相交合并，spec 0009：新选区与已有标记相交时按范围并集合并，
 * 删旧建新、不叠画多条）。并发写入用页面行锁串行，保证「读取相交集 → 删旧 →
 * 建新」在同一页面上不交错。
 */
export async function createPersonalMark(pageId: number, input: unknown, userId: string): Promise<PersonalMarksState> {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new PassageMarkError(400, "请求体必须是 JSON 对象");
  }
  const { anchor: rawAnchor, style } = input as Record<string, unknown>;
  if (!isMarkStyle(style)) throw new PassageMarkError(400, "未知标记样式");
  const anchor = parseAnchor(rawAnchor);
  const db = getDb();
  return db.transaction(async tx => {
    // 页面行锁：同页标记写入串行（合并读-删-建不被并发交错）
    await lockPerspectivePage(tx, pageId);
    const head = await loadHead(tx, pageId);
    if (!head) throw new PassageMarkError(404, "页面不存在或不可划线");
    const currentText = canonicalMarkdownText(head.content);
    let baseText = currentText;
    const baseRevisionId = Number(anchor.baseRevisionId);
    if (baseRevisionId !== head.id) {
      const [base] = await tx.select({ content: revisions.content }).from(revisions)
        .where(and(eq(revisions.id, baseRevisionId), eq(revisions.pageId, pageId)));
      if (!base) throw new PassageMarkError(404, "选区锚定的修订不存在，请刷新页面后重试");
      baseText = canonicalMarkdownText(base.content);
    }
    const outcome = relocateAnchor(anchor, { revisionId: anchor.baseRevisionId, text: baseText }, currentText);
    if (outcome.status !== "located") {
      throw new PassageMarkError(409, "正文已更新，标记未能对齐当前内容；刷新页面后再试");
    }
    const range = outcome.range;
    // 相交合并：只合并能在现行正文上定位的标记；「原文已变更」的旧行不动
    const rows: MarkRow[] = await tx.select(markRowColumns).from(personalMarks)
      .where(and(eq(personalMarks.pageId, pageId), eq(personalMarks.userId, userId)));
    const located: LocatedMarkView[] = (await locateMarkRows(tx, pageId, head, rows)).filter(isLocatedMark);
    const union = { start: range.start, end: range.end };
    const merging: number[] = [];
    for (const row of located) {
      if (row.start < union.end && row.end > union.start) {
        merging.push(row.id);
        union.start = Math.min(union.start, row.start);
        union.end = Math.max(union.end, row.end);
      }
    }
    if (merging.length) {
      await tx.delete(personalMarks).where(inArray(personalMarks.id, merging));
    }
    await tx.insert(personalMarks).values({
      pageId, userId, style,
      anchorStart: union.start, anchorEnd: union.end,
      quote: currentText.slice(union.start, union.end),
      baseRevisionId: head.id,
    });
    // 上次选择的样式随账号保存，作为新标记的默认样式
    await tx.insert(userMarkStyle).values({ userId, style })
      .onConflictDoUpdate({ target: userMarkStyle.userId, set: { style, updatedAt: new Date() } });
    return loadState(tx, pageId, userId);
  });
}

/** 删除自己的标记（个人标记无版务处置；行按 (id, userId) 精确命中）。 */
export async function deletePersonalMark(markId: number, pageId: number, userId: string): Promise<PersonalMarksState> {
  const db = getDb();
  return db.transaction(async tx => {
    await requirePerspectivePage(tx, pageId);
    const deleted = await tx.delete(personalMarks)
      .where(and(eq(personalMarks.id, markId), eq(personalMarks.userId, userId), eq(personalMarks.pageId, pageId)))
      .returning({ id: personalMarks.id });
    if (!deleted.length) throw new PassageMarkError(404, "标记不存在");
    return loadState(tx, pageId, userId);
  });
}

export async function markResponse(action: () => Promise<Response>) {
  try { return await action(); }
  catch (error) {
    if (error instanceof PassageMarkError) return Response.json({ error: error.message }, { status: error.status });
    throw error;
  }
}
