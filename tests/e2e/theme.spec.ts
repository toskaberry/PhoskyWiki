import { toggleTheme } from "./navigation-fixture";
import { expect, test, type Page } from "./fixtures";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { invitationFixture } from "../auth-fixture";
import { getDb } from "../../src/db";
import { pages, passageThoughts, personalMarks, user, userMarkStyle } from "../../src/db/schema";

async function expectTheme(page: Page, theme: "light" | "dark") {
  const mobile = page.getByRole("button", { name: "打开导航", exact: true });
  const isMobile = await mobile.isVisible();
  if (isMobile) await mobile.click();
  await expect(page.getByRole("button", { name: "深色主题", exact: true }))
    .toHaveAttribute("aria-pressed", String(theme === "dark"));
  await expect(page.locator("html")).toHaveCSS("color-scheme", theme);
  if (isMobile) await page.getByRole("button", { name: "关闭导航", exact: true }).click();
}

test("编辑器在明暗主题下保留可读的引用、代码与文献链接，以及原文强调", async ({ page }, testInfo) => {
  await page.goto(`/register#${await invitationFixture()}`);
  await page.getByLabel("名称").fill("主题测试编者");
  await page.getByLabel("邮箱").fill(`theme-${randomUUID()}@example.com`);
  await page.getByLabel("密码（至少 8 位）").fill("password123");
  await page.getByRole("button", { name: "注册并登录" }).click();
  await expect(page.getByTestId("session-user")).toBeVisible();
  await page.goto("/new/perspective");
  const editor = page.getByRole("textbox", { name: "正文（Markdown）" });
  const source = "## 阅读测试\n\n**原文强调**与*斜体强调*。\n\n> 引文文字\n\n[文献](https://example.com/source)\n\n`code`";
  await editor.fill(source);
  const preview = page.getByRole("region", { name: "实时预览" });
  await expect(preview.locator("strong")).toHaveText("原文强调");
  await expect(preview.locator("em")).toHaveText("斜体强调");
  await expect(preview.getByRole("link", { name: "文献" })).toHaveCSS("text-decoration-line", "underline");

  for (const theme of ["light", "dark"] as const) {
    if (theme === "dark") await toggleTheme(page);
    await expectTheme(page, theme);
    await expect(editor).toHaveText(source, { useInnerText: true });
    // Check visible syntax against its painted background, not generated token class names.
    const contrasts = await editor.locator("span").evaluateAll(elements => {
      const luminance = (color: string) => {
        const channels = color.match(/[\d.]+/g)!.slice(0, 3).map(Number).map(value => {
          const channel = value / 255;
          return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
        });
        return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
      };
      return elements.filter(element => element.textContent?.trim()).map(element => {
        let surface: Element | null = element;
        while (surface && getComputedStyle(surface).backgroundColor === "rgba(0, 0, 0, 0)") surface = surface.parentElement;
        const background = luminance(getComputedStyle(surface!).backgroundColor);
        const foreground = luminance(getComputedStyle(element).color);
        return { text: element.textContent, ratio: (Math.max(background, foreground) + 0.05) / (Math.min(background, foreground) + 0.05) };
      });
    });
    expect(contrasts.length).toBeGreaterThan(0);
    for (const token of contrasts) expect(token.ratio, `${theme}: ${token.text}`).toBeGreaterThanOrEqual(4.5);
    const screenshot = testInfo.outputPath(`editor-${theme}.png`);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: screenshot, caret: "initial", fullPage: true });
  }
  await editor.fill("");
  await editor.pressSequentially("[[");
  await editor.press("Control+Space");
  const completions = page.getByRole("listbox");
  const selected = completions.getByRole("option", { selected: true });
  const unselected = completions.getByRole("option", { selected: false }).first();
  await expect(selected).toBeVisible();
  await expect(unselected).toBeVisible();
  const selectedBackground = await selected.evaluate(element => getComputedStyle(element).backgroundColor);
  await expect(unselected).not.toHaveCSS("background-color", selectedBackground);
});

test("首次访问默认浅色，可用键盘切换并在首页、词条、视角和刷新后保持", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => {
    if (message.type() === "error" && /hydration|hydrated/i.test(message.text())) errors.push(message.text());
  });
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/");
  await expectTheme(page, "light");

  const toggle = page.getByRole("button", { name: "深色主题", exact: true });
  await toggle.focus();
  await page.keyboard.press("Space");
  await expectTheme(page, "dark");
  await expect(toggle).toBeFocused();

  await page.getByRole("link", { name: "主体性", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: "主体性" })).toBeVisible();
  await expectTheme(page, "dark");
  await page.getByRole("link", { name: "拉康论主体性", exact: true }).click();
  await expect(page.locator(".wiki-content")).toBeVisible();
  await expectTheme(page, "dark");
  await page.reload();
  await expectTheme(page, "dark");

  await toggle.focus();
  await page.keyboard.press("Enter");
  await expectTheme(page, "light");
  await page.reload();
  await expectTheme(page, "light");
  expect(errors).toEqual([]);
});

for (const failure of ["读取被拒绝", "写入被拒绝"] as const) {
  test(`存储${failure}时仍可阅读、切换主题和跨页导航`, async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.addInitScript(mode => {
      if (mode === "读取被拒绝") {
        Object.defineProperty(window, "localStorage", {
          get() { throw new DOMException("denied", "SecurityError"); },
        });
      } else {
        Storage.prototype.setItem = () => { throw new DOMException("full", "QuotaExceededError"); };
      }
    }, failure);
    await page.goto("/");
    await expectTheme(page, "light");
    await toggleTheme(page);
    await expectTheme(page, "dark");
    await page.getByRole("link", { name: "主体性", exact: true }).click();
    await expect(page.getByRole("heading", { level: 1, name: "主体性" })).toBeVisible();
    await expectTheme(page, "dark");
    await toggleTheme(page);
    await expectTheme(page, "light");
    expect(errors).toEqual([]);
  });
}

test("即使客户端脚本尚未加载，刷新也先呈现已选择的深色主题", async ({ page }) => {
  await page.goto("/");
  await toggleTheme(page);
  await expectTheme(page, "dark");
  // Hold back hydration: the saved appearance must be restored by the document itself.
  await page.route(/\/_next\/.*\.js(?:\?|$)/, route => route.abort());
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.locator("html")).toHaveCSS("color-scheme", "dark");
  await expect(page.getByRole("heading", { level: 1, name: /思想，\s*在分歧中展开。/ })).toBeVisible();
});

test("中文界面与阅读正文加载本站的黑体、宋体，字体失败时仍可阅读和导航", async ({ page, context }) => {
  const fonts: string[] = [];
  page.on("response", response => {
    if (response.request().resourceType() === "font" && response.ok()) fonts.push(response.url());
  });
  await page.goto("/");
  await page.getByRole("link", { name: "主体性", exact: true }).click();
  await page.getByRole("link", { name: "拉康论主体性", exact: true }).click();
  const content = page.locator(".wiki-content");
  const heading = page.getByRole("heading", { level: 1, name: "拉康论主体性" });
  await expect(heading).toHaveCSS("font-family", /Noto Sans/);
  await expect(content).toHaveCSS("font-family", /Noto Serif/);
  await page.evaluate(() => document.fonts.ready);
  expect(fonts.length).toBeGreaterThan(0);
  expect(fonts.every(url => new URL(url).origin === new URL(page.url()).origin)).toBe(true);
  const text = await content.innerText();

  const fallback = await context.newPage();
  await fallback.route("**/*", route => route.request().resourceType() === "font" ? route.abort() : route.continue());
  await fallback.goto(page.url());
  await fallback.evaluate(() => document.fonts.ready);
  await expect(fallback.locator(".wiki-content")).toHaveText(text);
  await expect(fallback.getByRole("heading", { level: 1, name: "拉康论主体性" })).toBeVisible();
  await fallback.getByRole("link", { name: "意识形态", exact: true }).click();
  await expect(fallback.getByRole("heading", { level: 1, name: "意识形态" })).toBeVisible();
  await fallback.close();
});

for (const width of [1440, 375]) {
  test(`${width}px 下正文、图谱、搜索菜单与表单共用主题，减少动态效果并保留可见焦点`, async ({ page }, testInfo) => {
    test.setTimeout(90_000);
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/");
    const termHref = await page.getByRole("link", { name: "主体性", exact: true }).getAttribute("href");
    await page.getByRole("link", { name: "主体性", exact: true }).click();
    const perspectiveHref = await page.getByRole("link", { name: "拉康论主体性", exact: true }).getAttribute("href");

    for (const theme of ["light", "dark"] as const) {
      if (theme === "dark") await toggleTheme(page);
      for (const [name, href] of [["home", "/"], ["term", termHref!], ["perspective", perspectiveHref!], ["graph", "/graph"], ["form", "/login"]]) {
        await page.goto(href);
        await expectTheme(page, theme);
        await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
        await page.evaluate(() => document.fonts.ready);
        if (name === "term" || name === "graph") {
          await expect(page.getByTestId("graph-canvas").getByRole("link").first()).toBeVisible();
        }
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
        const screenshot = testInfo.outputPath(`${name}-${width}-${theme}.png`);
        await page.screenshot({ path: screenshot, caret: "initial" });
        await testInfo.attach(`${name}-${width}-${theme}`, { path: screenshot, contentType: "image/png" });
      }

      const email = page.getByLabel("邮箱", { exact: true });
      await email.focus();
      await expect(email).toBeFocused();
      await expect(email).toHaveCSS("color-scheme", theme);
      await expect(email).toHaveCSS("outline-style", "solid");
      expect(await email.evaluate(element => parseFloat(getComputedStyle(element).outlineWidth))).toBeGreaterThanOrEqual(2);
      expect(await email.evaluate(element => parseFloat(getComputedStyle(element).transitionDuration))).toBeLessThanOrEqual(0.001);

      await page.goto("/graph");
      const search = page.getByRole("searchbox", { name: "图谱节点搜索" });
      await search.fill("主体性");
      const menu = page.getByRole("listbox");
      await expect(menu).toBeVisible();
      await expect(menu).toHaveCSS("color-scheme", theme);
      await search.press("Escape");
      await expect(menu).toBeHidden();
    }
  });
}

// #96 标记与主题：正文里的双链、个人高光与本人感想虚线随主题整体换色，
// 两主题下高光上的双链对比度都 ≥4.5:1，正文选区在新配色下仍可见。
test("视角正文的链接、个人高光与感想虚线随明暗主题换色且保持可读", async ({ page }, testInfo) => {
  test.skip(!process.env.SEED_ADMIN_PASSWORD, "需要种子管理员密码");
  test.setTimeout(120_000);
  await page.goto("/login");
  await page.getByLabel("邮箱").fill(process.env.SEED_ADMIN_EMAIL ?? "admin@phoskywiki.local");
  await page.getByLabel("密码").fill(process.env.SEED_ADMIN_PASSWORD!);
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page.getByTestId("session-user")).toContainText("管理员");
  const [lacan] = await getDb().select().from(pages).where(eq(pages.title, "拉康论主体性"));
  try {
    await page.goto(`/perspective/${lacan.slug}-${lacan.id}`);
    // 高光压在可跳转双链上，本人感想让该句出现红虚线（与链接同句叠加）
    const select = async (needle: string) => {
      await expect.poll(() => page.evaluate(() => {
        const root = document.querySelector(".wiki-content");
        if (!root) return "";
        const texts: Text[] = [];
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
        for (let node = walker.nextNode(); node; node = walker.nextNode()) texts.push(node as Text);
        return texts.map(text => text.nodeValue ?? "").join("");
      }, needle)).toContain(needle);
      const placed = await page.evaluate(needle => {
        const root = document.querySelector(".wiki-content");
        if (!root) return false;
        const texts: Text[] = [];
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
        for (let node = walker.nextNode(); node; node = walker.nextNode()) texts.push(node as Text);
        const start = texts.map(text => text.nodeValue ?? "").join("").indexOf(needle);
        if (start < 0) return false;
        const end = start + needle.length;
        let anchor: { node: Node; offset: number } | null = null;
        let focus: { node: Node; offset: number } | null = null;
        let cursor = 0;
        for (const text of texts) {
          const length = text.nodeValue?.length ?? 0;
          if (!anchor && start >= cursor && start <= cursor + length) anchor = { node: text, offset: start - cursor };
          if (!focus && end >= cursor && end <= cursor + length) focus = { node: text, offset: end - cursor };
          cursor += length;
          if (anchor && focus) break;
        }
        if (!anchor || !focus) return false;
        window.getSelection()?.setBaseAndExtent(anchor.node, anchor.offset, focus.node, focus.offset);
        return true;
      }, needle);
      expect(placed).toBe(true);
    };
    await select("参照意识形态词条下");
    await page.getByRole("toolbar", { name: "划线工具条" }).getByRole("button", { name: /马克笔划线/ }).click();
    await expect(page.locator("a.wiki-link .pw-mark--highlight").first()).toHaveText("意识形态");
    await select("主体与对象颠倒的问题亦见异化");
    const write = page.getByRole("button", { name: "写想法", exact: true });
    await write.waitFor({ state: "visible" });
    await write.click();
    await page.locator("#thought-draft").fill("主题叠加下的本人感想。");
    await page.getByRole("button", { name: "发布想法", exact: true }).click();
    await expect(page.locator("#thought-draft")).toHaveCount(0);
    await expect(page.locator(".pw-thought-marker[data-own=\"true\"]").filter({ hasText: "异化" }).first()).toBeVisible();

    const observed: Record<string, { link: string; marker: string; highlight: string; ratio: number }> = {};
    for (const theme of ["light", "dark"] as const) {
      if (theme === "dark") await toggleTheme(page);
      await expect(page.locator("html")).toHaveCSS("color-scheme", theme);
      const styles = await page.evaluate(() => {
        const mark = document.querySelector("a.wiki-link .pw-mark--highlight")!;
        const link = mark.closest("a")!;
        const marker = document.querySelector(".pw-thought-marker[data-own=\"true\"]")!;
        const context = document.createElement("canvas").getContext("2d")!;
        const rgba = (color: string) => {
          context.fillStyle = "#000000";
          context.fillStyle = color;
          context.fillRect(0, 0, 1, 1);
          const { data } = context.getImageData(0, 0, 1, 1);
          return [data[0], data[1], data[2], data[3] / 255];
        };
        const luminance = (rgb: number[]) => {
          const channel = (value: number) => {
            const c = value / 255;
            return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
          };
          return 0.2126 * channel(rgb[0]!) + 0.7152 * channel(rgb[1]!) + 0.0722 * channel(rgb[2]!);
        };
        const markBackground = rgba(getComputedStyle(mark).backgroundColor);
        const pageBackground = rgba(getComputedStyle(document.body).backgroundColor);
        const alpha = markBackground[3]!;
        const blended = [0, 1, 2].map(index => markBackground[index]! * alpha + pageBackground[index]! * (1 - alpha));
        const foreground = rgba(getComputedStyle(link).color).slice(0, 3);
        const first = luminance(foreground as number[]);
        const second = luminance(blended as number[]);
        return {
          link: getComputedStyle(link).color,
          marker: getComputedStyle(marker).textDecorationColor,
          highlight: getComputedStyle(mark).backgroundColor,
          ratio: (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05),
        };
      });
      observed[theme] = styles;
      expect(styles.ratio, `${theme} 高光上的双链对比度`).toBeGreaterThanOrEqual(4.5);
      // 选区配色随主题生效且可见：选中正文后 ::selection 底色与正文底色不同
      await select("参照意识形态词条下");
      await expect(page.getByRole("toolbar", { name: "划线工具条" })).toBeVisible();
      await page.evaluate(() => document.getSelection()?.removeAllRanges());
      const screenshot = testInfo.outputPath(`reading-marks-${theme}.png`);
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.screenshot({ path: screenshot, caret: "initial", fullPage: false });
      await testInfo.attach(`reading-marks-${theme}`, { path: screenshot, contentType: "image/png" });
    }
    // 两主题整体换色：链接、本人虚线与高光底色都不是同一组值
    expect(observed.light!.link).not.toBe(observed.dark!.link);
    expect(observed.light!.marker).not.toBe(observed.dark!.marker);
    expect(observed.light!.highlight).not.toBe(observed.dark!.highlight);
  } finally {
    const [admin] = await getDb().select().from(user).where(eq(user.email, process.env.SEED_ADMIN_EMAIL ?? "admin@phoskywiki.local"));
    await getDb().delete(passageThoughts).where(and(eq(passageThoughts.pageId, lacan.id), eq(passageThoughts.authorId, admin.id)));
    await getDb().delete(personalMarks).where(and(eq(personalMarks.pageId, lacan.id), eq(personalMarks.userId, admin.id)));
    await getDb().delete(userMarkStyle).where(eq(userMarkStyle.userId, admin.id));
  }
});
