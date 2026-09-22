import { randomUUID } from "node:crypto";
import { expect, test, type APIRequestContext } from "./fixtures";
import { cleanupTestContent } from "./content-cleanup";
import { toggleTheme } from "./navigation-fixture";

async function submit(request: APIRequestContext, data: Record<string, unknown>) {
  const response = await request.post("/api/submissions", { data });
  expect(response.status()).toBe(201);
  return response.json() as Promise<{ pageId: number; href: string }>;
}

test("长视角目录定位保持正文居中、标题锚点稳定且不进入标记正文", async ({ page }, testInfo) => {
  test.setTimeout(180_000);
  const titles = [`关于概念与阅读关系的长标题以及连续正文排版检验 ${randomUUID()}`, `阅读诠释者 ${randomUUID()}`];
  const signed = await page.request.post("/api/auth/sign-in/email", {
    data: { email: process.env.SEED_ADMIN_EMAIL ?? "admin@phoskywiki.local", password: process.env.SEED_ADMIN_PASSWORD },
  });
  expect(signed.ok()).toBe(true);
  try {
    const term = await submit(page.request, { kind: "new_term", title: titles[0] });
    const interpreter = await submit(page.request, { kind: "new_interpreter", title: titles[1] });
    const source = await submit(page.request, {
      kind: "new_perspective", termId: term.pageId, interpreterId: interpreter.pageId,
      content: `## 概念与**阅读**\n\n${"连续阅读的段落，保持可选择的完整文字。\n\n".repeat(25)}### 再论\n\n进一步阅读。\n\n## 再论\n\n结尾。`,
    });
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(source.href);
    const toc = page.getByRole("navigation", { name: "章节目录" });
    await expect(toc).toBeVisible();
    await expect(toc.getByRole("link")).toHaveText(["概念与阅读", "再论", "再论"]);
    await expect(page.locator(".wiki-content nav")).toHaveCount(0);
    const body = page.locator(".wiki-content");
    const box = (await body.boundingBox())!;
    expect(box.width).toBeGreaterThanOrEqual(680);
    expect(box.width).toBeLessThanOrEqual(720);
    expect(Math.abs(box.x + box.width / 2 - 720)).toBeLessThan(2);
    await expect(body).toHaveCSS("font-size", "18px");
    const last = toc.getByRole("link").last();
    const hash = (await last.getAttribute("href"))!;
    await last.click();
    const heading = page.locator(hash);
    await expect(heading).toHaveText("再论");
    await expect(heading).toBeInViewport();
    expect((await heading.boundingBox())!.y).toBeGreaterThanOrEqual(80);
    const ids = await body.locator("h2, h3").evaluateAll(nodes => nodes.map(node => node.id));
    expect(new Set(ids).size).toBe(3);
    await page.reload();
    await expect(heading).toBeInViewport();
    expect(await body.locator("h2, h3").evaluateAll(nodes => nodes.map(node => node.id))).toEqual(ids);
    for (const width of [1440, 1024, 375, 320]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(source.href);
      const summary = page.locator("summary", { hasText: "章节目录" });
      if (width < 1280) {
        await expect(toc).toHaveCount(0);
        await summary.focus();
        await page.keyboard.press("Enter");
        await expect(toc).toBeVisible();
      }
      await toc.getByRole("link").last().click();
      await expect(heading).toBeInViewport();
      expect((await heading.boundingBox())!.y).toBeGreaterThanOrEqual(80);
      for (const theme of ["light", "dark"] as const) {
        if (theme === "dark") await toggleTheme(page);
        await page.evaluate(() => window.scrollTo(0, 0));
        await page.evaluate(() => document.fonts.ready);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        await page.screenshot({ path: testInfo.outputPath(`reading-${width}-${theme}.png`) });
        await body.locator("p").first().scrollIntoViewIfNeeded();
        await page.screenshot({ path: testInfo.outputPath(`reading-body-${width}-${theme}.png`) });
      }
      await toggleTheme(page);
    }
    await page.route("**/*.woff2", route => route.abort());
    await page.reload();
    await page.evaluate(() => document.fonts.ready);
    await expect(body).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath("reading-font-fallback.png") });

  } finally {
    await cleanupTestContent(titles, page.request);
  }
});


test("无章节短视角不显示空目录，复制跨行内格式选区与真实双链仍可用", async ({ page, context }) => {
  test.setTimeout(180_000);
  const titles = [`短文词条 ${randomUUID()}`, `短文诠释者 ${randomUUID()}`];
  expect((await page.request.post("/api/auth/sign-in/email", {
    data: { email: process.env.SEED_ADMIN_EMAIL ?? "admin@phoskywiki.local", password: process.env.SEED_ADMIN_PASSWORD },
  })).ok()).toBe(true);
  try {
    const term = await submit(page.request, { kind: "new_term", title: titles[0] });
    const interpreter = await submit(page.request, { kind: "new_interpreter", title: titles[1] });
    const source = await submit(page.request, {
      kind: "new_perspective", termId: term.pageId, interpreterId: interpreter.pageId,
      content: "从[[主体性]]出发，**连续阅读**这段文字。\n\n> 编者提出的问题不自动成为原文摘录。",
    });
    await page.goto(source.href);
    await expect(page.getByRole("navigation", { name: "章节目录" })).toHaveCount(0);
    await expect(page.locator("summary", { hasText: "章节目录" })).toHaveCount(0);
    const body = page.locator(".wiki-content");
    await expect(body.locator("blockquote")).toHaveText("编者提出的问题不自动成为原文摘录。");
    const paragraph = body.locator(":scope > p").first();
    await paragraph.scrollIntoViewIfNeeded();
    await paragraph.evaluate(element => {
      const range = document.createRange();
      range.selectNodeContents(element);
      const selection = window.getSelection()!;
      selection.removeAllRanges();
      selection.addRange(range);
    });
    const quote = "从主体性出发，连续阅读这段文字。";
    expect(await page.evaluate(() => getSelection()?.toString())).toBe(quote);
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    const toolbar = page.getByRole("toolbar", { name: "划线工具条" });
    await toolbar.getByRole("button", { name: "复制所选文字" }).click();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(quote);
    await toolbar.getByRole("button", { name: /马克笔划线/ }).click();
    await page.reload();
    await expect(body.locator(".pw-mark").first()).toBeVisible();
    expect((await body.locator(".pw-mark").allTextContents()).join("")).toBe(quote);
    await body.getByRole("link", { name: "主体性", exact: true }).click();
    await expect(page).toHaveURL(/\/term\//);
    await expect(page.getByRole("heading", { level: 1, name: "主体性" })).toBeVisible();
  } finally {
    await cleanupTestContent(titles, page.request);
  }
});
