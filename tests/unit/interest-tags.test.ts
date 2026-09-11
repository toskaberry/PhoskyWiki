// 兴趣标签共享内核的纯函数单测（T12）：视角重排、集合运算、localStorage
// 序列化与 PUT 请求体解析。无 IO（存储注入内存替身）。

import { describe, expect, it } from "vitest";

import {
  EMPTY_INTEREST_SET,
  INTEREST_STORAGE_KEY,
  MAX_INTERESTS_PER_TYPE,
  mergeInterestSets,
  normalizeInterestSet,
  parseInterestRequestBody,
  parseStoredInterestSet,
  readGuestInterests,
  reorderPerspectivesByInterest,
  sameInterestSet,
  serializeInterestSet,
  writeGuestInterests,
  type InterestStorage,
} from "@/lib/interest-tags";

/** vitest 跑 node 环境：内存版 Storage 替身。 */
function memoryStorage(): InterestStorage & { dump(): Map<string, string> } {
  const store = new Map<string, string>();
  return {
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => void store.set(key, value),
    dump: () => store,
  };
}

function persp(interpreterId: number, extra: Partial<{ isBoard: boolean; pinned: boolean }> = {}) {
  return { interpreterId, isBoard: false, pinned: false, ...extra };
}

describe("reorderPerspectivesByInterest（视角兴趣重排）", () => {
  const items = [
    persp(1, { isBoard: true }), // 遗留标记不再具有排序特权
    persp(2), // 输入保持默认热度序
    persp(3),
    persp(4),
    persp(5),
  ];

  it("空兴趣集原样返回（未设兴趣 = 默认序）", () => {
    expect(reorderPerspectivesByInterest(items, new Set())).toEqual(items);
  });

  it("兴趣诠释者的视角排前；组内保持默认序，其余跟上", () => {
    const ordered = reorderPerspectivesByInterest(items, new Set([4]));
    expect(ordered.map((item) => item.interpreterId)).toEqual([4, 1, 2, 3, 5]);
  });

  it("多个兴趣诠释者整体前置，组内相对顺序不变", () => {
    const ordered = reorderPerspectivesByInterest(items, new Set([5, 3]));
    expect(ordered.map((item) => item.interpreterId)).toEqual([3, 5, 1, 2, 4]);
  });

  it("旧特权字段不再影响兴趣排序", () => {
    const ordered = reorderPerspectivesByInterest(items, new Set([4, 5, 3, 2]));
    expect(ordered.map(item => item.interpreterId)).toEqual([2, 3, 4, 5, 1]);
  });

  it("旧置顶字段不再优先于个人兴趣", () => {
    const withPinned = [
      persp(1, { isBoard: true }),
      persp(2, { pinned: true }), // 遗留置顶字段不在兴趣内
      persp(3),
      persp(4),
    ];
    const ordered = reorderPerspectivesByInterest(withPinned, new Set([4]));
    expect(ordered.map((item) => item.interpreterId)).toEqual([4, 1, 2, 3]);
  });

  it("兴趣集里的 id 不在列表中时无副作用", () => {
    expect(reorderPerspectivesByInterest(items, new Set([999]))).toEqual(items);
  });

  it("幂等：重复应用同一集合结果不变（服务端排过后客户端再排）", () => {
    const once = reorderPerspectivesByInterest(items, new Set([4, 5]));
    expect(reorderPerspectivesByInterest(once, new Set([4, 5]))).toEqual(once);
  });

  it("少于两条不必排序", () => {
    expect(reorderPerspectivesByInterest([persp(1)], new Set([1]))).toEqual([persp(1)]);
  });
});

describe("兴趣集合运算", () => {
  it("normalizeInterestSet：去重 + 升序", () => {
    expect(
      normalizeInterestSet({ interpreters: [3, 1, 3], schools: [], categories: [9, 2] }),
    ).toEqual({ interpreters: [1, 3], schools: [], categories: [2, 9] });
  });

  it("mergeInterestSets：并集取规范形态（登录后本地兴趣并入账号）", () => {
    expect(
      mergeInterestSets(
        { interpreters: [1, 2], schools: [5], categories: [] },
        { interpreters: [2, 3], schools: [], categories: [7] },
      ),
    ).toEqual({ interpreters: [1, 2, 3], schools: [5], categories: [7] });
  });

  it("sameInterestSet：规范形态相等即相等（与顺序、重复无关）", () => {
    expect(
      sameInterestSet(
        { interpreters: [2, 1], schools: [], categories: [3, 3] },
        { interpreters: [1, 2], schools: [], categories: [3] },
      ),
    ).toBe(true);
    expect(sameInterestSet(EMPTY_INTEREST_SET, { interpreters: [1], schools: [], categories: [] })).toBe(false);
  });
});

describe("游客 localStorage 序列化", () => {
  it("写入 → 读取往返一致（规范形态）", () => {
    const storage = memoryStorage();
    writeGuestInterests(storage, { interpreters: [4, 2], schools: [1], categories: [] });
    expect(readGuestInterests(storage)).toEqual({ interpreters: [2, 4], schools: [1], categories: [] });
    expect([...storage.dump().keys()]).toEqual([INTEREST_STORAGE_KEY]);
    // 序列化形态本身也可解析（版本 + 规范化三类）
    const set = { interpreters: [4, 2], schools: [], categories: [7, 7] };
    expect(parseStoredInterestSet(serializeInterestSet(set))).toEqual({
      interpreters: [2, 4],
      schools: [],
      categories: [7],
    });
  });

  it("解析对任何损坏输入都返回 null，绝不抛错", () => {
    expect(parseStoredInterestSet(null)).toBeNull();
    expect(parseStoredInterestSet("")).toBeNull();
    expect(parseStoredInterestSet("not json")).toBeNull();
    expect(parseStoredInterestSet('{"v":2,"interpreters":[],"schools":[],"categories":[]}')).toBeNull(); // 未知版本
    expect(parseStoredInterestSet('{"interpreters":[],"schools":[],"categories":[]}')).toBeNull(); // 缺版本
    expect(parseStoredInterestSet('{"v":1,"interpreters":"x","schools":[],"categories":[]}')).toBeNull();
    expect(parseStoredInterestSet('{"v":1,"interpreters":[0,-1,1.5,"2"],"schools":[],"categories":[]}')).toBeNull();
    expect(parseStoredInterestSet('{"v":1,"interpreters":[],"schools":null,"categories":[]}')).toBeNull();
  });

  it("读取空存储（游客从未设置）得到 null", () => {
    expect(readGuestInterests(memoryStorage())).toBeNull();
  });
});

describe("parseInterestRequestBody（PUT /api/interests 请求体）", () => {
  it("合法体：三类齐全，规范化（去重升序）", () => {
    expect(
      parseInterestRequestBody({ interpreters: [3, 1, 3], schools: [], categories: [8] }),
    ).toEqual({ ok: true, set: { interpreters: [1, 3], schools: [], categories: [8] } });
  });

  it("三类都可省略：省略 = 清空该类", () => {
    expect(parseInterestRequestBody({})).toEqual({
      ok: true,
      set: EMPTY_INTEREST_SET,
    });
  });

  it("拒绝：非对象 / 键非数组 / 元素非正整数 / 超上限", () => {
    expect(parseInterestRequestBody("x").ok).toBe(false);
    expect(parseInterestRequestBody(null).ok).toBe(false);
    expect(parseInterestRequestBody({ interpreters: "拉康" }).ok).toBe(false);
    expect(parseInterestRequestBody({ schools: [0] }).ok).toBe(false);
    expect(parseInterestRequestBody({ categories: [-1] }).ok).toBe(false);
    expect(parseInterestRequestBody({ interpreters: [1.5] }).ok).toBe(false);
    // 重复项去重后不超限：50 个不同 id 放行，51 个拒绝
    const fifty = Array.from({ length: MAX_INTERESTS_PER_TYPE }, (_, i) => i + 1);
    expect(parseInterestRequestBody({ interpreters: fifty }).ok).toBe(true);
    expect(
      parseInterestRequestBody({ interpreters: [...fifty, fifty[0], 51] }).ok,
    ).toBe(false);
  });
});
