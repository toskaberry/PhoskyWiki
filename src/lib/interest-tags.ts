// 兴趣标签的共享内核（T12）：客户端与服务端都可用（无 server-only、无 DB 导入）。
// 三类兴趣 = 诠释者 / 学派 / 主题（主题轴即分类，CONTEXT.md「兴趣标签」）。
// 游客的存储（localStorage）与 PUT /api/interests 的请求体解析在这里；
// 账号侧的读写走 lib/interests.ts。

/** 三类兴趣的 id 集：诠释者页 id / 学派页 id / 分类 id。 */
export interface InterestSet {
  interpreters: number[];
  schools: number[];
  categories: number[];
}

/** 每类兴趣上限（PUT 校验 + 防滥用；远超正常使用面）。 */
export const MAX_INTERESTS_PER_TYPE = 50;

export const EMPTY_INTEREST_SET: InterestSet = {
  interpreters: [],
  schools: [],
  categories: [],
};

export function hasAnyInterest(set: InterestSet): boolean {
  return (
    set.interpreters.length > 0 || set.schools.length > 0 || set.categories.length > 0
  );
}

/** 规范形态：去重 + 升序（账号与 localStorage 两路同一形态，便于比对与测试）。 */
export function normalizeInterestSet(set: InterestSet): InterestSet {
  const uniq = (ids: number[]) => [...new Set(ids)].sort((a, b) => a - b);
  return {
    interpreters: uniq(set.interpreters),
    schools: uniq(set.schools),
    categories: uniq(set.categories),
  };
}

export function sameInterestSet(a: InterestSet, b: InterestSet): boolean {
  return serializeInterestSet(a) === serializeInterestSet(b);
}

/** 并集（规范形态）：登录后把本浏览器的游客兴趣并入账号选择（「随账号同步」）。 */
export function mergeInterestSets(a: InterestSet, b: InterestSet): InterestSet {
  return normalizeInterestSet({
    interpreters: [...a.interpreters, ...b.interpreters],
    schools: [...a.schools, ...b.schools],
    categories: [...a.categories, ...b.categories],
  });
}

// ===== 视角重排（纯函数，词条页服务端与游客客户端共用）=====

export interface RankablePerspective {
  interpreterId: number;
}

/**
 * 兴趣重排（spec「Implementation Decisions」：设兴趣时同一列表按兴趣重排，
 * 覆盖的是默认热度序）：兴趣诠释者的视角 → 其余。
 * 组内保持传入序（调用方已按热度/创建序排好）；空兴趣集原样返回；
 * 幂等——重复应用同一集合结果不变（服务端排过后客户端再应用亦安全）。
 */
export function reorderPerspectivesByInterest<T extends RankablePerspective>(
  items: T[],
  interestedInterpreterIds: ReadonlySet<number>,
): T[] {
  if (interestedInterpreterIds.size === 0 || items.length < 2) return items;
  const rankOf = (item: T): number =>
    interestedInterpreterIds.has(item.interpreterId) ? 0 : 1;
  return items
    .map((item, index) => ({ item, index, rank: rankOf(item) }))
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .map((entry) => entry.item);
}

// ===== 游客 localStorage（未登录路径；登录后的账号路径见 lib/interests.ts）=====

export const INTEREST_STORAGE_KEY = "phoskywiki:interest-tags";

interface StoredInterests extends InterestSet {
  v: 1;
}

/** 序列化为存储形态（版本字段留升级余地，键位约定与编辑器草稿一致）。 */
export function serializeInterestSet(set: InterestSet): string {
  return JSON.stringify({ v: 1, ...normalizeInterestSet(set) } satisfies StoredInterests);
}

/** 解析存储形态；任何损坏（非法 JSON/结构/版本）都视同没有兴趣，绝不抛错。 */
export function parseStoredInterestSet(raw: string | null): InterestSet | null {
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const candidate = parsed as { v?: unknown } & Partial<InterestSet>;
  if (candidate.v !== 1) return null;
  const isIdArray = (value: unknown): value is number[] =>
    Array.isArray(value) &&
    value.every((id) => typeof id === "number" && Number.isSafeInteger(id) && id > 0);
  if (
    !isIdArray(candidate.interpreters) ||
    !isIdArray(candidate.schools) ||
    !isIdArray(candidate.categories)
  ) {
    return null;
  }
  return normalizeInterestSet({
    interpreters: candidate.interpreters,
    schools: candidate.schools,
    categories: candidate.categories,
  });
}

/** 最小存储接口：便于注入测试替身（vitest node 环境没有 localStorage）。 */
export interface InterestStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export function readGuestInterests(storage: InterestStorage): InterestSet | null {
  return parseStoredInterestSet(storage.getItem(INTEREST_STORAGE_KEY));
}

export function writeGuestInterests(storage: InterestStorage, set: InterestSet): void {
  storage.setItem(INTEREST_STORAGE_KEY, serializeInterestSet(set));
}

// ===== PUT /api/interests 请求体解析（纯函数，路由与测试共用）=====

export type ParsedInterestBody =
  | { ok: true; set: InterestSet }
  | { ok: false; error: string };

/**
 * 解析 PUT /api/interests 请求体：interpreters/schools/categories 三个键都可省
 * （省略 = 清空该类），在场则必须是正整数数组；去重后不得超过每类上限。
 */
export function parseInterestRequestBody(body: unknown): ParsedInterestBody {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return { ok: false, error: "请求体必须是 JSON 对象" };
  }
  const source = body as Record<string, unknown>;
  const result: InterestSet = { interpreters: [], schools: [], categories: [] };
  for (const key of ["interpreters", "schools", "categories"] as const) {
    const value = source[key];
    if (value === undefined || value === null) continue;
    if (!Array.isArray(value)) {
      return { ok: false, error: `${key} 必须是数组` };
    }
    if (!value.every((id) => typeof id === "number" && Number.isSafeInteger(id) && id > 0)) {
      return { ok: false, error: `${key} 的每一项都必须是正整数` };
    }
    if (new Set(value).size > MAX_INTERESTS_PER_TYPE) {
      return { ok: false, error: `${key} 最多 ${MAX_INTERESTS_PER_TYPE} 个` };
    }
    result[key] = value;
  }
  return { ok: true, set: normalizeInterestSet(result) };
}
