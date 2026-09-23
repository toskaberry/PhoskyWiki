// 页面双链的落库（写路径，ADR-0003 #4：解析发生在保存时）。
// 「产生修订 → 重建 links → 同步索引」是生效管线（ADR-0004 #8/#9）：
// 受理、管理员直编与回滚走这条路；软删除/恢复保留关系，由公开读取过滤。

import "server-only";

import { and, eq, inArray, isNull } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

import type { Db } from "@/db";
import { links, pages, perspectives } from "@/db/schema";
import { isPageVisible } from "@/lib/page-visibility";
import type { WikiLinkTarget } from "@/lib/markdown";
import { pagePath } from "@/lib/slug";
import { parseWikiLinks, wikiLinkKey, type ParsedWikiLink } from "@/lib/wiki-links";

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
type Reader = Db | Tx;

/**
 * 重建一页的全部真实双链：仍出现在正文的已解析名称键沿用目标 id，
 * 不因改名、旧名被复用或目标暂不可用而改变身份；新键与未解析红链按名称解析。
 * 默认链接落词条枢纽，
 * 显式视角链接按「词条 × 诠释者」定位视角页；未命中留名称快照即红链。
 */
export async function rebuildPageLinks(
  tx: Tx,
  pageId: number,
  content: string,
): Promise<void> {
  const refs = parseWikiLinks(content);
  const previous = await tx.select({ name: links.targetName, id: links.targetPageId })
    .from(links).where(eq(links.sourcePageId, pageId));
  const preserved = new Map(previous.map((link) => [link.name, link.id]));
  await tx.delete(links).where(eq(links.sourcePageId, pageId));
  if (refs.length === 0) return;

  const targetIds: (number | null)[] = [];
  for (const ref of refs) {
    // null 是真正未解析的红链，允许在目标创建后解析；隐藏目标的非空 id 必须保留。
    targetIds.push(preserved.get(wikiLinkKey(ref)) ?? await resolveLinkTarget(tx, ref));
  }
  await tx.insert(links).values(
    refs.map((ref, index) => ({
      sourcePageId: pageId,
      targetPageId: targetIds[index],
      targetName: wikiLinkKey(ref),
    })),
  );
}

async function resolveLinkTarget(
  tx: Reader,
  ref: ParsedWikiLink,
): Promise<number | null> {
  if (ref.interpreter === null) {
    // 同名解释都落在统一词条
    const [row] = await tx
      .select({ id: pages.id })
      .from(pages)
      .where(
        and(
          eq(pages.title, ref.term),
          isNull(pages.deletedAt),
          eq(pages.type, "term"),
        ),
      )
      .limit(1);
    return row?.id ?? null;
  }

  const termPage = alias(pages, "link_term_page");
  const interpreterPage = alias(pages, "link_interpreter_page");
  const perspectivePage = alias(pages, "link_perspective_page");
  const [row] = await tx
    .select({ id: perspectives.pageId })
    .from(perspectives)
    .innerJoin(termPage, eq(termPage.id, perspectives.termId))
    .innerJoin(interpreterPage, eq(interpreterPage.id, perspectives.interpreterId))
    .innerJoin(perspectivePage, eq(perspectivePage.id, perspectives.pageId))
    .where(
      and(
        eq(termPage.title, ref.term),
        eq(interpreterPage.title, ref.interpreter),
        isNull(termPage.deletedAt),
        isNull(interpreterPage.deletedAt),
        isNull(perspectivePage.deletedAt),
      ),
    )
    .limit(1);
  return row?.id ?? null;
}

/**
 * 未保存正文（编辑预览、审核提案预览）的双链落点，读路径版 rebuildPageLinks：
 * 既有 links 行按名称沿用目标身份（改名、旧名复用、暂不可用都不换目标），
 * 新键按名称解析；可见性与 getWikiLinkTargets 同口径。只读，不落库。
 */
export async function resolvePreviewWikiLinks(
  db: Reader,
  pageId: number | null,
  content: string,
): Promise<Map<string, WikiLinkTarget>> {
  const refs = parseWikiLinks(content);
  if (refs.length === 0) return new Map();

  const preserved = pageId === null ? new Map<string, number | null>() : new Map(
    (await db
      .select({ name: links.targetName, id: links.targetPageId })
      .from(links)
      .where(eq(links.sourcePageId, pageId)))
      .map((link) => [link.name, link.id]),
  );
  const targetIds = await Promise.all(
    refs.map((ref) => preserved.get(wikiLinkKey(ref)) ?? resolveLinkTarget(db, ref)),
  );

  const uniqueIds = [...new Set(targetIds.filter((id): id is number => id !== null))];
  const rows = uniqueIds.length
    ? await db
        .select({ id: pages.id, type: pages.type, slug: pages.slug, visible: isPageVisible(pages.id) })
        .from(pages)
        .where(inArray(pages.id, uniqueIds))
    : [];
  const pageById = new Map(rows.map((row) => [row.id, row]));

  return new Map(
    refs.map((ref, index) => {
      const id = targetIds[index];
      const row = id !== null ? pageById.get(id) : undefined;
      const exists = row !== undefined && row.visible;
      return [
        wikiLinkKey(ref),
        exists
          ? { href: pagePath(row.type!, row.slug!, row.id), exists: true }
          : { href: "", exists: false, ...(id !== null ? { unavailable: true } : {}) },
      ];
    }),
  );
}
