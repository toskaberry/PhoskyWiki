import { invitationFixture } from "../auth-fixture";
import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "./fixtures";

test.use({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true });

async function expectFits(page: Page) {
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
  await page.getByRole("button", { name: "打开导航", exact: true }).tap();
  for (const name of ["词条", "诠释者", "学派"]) {
    const link = page.getByRole("navigation", { name: "主导航", exact: true }).getByRole("link", { name, exact: true });
    await expect(link).toBeVisible();
    const bounds = await link.boundingBox();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(375);
  }
  await page.getByRole("button", { name: "关闭导航", exact: true }).tap();
}

test("375px：搜索提交、词条阅读、图谱定位可用，评论区保持只读", async ({ page }) => {
  await page.goto("/");
  await expectFits(page);
  const search = page.getByRole("main").getByRole("textbox", { name: "全站搜索" });
  await search.fill("主体性");
  await page.getByRole("main").getByRole("button", { name: "搜索", exact: true }).tap();
  await expect(page.getByRole("heading", { name: "全站搜索" })).toBeVisible();
  await expectFits(page);

  await page.goto("/");
  await page.getByRole("link", { name: "主体性", exact: true }).tap();
  await expect(page.getByRole("heading", { level: 1, name: "主体性" })).toBeVisible();
  await expectFits(page);
  await page.getByRole("button", { name: /展开全部/ }).tap();
  await expect(page.getByRole("link", { name: "德勒兹论主体性", exact: true })).toBeVisible();
  // 讨论区退役后词条页自带总评论区：移动端一期只读（写入口留给桌面端）
  await expect(page.getByRole("heading", { level: 2, name: "词条总评论" })).toBeVisible();
  await expect(page.getByText("移动端仅供阅读，请在桌面端发表评论。")).toBeVisible();
  await expectFits(page);
  const termUrl = page.url();

  await page.goto("/graph");
  await expect(page.getByTestId("graph-canvas")).toBeVisible();
  await expectFits(page);
  await page.getByLabel("图谱节点搜索").fill("主体性");
  await page.getByRole("option", { name: /主体性/ }).first().tap();
  await expect(page.getByTestId("graph-canvas")).toHaveAttribute("data-located", /\d+/);
  await page.getByTestId("graph-located").getByRole("link", { name: "主体性" }).tap();
  await expect(page.getByRole("heading", { level: 1, name: "主体性" })).toBeVisible();

  await page.goto(`/register#${await invitationFixture()}`);
  await page.getByLabel("名称").fill("移动端编者");
  await page.getByLabel("邮箱").fill(`t16-mobile-${randomUUID()}@example.com`);
  await page.getByLabel("密码（至少 8 位）").fill("password123");
  await page.getByRole("button", { name: "注册并登录" }).tap();
  await expect(page.getByTestId("session-user")).toContainText("移动端编者");
  // 登录用户同样只读：评论区保持可读，写入口仍是桌面端专属
  await page.goto(termUrl);
  await expect(page.getByRole("heading", { level: 2, name: "词条总评论" })).toBeVisible();
  await expect(page.getByText("移动端仅供阅读，请在桌面端发表评论。")).toBeVisible();
  await expectFits(page);
});
