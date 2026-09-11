import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, expect, it } from "vitest";
import { Meilisearch } from "meilisearch";
import { eq } from "drizzle-orm";
import { seedDatabase } from "@/db/seed";
import { getDb } from "@/db";
import { pages, terms, perspectives, revisions, interpreters, user, discussionPosts, termCategories, categories, submissions, links } from "@/db/schema";
import { GET as history } from "@/app/api/pages/[pageId]/history/route";
import { GET as graph } from "@/app/api/graph/site/route";
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkRehype from "remark-rehype";
import rehypeStringify from "rehype-stringify";
import { GET as search } from "@/app/api/search/route";
import { injectSearchIndex, resetSearchIndex } from "@/lib/search/search-service";
import { meiliSearchIndex } from "@/lib/search/meili-index";

const execute = promisify(execFile);
const searchHost = process.env.SEARCH_CONTRACT_HOST ?? "http://localhost:7700";
const searchUid = "consolidation-test";
const searchClient = new Meilisearch({ host: searchHost, apiKey: process.env.MEILI_MASTER_KEY ?? "dev-meili-master-key" });
afterAll(async () => { resetSearchIndex(); await searchClient.index(searchUid).delete().waitTask(); });
let directory: string;
let kept: number, removed: number, first: number, second: number, hidden: number;
let renamedTarget: number, reusedNameTarget: number;
const siteOrigin = new URL(process.env.BETTER_AUTH_URL ?? "http://localhost:3000").origin;
async function readHistory(id: number) {
  return history(new Request(`http://localhost/api/pages/${id}/history`), { params: Promise.resolve({ pageId: String(id) }) });
}
async function run(apply: boolean) {
  const database = new URL(process.env.DATABASE_URL!).pathname.slice(1);
  const result = await execute(process.execPath, ["--conditions", "react-server", "--import", "tsx", "scripts/consolidate-mvp.ts", "--database", database, "--groups", join(directory, "groups.json"), ...(apply ? ["--apply", "--backup", join(directory, "fixture-backup.txt")] : [])], { env: { ...process.env, MEILI_HOST: searchHost, MEILI_INDEX_UID: searchUid } });
  return JSON.parse(result.stdout);
}
beforeAll(async () => {
  await seedDatabase();
  directory = await mkdtemp(join(tmpdir(), "phosky-merge-"));
  await writeFile(join(directory, "groups.json"), JSON.stringify([{ title: "合并测试", sourceTitles: ["合并测试（哲学）", "合并测试（经济学）"] }]));
  // 测试库夹具可由 seed 重建；真实运维必须使用目标库备份。
  await writeFile(join(directory, "fixture-backup.txt"), "isolated seed fixture");
  const db = getDb();
  async function term(title: string) {
    const [p] = await db.insert(pages).values({ type: "term", title, slug: title }).returning();
    await db.insert(terms).values({ pageId: p.id }); return p.id;
  }
  kept = await term("合并测试（哲学）"); removed = await term("合并测试（经济学）");
  const [thinker] = await db.select().from(interpreters).innerJoin(pages, eq(pages.id, interpreters.pageId)).where(eq(pages.title, "马克思"));
  async function perspective(termId: number, content: string) {
    const [p] = await db.insert(pages).values({ type: "perspective", title: `马克思论${termId}`, slug: `merge-${termId}` }).returning();
    await db.insert(perspectives).values({ pageId: p.id, termId, interpreterId: thinker.interpreters.pageId });
    await db.insert(revisions).values({ pageId: p.id, content }); return p.id;
  }
  renamedTarget = await term("第三方新名");
  reusedNameTarget = await term("实际保留词条");
  first = await perspective(kept, `哲学解释完整保留 [[合并测试（经济学）|经济解释@马克思]] [[合并测试（经济学）]] [普通站内链接](/term/old-${removed}) [转义链接](/term/old&#45;${removed}?a=1&amp;b=2)\n\n[哲学出处][ref]\n\n[ref]: /term/old-${removed}`);
  second = await perspective(removed, `经济解释完整保留 [[合并测试（哲学）]] [[第三方旧名]] [精确站内链接](/perspective/old-${first}) <${siteOrigin}/term/old-${removed}>\n\n[经济出处][ref] [ref][] [ref]\n\n[ref]: /perspective/old-${first}`);
  // 等价于保存后目标改名、旧名被新来源复用：既有链接仍以原 id 为准。
  await getDb().insert(links).values([
    { sourcePageId: first, targetName: "合并测试（经济学）", targetPageId: reusedNameTarget },
    { sourcePageId: second, targetName: "第三方旧名", targetPageId: renamedTarget },
  ]);
  hidden = await term("隐藏夹具");
  await db.update(pages).set({ deletedAt: new Date() }).where(eq(pages.id, hidden));
  await perspective(hidden, "应被清除");
  const [author] = await db.insert(user).values({ id: "consolidation-fixture", name: "归并夹具", email: "consolidation-fixture@example.com" }).onConflictDoUpdate({ target: user.id, set: { name: "归并夹具" } }).returning();
  const [floor] = await db.insert(discussionPosts).values({ termId: removed, perspectiveId: second, authorId: author.id, content: "公开楼层" }).returning();
  await db.insert(discussionPosts).values({ termId: removed, parentId: floor.id, authorId: author.id, content: "公开回复" });
  await db.insert(submissions).values({ kind: "edit", pageId: second, submittedBy: author.id, quorum: 2, content: "来源待审不能发布" });
  await db.insert(submissions).values({ kind: "edit", pageId: first, submittedBy: author.id, quorum: 2, content: "保留页待审" });
  const [category] = await db.select().from(categories).limit(1);
  await db.insert(termCategories).values([{ termId: kept, categoryId: category.id }, { termId: removed, categoryId: category.id }]);
});

it("运维预览不改变公开页面；归并保留正文历史、清理来源并可重复执行", async () => {
  const preview = await run(false);
  expect(preview).toMatchObject({ applied: false, groups: [{ title: "合并测试", keepId: kept, perspectiveCount: 1 }] });
  expect((await readHistory(second)).status).toBe(200);
  const applied = await run(true);
  expect(applied.applied).toBe(true);
  injectSearchIndex(meiliSearchIndex({ host: searchHost, apiKey: process.env.MEILI_MASTER_KEY ?? "dev-meili-master-key", indexUid: searchUid }));
  const found = await (await search(new Request(`http://localhost/api/search?q=${encodeURIComponent("合并测试")}`))).json();
  expect(found.hits.map((hit: { pageId: number }) => hit.pageId)).toContain(kept);
  expect(found.hits.map((hit: { pageId: number }) => hit.pageId)).not.toContain(removed);
  expect((await readHistory(second)).status).toBe(404);
  expect((await readHistory(removed)).status).toBe(404);
  expect((await readHistory(hidden)).status).toBe(404);
  const state = await (await readHistory(first)).json();
  expect(state.revisions[0].content).toContain("## 合并测试（哲学）");
  expect(state.revisions[0].content).toContain("## 合并测试（经济学）");
  expect(state.revisions[0].content).toContain("[[合并测试|经济解释@马克思]]");
  expect(state.revisions[0].content).not.toContain("来源待审不能发布");
  expect(state.revisions[0].content).toContain("[[第三方新名|第三方旧名]]");
  expect(state.revisions[0].content).toContain("[[实际保留词条|合并测试（经济学）]]");
  expect(state.revisions[0].content).toContain(`/term/合并测试-${kept}`);
  expect(state.revisions[0].content).not.toContain(`/term/old-${removed}`);
  const html = String(await unified().use(remarkParse).use(remarkRehype).use(rehypeStringify).process(state.revisions[0].content));
  expect(html).toContain(`href="/term/${encodeURI(`合并测试-${kept}`)}">哲学出处</a>`);
  expect(html).toContain(`href="/term/${encodeURI(`合并测试-${kept}`)}?a=1&#x26;b=2">转义链接</a>`);
  expect(html).toContain(`href="${siteOrigin}/term/${encodeURI(`合并测试-${kept}`)}"`);
  expect(html).toContain(`href="/perspective/${encodeURI(`马克思论合并测试-${first}`)}">经济出处</a>`);
  expect(html.match(new RegExp(`href="/perspective/${encodeURI(`马克思论合并测试-${first}`)}">ref</a>`, "g"))).toHaveLength(2);
  expect(state.revisions.at(-1).content).toContain("哲学解释完整保留");
  const network = await (await graph()).json();
  expect(network.nodes.filter((node: { title: string }) => node.title.startsWith("合并测试"))).toMatchObject([{ id: kept, title: "合并测试", perspectiveCount: 1 }]);
  expect(network.edges).toEqual(expect.arrayContaining([
    expect.objectContaining({ source: Math.min(kept, renamedTarget), target: Math.max(kept, renamedTarget) }),
    expect.objectContaining({ source: Math.min(kept, reusedNameTarget), target: Math.max(kept, reusedNameTarget) }),
  ]));
  expect(await run(true)).toMatchObject({ groups: [], removedPages: 0, removedPosts: 0, removedRevisions: 0, removedSubmissions: 0 });
}, 60_000);
