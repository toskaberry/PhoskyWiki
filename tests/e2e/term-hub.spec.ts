import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "./fixtures";
import { cleanupTestContent } from "./content-cleanup";
import { toggleTheme } from "./navigation-fixture";

async function openTerm(page: Page) {
  await page.goto("/terms");
  await page.getByRole("link", { name: "主体性", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: "主体性" })).toBeVisible();
}

test("词条资料、反链与邻居保留真实导航，视角目录支持键盘展开与收起", async ({ page }) => {
  test.setTimeout(90_000);
  await openTerm(page);
  const directory = page.getByRole("region", { name: /^诠释者视角/ });
  await expect(directory.getByRole("listitem")).toHaveCount(5);
  const expand = directory.getByRole("button", { name: /展开全部/ });
  await expand.focus();
  await page.keyboard.press("Enter");
  await expect(directory.getByRole("link", { name: "德勒兹论主体性", exact: true })).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(directory.getByRole("listitem")).toHaveCount(5);

  const resources = page.getByRole("region", { name: "词条资料", exact: true });
  await expect(resources).toContainText("主体、subject");
  const category = resources.getByRole("link", { name: "主体理论", exact: true });
  const categoryHref = await category.getAttribute("href");
  expect(categoryHref).toMatch(/^\/categories\//);
  await category.click();
  await expect(page).toHaveURL(new URL(categoryHref!, page.url()).href);
  await openTerm(page);
  const explore = page.getByRole("region", { name: "继续探索", exact: true });
  const related = explore.getByTestId("related-terms").getByRole("link").first();
  const relatedTitle = await related.textContent();
  await related.click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(relatedTitle!);
  await openTerm(page);
  const backlink = explore.getByRole("region", { name: /^反链/ }).getByRole("link").first();
  const sourceTitle = await backlink.textContent();
  await backlink.click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(sourceTitle!);
  await expect(page).toHaveURL(/\/perspective\//);
  await openTerm(page);
  await explore.getByRole("list", { name: "邻居词条" }).getByRole("link", { name: /^意识形态（/ }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("意识形态");
});

for (const width of [1440, 375]) {
  test(`词条枢纽 ${width}px：明暗主题、长标题与无可选资料截图`, async ({ page }, testInfo) => {
    test.setTimeout(90_000);
    await page.setViewportSize({ width, height: 1000 });
    await openTerm(page);
    for (const theme of ["light", "dark"]) {
      if (theme === "dark") await toggleTheme(page);
      await page.evaluate(() => document.fonts.ready);
      await expect(page.getByTestId("graph-canvas")).toBeVisible();
      await expect(page.getByTestId("graph-canvas").getByRole("link").first()).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
      await page.screenshot({ path: testInfo.outputPath(`term-${width}-${theme}.png`), fullPage: true });
    }
    const title = `概念的历史语境与不同诠释路径：${"LongUnbrokenConceptTitle".repeat(3)} ${randomUUID()}`;
    const signed = await page.request.post("/api/auth/sign-in/email", { data: {
      email: process.env.SEED_ADMIN_EMAIL, password: process.env.SEED_ADMIN_PASSWORD,
    } });
    expect(signed.ok()).toBe(true);
    try {
      const result = await page.request.post("/api/submissions", { data: { kind: "new_term", title } });
      expect(result.status()).toBe(201);
      const term = await result.json();
      await page.goto(term.href);
      for (const theme of ["dark", "light"]) {
        if (theme === "light") await toggleTheme(page);
        await expect(page.getByRole("heading", { level: 1 })).toHaveText(title);
        await expect(page.getByText("该词条暂无诠释者的视角。", { exact: true })).toBeVisible();
        const resources = page.getByRole("region", { name: "词条资料", exact: true });
        await expect(resources).not.toContainText("关键文本");
        await expect(resources).toContainText("暂无分类");
        await expect(page.getByRole("region", { name: "继续探索", exact: true })).toContainText("暂无视角引用本页");
        await expect(page.getByRole("heading", { name: "Agent 解读", exact: true })).toBeVisible();
        const comments = page.getByRole("region", { name: "词条总评论", exact: true });
        await expect(comments).toBeVisible();
        if (width === 375) await expect(comments.getByRole("textbox")).toHaveCount(0);
        await page.evaluate(() => document.fonts.ready);
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
        await page.screenshot({ path: testInfo.outputPath(`empty-long-${width}-${theme}.png`), fullPage: true });
      }
    } finally {
      await cleanupTestContent([title], page.request);
    }
  });
}


test("可选关键文本按已有作品信息显示并保留来源链接", async ({ page }) => {
  const title = `F05 参考资料 ${randomUUID()}`;
  const signed = await page.request.post("/api/auth/sign-in/email", { data: {
    email: process.env.SEED_ADMIN_EMAIL, password: process.env.SEED_ADMIN_PASSWORD,
  } });
  expect(signed.ok()).toBe(true);
  try {
    const result = await page.request.post("/api/submissions", { data: {
      kind: "new_term", title,
      keyTexts: [{ title: "资料展示测试作品", author: "测试署名", year: "2026", url: "https://example.com/f05-source" }],
    } });
    expect(result.status()).toBe(201);
    await page.goto((await result.json()).href);
    const resources = page.getByRole("region", { name: "词条资料", exact: true });
    await expect(resources.getByRole("link", { name: "资料展示测试作品", exact: true })).toHaveAttribute("href", "https://example.com/f05-source");
    await expect(resources).toContainText("测试署名（2026）");
  } finally {
    await cleanupTestContent([title], page.request);
  }
});
