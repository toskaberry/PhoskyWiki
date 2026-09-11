// 兴趣标签账号侧（T12）：登录用户的兴趣读写与派生展开。
// 游客路径（localStorage）见 lib/interest-tags.ts；本模块是唯一写
// interest_tags 表的地方，写入语义 = 全量替换（客户端持有完整选择集）。

import "server-only";

import { and, eq, inArray, isNull } from "drizzle-orm";

import { getDb } from "@/db";
import {
  categories,
  interestTags,
  interpreters,
  pages,
  schoolMembers,
  schools,
} from "@/db/schema";
import { listCategoryRows, listInterpreters, listSchools } from "@/lib/content";
import { normalizeInterestSet, type InterestSet } from "@/lib/interest-tags";

/** 目标对读路径在线才有效：诠释者/学派软删除视同不再是兴趣，不报错、静默过滤。 */
async function liveInterpreterIds(ids: number[]): Promise<number[]> {
  if (ids.length === 0) return [];
  const rows = await getDb()
    .select({ id: interpreters.pageId })
    .from(interpreters)
    .innerJoin(pages, eq(pages.id, interpreters.pageId))
    .where(and(inArray(interpreters.pageId, ids), isNull(pages.deletedAt)));
  return rows.map((row) => row.id);
}

async function liveSchoolIds(ids: number[]): Promise<number[]> {
  if (ids.length === 0) return [];
  const rows = await getDb()
    .select({ id: schools.pageId })
    .from(schools)
    .innerJoin(pages, eq(pages.id, schools.pageId))
    .where(and(inArray(schools.pageId, ids), isNull(pages.deletedAt)));
  return rows.map((row) => row.id);
}

/** 分类无软删除（非页面，ADR-0003 #2），存在即有效。 */
async function existingCategoryIds(ids: number[]): Promise<number[]> {
  if (ids.length === 0) return [];
  const rows = await getDb()
    .select({ id: categories.id })
    .from(categories)
    .where(inArray(categories.id, ids));
  return rows.map((row) => row.id);
}

/** 过滤到在线目标并取规范形态（读与写共用同一口径）。 */
export async function filterLiveInterests(set: InterestSet): Promise<InterestSet> {
  // PostgreSQL 页面/分类 id 是 int4；超出范围的旧选择等价于不存在。
  const ids = (values: number[]) => values.filter((id) => id <= 2_147_483_647);
  const [interpretersLive, schoolsLive, categoriesLive] = await Promise.all([
    liveInterpreterIds(ids(set.interpreters)),
    liveSchoolIds(ids(set.schools)),
    existingCategoryIds(ids(set.categories)),
  ]);
  return normalizeInterestSet({
    interpreters: interpretersLive,
    schools: schoolsLive,
    categories: categoriesLive,
  });
}

/** 读用户兴趣（只含在线目标）；用户不存在或未设兴趣都得到空集。 */
export async function getInterestTags(userId: string): Promise<InterestSet> {
  const rows = await getDb()
    .select({
      interpreterId: interestTags.interpreterId,
      schoolId: interestTags.schoolId,
      categoryId: interestTags.categoryId,
    })
    .from(interestTags)
    .where(eq(interestTags.userId, userId));

  return filterLiveInterests({
    interpreters: rows.flatMap((row) => (row.interpreterId !== null ? [row.interpreterId] : [])),
    schools: rows.flatMap((row) => (row.schoolId !== null ? [row.schoolId] : [])),
    categories: rows.flatMap((row) => (row.categoryId !== null ? [row.categoryId] : [])),
  });
}

/**
 * 保存用户兴趣：全量替换。陈旧 id（目标已软删除 / 分类已删）静默丢弃，
 * 返回实际存下的规范形态——客户端可能带着过期选择，保存不应因此失败。
 */
export async function saveInterestTags(
  userId: string,
  set: InterestSet,
): Promise<InterestSet> {
  const live = await filterLiveInterests(set);

  // 三种行形态统一写成显式 null（负载列允许 null），满足插入 values 的统一类型
  const rows = [
    ...live.interpreters.map((id) => ({
      userId,
      interpreterId: id,
      schoolId: null,
      categoryId: null,
    })),
    ...live.schools.map((id) => ({
      userId,
      interpreterId: null,
      schoolId: id,
      categoryId: null,
    })),
    ...live.categories.map((id) => ({
      userId,
      interpreterId: null,
      schoolId: null,
      categoryId: id,
    })),
  ];

  await getDb().transaction(async (tx) => {
    await tx.delete(interestTags).where(eq(interestTags.userId, userId));
    if (rows.length > 0) {
      await tx.insert(interestTags).values(rows);
    }
  });

  return live;
}

/**
 * 兴趣 → 视角重排用的诠释者 id 集：直接兴趣 ∪ 兴趣学派成员
 * （选了学派即关注其成员的诠释；成员诠释者页软删除视同退出学派，不计入）。
 * 主题（分类）兴趣组织的是词条而非诠释者，不参与本展开——它作用于相关词条推荐。
 */
export async function expandInterestedInterpreters(
  interests: InterestSet,
): Promise<Set<number>> {
  let memberIds: number[] = [];
  if (interests.schools.length > 0) {
    const rows = await getDb()
      .select({ id: schoolMembers.interpreterId })
      .from(schoolMembers)
      .innerJoin(pages, eq(pages.id, schoolMembers.interpreterId))
      .where(
        and(inArray(schoolMembers.schoolId, interests.schools), isNull(pages.deletedAt)),
      );
    memberIds = rows.map((row) => row.id);
  }
  return new Set([...interests.interpreters, ...memberIds]);
}

/** 兴趣可选项（/interests 选择器与个人主页展示共用的三类清单）。 */
export interface InterestOptions {
  /** 在线诠释者 */
  interpreters: { id: number; name: string }[];
  schools: { id: number; name: string }[];
  /** 主题（分类）；parentName 供 chip 的上级提示（根分类为 null） */
  categories: { id: number; name: string; parentName: string | null }[];
}

export async function getInterestOptions(): Promise<InterestOptions> {
  const [interpreterRows, schoolRows, categoryRows] = await Promise.all([
    listInterpreters(),
    listSchools(),
    listCategoryRows(),
  ]);
  const categoryNameById = new Map(categoryRows.map((row) => [row.id, row.name]));
  return {
    interpreters: interpreterRows
      .map((row) => ({ id: row.pageId, name: row.name })),
    schools: schoolRows.map((row) => ({ id: row.id, name: row.title })),
    categories: categoryRows.map((row) => ({
      id: row.id,
      name: row.name,
      parentName: row.parentId ? (categoryNameById.get(row.parentId) ?? null) : null,
    })),
  };
}
