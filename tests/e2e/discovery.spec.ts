import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { getDb } from "../../src/db";
import { pages, interpreters, schools, categories, schoolMembers } from "../../src/db/schema";
import { toggleTheme } from "./navigation-fixture";
import { expect, test } from "./fixtures";

test("搜索无匹配时保留查询，并可清除后重新搜索", async ({ page }) => {
  const query = `f04nomatch${randomUUID().replaceAll("-", "")}`;
  await page.goto(`/search?q=${encodeURIComponent(query)}&type=term`);
  const main = page.getByRole("main");
  await expect(main.getByText(`没有与「${query}」匹配的内容。`)).toBeVisible();
  await expect(main.getByRole("textbox", { name: "全站搜索" })).toHaveValue(query);
  await main.getByRole("link", { name: "清除搜索", exact: true }).click();
  await expect(page).toHaveURL(/\/search$/);
  await expect(main.getByRole("textbox", { name: "全站搜索" })).toHaveValue("");
  await main.getByRole("link", { name: "浏览词条索引", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: "词条索引" })).toBeVisible();
});

test("不可用档案提供明确状态与索引返回入口", async ({ page }) => {
  await page.goto("/interpreter/2147483647");
  const main = page.getByRole("main");
  await expect(main.getByRole("heading", { name: "页面暂不可用" })).toBeVisible();
  await main.getByRole("link", { name: "诠释者索引", exact: true }).click();
  await expect(main.getByRole("heading", { level: 1, name: "诠释者索引" })).toBeVisible();
});

test("搜索保留类型筛选、联想与真实视角导航", async ({ page }) => {
  test.skip(!process.env.E2E_MEILI_HOST, "Requires the isolated real search service");
  await page.goto("/search?q=主体性");
  const main = page.getByRole("main");
  await main.getByRole("navigation", { name: "类型分面" }).getByRole("link", { name: /^视角/ }).click();
  await expect(page).toHaveURL(/type=perspective/);
  await expect(main.getByRole("listbox")).toHaveCount(0);
  await expect(main.getByRole("navigation", { name: "类型分面" }).getByRole("link", { name: /^视角/ })).toHaveAttribute("aria-current", "page");
  await main.getByRole("link", { name: "拉康论主体性", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: "拉康论主体性" })).toBeVisible();
  await page.goto("/search");
  await main.getByRole("textbox", { name: "全站搜索" }).fill("拉康");
  const suggestions = main.getByRole("listbox");
  await expect(suggestions).toBeVisible();
  await suggestions.getByRole("button", { name: "拉康 诠释者", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: "拉康" })).toBeVisible();
  await main.getByRole("link", { name: "拉康论主体性", exact: true }).click();
  await expect(page).toHaveURL(/\/perspective\//);
});

for (const width of [1440, 375]) {
  for (const theme of ["light", "dark"] as const) {
    test(`发现页面：${width}px ${theme} 的长标题、缺失资料与真实导航`, async ({ page }, testInfo) => {
      const suffix = randomUUID();
      const longName = "未收录资料的思想家与概念之间的关系".repeat(3) + suffix;
      const longSchool = "跨越多个问题领域的学派档案".repeat(3) + suffix;
      const longCategory = "持续追问概念与历史的知识主题".repeat(3) + suffix;
      const db = getDb();
      const fixture = await db.transaction(async tx => {
        const [person] = await tx.insert(pages).values({ type: "interpreter", title: longName, slug: `f04-person-${suffix}` }).returning();
        await tx.insert(interpreters).values({ pageId: person.id });
        const [school] = await tx.insert(pages).values({ type: "school", title: longSchool, slug: `f04-school-${suffix}` }).returning();
        await tx.insert(schools).values({ pageId: school.id });
        const [affiliation] = await tx.insert(pages).values({ type: "school", title: "人物资料中的学派" + "LongSchoolName".repeat(10) + suffix, slug: `f04-affiliation-${suffix}` }).returning();
        await tx.insert(schools).values({ pageId: affiliation.id });
        await tx.insert(schoolMembers).values({ schoolId: affiliation.id, interpreterId: person.id });
        const [category] = await tx.insert(categories).values({ name: longCategory, slug: `f04-category-${suffix}` }).returning();
        return { person, school, affiliation, category };
      });
      try {
        await page.setViewportSize({ width, height: 900 });
        await page.goto("/interpreters");
        if (theme === "dark") await toggleTheme(page);
        const main = page.getByRole("main");
        async function capture(name: string) {
          await expect(page.locator("html")).toHaveCSS("color-scheme", theme);
          await page.evaluate(() => document.fonts.ready);
          expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width + 1);
          const path = testInfo.outputPath(`${name}-${width}-${theme}.png`);
          await page.screenshot({ path, animations: "disabled" });
          await testInfo.attach(name, { path, contentType: "image/png" });
        }
        await main.getByRole("link", { name: longName, exact: true }).scrollIntoViewIfNeeded();
        await capture("interpreter-index-long");
        await main.getByRole("link", { name: longName, exact: true }).click();
        await expect(main.getByRole("heading", { level: 1, name: longName })).toBeVisible();
        await expect(main.getByRole("complementary", { name: "人物资料" })).toContainText("暂未收录");
        await expect(main.getByText("该诠释者还没有已收录的视角。", { exact: true })).toBeVisible();
        await expect(main.getByRole("complementary", { name: "人物资料" }).getByRole("link", { name: fixture.affiliation.title, exact: true })).toBeVisible();
        await capture("interpreter-missing");
        await main.getByRole("link", { name: "返回诠释者索引", exact: true }).click();
        await expect(main.getByRole("heading", { level: 1, name: "诠释者索引" })).toBeVisible();

        await page.goto("/schools");
        await main.getByRole("link", { name: longSchool, exact: true }).scrollIntoViewIfNeeded();
        await capture("school-index-long");
        await main.getByRole("link", { name: longSchool, exact: true }).click();
        await expect(main.getByText("该学派暂无成员诠释者。", { exact: true })).toBeVisible();
        await expect(main.getByText("成员还没有已收录的视角，暂无法派生核心词条。", { exact: true })).toBeVisible();
        await capture("school-empty");

        await page.goto("/categories");
        await main.getByRole("link", { name: longCategory, exact: true }).scrollIntoViewIfNeeded();
        await capture("category-index-long");
        await main.getByRole("link", { name: longCategory, exact: true }).click();
        await expect(main.getByText("该分类下暂无词条。", { exact: true })).toBeVisible();
        await capture("category-empty");
        await main.getByRole("link", { name: "返回分类索引", exact: true }).click();
        await expect(main.getByRole("heading", { level: 1, name: "分类" })).toBeVisible();

        await page.goto("/terms");
        await capture("term-index");
        await main.getByRole("link", { name: "主体性", exact: true }).click();
        await expect(main.getByRole("heading", { level: 1, name: "主体性" })).toBeVisible();
        if (process.env.E2E_MEILI_HOST) {
          await page.goto("/search?q=主体性");
          await expect(main.getByRole("link", { name: "主体性", exact: true })).toBeVisible();
          await capture("search-results");
        }
      } finally {
        await db.delete(categories).where(eq(categories.id, fixture.category.id));
        await db.delete(pages).where(inArray(pages.id, [fixture.person.id, fixture.school.id, fixture.affiliation.id]));
      }
    });
  }
}

for (const refocus of [false, true]) {
  test(`联想延迟返回遵循读者${refocus ? "重新聚焦" : "关闭"}意图`, async ({ page }) => {
    test.skip(!process.env.E2E_MEILI_HOST, "Requires the isolated real search service");
    await page.goto("/search");
    const main = page.getByRole("main");
    const input = main.getByRole("textbox", { name: "全站搜索" });
    let release!: () => void;
    let received!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const pending = new Promise<void>(resolve => { received = resolve; });
    await page.route("**/api/search/suggest?*", async route => {
      const response = await route.fetch();
      received();
      await gate;
      await route.fulfill({ response });
    });
    await input.fill("拉康");
    await pending;
    await main.getByRole("heading", { level: 1, name: "全站搜索" }).click();
    if (refocus) await input.focus();
    const response = page.waitForResponse(url => url.url().includes("/api/search/suggest?"));
    release();
    await (await response).finished();
    // Let the browser paint the completed response before checking a closed list.
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    if (!refocus) {
      await expect(main.getByRole("listbox")).toHaveCount(0);
      await input.focus();
    }
    await expect(main.getByRole("listbox")).toBeVisible();
    await main.getByRole("listbox").getByRole("button", { name: "拉康 诠释者", exact: true }).click();
    await expect(main.getByRole("heading", { level: 1, name: "拉康" })).toBeVisible();
  });
}
