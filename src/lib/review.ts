import { administratorRoles, hasAdminRole } from "@/lib/roles";
// 审核域写路径（T06）：提交状态机 + 两票受理 + 修订快照 + links 重建。
// 语义按 ADR-0004：
//   - submissions 存全量提议内容 + base_revision_id（不存 diff，队列页 diff 现算）；
//   - pending → approved/rejected 均终态；任一驳回即 rejected；修改重提 = 新建提交；
//   - quorum = min(2, 提交创建时管理员数)，其后管理员人数变化不追溯；
//   - 受理时页面 head ≠ base → 该票无法通过，自动驳回并提示基于新版重新提交；
//   - 管理员本人提交跳过排队与投票，与受理路径共用「产生修订 → 重建 links → 同步索引」
//     管线（搜索索引同步见 lib/search/search-sync，ADR-0004 #9）。

import "server-only";
import { parseKeyTexts, type KeyText } from "@/lib/key-texts";

import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";

import { getDb, type Db } from "@/db";
import {
  interpreters,
  notifications,
  pages,
  perspectives,
  revisions,
  submissionVotes,
  submissions,
  terms,
  user,
} from "@/db/schema";
import type {
  SubmissionKind,
  SubmissionStatus,
  UserRole,
} from "@/db/schema";
import { rebuildPageLinks } from "@/lib/page-links";
import { queueSearchSync, transactionWithSearchSync } from "@/lib/search/search-sync";
import { pagePath, slugify as slugifyTitle } from "@/lib/slug";
import type { CreateSubmissionResult, ReviewOutcome } from "@/lib/review-types";
import { ImageError } from "@/lib/image-markdown";
import { publishImageReferences, validateImageReferences } from "@/lib/images";
import { lockPerspectiveParents } from "@/lib/perspective-parents";
import { termSnapshot, type TermSnapshot, type MetadataSnapshot, type InterpreterSnapshot, type RevisionSource } from "@/lib/revision-snapshot";

export type { CreateSubmissionResult, ReviewOutcome } from "@/lib/review-types";

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
type DbOrTx = Db | Tx;

/** 操作者（来自会话）：足够驱动审核域的最小字段。 */
export interface Actor {
  id: string;
  role: UserRole;
}

/** 审核域的业务错误：status 直接作为 HTTP 状态码。 */
export class ReviewError extends Error {
  constructor(
    public status: number,
    message: string,
    public href?: string,
  ) {
    super(message);
  }
}

/** 应用层唯一索引冲突（并发抢先创建等）的识别，路由据此转 409。 */
export function isUniqueViolation(err: unknown): boolean {
  const candidates = [err, (err as { cause?: unknown })?.cause];
  return candidates.some((candidate) =>
    (candidate as { code?: string } | undefined)?.code?.startsWith("23505"),
  );
}

/**
 * 两个审核路由共用的错误映射。返回 null = 不是审核域的已知错误（向上抛）。
 * ReviewError → 其状态码；唯一索引冲突（并发抢先创建）→ 409。
 */
export function reviewErrorResponse(err: unknown): Response | null {
  if (err instanceof ReviewError || err instanceof ImageError) {
    return Response.json({ error: err.message, ...(err instanceof ReviewError && err.href ? { href: err.href } : {}) }, { status: err.status });
  }
  if (isUniqueViolation(err)) {
    return Response.json(
      { error: "提议的目标已存在（可能被其他提交抢先创建），请驳回该提交" },
      { status: 409 },
    );
  }
  return null;
}

// ---------------------------------------------------------------------------
// 创建提交
// ---------------------------------------------------------------------------

export interface SubmissionInput {
  kind: SubmissionKind;
  /** kind=edit：编辑目标页 */
  pageId?: number;
  /** kind=edit/new_perspective：提议正文（Markdown 源文本） */
  content?: string;
  /** 新建页或词条信息编辑：标题 */
  title?: string;
  /** 新建页或词条信息编辑：一句话简介 */
  summary?: string;
  keyTexts?: KeyText[] | null;
  aliases?: string[];
  /** kind=new_perspective：挂载的词条与诠释者 */
  termId?: number;
  interpreterId?: number;
  /** kind=edit：编辑起点的页面 head 修订（ADR-0004 #2） */
  baseRevisionId?: number;
  /** 修改重提的谱系：被驳回的前任提交 id（ADR-0004 #5） */
  supersedes?: number;
  /** 编者已对照此修订人工整理过期提案。 */
  confirmedBaseRevisionId?: number;
}

interface ValidatedSubmission {
  keyTexts?: KeyText[] | null;
  aliases?: string[];
  kind: SubmissionKind;
  pageId: number | null;
  content: string;
  title: string | null;
  summary: string | null;
  termId: number | null;
  interpreterId: number | null;
  baseRevisionId: number | null;
  supersedes: number | null;
}

function requiredInt(value: unknown, error: string): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(n) || n <= 0) throw new ReviewError(400, error);
  return n;
}

async function validateSubmissionInput(
  db: Tx,
  input: SubmissionInput,
  actor: Actor,
): Promise<ValidatedSubmission> {
  let keyTexts: KeyText[] | undefined;
  try { keyTexts = parseKeyTexts(input.keyTexts); } catch (error) { throw new ReviewError(400, (error as Error).message); }
  const summary = input.summary?.trim() || null;
  const supersedes =
    input.supersedes === undefined || input.supersedes === null
      ? null
      : requiredInt(input.supersedes, "supersedes 必须是正整数");

  if (supersedes !== null) {
    const [prior] = await db
      .select()
      .from(submissions)
      .where(eq(submissions.id, supersedes))
      .limit(1);
    // 只有被驳回的提交才谈得上「修改重提」（approved 无需重提，pending 未结）
    if (!prior || prior.status !== "rejected") {
      throw new ReviewError(400, "supersedes 必须指向一条已驳回的提交");
    }
    if (prior.submittedBy !== actor.id) throw new ReviewError(403, "只能从自己的驳回记录重新提交");
    if (prior.kind !== input.kind || (prior.kind === "edit" && prior.pageId !== input.pageId)) {
      throw new ReviewError(400, "重提必须保留原提交类型与编辑目标");
    }
    if (prior.kind === "edit") {
      const page = await lockLivePage(db, prior.pageId!);
      if (page.type === "perspective") {
        const [perspective] = await db.select().from(perspectives).where(eq(perspectives.pageId, page.id));
        if (!perspective) throw new ReviewError(404, "目标视角不存在");
        const parents = await lockPerspectiveParents(db, perspective.termId, perspective.interpreterId);
        if (!parents.available) throw new ReviewError(404, parents.reason);
      }
      const headId = await headRevisionId(db, page.id);
      if (!headId || headId !== input.baseRevisionId || (headId !== prior.baseRevisionId && input.confirmedBaseRevisionId !== headId)) {
        throw new ReviewError(409, "页面已有新版，请重新打开重提页，对照最新版与原提案整理并确认。草稿已保留。");
      }
      if (page.type === "term") {
        const [duplicate] = await db.select({ id: pages.id }).from(pages).where(and(eq(pages.type, "term"), eq(pages.title, input.title?.trim() ?? ""), sql`${pages.id} <> ${page.id}`)).limit(1);
        if (duplicate) throw new ReviewError(409, "同名词条已存在，请修改标题后重试");
      }
    }
  }

  switch (input.kind) {
    case "edit": {
      const pageId = requiredInt(input.pageId, "缺少编辑目标页面");
      const content = (input.content ?? "").trim();
      const [page] = await db
        .select({ type: pages.type, deletedAt: pages.deletedAt })
        .from(pages)
        .where(eq(pages.id, pageId))
        .limit(1);
      if (!page) throw new ReviewError(404, "目标页面不存在");
      if (page.deletedAt !== null) throw new ReviewError(404, "目标页面已被删除");
      if (page.type !== "perspective" && page.type !== "term" && page.type !== "interpreter") {
        throw new ReviewError(400, "只支持编辑词条、诠释者信息和视角正文");
      }
      if (page.type === "interpreter" && (typeof input.title !== "string" || !input.title.trim() || typeof input.summary !== "string")) throw new ReviewError(400, "诠释者编辑必须提供名称与简介");
      if (page.type === "perspective" && !content) throw new ReviewError(400, "正文不能为空");
      if (page.type === "term") {
        if (typeof input.title !== "string" || !input.title.trim()) throw new ReviewError(400, "标题不能为空");
        if (typeof input.summary !== "string" || !Array.isArray(input.aliases) || input.aliases.length > 50 || input.aliases.some((a) => typeof a !== "string")) {
          throw new ReviewError(400, "词条编辑必须提供完整简介和别名（最多 50 项）");
        }
      }
      const baseRevisionId = requiredInt(input.baseRevisionId, "缺少 base 修订（编辑起点）");
      const [base] = await db
        .select({ id: revisions.id, snapshot: revisions.snapshot })
        .from(revisions)
        .where(and(eq(revisions.id, baseRevisionId), eq(revisions.pageId, pageId)))
        .limit(1);
      if (!base) throw new ReviewError(400, "base 修订不属于目标页面");
      if (page.type === "term" && !base.snapshot) throw new ReviewError(400, "旧修订没有词条信息快照，请重新打开编辑页获取起始快照");
      return {
        keyTexts,
        kind: "edit",
        pageId,
        content: page.type !== "perspective" ? "" : content,
        title: page.type !== "perspective" ? input.title!.trim() : null,
        summary: page.type !== "perspective" ? input.summary!.trim() : null,
        aliases: page.type === "term" ? [...new Set(input.aliases!.map((a) => a.trim()).filter(Boolean))] : [],
        termId: null,
        interpreterId: null,
        baseRevisionId,
        supersedes,
      };
    }
    case "new_term":
    case "new_interpreter": {
      if (input.kind === "new_term" && input.content?.trim()) throw new ReviewError(400, "新词条只接受导航信息；请另行创建具名诠释者视角来提交正文");
      if (input.aliases !== undefined && (!Array.isArray(input.aliases) || input.aliases.some((alias) => typeof alias !== "string") || input.aliases.length > 50)) {
        throw new ReviewError(400, "别名必须是最多 50 项的字符串数组");
      }
      const title = input.title?.trim() ?? "";
      if (!title) throw new ReviewError(400, "标题不能为空");
      // 撞名检查与唯一性口径：
      //   词条标题有部分唯一索引（软删除仍占标题，ADR-0003 #5）；
      //   诠释者无索引，按在线页面防撞（重名会让显式视角链接的按名解析歧义）。
      const [dup] =
        input.kind === "new_term"
          ? await db
              .select({ id: pages.id })
              .from(pages)
              .where(and(eq(pages.type, "term"), eq(pages.title, title)))
              .limit(1)
          : await db
              .select({ id: pages.id })
              .from(pages)
              .where(
                and(
                  eq(pages.type, "interpreter"),
                  eq(pages.title, title),
                  isNull(pages.deletedAt),
                ),
              )
              .limit(1);
      if (dup) {
        throw new ReviewError(
          400,
          input.kind === "new_term"
            ? "同名词条已存在，请补充该词条的视角或在已有视角中分章说明不同含义"
            : "同名诠释者已存在",
          `/${input.kind === "new_term" ? "term" : "interpreter"}/${dup.id}`,
        );
      }
      return {
        keyTexts,
        kind: input.kind,
        pageId: null,
        content: "",
        aliases: input.kind === "new_term" ? [...new Set((input.aliases ?? []).map((a) => a.trim()).filter(Boolean))] : [],
        title,
        summary,
        termId: null,
        interpreterId: null,
        baseRevisionId: null,
        supersedes,
      };
    }
    case "new_perspective": {
      const termId = requiredInt(input.termId, "缺少目标词条");
      const interpreterId = requiredInt(input.interpreterId, "缺少诠释者");
      const content = (input.content ?? "").trim();
      if (!content) throw new ReviewError(400, "正文不能为空");
      const parents = await lockPerspectiveParents(db, termId, interpreterId);
      if (!parents.available) throw new ReviewError(404, parents.reason);
      // （词条 × 诠释者）唯一约束的提交期预检：软删除的视角仍占位（恢复而非重建）
      const [dup] = await db
        .select({ pageId: perspectives.pageId })
        .from(perspectives)
        .where(
          and(
            eq(perspectives.termId, termId),
            eq(perspectives.interpreterId, interpreterId),
          ),
        )
        .limit(1);
      if (dup) throw new ReviewError(400, "该诠释者在此词条下已有视角");
      return {
        kind: "new_perspective",
        pageId: null,
        content,
        title: null,
        summary,
        termId,
        interpreterId,
        baseRevisionId: null,
        supersedes,
      };
    }
    default:
      throw new ReviewError(400, "非法的提交类型");
  }
}

/**
 * 创建提交。管理员本人提交直接生效（ADR-0004 #9：跳过排队与投票，
 * 与受理共用修订管线）；编者提交进入 pending，quorum 在此刻快照。
 */
export async function createSubmission(
  input: SubmissionInput,
  actor: Actor,
): Promise<CreateSubmissionResult> {
  return transactionWithSearchSync(getDb(), async (db) => {
    const validated = await validateSubmissionInput(db, input, actor);
    await validateImageReferences(db, validated.content, actor);

    if (hasAdminRole(actor.role)) {
      const applied = await applySubmission(db, { ...validated, submittedBy: actor.id }, "direct");
      const [page] = await db
        .select({ type: pages.type, slug: pages.slug })
        .from(pages)
        .where(eq(pages.id, applied.pageId))
        .limit(1);
      return {
        outcome: "direct",
        pageId: applied.pageId,
        href: pagePath(page.type, page.slug, applied.pageId),
      };
    }

    const [adminCountRow] = await db
      .select({ count: sql<number>`count(*)`.mapWith(Number) })
      .from(user)
      .where(inArray(user.role, [...administratorRoles]));
    const quorum = Math.min(2, adminCountRow.count);
    const [row] = await db
      .insert(submissions)
      .values({
        pageId: validated.pageId,
        kind: validated.kind,
        content: validated.content,
        title: validated.title,
        summary: validated.summary,
        aliases: validated.aliases ?? [],
        keyTexts: validated.keyTexts,
        termId: validated.termId,
        interpreterId: validated.interpreterId,
        baseRevisionId: validated.baseRevisionId,
        quorum,
        submittedBy: actor.id,
        supersedesId: validated.supersedes,
      })
      .returning({ id: submissions.id });
    return { outcome: "pending", submissionId: row.id, quorum };
  });
}

/** 整批复用管理员直编管线；任何一项失败都不发布，提交后统一同步搜索。 */
export async function importPages(inputs: SubmissionInput[], actor: Actor) {
  if (!hasAdminRole(actor.role)) throw new ReviewError(403, "需要管理员角色");
  return transactionWithSearchSync(getDb(), async (tx) => {
    const results = [];
    for (const input of inputs) {
      if (input.kind !== "new_term" && input.kind !== "new_interpreter") throw new ReviewError(400, "只能导入词条与诠释者");
      if (input.kind === "new_term" && input.content?.trim()) throw new ReviewError(400, "词条导入只接受导航信息；请另行创建具名诠释者视角来提交正文");
      let imported = input;
      if (input.pageId !== undefined) {
        const page = await lockLivePage(tx, requiredInt(input.pageId, "pageId 必须是正整数"));
        if (page.type !== (input.kind === "new_term" ? "term" : "interpreter")) throw new ReviewError(400, "导入目标类型不匹配");
        const [value] = page.type === "term" ? await tx.select().from(terms).where(eq(terms.pageId, page.id)) : await tx.select().from(interpreters).where(eq(interpreters.pageId, page.id));
        const [head] = await tx.select().from(revisions).where(eq(revisions.pageId, page.id)).orderBy(desc(revisions.id)).limit(1);
        const snapshot: MetadataSnapshot = page.type === "term"
          ? termSnapshot({ title: page.title, summary: value.summary, aliases: "aliases" in value ? value.aliases : [], keyTexts: value.keyTexts })
          : { version: 1, type: "interpreter", title: page.title, summary: value.summary, keyTexts: value.keyTexts };
        const baseRevisionId = head?.snapshot ? head.id : (await tx.insert(revisions).values({ pageId: page.id, content: infoboxSnapshot(snapshot), snapshot, source: "baseline" }).returning({ id: revisions.id }))[0].id;
        imported = { ...input, kind: "edit", summary: input.summary ?? value.summary, aliases: input.aliases ?? ("aliases" in value ? value.aliases : []), baseRevisionId };
      }
      const validated = await validateSubmissionInput(tx, imported, actor);
      await validateImageReferences(tx, validated.content, actor);
      const applied = await applySubmission(tx, { ...validated, submittedBy: actor.id }, "direct");
      results.push({ pageId: applied.pageId, href: pagePath(input.kind === "new_term" ? "term" : "interpreter", slugifyTitle(validated.title!), applied.pageId) });
    }
    // 本批页面都存在后再解析一次，避免先写视角留下指向后写词条的红链。
    const rootIds = results.map((result) => result.pageId);
    const children = await tx.select({ id: perspectives.pageId }).from(perspectives).where(inArray(perspectives.termId, rootIds));
    const snapshots = await tx.select().from(revisions).where(inArray(revisions.pageId, [...rootIds, ...children.map((child) => child.id)]));
    for (const snapshot of snapshots) await rebuildPageLinks(tx, snapshot.pageId, snapshot.content);
    return results;
  });
}

// ---------------------------------------------------------------------------
// 受理 / 驳回（状态机转移）
// ---------------------------------------------------------------------------

/** 页面当前 head 修订 id；无修订返回 null。 */
async function headRevisionId(db: DbOrTx, pageId: number): Promise<number | null> {
  const [row] = await db
    .select({ id: revisions.id })
    .from(revisions)
    .where(eq(revisions.pageId, pageId))
    .orderBy(desc(revisions.id))
    .limit(1);
  return row?.id ?? null;
}

async function approveCountOf(db: DbOrTx, submissionId: number): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)`.mapWith(Number) })
    .from(submissionVotes)
    .where(
      and(
        eq(submissionVotes.submissionId, submissionId),
        eq(submissionVotes.vote, "approve"),
      ),
    );
  return row.count;
}

/**
 * 管理员对提交投票：approve = 批准票（顺序批准，凑满 quorum 即时生效）；
 * reject = 驳回（必填理由，任一驳回即终态）。整段原子——投票、状态翻转、
 * 生效应用要么全部落盘，要么全部回滚。
 */
export async function reviewSubmission(
  submissionId: number,
  actor: Actor,
  action: "approve" | "reject",
  reason?: string,
): Promise<ReviewOutcome> {
  if (!hasAdminRole(actor.role)) throw new ReviewError(403, "需要管理员角色");
  const db = getDb();

  return transactionWithSearchSync(db, async (tx) => {
    // 行锁串行化同一提交上的并发投票，杜绝两次凑票双双「成为决定票」
    const [sub] = await tx
      .select()
      .from(submissions)
      .where(eq(submissions.id, submissionId))
      .limit(1)
      .for("update");
    if (!sub) throw new ReviewError(404, "提交不存在");
    if (sub.status !== "pending") {
      throw new ReviewError(409, `提交已进入终态（${sub.status}），不能再投票`);
    }

    const [existingVote] = await tx
      .select({ id: submissionVotes.id })
      .from(submissionVotes)
      .where(
        and(
          eq(submissionVotes.submissionId, submissionId),
          eq(submissionVotes.adminId, actor.id),
        ),
      )
      .limit(1);
    if (existingVote) throw new ReviewError(409, "已对该提交投过票");

    if (action === "reject") {
      // 驳回不做「不能审自己」限制：提交者晋升为管理员后驳回自己的旧提交
      // 等价于撤回——那恰恰是唯一能终结名下悬挂提交的出口（之后可重提/直编）。
      if (!reason?.trim()) throw new ReviewError(400, "驳回必须填写理由");
      await tx.insert(submissionVotes).values({
        submissionId,
        adminId: actor.id,
        vote: "reject",
        reason,
      });
      await tx
        .update(submissions)
        .set({ status: "rejected", rejectionReason: reason, decidedAt: new Date() })
        .where(eq(submissions.id, submissionId));
      await tx.insert(notifications).values({ submissionId });
      return { outcome: "rejected", staleBase: false, message: "已驳回" };
    }

    if (sub.submittedBy === actor.id) {
      throw new ReviewError(403, "不能受理自己提交的内容");
    }

    if (sub.kind === "new_perspective") {
      const parents = await lockPerspectiveParents(tx, sub.termId!, sub.interpreterId!);
      if (!parents.available) {
        const message = `系统驳回：${parents.reason}`;
        await tx.update(submissions)
          .set({ status: "rejected", rejectionReason: message, decidedAt: new Date() })
          .where(eq(submissions.id, submissionId));
        await tx.insert(notifications).values({ submissionId });
        return { outcome: "rejected", staleBase: false, message };
      }
    }

    // 并发防护（ADR-0004 #2）：受理时页面 head ≠ base → 该票无法通过，
    // 自动驳回并提示提交者基于新版重新提交（rebase）。系统驳回不记投票。
    if (sub.kind === "edit") {
      await lockLivePage(tx, sub.pageId!);
      const headId = await headRevisionId(tx, sub.pageId!);
      if (headId !== sub.baseRevisionId) {
        const message =
          "页面在提交后已有新的修订（base 过期）：请基于当前版本修改后重新提交。";
        await tx
          .update(submissions)
          .set({ status: "rejected", rejectionReason: message, decidedAt: new Date() })
          .where(eq(submissions.id, submissionId));
        await tx.insert(notifications).values({ submissionId });
        return { outcome: "rejected", staleBase: true, message };
      }
    }

    await tx
      .insert(submissionVotes)
      .values({ submissionId, adminId: actor.id, vote: "approve" });
    const approveCount = await approveCountOf(tx, submissionId);
    if (approveCount < sub.quorum) {
      return { outcome: "pending", approveCount, quorum: sub.quorum };
    }

    // quorum 凑满：即时生效（产生修订 → 重建 links），提交进入 approved 终态
    await applySubmission(tx, sub);
    await tx
      .update(submissions)
      .set({ status: "approved", decidedAt: new Date() })
      .where(eq(submissions.id, submissionId));
    await tx.insert(notifications).values({ submissionId });
    return { outcome: "approved" };
  });
}

// ---------------------------------------------------------------------------
// 生效管线：产生修订 → 重建 links（受理与管理员直编共用，ADR-0004 #9）
// ---------------------------------------------------------------------------

interface AppliableSubmission {
  keyTexts?: KeyText[] | null;
  aliases?: string[];
  kind: SubmissionKind;
  pageId: number | null;
  content: string;
  title: string | null;
  summary: string | null;
  termId: number | null;
  interpreterId: number | null;
  submittedBy: string;
  baseRevisionId: number | null;
}

/** 与回滚、软删除共用页面锁，锁内检查在线状态。 */
export async function lockLivePage(tx: Tx, pageId: number) {
  const [page] = await tx.select().from(pages).where(eq(pages.id, pageId)).for("update");
  if (!page || page.deletedAt) throw new ReviewError(404, "目标页面不存在或已删除");
  return page;
}

/** 产生一个全量修订快照并重建该页 links，登记索引同步（提交后落索引）。返回新修订 id。 */
export async function applyContentChange(
  tx: Tx,
  pageId: number,
  content: string,
  rollbackFromId: number | null = null,
  attribution: { createdBy?: string; source?: RevisionSource } = {},
): Promise<number> {
  await publishImageReferences(tx, content);
  const [revision] = await tx
    .insert(revisions)
    .values({ pageId, content, rollbackFromId, ...attribution, source: rollbackFromId ? "rollback" : attribution.source ?? "legacy", createdAt: new Date() })
    .returning({ id: revisions.id });
  await rebuildPageLinks(tx, pageId, content);
  await tx.update(pages).set({ updatedAt: new Date() }).where(eq(pages.id, pageId));
  queueSearchSync(tx, pageId);
  return revision.id;
}

/** Apply metadata without interpreting it as Markdown. Caller holds the page lock. */
export async function applyTermMetadataChange(
  tx: Tx,
  pageId: number,
  snapshot: TermSnapshot,
  rollbackFromId: number | null = null,
  attribution: { createdBy?: string; source?: RevisionSource } = {},
): Promise<number> {
  await tx.update(pages).set({ title: snapshot.title, slug: slugifyTitle(snapshot.title), updatedAt: new Date() }).where(eq(pages.id, pageId));
  const [current] = await tx.select().from(terms).where(eq(terms.pageId, pageId));
  snapshot = { ...snapshot, keyTexts: snapshot.keyTexts ?? current.keyTexts };
  await tx.update(terms).set({ summary: snapshot.summary, aliases: snapshot.aliases, keyTexts: snapshot.keyTexts }).where(eq(terms.pageId, pageId));
  // Keep a plain code-block projection for existing content readers; snapshot is authoritative.
  const [revision] = await tx.insert(revisions).values({ pageId, content: infoboxSnapshot(snapshot), snapshot, rollbackFromId, ...attribution, source: rollbackFromId ? "rollback" : attribution.source ?? "direct", createdAt: new Date() }).returning({ id: revisions.id });
  await rebuildPageLinks(tx, pageId, "");
  queueSearchSync(tx, pageId);
  // syncPages expands the term to its dependent perspective/discussion documents.
  return revision.id;
}

/** Legacy/imported rows gain one honest baseline from current fields, under the page lock. */
export async function applyInterpreterMetadataChange(tx: Tx, pageId: number, snapshot: InterpreterSnapshot, rollbackFromId: number | null = null, attribution: { createdBy?: string; source?: RevisionSource } = {}) {
  const [duplicate] = await tx.select({ id: pages.id }).from(pages).where(and(eq(pages.type, "interpreter"), eq(pages.title, snapshot.title), isNull(pages.deletedAt), sql`${pages.id} <> ${pageId}`));
  if (duplicate) throw new ReviewError(409, "同名诠释者已存在");
  const [current] = await tx.select().from(interpreters).where(eq(interpreters.pageId, pageId));
  snapshot = { ...snapshot, keyTexts: snapshot.keyTexts ?? current.keyTexts };
  await tx.update(pages).set({ title: snapshot.title, slug: slugifyTitle(snapshot.title), updatedAt: new Date() }).where(eq(pages.id, pageId));
  await tx.update(interpreters).set({ summary: snapshot.summary, keyTexts: snapshot.keyTexts }).where(eq(interpreters.pageId, pageId));
  const [revision] = await tx.insert(revisions).values({ pageId, content: infoboxSnapshot(snapshot), snapshot, rollbackFromId, ...attribution, source: rollbackFromId ? "rollback" : attribution.source ?? "direct" }).returning({ id: revisions.id });
  await rebuildPageLinks(tx, pageId, "");
  queueSearchSync(tx, pageId);
  return revision.id;
}

export async function getInterpreterEditingState(pageId: number) {
  return getDb().transaction(async (tx) => {
    const page = await lockLivePage(tx, pageId);
    if (page.type !== "interpreter") throw new ReviewError(400, "目标必须是诠释者");
    const [value] = await tx.select().from(interpreters).where(eq(interpreters.pageId, pageId));
    const snapshot: InterpreterSnapshot = { version: 1, type: "interpreter", title: page.title, summary: value.summary, keyTexts: value.keyTexts };
    const [head] = await tx.select().from(revisions).where(eq(revisions.pageId, pageId)).orderBy(desc(revisions.id)).limit(1);
    if (head?.snapshot) return { snapshot, baseRevisionId: head.id };
    const [baseline] = await tx.insert(revisions).values({ pageId, content: infoboxSnapshot(snapshot), snapshot, source: "baseline" }).returning({ id: revisions.id });
    return { snapshot, baseRevisionId: baseline.id };
  });
}

export async function getTermEditingState(pageId: number) {
  return getDb().transaction(async (tx) => {
    const page = await lockLivePage(tx, pageId);
    if (page.type !== "term") throw new ReviewError(400, "目标必须是词条");
    const [term] = await tx.select().from(terms).where(eq(terms.pageId, pageId));
    if (!term) throw new ReviewError(404, "词条不存在");
    const snapshot = termSnapshot({ title: page.title, summary: term.summary, aliases: term.aliases, keyTexts: term.keyTexts });
    const [head] = await tx.select().from(revisions).where(eq(revisions.pageId, pageId)).orderBy(desc(revisions.id)).limit(1);
    if (head?.snapshot) return { snapshot, baseRevisionId: head.id };
    const [baseline] = await tx.insert(revisions).values({ pageId, content: "", snapshot, source: "baseline", createdAt: new Date() }).returning({ id: revisions.id });
    return { snapshot, baseRevisionId: baseline.id };
  });
}

/** 信息框是纯文本元数据，快照用 Markdown 代码块，不能被解释成正文图片或双链。 */
function infoboxSnapshot(value: { title: string | null; summary: string; aliases?: string[] }) {
  return `\`\`\`json\n${JSON.stringify(value)}\n\`\`\``;
}

/** 把一条（已验证的）提议落为现实：建页/产生修订/重建 links。 */
async function applySubmission(
  tx: Tx,
  sub: AppliableSubmission,
  source: "direct" | "approval" = "approval",
): Promise<{ pageId: number }> {
  switch (sub.kind) {
    case "edit": {
      const page = await lockLivePage(tx, sub.pageId!);
      if (await headRevisionId(tx, sub.pageId!) !== sub.baseRevisionId) {
        throw new ReviewError(409, "页面已有新的修订，请基于当前修订重新编辑");
      }
      if (page.type === "term") {
        await applyTermMetadataChange(tx, sub.pageId!, termSnapshot({ title: sub.title!, summary: sub.summary ?? "", aliases: sub.aliases ?? [], keyTexts: sub.keyTexts ?? undefined }), null, { source, createdBy: sub.submittedBy });
      } else if (page.type === "interpreter") {
        await applyInterpreterMetadataChange(tx, page.id, { version: 1, type: "interpreter", title: sub.title!, summary: sub.summary ?? "", keyTexts: sub.keyTexts ?? undefined }, null, { source, createdBy: sub.submittedBy });
      } else {
        await applyContentChange(tx, sub.pageId!, sub.content, null, { source, createdBy: sub.submittedBy });
      }
      return { pageId: sub.pageId! };
    }
    case "new_term": {
      if (sub.content.trim()) throw new ReviewError(400, "新词条只接受导航信息；请另行提交视角正文");
      const [page] = await tx
        .insert(pages)
        .values({
          type: "term",
          title: sub.title!,
          slug: slugifyTitle(sub.title!),
          createdBy: sub.submittedBy,
        })
        .returning({ id: pages.id });
      await tx.insert(terms).values({ pageId: page.id, summary: sub.summary ?? "", aliases: sub.aliases ?? [], keyTexts: sub.keyTexts ?? undefined });
      await applyTermMetadataChange(tx, page.id, termSnapshot({ title: sub.title!, summary: sub.summary ?? "", aliases: sub.aliases ?? [], keyTexts: sub.keyTexts ?? undefined }), null, { source: "create", createdBy: sub.submittedBy });
      return { pageId: page.id };
    }
    case "new_interpreter": {
      const [page] = await tx
        .insert(pages)
        .values({
          type: "interpreter",
          title: sub.title!,
          slug: slugifyTitle(sub.title!),
          createdBy: sub.submittedBy,
        })
        .returning({ id: pages.id });
      await tx
        .insert(interpreters)
        .values({ pageId: page.id, summary: sub.summary ?? "" });
      await applyInterpreterMetadataChange(tx, page.id, { version: 1, type: "interpreter", title: sub.title!, summary: sub.summary ?? "", keyTexts: sub.keyTexts ?? [] }, null, { source: "create", createdBy: sub.submittedBy });
      return { pageId: page.id };
    }
    case "new_perspective": {
      const parents = await lockPerspectiveParents(tx, sub.termId!, sub.interpreterId!);
      if (!parents.available) throw new ReviewError(404, parents.reason);
      const title = `${parents.interpreter.title}论${parents.term.title}`;
      const [page] = await tx
        .insert(pages)
        .values({
          type: "perspective",
          title,
          slug: slugifyTitle(title),
          createdBy: sub.submittedBy,
        })
        .returning({ id: pages.id });
      await tx.insert(perspectives).values({
        pageId: page.id,
        termId: sub.termId!,
        interpreterId: sub.interpreterId!,
      });
      await applyContentChange(tx, page.id, sub.content, null, { source: "create", createdBy: sub.submittedBy });
      return { pageId: page.id };
    }
  }
}

// ---------------------------------------------------------------------------
// 审核队列（读路径）
// ---------------------------------------------------------------------------

export interface QueueItem {
  keyTexts: KeyText[] | null;
  currentMetadata: MetadataSnapshot | null;
  aliases: string[];
  id: number;
  kind: SubmissionKind;
  status: SubmissionStatus;
  submitterName: string;
  createdAt: Date;
  quorum: number;
  /** 已投的批准票（pending 下投票只能是批准票） */
  approverNames: string[];
  /** kind=edit：目标页信息与链接；新建类为 null */
  targetTitle: string | null;
  targetHref: string | null;
  baseRevisionId: number | null;
  /** base 过期（head ≠ base）：受理将自动驳回并提示重新提交 */
  staleBase: boolean;
  /** 编辑对象的当前内容（diff 的「当前版」一侧）；新建类为 null */
  currentContent: string | null;
  content: string;
  title: string | null;
  summary: string | null;
  /** kind=new_perspective：挂载描述 */
  termTitle: string | null;
  interpreterName: string | null;
}

/** 审核队列：全部 pending 提交（含 diff 两侧内容、票数与 base 过期标记）。 */
export async function listQueue(): Promise<QueueItem[]> {
  const db = getDb();
  const rows = await db
    .select({
      id: submissions.id,
      kind: submissions.kind,
      status: submissions.status,
      submitterName: user.name,
      createdAt: submissions.createdAt,
      quorum: submissions.quorum,
      pageId: submissions.pageId,
      baseRevisionId: submissions.baseRevisionId,
      content: submissions.content,
      title: submissions.title,
      summary: submissions.summary,
      aliases: submissions.aliases,
      keyTexts: submissions.keyTexts,
      termId: submissions.termId,
      interpreterId: submissions.interpreterId,
    })
    .from(submissions)
    .innerJoin(user, eq(user.id, submissions.submittedBy))
    .where(eq(submissions.status, "pending"))
    .orderBy(asc(submissions.id));
  if (rows.length === 0) return [];

  const ids = rows.map((row) => row.id);
  const votes = await db
    .select({ submissionId: submissionVotes.submissionId, adminName: user.name })
    .from(submissionVotes)
    .innerJoin(user, eq(user.id, submissionVotes.adminId))
    .where(
      and(
        inArray(submissionVotes.submissionId, ids),
        eq(submissionVotes.vote, "approve"),
      ),
    );
  const approvers = new Map<number, string[]>();
  for (const vote of votes) {
    approvers.set(vote.submissionId, [...(approvers.get(vote.submissionId) ?? []), vote.adminName]);
  }

  // 编辑类的目标页 + head 修订（staleness 与 diff 旧侧）
  const editPageIds = rows
    .filter((row) => row.kind === "edit" && row.pageId !== null)
    .map((row) => row.pageId!);
  const editPages = editPageIds.length
    ? await db
        .select({
          id: pages.id,
          type: pages.type,
          title: pages.title,
          slug: pages.slug,
        })
        .from(pages)
        .where(inArray(pages.id, editPageIds))
    : [];
  const pageById = new Map(editPages.map((page) => [page.id, page]));
  const headIds = editPageIds.length
    ? await db
        .select({
          pageId: revisions.pageId,
          id: sql<number>`max(${revisions.id})`.mapWith(Number),
        })
        .from(revisions)
        .where(inArray(revisions.pageId, editPageIds))
        .groupBy(revisions.pageId)
    : [];
  const headByPage = new Map(headIds.map((row) => [row.pageId, row.id]));
  const headContents = headIds.length
    ? await db
        .select({ id: revisions.id, content: revisions.content })
        .from(revisions)
        .where(
          inArray(
            revisions.id,
            headIds.map((row) => row.id),
          ),
        )
    : [];
  const contentByRevision = new Map(headContents.map((row) => [row.id, row.content]));
  const termRows = editPageIds.length ? await db.select({ pageId: terms.pageId, title: pages.title, summary: terms.summary, aliases: terms.aliases, keyTexts: terms.keyTexts })
    .from(terms).innerJoin(pages, eq(pages.id, terms.pageId)).where(inArray(terms.pageId, editPageIds)) : [];
  const metadataByPage = new Map<number, MetadataSnapshot>(termRows.map((row) => [row.pageId, termSnapshot(row)]));

  const interpreterRows = editPageIds.length ? await db.select({ pageId: interpreters.pageId, title: pages.title, summary: interpreters.summary, keyTexts: interpreters.keyTexts }).from(interpreters).innerJoin(pages, eq(pages.id, interpreters.pageId)).where(inArray(interpreters.pageId, editPageIds)) : [];
  for (const row of interpreterRows) metadataByPage.set(row.pageId, { version: 1, type: "interpreter", ...row });

  // new_perspective 的挂载名称
  const mountPageIds = rows
    .flatMap((row) => [row.termId, row.interpreterId])
    .filter((id): id is number => id !== null);
  const mountPages = mountPageIds.length
    ? await db
        .select({ id: pages.id, title: pages.title })
        .from(pages)
        .where(inArray(pages.id, mountPageIds))
    : [];
  const titleById = new Map(mountPages.map((page) => [page.id, page.title]));

  return rows.map((row) => {
    const page = row.pageId !== null ? pageById.get(row.pageId) : undefined;
    const headId = row.pageId !== null ? headByPage.get(row.pageId) : undefined;
    return {
      currentMetadata: row.pageId ? metadataByPage.get(row.pageId) ?? null : null,
      id: row.id,
      kind: row.kind,
      status: row.status,
      submitterName: row.submitterName,
      createdAt: row.createdAt,
      quorum: row.quorum,
      approverNames: approvers.get(row.id) ?? [],
      targetTitle: page?.title ?? null,
      targetHref: page
        ? pagePath(page.type, page.slug, page.id)
        : null,
      baseRevisionId: row.baseRevisionId,
      staleBase: row.kind === "edit" && headId !== row.baseRevisionId,
      currentContent:
        row.kind === "edit" && headId !== undefined
          ? contentByRevision.get(headId) ?? null
          : null,
      content: row.content,
      title: row.title,
      summary: row.summary,
      aliases: row.aliases,
      keyTexts: row.keyTexts,
      termTitle: row.termId !== null ? titleById.get(row.termId) ?? null : null,
      interpreterName:
        row.interpreterId !== null
          ? titleById.get(row.interpreterId) ?? null
          : null,
    };
  });
}
