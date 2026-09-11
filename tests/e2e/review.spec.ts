import { invitationFixture } from "../auth-fixture";
// 审核流全流程（T06 验收）：编者提交 → 管理员在队列看 diff 后受理 → 游客可见新内容。
// 走种子数据（主体性 词条的福柯视角）；种子管理员登录受理。
// 本地库只有一名种子管理员，quorum = min(2, 1) = 1——单票即生效（冷启动退化路径）。
// SEED_ADMIN_PASSWORD 未配置（种子走随机密码）的环境自动跳过。

import "dotenv/config";

import { randomUUID } from "node:crypto";

import { expect, test, type Page } from "./fixtures";

const ADMIN_EMAIL = process.env.SEED_ADMIN_EMAIL ?? "admin@phoskywiki.local";
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD;

test.skip(!ADMIN_PASSWORD, "需要 .env 配置 SEED_ADMIN_PASSWORD（种子管理员密码）");

async function openFoucaultPerspective(page: Page): Promise<void> {
  await page.goto("/");
  await page.getByRole("link", { name: "主体性", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: "主体性" })).toBeVisible();
  // 从具名视角列表进入视角页
  await page.getByRole("link", { name: "福柯论主体性" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "福柯论主体性" })).toBeVisible();
}

/** 拉康论主体性视角页（与福柯视角不同目标，两个用例可并行互不干扰）。 */
async function openLacanPerspective(page: Page): Promise<void> {
  await page.goto("/");
  await page.getByRole("link", { name: "主体性", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: "主体性" })).toBeVisible();
  await page.getByRole("link", { name: "拉康论主体性", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: "拉康论主体性" })).toBeVisible();
}

async function login(page: Page, email: string, password: string): Promise<void> {
  await page.goto("/login");
  await page.getByLabel("邮箱").fill(email);
  await page.getByLabel("密码").fill(password);
  await page.getByRole("button", { name: "登录" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "PhoskyWiki" })).toBeVisible();
}

test("编者提交 → 管理员受理 → 游客可见新内容", async ({ page }) => {
  const marker = `E2E 受理标记 ${Date.now()}`;

  // 游客看不到编辑入口
  await openFoucaultPerspective(page);
  await expect(page.getByRole("link", { name: "编辑", exact: true })).toHaveCount(0);

  // 注册新编者并登录
  const email = `e2e-review-${randomUUID()}@example.com`;
  await page.goto(`/register#${await invitationFixture()}`);
  await page.getByLabel("名称").fill("E2E 审核编者");
  await page.getByLabel("邮箱").fill(email);
  await page.getByLabel("密码（至少 8 位）").fill("password123");
  await page.getByRole("button", { name: "注册并登录" }).click();
  await expect(page.getByTestId("session-user")).toContainText("编者");

  // 编辑福柯视角：追加一段标记文字，提交进审核队列
  await openFoucaultPerspective(page);
  await page.getByRole("link", { name: "编辑", exact: true }).click();
  await expect(
    page.getByRole("heading", { level: 1, name: "编辑：福柯论主体性" }),
  ).toBeVisible();

  const editor = page.getByRole("textbox", { name: "正文（Markdown）" });
  await editor.press("ControlOrMeta+End");
  await editor.press("Enter");
  await editor.pressSequentially(`${marker}。`);
  await page.getByRole("button", { name: "提交审核" }).click();
  await expect(page.getByTestId("submit-success")).toContainText("等待审核");

  // 登出后以游客身份确认新内容尚未生效
  await page.getByRole("button", { name: "登出" }).click();
  await expect(page.getByRole("banner")).toContainText("登录");
  await page.goto("/");
  await page.getByRole("link", { name: "主体性", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: "主体性" })).toBeVisible();
  await expect(page.getByText(marker)).toHaveCount(0);

  // 种子管理员在审核队列看「当前版 vs 提案」diff 后受理
  await login(page, ADMIN_EMAIL, ADMIN_PASSWORD!);
  await page.getByRole("link", { name: "审核队列" }).click();
  await expect(page.getByRole("heading", { level: 1, name: /审核队列/ })).toBeVisible();

  const item = page.locator("[data-submission-id]").filter({ hasText: "福柯论主体性" });
  await expect(item).toContainText("编辑视角");
  await item.locator("summary").click();
  await expect(item.getByTestId("content-diff")).toContainText(marker);

  await item.getByRole("button", { name: "受理", exact: true }).click();
  // 受理生效后提交离开队列
  await expect(item).toHaveCount(0);

  // 登出后游客读路径立即可见新内容（具名视角页）
  await page.getByRole("button", { name: "登出" }).click();
  await expect(page.getByRole("banner")).toContainText("登录");
  await page.goto("/");
  await page.getByRole("link", { name: "主体性", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: "主体性" })).toBeVisible();
  await page.getByRole("link", { name: "福柯论主体性", exact: true }).click();
  await expect(page.getByText(marker)).toBeVisible();
});

test("驳回必填理由：不填无法提交驳回", async ({ page }) => {
  // 用一个新编者对拉康视角提交，管理员尝试无理由驳回
  const email = `e2e-reject-${randomUUID()}@example.com`;
  await page.goto(`/register#${await invitationFixture()}`);
  await page.getByLabel("名称").fill("E2E 驳回编者");
  await page.getByLabel("邮箱").fill(email);
  await page.getByLabel("密码（至少 8 位）").fill("password123");
  await page.getByRole("button", { name: "注册并登录" }).click();
  await expect(page.getByTestId("session-user")).toContainText("编者");

  const marker = `待驳回标记 ${Date.now()}`;
  await openLacanPerspective(page);
  await page.getByRole("link", { name: "编辑", exact: true }).click();
  const editor = page.getByRole("textbox", { name: "正文（Markdown）" });
  await editor.press("ControlOrMeta+End");
  await editor.press("Enter");
  await editor.pressSequentially(`${marker}。`);
  await page.getByRole("button", { name: "提交审核" }).click();
  await expect(page.getByTestId("submit-success")).toContainText("等待审核");

  await login(page, ADMIN_EMAIL, ADMIN_PASSWORD!);
  await page.getByRole("link", { name: "审核队列" }).click();
  const item = page.locator("[data-submission-id]").filter({ hasText: "拉康论主体性" });
  await item.getByRole("button", { name: "驳回…" }).click();
  // 理由为空时确认驳回不可点
  await expect(item.getByRole("button", { name: "确认驳回" })).toBeDisabled();

  // 填理由驳回 → 队列移除该提交，内容未生效
  await item.getByLabel(/驳回理由/).fill("测试驳回：理由必填。");
  await item.getByRole("button", { name: "确认驳回" }).click();
  await expect(item).toHaveCount(0);

  await page.getByRole("button", { name: "登出" }).click();
  await openLacanPerspective(page);
  await expect(page.getByText(marker)).toHaveCount(0);
});
