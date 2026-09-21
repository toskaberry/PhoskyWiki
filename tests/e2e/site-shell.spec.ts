import { expect, test } from "./fixtures";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { getDb } from "../../src/db";
import { user } from "../../src/db/schema";
import { fixtureRegister } from "./auth-fixture";
import { openAccountMenu, toggleTheme } from "./navigation-fixture";

test("桌面页头提供检索、三轴与图谱，键盘可跳过导航并从页尾继续浏览", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await page.keyboard.press("Tab");
  const skip = page.getByRole("link", { name: "跳到主要内容", exact: true });
  await expect(skip).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator("#main-content")).toBeFocused();
  const banner = page.getByRole("banner");
  for (const [label, href, heading] of [
    ["词条", "/terms", "词条索引"],
    ["诠释者", "/interpreters", "诠释者索引"],
    ["学派", "/schools", "学派"],
    ["图谱", "/graph", "全站图谱"],
  ]) {
    await banner.getByRole("link", { name: label, exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`${href}$`));
    await expect(page.getByRole("heading", { level: 1, name: heading, exact: true })).toBeVisible();
  }
  await banner.getByRole("textbox", { name: "全站搜索", exact: true }).fill("主体性");
  await banner.getByRole("textbox", { name: "全站搜索", exact: true }).press("Enter");
  await expect(page).toHaveURL(/\/search\?q=/);
  await expect(page.getByRole("heading", { level: 1, name: "全站搜索" })).toBeVisible();
  await banner.getByRole("button", { name: "更多导航", exact: true }).click();
  const more = page.getByRole("dialog", { name: "更多导航", exact: true });
  await more.getByRole("link", { name: "分类", exact: true }).click();
  await expect(page).toHaveURL(/\/categories$/);
  await expect(more).toBeHidden();
  await page.getByRole("contentinfo").getByRole("link", { name: "浏览兴趣", exact: true }).click();
  await expect(page).toHaveURL(/\/interests$/);
  await expect(page.getByRole("heading", { level: 1, name: "兴趣标签" })).toBeVisible();
});

test.describe("手机导航", () => {
  test.use({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true });

  test("展开后可完整导航，关闭恢复触发焦点与阅读位置", async ({ page }) => {
    await page.goto("/");
    await page.evaluate(() => window.scrollTo(0, 600));
    const position = await page.evaluate(() => window.scrollY);
    const trigger = page.getByRole("button", { name: "打开导航", exact: true });
    await trigger.tap();
    const panel = page.getByRole("dialog", { name: "站点导航", exact: true });
    await expect(panel).toBeVisible();
    for (const name of ["词条", "诠释者", "学派", "图谱", "分类", "兴趣", "搜索", "登录", "注册"]) {
      await expect(panel.getByRole("link", { name, exact: true })).toBeVisible();
    }
    await expect(panel.getByRole("button", { name: "深色主题", exact: true })).toBeVisible();
    await panel.getByRole("button", { name: "关闭导航", exact: true }).tap();
    await expect(panel).toBeHidden();
    await expect(trigger).toBeFocused();
    expect(await page.evaluate(() => window.scrollY)).toBeCloseTo(position, 0);

    await trigger.tap();
    const close = panel.getByRole("button", { name: "关闭导航", exact: true });
    await expect(close).toBeFocused();
    await page.keyboard.press("Shift+Tab");
    await expect(panel.getByRole("link", { name: "注册", exact: true })).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(close).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(panel).toBeHidden();
    await expect(trigger).toBeFocused();
    expect(await page.evaluate(() => window.scrollY)).toBeCloseTo(position, 0);

    await trigger.tap();
    await panel.getByRole("link", { name: "诠释者", exact: true }).tap();
    await expect(page).toHaveURL(/\/interpreters$/);
    await expect(page.getByRole("heading", { level: 1, name: "诠释者索引" })).toBeVisible();
    await expect(panel).toBeHidden();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });

  test("搜索按钮与次级导航可触摸到达，登录入口不暴露编者操作", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("banner").getByRole("link", { name: "搜索", exact: true }).tap();
    await expect(page).toHaveURL(/\/search$/);
    for (const [name, path] of [["词条", "/terms"], ["学派", "/schools"], ["图谱", "/graph"], ["分类", "/categories"], ["兴趣", "/interests"], ["登录", "/login"], ["注册", "/register"]]) {
      const menu = await openAccountMenu(page);
      await expect(menu.getByRole("link", { name: "创建词条", exact: true })).toHaveCount(0);
      await expect(menu.getByRole("link", { name: "审核队列", exact: true })).toHaveCount(0);
      await menu.getByRole("link", { name, exact: true }).tap();
      await expect(page).toHaveURL(new RegExp(`${path}$`));
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await expect(menu).toBeHidden();
    }
  });
});

for (const width of [1440, 375]) {
  test.describe(`${width}px 账户与布局`, () => {
    test.use({ viewport: { width, height: 900 }, hasTouch: width === 375, isMobile: width === 375 });
    test("游客菜单与页尾在明暗主题中可读", async ({ page }, testInfo) => {
      await page.goto("/");
      for (const theme of ["light", "dark"] as const) {
        if (theme === "dark") await toggleTheme(page);
        await page.evaluate(() => { window.scrollTo(0, 0); return document.fonts.ready; });
        await page.screenshot({ path: testInfo.outputPath(`guest-${width}-${theme}-header.png`), caret: "initial" });
        const trigger = page.getByRole("button", { name: width === 375 ? "打开导航" : "账户菜单", exact: true });
        await trigger.focus();
        await page.keyboard.press("Enter");
        const menu = page.getByRole("dialog", { name: width === 375 ? "站点导航" : "账户菜单", exact: true });
        await expect(menu.getByRole("link", { name: "登录", exact: true })).toBeVisible();
        await expect(menu.getByRole("link", { name: "注册", exact: true })).toBeVisible();
        await page.screenshot({ path: testInfo.outputPath(`guest-${width}-${theme}-menu.png`), caret: "initial" });
        await page.keyboard.press("Escape");
        await expect(trigger).toBeFocused();
        const footer = page.getByRole("contentinfo");
        await expect(footer.getByRole("link", { name: "检索全站", exact: true })).toHaveAttribute("href", "/search");
        await footer.screenshot({ path: testInfo.outputPath(`footer-${width}-${theme}.png`), caret: "initial" });
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
      }
    });

    for (const role of ["editor", "admin", "superadmin"] as const) {
      test(`${role} 的长用户名、创建和管理入口符合权限`, async ({ page }, testInfo) => {
        const name = `跨领域阅读与文献整理编者${"LongUnbrokenName".repeat(5)}`;
        const response = await fixtureRegister(page.request, { data: { name, email: `shell-${randomUUID()}@example.com`, password: "shell-password123" } });
        expect(response.ok(), await response.text()).toBe(true);
        const { user: account } = await response.json();
        try {
          await getDb().update(user).set({ role }).where(eq(user.id, account.id));
          await page.goto("/");
          const banner = page.getByRole("banner");
          await expect(banner.getByRole("link", { name: "通知", exact: true })).toBeVisible();
          for (const theme of ["light", "dark"] as const) {
            if (theme === "dark") await toggleTheme(page);
            await page.evaluate(() => document.fonts.ready);
            expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
            await page.screenshot({ caret: "initial", path: testInfo.outputPath(`${role}-${width}-${theme}-header.png`) });
            const menu = await openAccountMenu(page);
            await expect(menu.getByText(name, { exact: true })).toBeVisible();
            for (const [label, href] of [
              ["个人主页", "/profile"], ["我的提交", "/profile#submission-history-heading"],
              ["评论与感想", "/profile#records-heading"], ["创建词条", "/new/term"],
              ["新诠释者", "/new/interpreter"], ["新视角", "/new/perspective"],
            ]) await expect(menu.getByRole("link", { name: label, exact: true })).toHaveAttribute("href", href);
            for (const [label, href] of [["审核队列", "/review"], ["已删除页面", "/admin/deleted"], ["邀请与恢复", "/admin/access"], ["导入内容", "/admin/import"]]) {
              const link = menu.getByRole("link", { name: label, exact: true });
              if (role === "editor") await expect(link).toHaveCount(0);
              else await expect(link).toHaveAttribute("href", href);
            }
            const management = menu.getByRole("link", { name: "用户管理", exact: true });
            if (role === "superadmin") await expect(management).toHaveAttribute("href", "/profile#user-management");
            else await expect(management).toHaveCount(0);
            expect(await menu.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
            await page.screenshot({ caret: "initial", path: testInfo.outputPath(`${role}-${width}-${theme}-menu.png`) });
            await page.keyboard.press("Escape");
          }
          const menu = await openAccountMenu(page);
          const destination = role === "superadmin" ? "用户管理" : role === "admin" ? "审核队列" : "我的提交";
          await menu.getByRole("link", { name: destination, exact: true }).click();
          await expect(menu).toBeHidden();
          if (role === "admin") {
            await expect(page).toHaveURL(/\/review$/);
            await expect(page.getByRole("heading", { level: 1, name: /审核队列/ })).toBeVisible();
          } else {
            await expect(page).toHaveURL(role === "superadmin" ? /\/profile#user-management$/ : /\/profile#submission-history-heading$/);
            const heading = page.getByRole("heading", { level: 2, name: role === "superadmin" ? "用户管理" : "提交历史", exact: true });
            await expect(heading).toBeInViewport();
            expect((await heading.boundingBox())!.y).toBeGreaterThanOrEqual(64);
          }
        } finally {
          await getDb().delete(user).where(eq(user.id, account.id));
        }
      });
    }
  });
}

test("窄桌面、最窄手机和尺寸切换仍可关闭菜单并继续浏览", async ({ page }) => {
  await page.goto("/terms");
  for (const width of [1280, 1024, 768, 320]) {
    await page.setViewportSize({ width, height: 700 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    const menu = await openAccountMenu(page);
    await expect(menu.getByRole("link", { name: "登录", exact: true })).toBeVisible();
    await page.keyboard.press("Escape");
  }
  await page.getByRole("button", { name: "打开导航", exact: true }).click();
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(page.getByRole("dialog", { name: "站点导航" })).toBeHidden();
  await page.getByRole("banner").getByRole("link", { name: "学派", exact: true }).click();
  await expect(page).toHaveURL(/\/schools$/);
  for (const label of ["账户菜单", "更多导航"]) {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.getByRole("button", { name: label, exact: true }).click();
    const menu = page.getByRole("dialog", { name: label, exact: true });
    await expect(menu).toBeVisible();
    await page.setViewportSize({ width: 375, height: 812 });
    await expect(menu).toBeHidden();
    await expect(page.getByRole("banner").getByRole("link", { name: "PhoskyWiki", exact: true })).toBeFocused();
    await page.getByRole("button", { name: "打开导航", exact: true }).click();
    await expect(page.getByRole("dialog", { name: "站点导航", exact: true })).toBeVisible();
    await page.keyboard.press("Escape");
  }
});

test("桌面菜单关闭后保留外部搜索框的焦点", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  const search = page.getByRole("banner").getByRole("textbox", { name: "全站搜索", exact: true });
  for (const label of ["账户菜单", "更多导航"]) {
    await page.getByRole("button", { name: label, exact: true }).click();
    const menu = page.getByRole("dialog", { name: label, exact: true });
    await expect(menu).toBeVisible();
    await search.click();
    await expect(menu).toBeHidden();
    await expect(search).toBeFocused();
    await page.keyboard.type("test");
    await expect(search).toHaveValue("test");
    await search.fill("");
  }
});
