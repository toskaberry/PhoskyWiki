// 读路径的数据访问层：词条页 / 视角页 / 诠释者页 / 学派页 / 分类树 的查询都在这里。
// 全部过滤 pages.deleted_at（软删除页面对读路径不可见，ADR-0003 #7）。

import "server-only";

import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

import { getDb, type Db } from "@/db";
import {
  categories,
  interpreters,
  links,
  pages,
  perspectives,
  revisions,
  schoolMembers,
  schools,
  termCategories,
  terms,
} from "@/db/schema";
import type { PageType } from "@/db/schema";
import {
  buildCategoryTree,
  categoryAncestorPath,
  type CategoryRow,
  type CategoryTreeNode,
} from "@/lib/categories";
import { pagePath } from "@/lib/slug";
import type { WikiLinkTarget } from "@/lib/markdown";
import { isPageVisible } from "@/lib/page-visibility";

/** 在线页面（未软删除）的最小信息。 */
export interface LivePage {
  id: number;
  type: PageType;
  title: string;
  slug: string;
}

export async function getLivePage(id: number): Promise<LivePage | null> {
  const [row] = await getDb()
    .select({ id: pages.id, type: pages.type, title: pages.title, slug: pages.slug })
    .from(pages)
    .where(and(eq(pages.id, id), isPageVisible(pages.id)))
    .limit(1);
  return row ?? null;
}

/** 词条索引（含各词条的在线视角数）。 */
export async function listTerms(): Promise<
  { id: number; title: string; slug: string; summary: string; perspectiveCount: number }[]
> {
  return getDb()
    .select({
      id: pages.id,
      title: pages.title,
      slug: pages.slug,
      summary: terms.summary,
      perspectiveCount: sql<number>`(
        select count(*) from ${perspectives} pc
        join ${pages} pcPage on pcPage.id = pc.page_id
        join ${pages} piPage on piPage.id = pc.interpreter_id
        where pc.term_id = ${pages.id} and ${isPageVisible(sql`pcPage.id`)} and piPage.deleted_at is null
      )`.mapWith(Number),
    })
    .from(pages)
    .innerJoin(terms, eq(terms.pageId, pages.id))
    .where(and(eq(pages.type, "term"), isPageVisible(pages.id)))
    .orderBy(asc(pages.id));
}

/** 新建视角表单的占位组合；软删除视角仍受唯一约束，需恢复而非重建。 */
export async function listPerspectivePairs() {
  return getDb().select({ termId: perspectives.termId, interpreterId: perspectives.interpreterId }).from(perspectives);
}

/** 词条详情（信息框用）。 */
export async function getTermDetail(id: number) {
  const [row] = await getDb()
    .select({
      id: pages.id,
      title: pages.title,
      slug: pages.slug,
      summary: terms.summary,
      aliases: terms.aliases,
      keyTexts: terms.keyTexts,
    })
    .from(pages)
    .innerJoin(terms, eq(terms.pageId, pages.id))
    .where(
      and(eq(pages.id, id), eq(pages.type, "term"), isPageVisible(pages.id)),
    )
    .limit(1);
  return row ?? null;
}

export interface PerspectiveListItem {
  pageId: number;
  title: string;
  slug: string;
  interpreterId: number;
  interpreterName: string;
  interpreterSlug: string;
  linkCount: number;
}

/**
 * 词条下的视角列表，默认排序（spec「Implementation Decisions」）：
 * 站内引用数（links 统计）热度 → 并列时按创建序。
 */
export async function listPerspectivesOfTerm(
  termId: number,
): Promise<PerspectiveListItem[]> {
  const db = getDb();
  const interpreterPages = alias(pages, "interpreter_pages");
  const sourcePages = alias(pages, "source_pages");
  // 热度 = 在线引用方的双链数（软删除的引用方不加热，与反链面板同一口径）
  const linkCounts = db
    .select({
      targetPageId: links.targetPageId,
      count: sql<number>`count(*)`.mapWith(Number).as("count"),
    })
    .from(links)
    .innerJoin(sourcePages, eq(sourcePages.id, links.sourcePageId))
    .where(isPageVisible(sourcePages.id))
    .groupBy(links.targetPageId)
    .as("link_counts");

  const rows = await db
    .select({
      pageId: perspectives.pageId,
      title: pages.title,
      slug: pages.slug,
      interpreterId: interpreters.pageId,
      interpreterName: interpreterPages.title,
      interpreterSlug: interpreterPages.slug,
      linkCount: sql<number>`coalesce(${linkCounts.count}, 0)`.mapWith(Number),
    })
    .from(perspectives)
    .innerJoin(pages, eq(pages.id, perspectives.pageId))
    .innerJoin(interpreters, eq(interpreters.pageId, perspectives.interpreterId))
    .innerJoin(interpreterPages, eq(interpreterPages.id, interpreters.pageId))
    .leftJoin(linkCounts, eq(linkCounts.targetPageId, perspectives.pageId))
    .where(
      and(
        eq(perspectives.termId, termId),
        isPageVisible(pages.id),
        isNull(interpreterPages.deletedAt),
      ),
    )
    .orderBy(
      desc(sql`coalesce(${linkCounts.count}, 0)`),
      asc(pages.id),
    );

  return rows;
}

/** 页面当前（head）修订的 Markdown 源文本。 */
export async function getHeadContent(pageId: number): Promise<string | null> {
  const [row] = await getDb()
    .select({ content: revisions.content })
    .from(revisions)
    .where(eq(revisions.pageId, pageId))
    .orderBy(desc(revisions.id))
    .limit(1);
  return row?.content ?? null;
}

/** 页面当前（head）修订的 id；无修订返回 null（base_revision_id 的取值来源）。 */
export async function getHeadRevisionId(pageId: number): Promise<number | null> {
  const [row] = await getDb()
    .select({ id: revisions.id })
    .from(revisions)
    .where(eq(revisions.pageId, pageId))
    .orderBy(desc(revisions.id))
    .limit(1);
  return row?.id ?? null;
}

/** 正文、base 和预览关系来自同一数据库快照，避免编辑时混入并发发布。 */
export async function getPerspectiveEditingState(pageId: number) {
  return getDb().transaction(async (tx) => {
    const [head] = await tx.select({ content: revisions.content, baseRevisionId: revisions.id })
      .from(revisions).where(eq(revisions.pageId, pageId)).orderBy(desc(revisions.id)).limit(1);
    if (!head) return null;
    return { ...head, linkTargets: await getWikiLinkTargets(pageId, tx) };
  }, { isolationLevel: "repeatable read", accessMode: "read only" });
}

/** 全部在线诠释者，供索引与新建视角选择器使用。 */
export async function listInterpreters(): Promise<
  { pageId: number; name: string; slug: string; summary: string }[]
> {
  return getDb()
    .select({ pageId: interpreters.pageId, name: pages.title, slug: pages.slug, summary: interpreters.summary })
    .from(interpreters)
    .innerJoin(pages, eq(pages.id, interpreters.pageId))
    .where(and(eq(pages.type, "interpreter"), isPageVisible(pages.id)))
    .orderBy(asc(pages.id));
}

/** 新发布的视角：所属词条与诠释者也必须在线。 */
export async function listRecentPerspectives(limit = 6) {
  const termPages = alias(pages, "recent_term_pages");
  const interpreterPages = alias(pages, "recent_interpreter_pages");
  return getDb()
    .select({ id: pages.id, title: pages.title, slug: pages.slug, termTitle: termPages.title, interpreterName: interpreterPages.title })
    .from(perspectives)
    .innerJoin(pages, eq(pages.id, perspectives.pageId))
    .innerJoin(termPages, eq(termPages.id, perspectives.termId))
    .innerJoin(interpreterPages, eq(interpreterPages.id, perspectives.interpreterId))
    .where(and(isPageVisible(pages.id), isNull(termPages.deletedAt), isNull(interpreterPages.deletedAt)))
    .orderBy(desc(pages.createdAt), desc(pages.id))
    .limit(limit);
}

/** 视角详情：所属词条 + 诠释者（含生卒年）。 */
export async function getPerspectiveDetail(id: number) {
  const termPages = alias(pages, "term_pages");
  const interpreterPages = alias(pages, "interpreter_pages");
  const [row] = await getDb()
    .select({
      id: pages.id,
      title: pages.title,
      slug: pages.slug,
      termId: terms.pageId,
      termTitle: termPages.title,
      termSlug: termPages.slug,
      interpreterId: interpreters.pageId,
      interpreterName: interpreterPages.title,
      interpreterSlug: interpreterPages.slug,
      interpreterBirthYear: interpreters.birthYear,
      interpreterDeathYear: interpreters.deathYear,
    })
    .from(perspectives)
    .innerJoin(pages, eq(pages.id, perspectives.pageId))
    .innerJoin(terms, eq(terms.pageId, perspectives.termId))
    .innerJoin(termPages, eq(termPages.id, terms.pageId))
    .innerJoin(interpreters, eq(interpreters.pageId, perspectives.interpreterId))
    .innerJoin(interpreterPages, eq(interpreterPages.id, interpreters.pageId))
    .where(
      and(
        eq(perspectives.pageId, id),
        isPageVisible(pages.id),
        isNull(termPages.deletedAt),
        isNull(interpreterPages.deletedAt),
      ),
    )
    .limit(1);
  return row ?? null;
}

/** 诠释者详情（信息框用）。 */
export async function getInterpreterDetail(id: number) {
  const [row] = await getDb()
    .select({
      id: pages.id,
      title: pages.title,
      slug: pages.slug,
      summary: interpreters.summary,
      keyTexts: interpreters.keyTexts,
      birthYear: interpreters.birthYear,
      deathYear: interpreters.deathYear,
    })
    .from(pages)
    .innerJoin(interpreters, eq(interpreters.pageId, pages.id))
    .where(
      and(
        eq(pages.id, id),
        eq(pages.type, "interpreter"),
        isPageVisible(pages.id),
      ),
    )
    .limit(1);
  return row ?? null;
}

/** 诠释者的全部视角索引。 */
export async function listPerspectivesOfInterpreter(
  interpreterId: number,
): Promise<
  { pageId: number; title: string; slug: string; termId: number; termTitle: string; termSlug: string }[]
> {
  const termPages = alias(pages, "term_pages");
  return getDb()
    .select({
      pageId: perspectives.pageId,
      title: pages.title,
      slug: pages.slug,
      termId: terms.pageId,
      termTitle: termPages.title,
      termSlug: termPages.slug,
    })
    .from(perspectives)
    .innerJoin(pages, eq(pages.id, perspectives.pageId))
    .innerJoin(terms, eq(terms.pageId, perspectives.termId))
    .innerJoin(termPages, eq(termPages.id, terms.pageId))
    .where(
      and(
        eq(perspectives.interpreterId, interpreterId),
        isPageVisible(pages.id),
        isNull(termPages.deletedAt),
      ),
    )
    .orderBy(asc(pages.id));
}

/**
 * 页面双链的解析结果（受理时落库的即真相，ADR-0003 #4）：
 * links 行 join 目标页 → 名称 → 站内路径 / 红链。
 * 已解析目标暂不可用时保留身份，不导向 404，也不标作尚未创建。
 * 键为 wikiLinkKey 的规范形态：默认链接 = 词条名；显式视角链接 = 词条@诠释者。
 */
export async function getWikiLinkTargets(
  pageId: number,
  db: Db | Parameters<Parameters<Db["transaction"]>[0]>[0] = getDb(),
): Promise<Map<string, WikiLinkTarget>> {
  const rows = await db
    .select({
      name: links.targetName,
      targetId: pages.id,
      type: pages.type,
      slug: pages.slug,
      visible: isPageVisible(pages.id),
    })
    .from(links)
    .leftJoin(pages, eq(pages.id, links.targetPageId))
    .where(eq(links.sourcePageId, pageId));

  return new Map(
    rows.map((row) => {
      const exists = row.targetId !== null && row.visible;
      return [
        row.name,
        exists
          ? { href: pagePath(row.type!, row.slug!, row.targetId!), exists: true }
          : { href: "", exists: false, ...(row.targetId !== null ? { unavailable: true } : {}) },
      ];
    }),
  );
}

export interface BacklinkItem {
  /** 引用方视角页 */
  pageId: number;
  title: string;
  slug: string;
  /** 引用方视角所属词条（上下文提示用） */
  termId: number;
  termTitle: string;
  termSlug: string;
}

/**
 * 反链面板数据（ADR-0003 数据模型注记）：直接查 links（target = 本页），
 * 引用方即视角页（双链只出现在视角正文里）；软删除的引用方与其词条不展示。
 */
export async function listBacklinks(targetPageId: number): Promise<BacklinkItem[]> {
  const sourcePages = alias(pages, "source_pages");
  const termPages = alias(pages, "term_pages");
  return getDb()
    .selectDistinct({
      pageId: sourcePages.id,
      title: sourcePages.title,
      slug: sourcePages.slug,
      termId: terms.pageId,
      termTitle: termPages.title,
      termSlug: termPages.slug,
    })
    .from(links)
    .innerJoin(sourcePages, eq(sourcePages.id, links.sourcePageId))
    .innerJoin(perspectives, eq(perspectives.pageId, links.sourcePageId))
    .innerJoin(terms, eq(terms.pageId, perspectives.termId))
    .innerJoin(termPages, eq(termPages.id, terms.pageId))
    .where(
      and(
        eq(links.targetPageId, targetPageId),
        isPageVisible(sourcePages.id),
        isNull(termPages.deletedAt),
      ),
    )
    .orderBy(asc(sourcePages.id));
}

// ===== 学派轴（强类型实体，只组织诠释者）=====

/** 学派列表（成员数与核心词条数为在线页面计数）。 */
export async function listSchools(): Promise<
  { id: number; title: string; slug: string; summary: string; memberCount: number; coreTermCount: number }[]
> {
  return getDb()
    .select({
      id: pages.id,
      title: pages.title,
      slug: pages.slug,
      summary: schools.summary,
      memberCount: sql<number>`(
        select count(*) from ${schoolMembers} sm
        join ${pages} mp on mp.id = sm.interpreter_id
        where sm.school_id = ${pages.id} and mp.deleted_at is null
      )`.mapWith(Number),
      coreTermCount: sql<number>`(
        select count(distinct pp.term_id) from ${schoolMembers} sm
        join ${pages} mpage on mpage.id = sm.interpreter_id
        join ${perspectives} pp on pp.interpreter_id = sm.interpreter_id
        join ${pages} ppage on ppage.id = pp.page_id
        join ${pages} tp on tp.id = pp.term_id
        where sm.school_id = ${pages.id}
          and mpage.deleted_at is null and ppage.deleted_at is null and tp.deleted_at is null
      )`.mapWith(Number),
    })
    .from(pages)
    .innerJoin(schools, eq(schools.pageId, pages.id))
    .where(and(eq(pages.type, "school"), isPageVisible(pages.id)))
    .orderBy(asc(pages.id));
}

/** 学派详情（信息框用）。 */
export async function getSchoolDetail(id: number) {
  const [row] = await getDb()
    .select({ id: pages.id, title: pages.title, slug: pages.slug, summary: schools.summary })
    .from(pages)
    .innerJoin(schools, eq(schools.pageId, pages.id))
    .where(and(eq(pages.id, id), eq(pages.type, "school"), isPageVisible(pages.id)))
    .limit(1);
  return row ?? null;
}

/** 学派成员诠释者列表（软删除的诠释者视同退出学派），按诠释者页 id 稳定排序。 */
export async function listSchoolMembers(
  schoolId: number,
): Promise<
  {
    interpreterId: number;
    name: string;
    slug: string;
    birthYear: number | null;
    deathYear: number | null;
    perspectiveCount: number;
  }[]
> {
  const interpreterPages = alias(pages, "interpreter_pages");
  return getDb()
    .select({
      interpreterId: interpreters.pageId,
      name: interpreterPages.title,
      slug: interpreterPages.slug,
      keyTexts: interpreters.keyTexts,
      birthYear: interpreters.birthYear,
      deathYear: interpreters.deathYear,
      perspectiveCount: sql<number>`(
        select count(*) from ${perspectives} pc
        join ${pages} pcPage on pcPage.id = pc.page_id
        join ${pages} ptPage on ptPage.id = pc.term_id
        where pc.interpreter_id = ${interpreters.pageId}
          and pcPage.deleted_at is null and ptPage.deleted_at is null
      )`.mapWith(Number),
    })
    .from(schoolMembers)
    .innerJoin(interpreters, eq(interpreters.pageId, schoolMembers.interpreterId))
    .innerJoin(interpreterPages, eq(interpreterPages.id, interpreters.pageId))
    .where(and(eq(schoolMembers.schoolId, schoolId), isNull(interpreterPages.deletedAt)))
    .orderBy(asc(interpreterPages.id));
}

/**
 * 学派核心词条：派生数据——成员的在线视角按词条聚合（视角数降序）。
 * 学派不直接挂词条（强弱类型边界），「核心」由成员的作品说话。
 */
export async function listSchoolCoreTerms(
  schoolId: number,
): Promise<{ termId: number; title: string; slug: string; perspectiveCount: number }[]> {
  const termPages = alias(pages, "term_pages");
  const memberPages = alias(pages, "member_pages");
  return getDb()
    .select({
      termId: terms.pageId,
      title: termPages.title,
      slug: termPages.slug,
      perspectiveCount: sql<number>`count(*)`.mapWith(Number),
    })
    .from(schoolMembers)
    .innerJoin(interpreters, eq(interpreters.pageId, schoolMembers.interpreterId))
    .innerJoin(memberPages, eq(memberPages.id, interpreters.pageId))
    .innerJoin(perspectives, eq(perspectives.interpreterId, interpreters.pageId))
    .innerJoin(pages, eq(pages.id, perspectives.pageId))
    .innerJoin(terms, eq(terms.pageId, perspectives.termId))
    .innerJoin(termPages, eq(termPages.id, terms.pageId))
    .where(
      and(
        eq(schoolMembers.schoolId, schoolId),
        isNull(memberPages.deletedAt),
        isPageVisible(pages.id),
        isNull(termPages.deletedAt),
      ),
    )
    .groupBy(terms.pageId, termPages.title, termPages.slug)
    .orderBy(desc(sql`count(*)`), asc(terms.pageId));
}

/** 诠释者所属学派（诠释者页信息框用）。 */
export async function listSchoolsOfInterpreter(
  interpreterId: number,
): Promise<{ id: number; title: string; slug: string }[]> {
  return getDb()
    .select({ id: pages.id, title: pages.title, slug: pages.slug })
    .from(schoolMembers)
    .innerJoin(schools, eq(schools.pageId, schoolMembers.schoolId))
    .innerJoin(pages, eq(pages.id, schools.pageId))
    .where(and(eq(schoolMembers.interpreterId, interpreterId), isPageVisible(pages.id)))
    .orderBy(asc(pages.id));
}

// ===== 分类轴（弱类型标签树，只组织词条）=====

/**
 * 全部分类（带在线词条数），分类数量小，一次取全在内存建树。
 * 注意：词条数用独立 GROUP BY 查询合并——单表主查询里内嵌相关子查询时，
 * drizzle 会把列渲染成无限定名（"id"），子查询内会错误绑定到 join 别名。
 */
export async function listCategoryRows(): Promise<CategoryRow[]> {
  const db = getDb();
  const [rows, counts] = await Promise.all([
    db
      .select({
        id: categories.id,
        name: categories.name,
        slug: categories.slug,
        parentId: categories.parentId,
      })
      .from(categories)
      .orderBy(asc(categories.id)),
    db
      .select({
        categoryId: termCategories.categoryId,
        count: sql<number>`count(*)`.mapWith(Number),
      })
      .from(termCategories)
      .innerJoin(pages, eq(pages.id, termCategories.termId))
      .where(isPageVisible(pages.id))
      .groupBy(termCategories.categoryId),
  ]);
  const countByCategory = new Map(counts.map((row) => [row.categoryId, row.count]));
  return rows.map((row) => ({ ...row, termCount: countByCategory.get(row.id) ?? 0 }));
}

/** 分类树浏览页数据：根分类嵌套全部后代。 */
export async function getCategoryTree(): Promise<CategoryTreeNode[]> {
  return buildCategoryTree(await listCategoryRows());
}

export interface CategoryDetail {
  id: number;
  name: string;
  slug: string;
  /** 从根到本分类的祖先链（不含自身），面包屑用。 */
  path: { id: number; name: string; slug: string }[];
  children: CategoryRow[];
  terms: { id: number; title: string; slug: string; summary: string }[];
}

/** 分类详情：祖先链 + 子分类 + 本分类（直接挂载）的在线词条。 */
export async function getCategoryDetailBySlug(slug: string): Promise<CategoryDetail | null> {
  const rows = await listCategoryRows();
  const category = rows.find((row) => row.slug === slug);
  if (!category) return null;

  const categoryTerms = await getDb()
    .select({ id: pages.id, title: pages.title, slug: pages.slug, summary: terms.summary })
    .from(termCategories)
    .innerJoin(terms, eq(terms.pageId, termCategories.termId))
    .innerJoin(pages, eq(pages.id, terms.pageId))
    .where(and(eq(termCategories.categoryId, category.id), isPageVisible(pages.id)))
    .orderBy(asc(pages.id));

  return {
    id: category.id,
    name: category.name,
    slug: category.slug,
    path: categoryAncestorPath(rows, category.id).map(({ id, name, slug }) => ({ id, name, slug })),
    children: rows.filter((row) => row.parentId === category.id),
    terms: categoryTerms,
  };
}

/** 词条所属分类（词条页信息框用），按分类 id 稳定排序；挂载表无时序列。 */
export async function listCategoriesOfTerm(
  termId: number,
): Promise<{ id: number; name: string; slug: string }[]> {
  return getDb()
    .select({ id: categories.id, name: categories.name, slug: categories.slug })
    .from(termCategories)
    .innerJoin(categories, eq(categories.id, termCategories.categoryId))
    .innerJoin(pages, eq(pages.id, termCategories.termId))
    .where(and(eq(termCategories.termId, termId), isPageVisible(pages.id)))
    .orderBy(asc(categories.id));
}
