import { openAccountMenu } from "./navigation-fixture";
// 认证关键路径（T05 验收）：注册 → 登出 → 再登录，会话持久；游客浏览不受限。
// 走真实浏览器与真实 /api/auth/* 端点；每个用例用独立邮箱，可并行/重复执行。

import { randomUUID } from "node:crypto";

import { expect, test } from "./fixtures";
import { invitationFixture } from "../auth-fixture";

test.describe("游客（未登录）", () => {
  test("页头显示登录/注册入口，浏览不受限", async ({ page }) => {
    await page.goto("/");
    const banner = page.getByRole("banner");
    await expect(banner).toContainText("登录");
    await expect(banner).toContainText("注册");
    await expect(page.getByRole("heading", { level: 1, name: "PhoskyWiki" })).toBeVisible();
  });
});

test.describe("编者账号全流程", () => {
  const email = `e2e-${randomUUID()}@example.com`;
  const password = "password123";
  const name = "E2E 编者";

  test("注册 → 登出 → 再登录，会话持久", async ({ page }) => {
    // 注册成功即自动登录
    await page.goto(`/register#${await invitationFixture()}`);
    await page.getByLabel("名称").fill(name);
    await page.getByLabel("邮箱").fill(email);
    await page.getByLabel("密码（至少 8 位）").fill(password);
    await page.getByRole("button", { name: "注册并登录" }).click();

    const banner = page.getByRole("banner");
    await expect(banner).toContainText(name);
    await expect(banner).toContainText("编者");

    // 会话持久：整页刷新（新文档请求）后仍为登录态
    await page.reload();
    await expect(banner).toContainText(name);

    // 登出
    await (await openAccountMenu(page)).getByRole("button", { name: "登出" }).click();
    await expect(banner).toContainText("登录");
    await expect(banner).not.toContainText(name);

    // 再登录
    await page.goto("/login");
    await page.getByLabel("邮箱").fill(email);
    await page.getByLabel("密码").fill(password);
    await page.getByRole("button", { name: "登录" }).click();
    await expect(banner).toContainText(name);
    await expect(banner).toContainText("编者");

    // 登录态下换页仍保持
    await page.goto("/");
    await expect(banner).toContainText(name);
  });

  test("错误密码登录显示错误提示", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("邮箱").fill(`e2e-${randomUUID()}@example.com`);
    await page.getByLabel("密码").fill("wrong-password");
    await page.getByRole("button", { name: "登录" }).click();

    await expect(page.getByTestId("form-error")).toContainText("邮箱或密码错误");
    await expect(page.getByRole("banner")).toContainText("登录");
  });
});
