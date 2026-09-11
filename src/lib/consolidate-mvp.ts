import "server-only";

import { and, asc, eq, inArray, isNotNull, or, sql } from "drizzle-orm";
import { getDb, type Db } from "@/db";
import { discussionPosts, links, pages, perspectives, revisions, submissions, termCategories, termDiscussions, terms } from "@/db/schema";
import { applyContentChange, applyTermMetadataChange } from "@/lib/review";
import { isPageVisible } from "@/lib/page-visibility";
import { prepareConsolidationLinks, preserveConsolidatedTargets } from "@/lib/consolidation-links";
import { rebuildPageLinks } from "@/lib/page-links";
import { slugify } from "@/lib/slug";
import { reindexAll } from "@/lib/search/search-sync";
import { termSnapshot } from "@/lib/revision-snapshot";

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
export interface MergeGroup { title: string; sourceTitles: string[] }
/** 已明确的领域归并，不根据括号猜测其他概念。 */
export const mvpMergeGroups: MergeGroup[] = [{ title: "价值", sourceTitles: ["价值（政治经济学）", "价值（哲学）"] }];

async function plan(tx: Tx, groups: MergeGroup[]) {
  const inventory = await tx.select({ id: pages.id, title: pages.title, type: pages.type, visible: isPageVisible(pages.id) }).from(pages).orderBy(asc(pages.id));
  const hiddenIds = inventory.filter(p => !p.visible).map(p => p.id);
  const hidden = new Set(hiddenIds);
  const memberships = await tx.select().from(perspectives);
  const merges = groups.flatMap(group => {
    const roots = inventory.filter(p => p.type === "term" && p.visible && (p.title === group.title || group.sourceTitles.includes(p.title)));
    if (!roots.length || (roots.length === 1 && roots[0].title === group.title)) return [];
    const keep = roots.find(p => p.title === group.title) ?? roots[0];
    const rootIds = roots.map(p => p.id);
    const children = memberships.filter(p => rootIds.includes(p.termId) && !hidden.has(p.pageId));
    const byInterpreter = new Map<number, typeof children>();
    for (const child of children) byInterpreter.set(child.interpreterId, [...(byInterpreter.get(child.interpreterId) ?? []), child]);
    const perspectives = [...byInterpreter.values()].map(items => {
      items.sort((a, b) => Number(b.termId === keep.id) - Number(a.termId === keep.id) || a.pageId - b.pageId);
      return { keepId: items[0].pageId, items };
    });
    return [{ title: group.title, keepId: keep.id, roots, perspectives }];
  });
  const obsoleteIds = inventory.filter(p => p.type === "disambiguation").map(p => p.id);
  const claimedRoots = new Set<number>();
  for (const merge of merges) {
    for (const root of merge.roots) {
      if (claimedRoots.has(root.id)) throw new Error(`词条 ${root.id} 出现在多个归并组中，未执行整理`);
      claimedRoots.add(root.id);
    }
    obsoleteIds.push(...merge.roots.filter(p => p.id !== merge.keepId).map(p => p.id));
    for (const perspective of merge.perspectives) obsoleteIds.push(...perspective.items.slice(1).map(p => p.pageId));
  }
  const removeIds = [...new Set([...hiddenIds, ...obsoleteIds])];
  const removedPosts = await tx.select({ id: discussionPosts.id }).from(discussionPosts).where(or(isNotNull(discussionPosts.deletedAt), removeIds.length ? inArray(discussionPosts.termId, hiddenIds) : undefined));
  const removedRevisions = removeIds.length ? await tx.select({ id: revisions.id }).from(revisions).where(inArray(revisions.pageId, removeIds)) : [];
  const removedSubmissions = removeIds.length ? await tx.select({ id: submissions.id }).from(submissions).where(or(inArray(submissions.pageId, removeIds), inArray(submissions.termId, removeIds), inArray(submissions.interpreterId, removeIds))) : [];
  return { merges, hiddenIds, obsoleteIds, removeIds, removedPosts: removedPosts.map(p => p.id), removedRevisions: removedRevisions.map(r => r.id), removedSubmissions: removedSubmissions.map(s => s.id) };
}

async function purge(tx: Tx, ids: number[]) {
  if (!ids.length) return;
  const removedSubmissions = await tx.select({ id: submissions.id }).from(submissions).where(or(inArray(submissions.pageId, ids), inArray(submissions.termId, ids), inArray(submissions.interpreterId, ids)));
  if (removedSubmissions.length) {
    const subIds = removedSubmissions.map(s => s.id);
    await tx.update(submissions).set({ supersedesId: null }).where(inArray(submissions.supersedesId, subIds));
    await tx.delete(submissions).where(inArray(submissions.id, subIds));
  }
  const revIds = (await tx.select({ id: revisions.id }).from(revisions).where(inArray(revisions.pageId, ids))).map(r => r.id);
  if (revIds.length) {
    await tx.update(revisions).set({ rollbackFromId: null }).where(inArray(revisions.rollbackFromId, revIds));
    await tx.update(submissions).set({ baseRevisionId: null }).where(inArray(submissions.baseRevisionId, revIds));
  }
  await tx.update(links).set({ targetPageId: null }).where(inArray(links.targetPageId, ids));
  await tx.delete(pages).where(inArray(pages.id, ids));
}

/** 小型 Wiki 的一次性运维事务；锁住内容表后重新盘点，失败整批回滚。 */
export async function consolidateMvp(apply = false, groups = mvpMergeGroups) {
  const report = await getDb().transaction(async tx => {
    await tx.execute(sql`set local lock_timeout = '5s'`);
    if (apply) await tx.execute(sql`lock table pages, terms, interpreters, perspectives, revisions, submissions, submission_votes, links, discussion_posts, term_discussions, term_categories in share row exclusive mode`);
    const planned = await plan(tx, groups);
    const report = { applied: apply, groups: planned.merges.map(g => ({ title: g.title, keepId: g.keepId, sourceIds: g.roots.map(p => p.id), perspectiveCount: g.perspectives.length })), hiddenPages: planned.hiddenIds.length, obsoletePages: planned.obsoleteIds.length, removedPages: planned.removeIds.length, removedPosts: planned.removedPosts.length, removedRevisions: planned.removedRevisions.length, removedSubmissions: planned.removedSubmissions.length };
    if (!apply) return report;
    const names = new Map<string, string>();
    const ids = new Map<number, number>();
    const titles = new Map<number, string>();
    for (const group of planned.merges) {
      titles.set(group.keepId, group.title);
      for (const root of group.roots) { names.set(root.title, group.title); ids.set(root.id, group.keepId); }
      for (const perspective of group.perspectives) {
        const [interpreter] = await tx.select().from(pages).where(eq(pages.id, perspective.items[0].interpreterId));
        titles.set(perspective.keepId, `${interpreter.title}论${group.title}`);
        for (const item of perspective.items) ids.set(item.pageId, perspective.keepId);
      }
    }
    for (const old of await tx.select().from(pages).where(eq(pages.type, "disambiguation"))) {
      const [term] = await tx.select().from(pages).where(and(eq(pages.type, "term"), eq(pages.title, old.title)));
      const keepId = planned.merges.find(g => g.title === old.title)?.keepId ?? term?.id;
      if (keepId !== undefined && !planned.removeIds.includes(keepId)) ids.set(old.id, keepId);
    }
    const combinedSources = new Set(planned.merges.flatMap(group => group.perspectives.filter(p => p.items.length > 1).flatMap(p => p.items.map(item => item.pageId))));
    const prepared = await prepareConsolidationLinks(tx, ids, titles, names, new Set(planned.removeIds), combinedSources);
    const combined = new Set<number>();
    if (planned.removedPosts.length) {
      // 被删楼层下的公开回复提升为楼层，保留文字；不复活被删除正文。
      await tx.update(discussionPosts).set({ parentId: null }).where(inArray(discussionPosts.parentId, planned.removedPosts));
      await tx.delete(discussionPosts).where(inArray(discussionPosts.id, planned.removedPosts));
    }
    await purge(tx, planned.hiddenIds);
    for (const group of planned.merges) {
      const payloads = await tx.select().from(terms).where(inArray(terms.pageId, group.roots.map(p => p.id)));
      const keep = payloads.find(t => t.pageId === group.keepId)!;
      await applyTermMetadataChange(tx, group.keepId, termSnapshot({ title: group.title, summary: [...new Set(payloads.map(t => t.summary).filter(Boolean))].join("\n"), aliases: [...new Set(payloads.flatMap(t => t.aliases))], keyTexts: [...new Map(payloads.flatMap(t => t.keyTexts).map(t => [JSON.stringify(t), t])).values()] }));
      for (const perspective of group.perspectives) {
        let content = "";
        const targets = new Map<string, number | null>();
        for (const item of perspective.items) {
          const source = prepared.get(item.pageId);
          if (!source) throw new Error(`视角 ${item.pageId} 缺少正文修订，未执行归并`);
          for (const [name, id] of source.targets) targets.set(name, id);
          content += `${content ? "\n\n" : ""}## ${group.roots.find(r => r.id === item.termId)!.title}\n\n${source.content}`;
          await tx.update(discussionPosts).set({ perspectiveId: perspective.keepId }).where(eq(discussionPosts.perspectiveId, item.pageId));
        }
        const [interpreter] = await tx.select().from(pages).where(eq(pages.id, perspective.items[0].interpreterId));
        const title = `${interpreter.title}论${group.title}`;
        await tx.update(pages).set({ title, slug: slugify(title) }).where(eq(pages.id, perspective.keepId));
        if (perspective.items.length > 1) {
          await preserveConsolidatedTargets(tx, perspective.keepId, targets);
          await applyContentChange(tx, perspective.keepId, content, null, { source: "direct" });
          combined.add(perspective.keepId);
        }
      }
      const rootIds = group.roots.map(r => r.id);
      const categories = await tx.select().from(termCategories).where(inArray(termCategories.termId, rootIds));
      for (const category of categories) await tx.insert(termCategories).values({ termId: group.keepId, categoryId: category.categoryId }).onConflictDoNothing();
      const [locked] = await tx.select().from(termDiscussions).where(and(inArray(termDiscussions.termId, rootIds), isNotNull(termDiscussions.lockedAt))).limit(1);
      if (locked) await tx.insert(termDiscussions).values({ ...locked, termId: group.keepId }).onConflictDoUpdate({ target: termDiscussions.termId, set: { lockedAt: locked.lockedAt, lockedBy: locked.lockedBy } });
      await tx.update(discussionPosts).set({ termId: group.keepId }).where(inArray(discussionPosts.termId, rootIds));
      // 重复身份删除后再归属，以遵守词条 × 诠释者唯一约束。
      const duplicates = group.perspectives.flatMap(p => p.items.slice(1).map(i => i.pageId));
      for (const [oldId, newId] of ids) if (oldId !== newId) await tx.update(links).set({ targetPageId: newId }).where(eq(links.targetPageId, oldId));
      await purge(tx, duplicates);
      for (const perspective of group.perspectives) await tx.update(perspectives).set({ termId: keep.pageId }).where(eq(perspectives.pageId, perspective.keepId));
    }
    for (const [oldId, newId] of ids) if (oldId !== newId) await tx.update(links).set({ targetPageId: newId }).where(eq(links.targetPageId, oldId));
    await purge(tx, planned.obsoleteIds);
    const remaining = await tx.select().from(pages).where(isPageVisible(pages.id));
    for (const page of remaining) {
      const source = prepared.get(page.id);
      if (!source || combined.has(page.id)) continue;
      await preserveConsolidatedTargets(tx, page.id, source.targets);
      if (source.content !== source.original) await applyContentChange(tx, page.id, source.content, null, { source: "direct" });
      else await rebuildPageLinks(tx, page.id, source.content);
    }
    return report;
  }, { isolationLevel: "repeatable read" });
  if (apply) await reindexAll();
  return report;
}
