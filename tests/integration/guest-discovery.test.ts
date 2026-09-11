import { beforeAll, expect, it } from "vitest";

import { GET } from "@/app/api/terms/[id]/discovery/route";
import { seedDatabase } from "@/db/seed";
import { listCategoryRows, listInterpreters, listPerspectivesOfTerm, listSchools, listTerms } from "@/lib/content";
import { getDb } from "@/db";
import { pages, terms, links, termCategories, interpreters, schools, schoolMembers } from "@/db/schema";
import { eq, inArray } from "drizzle-orm";

beforeAll(async () => { await seedDatabase(); });

async function discover(interests: unknown) {
  const term = (await listTerms()).find((row) => row.title === "主体性")!;
  return GET(new Request(`http://localhost/api/terms/${term.id}/discovery?interests=${encodeURIComponent(JSON.stringify(interests))}`), {
    params: Promise.resolve({ id: String(term.id) }),
  });
}

it("匿名发现以学派成员重排视角，并禁止共享缓存", async () => {
  const school = (await listSchools()).find((row) => row.title === "精神分析")!;
  const res = await discover({ schools: [school.id, school.id] });
  expect(res.status).toBe(200);
  expect(res.headers.get("cache-control")).toContain("no-store");
  const data = await res.json();
  expect(data.perspectives.slice(0, 2).map((row: { title: string }) => row.title)).toEqual([
    "拉康论主体性", "弗洛伊德论主体性",
  ]);
  expect(data.relatedTerms.length).toBeGreaterThan(0);
});

it("完整一跳集合先计分再截断，低热度的第 401 个邻居仍能入选", async () => {
  const root = (await listTerms()).find((row) => row.title === "主体性")!;
  const source = (await listPerspectivesOfTerm(root.id))[0];
  const category = (await listCategoryRows()).find((row) => row.name === "政治经济学")!;
  const neighbors = await getDb().insert(pages).values(Array.from({ length: 401 }, (_, i) => ({
    type: "term" as const, title: `R09候选${i}`, slug: `r09-neighbor-${i}`,
  }))).returning({ id: pages.id });
  await getDb().insert(terms).values(neighbors.map((p) => ({ pageId: p.id })));
  await getDb().insert(links).values(neighbors.map((p, i) => ({
    sourcePageId: source.pageId, targetPageId: p.id, targetName: `R09候选${i}`,
  })));
  await getDb().insert(termCategories).values({ termId: neighbors[400].id, categoryId: category.id });
  const data = await (await discover({ categories: [category.id] })).json();
  expect(data.relatedTerms.map((row: { title: string }) => row.title)).toContain("R09候选400");
  expect(data.relatedTerms).toHaveLength(5);
  await getDb().delete(pages).where(inArray(pages.id, neighbors.map((p) => p.id)));
});

it("三类兴趣共享规范化、过滤和计分，主题不改变视角，匿名并发响应互不串用", async () => {
  const marcuse = (await listInterpreters()).find((row) => row.name === "马尔库塞")!;
  const school = (await listSchools()).find((row) => row.title === "法兰克福学派")!;
  const topic = (await listCategoryRows()).find((row) => row.name === "政治经济学")!;
  const [normal, direct, bySchool, byTopic, combined] = await Promise.all([
    discover({}), discover({ interpreters: [marcuse.pageId] }), discover({ schools: [school.id] }),
    discover({ categories: [topic.id] }),
    discover({ interpreters: [marcuse.pageId, marcuse.pageId, 999999, Number.MAX_SAFE_INTEGER], schools: [school.id, 999999], categories: [topic.id, 999999] }),
  ]).then((responses) => Promise.all(responses.map((res) => res.json())));
  expect(direct.relatedTerms[0]).toMatchObject({ title: "意识形态", interestMatchCount: 1 });
  expect(bySchool.relatedTerms[0].title).toBe("意识形态");
  expect(byTopic.relatedTerms[0].title).toBe("剩余价值");
  expect(byTopic.perspectives).toEqual(normal.perspectives);
  expect(combined.relatedTerms[0].title).toBe("意识形态");
  expect(combined.interestInterpreterIds).not.toContain(999999);
  expect(combined.relatedTerms.find((row: { title: string }) => row.title === "意识形态").interestMatchCount)
    .toBe(bySchool.relatedTerms[0].interestMatchCount);
});

it("直接与学派成员兴趣排前，其余保持热度顺序", async () => {
  const root = (await listTerms()).find((row) => row.title === "主体性")!;
  const rows = await listPerspectivesOfTerm(root.id);
  const direct = rows.find((p) => p.interpreterName === "德勒兹")!;
  const school = (await listSchools()).find((row) => row.title === "精神分析")!;
  const data = await (await discover({ interpreters: [direct.interpreterId], schools: [school.id] })).json();
  expect(data.perspectives.slice(0, 4).map((row: { title: string }) => row.title)).toEqual([
    "拉康论主体性", "德勒兹论主体性", "弗洛伊德论主体性", "阿尔都塞论主体性",
  ]);
});

it("已删除或错误类型的兴趣对象被过滤，隐藏视角不计入相关发现", async () => {
  const root = (await listTerms()).find((row) => row.title === "主体性")!;
  const marcuse = (await listInterpreters()).find((row) => row.name === "马尔库塞")!;
  const [deadInterpreter, deadSchool] = await getDb().insert(pages).values([
    { type: "interpreter", title: "R09失效诠释者", slug: "r09-dead-interpreter", deletedAt: new Date() },
    { type: "school", title: "R09失效学派", slug: "r09-dead-school", deletedAt: new Date() },
  ]).returning({ id: pages.id });
  await getDb().insert(interpreters).values({ pageId: deadInterpreter.id });
  await getDb().insert(schools).values({ pageId: deadSchool.id });
  await getDb().insert(schoolMembers).values({ schoolId: deadSchool.id, interpreterId: marcuse.pageId });
  const data = await (await discover({ interpreters: [root.id, deadInterpreter.id], schools: [root.id, deadSchool.id], categories: [999999] })).json();
  expect(data.interestInterpreterIds).toEqual([]);
  expect(data.relatedTerms.every((row: { interestMatchCount: number }) => row.interestMatchCount === 0)).toBe(true);
  const ideology = (await listTerms()).find((row) => row.title === "意识形态")!;
  const hidden = (await listPerspectivesOfTerm(ideology.id)).find((p) => p.interpreterId === marcuse.pageId)!;
  await getDb().update(pages).set({ deletedAt: new Date() }).where(eq(pages.id, hidden.pageId));
  try {
    const hiddenResult = await (await discover({ interpreters: [marcuse.pageId] })).json();
    expect(hiddenResult.relatedTerms.every((row: { interestMatchCount: number }) => row.interestMatchCount === 0)).toBe(true);
  } finally {
    await getDb().update(pages).set({ deletedAt: null }).where(eq(pages.id, hidden.pageId));
    await getDb().delete(pages).where(inArray(pages.id, [deadInterpreter.id, deadSchool.id]));
  }
});

it("发现请求校验三类正整数及每类50项上限，缺失或隐藏词条返回404", async () => {
  for (const interests of [null, [], { schools: "精神分析" }, { interpreters: [0] }, { categories: [1.5] },
    { schools: Array.from({ length: 51 }, (_, i) => i + 1) }]) {
    expect((await discover(interests)).status).toBe(400);
  }
  for (const id of ["0", "abc", "2147483648"]) {
    const res = await GET(new Request("http://localhost/api/discovery"), { params: Promise.resolve({ id }) });
    expect(res.status).toBe(400);
  }
  const missing = await GET(new Request("http://localhost/api/discovery"), { params: Promise.resolve({ id: "999999" }) });
  expect(missing.status).toBe(404);
  const badJSON = await GET(new Request("http://localhost/api/discovery?interests=broken"), { params: Promise.resolve({ id: "1" }) });
  expect(badJSON.status).toBe(400);
});
