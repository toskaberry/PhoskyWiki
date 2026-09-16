import "server-only";

import { and, eq, inArray, isNull } from "drizzle-orm";
import { getDb } from "@/db";
import { pageComments, pages, passageThoughts, replies } from "@/db/schema";
import { isPageVisible } from "@/lib/page-visibility";
import { locateThoughtAnchor } from "@/lib/passage-thoughts";
import { pagePath } from "@/lib/slug";

export type PersonalRecordKind = "comment" | "thought" | "reply";
export type PersonalRecordStatus = "available" | "page-deleted" | "original-changed" | "thought-private" | "target-deleted";
export interface PersonalRecord {
  id: number;
  kind: PersonalRecordKind;
  content: string;
  createdAt: string;
  targetTitle: string;
  /** 目标页面 id（历史入口与跳转兜底用；页面已删除时仍保留 id）。 */
  pageId: number | null;
  quote: string | null;
  /** 感想发表时的基准修订（个人界面「查看原修订」入口用；评论与回复为空）。 */
  baseRevisionId: number | null;
  visibility: "public" | "private" | null;
  status: PersonalRecordStatus;
  href: string | null;
  /** 状态原因的补充说明（如「原始感想已转私密」），无原因时为 null。 */
  note: string | null;
}

/** Personal records deliberately retain inaccessible targets, but never expose parent content. */
export async function listMyRecords(userId: string, kind?: PersonalRecordKind): Promise<PersonalRecord[]> {
  const db = getDb();
  const [comments, thoughts, ownReplies] = await Promise.all([
    !kind || kind === "comment" ? db.select().from(pageComments).where(and(eq(pageComments.authorId, userId), isNull(pageComments.deletedAt))) : [],
    !kind || kind === "thought" ? db.select().from(passageThoughts).where(and(eq(passageThoughts.authorId, userId), isNull(passageThoughts.deletedAt))) : [],
    !kind || kind === "reply" ? db.select().from(replies).where(and(eq(replies.authorId, userId), isNull(replies.deletedAt))) : [],
  ]);
  const commentIds = ownReplies.filter(row => row.targetType === "page_comment").map(row => row.targetId);
  const thoughtIds = ownReplies.filter(row => row.targetType === "passage_thought").map(row => row.targetId);
  const [parentComments, parentThoughts] = await Promise.all([
    commentIds.length ? db.select({ id: pageComments.id, pageId: pageComments.pageId, deletedAt: pageComments.deletedAt }).from(pageComments).where(inArray(pageComments.id, commentIds)) : [],
    thoughtIds.length ? db.select({
      id: passageThoughts.id, pageId: passageThoughts.pageId, authorId: passageThoughts.authorId,
      visibility: passageThoughts.visibility, deletedAt: passageThoughts.deletedAt,
      baseRevisionId: passageThoughts.baseRevisionId, anchorStart: passageThoughts.anchorStart,
      anchorEnd: passageThoughts.anchorEnd, quote: passageThoughts.quote,
    }).from(passageThoughts).where(inArray(passageThoughts.id, thoughtIds)) : [],
  ]);
  const pageIds = [...new Set([...comments, ...thoughts, ...parentComments, ...parentThoughts].map(row => row.pageId))];
  if (!pageIds.length) return [];
  const targets = await db.select({ id: pages.id, title: pages.title, type: pages.type, slug: pages.slug, visible: isPageVisible(pages.id) })
    .from(pages).where(inArray(pages.id, pageIds));
  const targetMap = new Map(targets.map(row => [row.id, row]));
  const commentMap = new Map(parentComments.map(row => [row.id, row]));
  const thoughtMap = new Map(parentThoughts.map(row => [row.id, row]));
  const anchors = new Map<number, Promise<Awaited<ReturnType<typeof locateThoughtAnchor>>>>();
  function locate(row: (typeof parentThoughts)[number]) {
    let value = anchors.get(row.id);
    if (!value) { value = locateThoughtAnchor(row, db); anchors.set(row.id, value); }
    return value;
  }
  function target(pageId: number | undefined, anchor: string): Pick<PersonalRecord, "targetTitle" | "status" | "href" | "pageId"> {
    const page = pageId === undefined ? undefined : targetMap.get(pageId);
    return {
      targetTitle: page?.title ?? "目标页面已删除",
      pageId: pageId ?? null,
      status: page?.visible ? "available" : "page-deleted",
      href: page?.visible ? `${pagePath(page.type, page.slug, page.id)}#${anchor}` : null,
    };
  }
  const records: PersonalRecord[] = comments.map(row => ({
    id: row.id, kind: "comment", content: row.content, createdAt: row.createdAt.toISOString(),
    quote: null, baseRevisionId: null, visibility: null, note: null, ...target(row.pageId, `comment-${row.id}`),
  }));
  for (const row of thoughts) {
    const link = target(row.pageId, `thought-${row.id}`);
    let note: string | null = null;
    if (link.status === "available" && (await locate(row)).status !== "located") {
      link.status = "original-changed"; link.href = null;
      note = "标记所依据的原文已修订，无法定位到当前正文（发表时的引用仍保留）";
    }
    records.push({
      id: row.id, kind: "thought", content: row.content, createdAt: row.createdAt.toISOString(),
      quote: row.quote, baseRevisionId: row.baseRevisionId, visibility: row.visibility, note, ...link,
    });
  }
  for (const row of ownReplies) {
    const isThought = row.targetType === "passage_thought";
    const parentThought = isThought ? thoughtMap.get(row.targetId) : undefined;
    const parent = isThought ? parentThought : commentMap.get(row.targetId);
    const link = target(parent?.pageId, `${isThought ? "thought" : "comment"}-${row.targetId}`);
    let note: string | null = null;
    if (link.status === "available") {
      if (!parent || parent.deletedAt) { link.status = "target-deleted"; note = "所回复的内容已被删除，你的回复仍保留"; }
      else if (parentThought?.visibility === "private" && parentThought.authorId !== userId) {
        link.status = "thought-private"; note = "所回复的感想已转为仅作者可见，你的回复仍保留在个人记录里";
      } else if (parentThought && (await locate(parentThought)).status !== "located") {
        link.status = "original-changed"; note = "所回复的感想原文已修订，无法定位到当前正文（引用仍保留）";
      }
      if (link.status !== "available") link.href = null;
    }
    // Replies contain only their own text, never the parent's quote or content.
    records.push({
      id: row.id, kind: "reply", content: row.content, createdAt: row.createdAt.toISOString(),
      quote: null, baseRevisionId: null, visibility: null, note, ...link,
    });
  }
  return records.sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id - a.id || a.kind.localeCompare(b.kind));
}
