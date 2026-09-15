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
  quote: string | null;
  visibility: "public" | "private" | null;
  status: PersonalRecordStatus;
  href: string | null;
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
  function target(pageId: number | undefined, anchor: string): Pick<PersonalRecord, "targetTitle" | "status" | "href"> {
    const page = pageId === undefined ? undefined : targetMap.get(pageId);
    return {
      targetTitle: page?.title ?? "目标页面已删除",
      status: page?.visible ? "available" : "page-deleted",
      href: page?.visible ? `${pagePath(page.type, page.slug, page.id)}#${anchor}` : null,
    };
  }
  const records: PersonalRecord[] = comments.map(row => ({
    id: row.id, kind: "comment", content: row.content, createdAt: row.createdAt.toISOString(),
    quote: null, visibility: null, ...target(row.pageId, `comment-${row.id}`),
  }));
  for (const row of thoughts) {
    const link = target(row.pageId, `thought-${row.id}`);
    if (link.status === "available" && (await locate(row)).status !== "located") {
      link.status = "original-changed"; link.href = null;
    }
    records.push({ id: row.id, kind: "thought", content: row.content, createdAt: row.createdAt.toISOString(), quote: row.quote, visibility: row.visibility, ...link });
  }
  for (const row of ownReplies) {
    const isThought = row.targetType === "passage_thought";
    const parentThought = isThought ? thoughtMap.get(row.targetId) : undefined;
    const parent = isThought ? parentThought : commentMap.get(row.targetId);
    const link = target(parent?.pageId, `${isThought ? "thought" : "comment"}-${row.targetId}`);
    if (link.status === "available") {
      if (!parent || parent.deletedAt) link.status = "target-deleted";
      else if (parentThought?.visibility === "private" && parentThought.authorId !== userId) link.status = "thought-private";
      else if (parentThought && (await locate(parentThought)).status !== "located") link.status = "original-changed";
      if (link.status !== "available") link.href = null;
    }
    // Replies contain only their own text, never the parent's quote or content.
    records.push({ id: row.id, kind: "reply", content: row.content, createdAt: row.createdAt.toISOString(), quote: null, visibility: null, ...link });
  }
  return records.sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id - a.id || a.kind.localeCompare(b.kind));
}
