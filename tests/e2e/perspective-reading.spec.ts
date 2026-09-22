import { randomUUID } from "node:crypto";
import { expect, test, type APIRequestContext, type Page } from "./fixtures";
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
    // 划线 POST 与 reload 是并发的：不等标记渲染就刷新会中断保存（曾随机失败）。
    await expect(body.locator(".pw-mark").first()).toBeVisible();
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

/* ---------------------------------------------------------------------------
 * F07（#95）：资料／感想／Agent 解读按需面板。
 * 验收：默认收起；宽屏在正文外留白展示、开关不压窄/不重排正文、阅读位置不动；
 * Esc 关闭后焦点回触发入口；关闭再打开保留本页状态（感想草稿、Agent 回答与
 * 阅读路径）；感想入口可回到原句；窄屏（含 375px）为可关闭覆盖层且维持只读边界。
 * ------------------------------------------------------------------------- */

const panelContent = "第一句包含部分引用。第二句继续讨论。\n\n## 连续\n\n" +
  "用于验证面板开关不重排正文的长段落，保持连续可选择的完整文字。\n\n".repeat(12) +
  "### 深入\n\n更多连续内容。\n\n## 结尾\n\n完。";

async function setupPanelPerspective(page: Page) {
  const signed = await page.request.post("/api/auth/sign-in/email", {
    data: { email: process.env.SEED_ADMIN_EMAIL ?? "admin@phoskywiki.local", password: process.env.SEED_ADMIN_PASSWORD },
  });
  expect(signed.ok()).toBe(true);
  const suffix = randomUUID();
  const titles = [`面板词条 ${suffix}`, `面板诠释者 ${suffix}`];
  const term = await submit(page.request, { kind: "new_term", title: titles[0] });
  const interpreter = await submit(page.request, { kind: "new_interpreter", title: titles[1] });
  const perspective = await submit(page.request, {
    kind: "new_perspective", termId: term.pageId, interpreterId: interpreter.pageId, content: panelContent,
  });
  const revision = (await (await page.request.get(`/api/pages/${perspective.pageId}/history`)).json()).revisions[0].id as number;
  const thoughtResponse = await page.request.post("/api/thoughts", {
    data: {
      pageId: perspective.pageId,
      anchor: { start: 0, end: 10, quote: "第一句包含部分引用。", baseRevisionId: String(revision) },
      content: "面板读者的公开想法", visibility: "public", style: "highlight",
    },
  });
  expect(thoughtResponse.status()).toBe(201);
  const thought = (await thoughtResponse.json()).thoughts[0] as { id: number };
  return { ...perspective, titles, thoughtId: thought.id };
}

test("按需面板默认收起：宽屏留白展示不重排正文，Esc 关焦点回入口，重开保留本页状态", async ({ page }) => {
  test.setTimeout(180_000);
  const source = await setupPanelPerspective(page);
  try {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(source.href);
    const triggers = page.getByRole("group", { name: "阅读面板入口" });
    await expect(triggers).toBeVisible();
    for (const name of ["资料", "感想", "Agent 解读"]) {
      await expect(triggers.getByRole("button", { name, exact: true })).toHaveAttribute("aria-expanded", "false");
    }
    const materials = page.getByRole("region", { name: "资料", exact: true });
    const thoughts = page.getByRole("region", { name: "感想", exact: true });
    const agent = page.getByRole("region", { name: "Agent 解读", exact: true });
    await expect(materials).toBeHidden();
    await expect(thoughts).toBeHidden();
    await expect(agent).toBeHidden();

    // 滚到正文中部再开面板：正文列的宽度/位置与阅读位置都不得变化
    const body = page.locator(".wiki-content");
    await body.locator("p").nth(6).scrollIntoViewIfNeeded();
    const before = await body.boundingBox();
    const scrollBefore = await page.evaluate(() => window.scrollY);

    const materialsTrigger = triggers.getByRole("button", { name: "资料", exact: true });
    await materialsTrigger.click();
    await expect(materials).toBeVisible();
    await expect(materials.getByRole("link", { name: source.titles[0] })).toBeVisible();
    const during = await body.boundingBox();
    expect(during!.width).toBe(before!.width);
    expect(during!.x).toBe(before!.x);
    expect(Math.abs(during!.x + during!.width / 2 - 720)).toBeLessThan(2);
    expect(await page.evaluate(() => window.scrollY)).toBe(scrollBefore);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

    // Esc 关闭：面板收起，焦点回到触发入口，阅读位置不动
    await page.keyboard.press("Escape");
    await expect(materials).toBeHidden();
    await expect(materialsTrigger).toBeFocused();
    expect(await page.evaluate(() => window.scrollY)).toBe(scrollBefore);

    // Agent 解读：回答与阅读路径保留本页状态（关闭再打开不丢）
    await page.route("https://model.example/v1/chat/completions", route => route.fulfill({ contentType: "text/event-stream", body: `data: ${JSON.stringify({ choices: [{ delta: { content: "1. [1] 入门\n2. [1] 深入\n参照说明文字。" } }] })}\n\ndata: [DONE]\n\n` }));
    await triggers.getByRole("button", { name: "Agent 解读", exact: true }).click();
    await agent.getByText("模型配置", { exact: true }).click();
    await agent.getByLabel("baseURL").fill("https://model.example/v1");
    await agent.getByLabel("API key").fill("test-agent-secret");
    await agent.getByLabel("模型名").fill("test-model");
    await agent.getByRole("button", { name: "保存配置" }).click();
    await agent.getByLabel("问题").fill("面板状态保留问题？");
    await agent.getByRole("button", { name: "生成阅读路径" }).click();
    const path = agent.getByRole("region", { name: "阅读路径" });
    await expect(path.getByRole("listitem").first()).toBeVisible();
    await expect(agent.getByTestId("agent-answer")).toContainText("入门");
    await page.keyboard.press("Escape");
    await expect(agent).toBeHidden();
    await triggers.getByRole("button", { name: "Agent 解读", exact: true }).click();
    await expect(agent.getByTestId("agent-answer")).toContainText("入门");
    await expect(agent.getByLabel("问题")).toHaveValue("面板状态保留问题？");
    await expect(path.getByRole("listitem").first()).toBeVisible();
    await page.keyboard.press("Escape");

    // 感想草稿：面板开关不清空未发布的草稿（既有恢复语义）
    const paragraph = body.locator(":scope > p").nth(4);
    await paragraph.scrollIntoViewIfNeeded();
    await paragraph.evaluate(element => {
      const range = document.createRange();
      range.selectNodeContents(element);
      const selection = window.getSelection()!;
      selection.removeAllRanges();
      selection.addRange(range);
    });
    const write = page.getByRole("button", { name: "写想法", exact: true });
    await write.waitFor({ state: "visible" });
    await write.click();
    await page.locator("#thought-draft").fill("面板开关不应丢掉这份草稿");
    await materialsTrigger.click();
    await expect(materials).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.locator("#thought-draft")).toHaveValue("面板开关不应丢掉这份草稿");
    await page.getByRole("button", { name: "收起", exact: true }).click();
    await expect(page.locator("#thought-draft")).toHaveCount(0);

    // 感想面板：列出本页感想并可回到原句（进入对应句子的想法面板）
    const thoughtsTrigger = triggers.getByRole("button", { name: "感想", exact: true });
    await thoughtsTrigger.click();
    await expect(thoughts).toBeVisible();
    await expect(thoughts).toContainText("面板读者的公开想法");
    await expect(materials).toBeHidden();
    await thoughts.getByRole("button", { name: "回到原句" }).click();
    const sentencePanel = page.getByRole("dialog", { name: "句子想法" });
    await expect(sentencePanel).toContainText("面板读者的公开想法");
    await expect(page.locator(`#thought-${source.thoughtId}`)).toBeFocused();
    await sentencePanel.getByRole("button", { name: "关闭想法面板" }).click();
    await expect(sentencePanel).toBeHidden();
    // 再次以触发入口开-关：关闭后焦点仍在触发入口
    await thoughtsTrigger.click();
    await expect(thoughts).toBeVisible();
    await thoughtsTrigger.click();
    await expect(thoughts).toBeHidden();
    await expect(thoughtsTrigger).toBeFocused();

    // 空间不足的宽度（1024）：同一个面板以可关闭覆盖层出现，仍不重排正文
    await page.setViewportSize({ width: 1024, height: 900 });
    await page.evaluate(() => window.scrollTo(0, 300));
    const overlayBefore = await body.boundingBox();
    const overlayScroll = await page.evaluate(() => window.scrollY);
    await materialsTrigger.click();
    await expect(materials).toBeVisible();
    const overlayBox = await materials.boundingBox();
    expect(overlayBox!.x).toBeGreaterThanOrEqual(0);
    expect(overlayBox!.x + overlayBox!.width).toBeLessThanOrEqual(1024);
    const overlayDuring = await body.boundingBox();
    expect(overlayDuring!.width).toBe(overlayBefore!.width);
    expect(overlayDuring!.x).toBe(overlayBefore!.x);
    expect(await page.evaluate(() => window.scrollY)).toBe(overlayScroll);
    await page.keyboard.press("Escape");
    await expect(materials).toBeHidden();
    await expect(materialsTrigger).toBeFocused();
  } finally {
    await cleanupTestContent(source.titles, page.request);
  }
});

test("375px 手机：目录与资料、感想面板为窄屏展开层，感想维持只读边界", async ({ page }) => {
  test.setTimeout(180_000);
  const source = await setupPanelPerspective(page);
  try {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto(source.href);
    const triggers = page.getByRole("group", { name: "阅读面板入口" });
    await expect(triggers).toBeVisible();

    // 章节目录仍是窄屏展开层（details）
    const summary = page.locator("summary", { hasText: "章节目录" });
    await summary.click();
    const toc = page.getByRole("navigation", { name: "章节目录" });
    await expect(toc).toBeVisible();
    await toc.getByRole("link").last().click();
    await expect(page.getByRole("heading", { name: "结尾", exact: true })).toBeInViewport();

    // 资料面板：覆盖层展开，可关闭，关闭后焦点回触发入口
    const materials = page.getByRole("region", { name: "资料", exact: true });
    const materialsTrigger = triggers.getByRole("button", { name: "资料", exact: true });
    await materialsTrigger.click();
    await expect(materials).toBeVisible();
    const box = await materials.boundingBox();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(375);
    await materials.getByRole("button", { name: "关闭资料面板" }).click();
    await expect(materials).toBeHidden();
    await expect(materialsTrigger).toBeFocused();

    // 感想面板：可阅读已有感想，但不出现发表/赞同/回复等写入口（只读边界）
    const thoughts = page.getByRole("region", { name: "感想", exact: true });
    const thoughtsTrigger = triggers.getByRole("button", { name: "感想", exact: true });
    await thoughtsTrigger.click();
    await expect(thoughts).toBeVisible();
    await expect(thoughts).toContainText("面板读者的公开想法");
    await expect(thoughts.getByRole("button", { name: /赞同|回复|设为|删除|发表/ })).toHaveCount(0);
    await thoughts.getByRole("button", { name: "回到原句" }).click();
    const sentencePanel = page.getByRole("dialog", { name: "句子想法" });
    await expect(sentencePanel).toContainText("面板读者的公开想法");
    await expect(sentencePanel.getByRole("button", { name: /赞同|回复想法|设为|删除|发表/ })).toHaveCount(0);
    await sentencePanel.getByRole("button", { name: "关闭想法面板" }).click();
    await expect(sentencePanel).toBeHidden();
    // 「回到原句」定位时感想面板已自动收起；窄屏覆盖层铺满视口时触发入口会被盖住，
    // 用面板内关闭按钮收起，焦点仍回到触发入口。
    await thoughtsTrigger.click();
    await expect(thoughts).toBeVisible();
    await thoughts.getByRole("button", { name: "关闭感想面板" }).click();
    await expect(thoughts).toBeHidden();
    await expect(thoughtsTrigger).toBeFocused();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
  } finally {
    await cleanupTestContent(source.titles, page.request);
  }
});

test("覆盖面板的正反向 Tab 只经过当前可见控件，关闭后恢复焦点与阅读位置", async ({ page }) => {
  test.setTimeout(180_000);
  const source = await setupPanelPerspective(page);
  try {
    for (const width of [1024, 375]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(source.href);
      const triggers = page.getByRole("group", { name: "阅读面板入口" });
      for (const name of ["资料", "感想", "Agent 解读"]) {
        const trigger = triggers.getByRole("button", { name, exact: true });
        const panel = page.getByRole("region", { name, exact: true });
        await trigger.click();
        await expect(panel).toBeFocused();
        const scroll = await page.evaluate(() => window.scrollY);
        // 包含刚打开时焦点位于 section，以及遍历末端后的反向循环。
        for (const key of ["Shift+Tab", ...Array<string>(12).fill("Tab"), ...Array<string>(12).fill("Shift+Tab")]) {
          await page.keyboard.press(key);
          expect(await panel.evaluate(element => element.contains(document.activeElement))).toBe(true);
          expect(await page.evaluate(() => window.scrollY)).toBe(scroll);
        }
        if (name === "Agent 解读") {
          await panel.locator("summary").click();
          await panel.getByLabel("API key").fill("focus-regression");
          await panel.getByRole("button", { name: "生成阅读路径" }).focus();
          await page.keyboard.press("Tab");
          await expect(panel.getByRole("button", { name: "关闭Agent 解读面板" })).toBeFocused();
        }
        await page.keyboard.press("Escape");
        await expect(panel).toBeHidden();
        await expect(trigger).toBeFocused();
        expect(await page.evaluate(() => window.scrollY)).toBe(scroll);
      }
    }
  } finally {
    await cleanupTestContent(source.titles, page.request);
  }
});
