import { invitationFixture } from "../auth-fixture";
import { expect, test } from "./fixtures";
import { randomUUID } from "node:crypto";

test("首页以搜索为中心，提供真实发现栏目和可用的三轴入口", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { level: 1, name: /思想，\s*在分歧中展开。/ })).toBeVisible();
  await expect(page.getByRole("banner")).toContainText("词条");
  await expect(page.getByRole("contentinfo")).toContainText("原子笔记");
  const main = page.getByRole("main");
  await expect(main.getByRole("textbox", { name: "全站搜索" })).toBeVisible();
  for (const name of ["探索概念", "新视角", "学派巡礼"]) {
    await expect(main.getByRole("heading", { name, exact: true })).toBeVisible();
  }
  await page.getByRole("banner").getByRole("link", { name: "诠释者", exact: true }).click();
  await expect(page.getByRole("heading", { name: "诠释者索引", exact: true })).toBeVisible();
  await page.getByRole("main").getByRole("link", { name: "拉康", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: "拉康" })).toBeVisible();
  await page.getByRole("banner").getByRole("link", { name: "词条", exact: true }).click();
  await expect(page.getByRole("heading", { name: "词条索引", exact: true })).toBeVisible();
  await page.goto("/");
  await main.getByRole("textbox", { name: "全站搜索" }).fill("主体性");
  await main.getByRole("textbox", { name: "全站搜索" }).press("Enter");
  await expect(page).toHaveURL(/\/search\?q=/);
  await expect(page.getByRole("heading", { name: "全站搜索" })).toBeVisible();
});

test("登录首页使用账号兴趣推荐，未设置兴趣时引导选择", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("region", { name: "为你发现" })).toHaveCount(0);
  await page.goto(`/register#${await invitationFixture()}`);
  await page.getByLabel("名称").fill("首页推荐编者");
  await page.getByLabel("邮箱").fill(`t16-${randomUUID()}@example.com`);
  await page.getByLabel("密码（至少 8 位）").fill("password123");
  await page.getByRole("button", { name: "注册并登录" }).click();
  await expect(page.getByTestId("session-user")).toContainText("首页推荐编者");
  await page.goto("/");
  const recommendations = page.getByRole("region", { name: "为你发现" });
  await expect(recommendations.getByRole("link", { name: "设置兴趣标签" })).toBeVisible();
  await recommendations.getByRole("link", { name: "设置兴趣标签" }).click();
  await page.getByLabel("德勒兹", { exact: true }).check();
  await page.getByRole("button", { name: "保存到账号" }).click();
  await expect(page.getByTestId("interest-saved")).toBeVisible();
  await page.goto("/");
  await expect(recommendations.getByRole("link", { name: /^主体性 / })).toBeVisible();
  await expect(recommendations.getByRole("link", { name: /^剩余价值 / })).toHaveCount(0);
  await recommendations.getByRole("link", { name: /^主体性 / }).click();
  await expect(page.getByRole("heading", { level: 1, name: "主体性" })).toBeVisible();
});

test("/healthz 返回 PG 连接状态（经真实起动的应用）", async ({ request }) => {
  const res = await request.get("/healthz");

  expect(res.status()).toBe(200);
  await expect(res.json()).resolves.toMatchObject({
    status: "ok",
    checks: { postgres: "up" },
  });
});
