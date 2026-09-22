import { openAccountMenu } from "./navigation-fixture";
import { fixtureRegister } from "./auth-fixture";
// T09：个人主页的提交历史、审核通知与私有差异，走真实 HTTP + SSR/浏览器主缝。
// 每个用例创建独立编者和新页面，不依赖既有提交，也不改变种子内容。

import "dotenv/config";

import { randomUUID } from "node:crypto";

import { expect, test, type APIRequestContext } from "./fixtures";

const ADMIN_EMAIL = process.env.SEED_ADMIN_EMAIL ?? "admin@phoskywiki.local";
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD;

async function loginAdmin(request: APIRequestContext) {
  const response = await request.post("/api/auth/sign-in/email", {
    data: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
  });
  expect(response.ok()).toBe(true);
  expect(await response.json()).toMatchObject({ user: { role: "admin" } });
}

async function register(request: APIRequestContext, name = "T09 个人主页编者") {
  const email = `e2e-profile-${randomUUID()}@example.com`;
  const password = "profile-password123";
  const response = await fixtureRegister(request, {
    data: { name, email, password },
  });
  expect(response.ok()).toBe(true);
  const { user } = await response.json();
  return { id: user.id as string, email, password, name };
}

async function submit(request: APIRequestContext, data: Record<string, unknown>) {
  const response = await request.post("/api/submissions", { data });
  expect(response.status()).toBe(201);
  return response.json() as Promise<{
    submissionId: number;
    quorum?: number;
    pageId?: number;
    href?: string;
  }>;
}

test("游客访问个人主页先登录", async ({ page }) => {
  await page.goto("/profile");
  await expect(page).toHaveURL(/\/login(?:\?|$)/);
  await expect(page.getByRole("heading", { level: 1, name: "登录" })).toBeVisible();
});

test("个人主页只显示自己的提交，新词条差异含标题与简介且不向其他编者公开", async ({ page, browser, baseURL }) => {
  const author = await register(page.request);
  const title = `个人提交词条 ${randomUUID()}`;
  const summary = "这是一条尚待审核的新词条简介。";
  const created = await submit(page.request, { kind: "new_term", title, summary });

  await page.goto("/profile");
  await expect(page.getByRole("heading", { level: 1, name: "个人主页" })).toBeVisible();
  await expect(page.getByTestId("session-user")).toContainText(author.name);
  await expect((await openAccountMenu(page)).getByRole("link", { name: "个人主页", exact: true }))
    .toHaveAttribute("href", "/profile");

  const item = page.locator(`[data-submission-id="${created.submissionId}"]`);
  await expect(item).toContainText(title);
  await expect(item).toContainText("待审核");
  await page.getByRole("link", { name: "待审核", exact: true }).click();
  await expect(page).toHaveURL(/\/profile\?status=pending$/);
  await expect(item).toBeVisible();

  await item.getByRole("link", { name: "查看差异", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/profile/submissions/${created.submissionId}$`));
  const diff = page.getByTestId("content-diff");
  await expect(diff).toContainText(title);
  await expect(diff).toContainText(summary);

  const otherContext = await browser.newContext({ baseURL });
  try {
    await register(otherContext.request, "T09 另一位编者");
    const otherTitle = `其他编者的词条 ${randomUUID()}`;
    const other = await submit(otherContext.request, { kind: "new_term", title: otherTitle });
    const otherPage = await otherContext.newPage();
    await otherPage.goto("/profile");
    await expect(otherPage.locator(`[data-submission-id="${other.submissionId}"]`)).toContainText(otherTitle);
    await expect(otherPage.locator(`[data-submission-id="${created.submissionId}"]`)).toHaveCount(0);
    await expect(otherPage.getByText(summary, { exact: true })).toHaveCount(0);

    await otherPage.goto(`/profile/submissions/${created.submissionId}`);
    await expect(otherPage.getByRole("heading", { level: 1, name: "404", exact: true })).toBeVisible();
    await expect(otherPage.getByTestId("content-diff")).toHaveCount(0);
    await expect(otherPage.getByText(summary, { exact: true })).toHaveCount(0);
  } finally {
    await otherContext.close();
  }
});

test("受理与驳回通知保留理由原文，未读数与已读状态持久，提交历史可按状态筛选", async ({ page, request }) => {
  test.skip(!ADMIN_PASSWORD, "需要 SEED_ADMIN_PASSWORD（与既有审核浏览器用例相同）");
  await register(page.request);
  await loginAdmin(request);

  const approved = await submit(page.request, { kind: "new_term", title: `通知受理词条 ${randomUUID()}` });
  const rejected = await submit(page.request, { kind: "new_interpreter", title: `通知驳回诠释者 ${randomUUID()}` });
  const pending = await submit(page.request, { kind: "new_term", title: `通知待审核词条 ${randomUUID()}` });
  await page.goto("/profile");
  const banner = page.getByRole("banner");
  await expect(banner.getByRole("link", { name: "通知", exact: true })).toBeVisible();
  await expect(page.locator("[data-notification-id]")).toHaveCount(0);
  await banner.getByRole("link", { name: "PhoskyWiki", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: /思想，\s*在分歧中展开。/, exact: true })).toBeVisible();

  const approveResponse = await request.post(`/api/admin/submissions/${approved.submissionId}/review`, {
    data: { action: "approve" },
  });
  expect(approveResponse.ok()).toBe(true);
  expect(await approveResponse.json()).toMatchObject({ outcome: "approved" });
  const reason = "  请补充 <em>原文出处</em>。\n\n保留这一行的  两个空格。  ";
  const rejectResponse = await request.post(`/api/admin/submissions/${rejected.submissionId}/review`, {
    data: { action: "reject", reason },
  });
  expect(rejectResponse.ok()).toBe(true);

  // 审核来自另一个会话；普通站内导航也应更新页头，不能依赖整页刷新。
  await (await openAccountMenu(page)).getByRole("link", { name: "个人主页", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: "个人主页", exact: true })).toBeVisible();
  await expect(banner.getByRole("link", { name: "通知（2 条未读）", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { level: 2, name: "通知", exact: true })).toBeVisible();
  const approvedNotice = page.locator(`[data-notification-id="${approved.submissionId}"]`);
  const rejectedNotice = page.locator(`[data-notification-id="${rejected.submissionId}"]`);
  await expect(approvedNotice).toContainText("已受理");
  await expect(rejectedNotice).toContainText("已驳回");
  await expect(rejectedNotice.getByText(reason, { exact: true })).toHaveJSProperty("textContent", reason);
  await expect(rejectedNotice.locator("em")).toHaveCount(0);
  await expect(page.locator(`[data-notification-id="${pending.submissionId}"]`)).toHaveCount(0);

  await rejectedNotice.getByRole("link", { name: "查看提交", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/profile/submissions/${rejected.submissionId}$`));
  await expect(page.getByText(reason, { exact: true })).toHaveJSProperty("textContent", reason);
  await page.getByRole("link", { name: "返回提交历史", exact: true }).click();
  await rejectedNotice.getByRole("button", { name: "标为已读", exact: true }).click();
  await expect(banner.getByRole("link", { name: "通知（1 条未读）", exact: true })).toBeVisible();
  await page.reload();
  await expect(rejectedNotice).toContainText("已读");
  await expect(rejectedNotice.getByRole("button", { name: "标为已读", exact: true })).toHaveCount(0);
  await approvedNotice.getByRole("button", { name: "标为已读", exact: true }).click();
  await expect(banner.getByRole("link", { name: "通知", exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("button", { name: "标为已读", exact: true })).toHaveCount(0);

  for (const { label, status, submissionId } of [
    { label: "待审核", status: "pending", submissionId: pending.submissionId },
    { label: "已受理", status: "approved", submissionId: approved.submissionId },
    { label: "已驳回", status: "rejected", submissionId: rejected.submissionId },
  ]) {
    await page.getByLabel("提交状态筛选").getByRole("link", { name: label, exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/profile\\?status=${status}$`));
    await expect(page.locator("[data-submission-id]")).toHaveCount(1);
    await expect(page.locator(`[data-submission-id="${submissionId}"]`)).toBeVisible();
  }
  await page.getByLabel("提交状态筛选").getByRole("link", { name: "全部", exact: true }).click();
  await expect(page.locator("[data-submission-id]")).toHaveCount(3);
});

test("页面后续修订不改变我的提交差异，起始修订过期的自动驳回也通知提交者", async ({ page, request }) => {
  test.skip(!ADMIN_PASSWORD, "需要 SEED_ADMIN_PASSWORD（与既有审核浏览器用例相同）");
  await register(page.request);
  await loginAdmin(request);
  const term = await submit(request, { kind: "new_term", title: `历史差异词条 ${randomUUID()}` });
  const interpreter = await submit(request, { kind: "new_interpreter", title: `历史差异诠释者 ${randomUUID()}` });
  const original = "开始编辑时的修订正文。";
  const proposed = "编者提交的提议正文。";
  const later = "管理员后续生效的另一份正文。";
  const perspective = await submit(request, {
    kind: "new_perspective", termId: term.pageId, interpreterId: interpreter.pageId, content: original,
  });

  await page.goto(`/edit/${perspective.pageId}`);
  await expect(page.getByRole("textbox", { name: "正文（Markdown）" })).toHaveText(original);
  await page.getByRole("textbox", { name: "正文（Markdown）" }).fill(proposed);
  const submittedResponse = page.waitForResponse((response) =>
    response.url().endsWith("/api/submissions") && response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "提交审核", exact: true }).click();
  const submissionResponse = await submittedResponse;
  expect(submissionResponse.status()).toBe(201);
  const { submissionId } = await submissionResponse.json();
  const { baseRevisionId } = submissionResponse.request().postDataJSON();
  await expect(page.getByTestId("submit-success")).toContainText("等待审核");

  await submit(request, {
    kind: "edit", pageId: perspective.pageId, baseRevisionId, content: later,
  });
  const reviewResponse = await request.post(`/api/admin/submissions/${submissionId}/review`, {
    data: { action: "approve" },
  });
  expect(reviewResponse.ok()).toBe(true);
  const outcome = await reviewResponse.json();
  expect(outcome).toMatchObject({ outcome: "rejected", staleBase: true });

  await page.goto("/profile");
  const notification = page.locator(`[data-notification-id="${submissionId}"]`);
  await expect(notification).toContainText("已驳回");
  await expect(notification).toContainText(outcome.message);
  await page.locator(`[data-submission-id="${submissionId}"]`)
    .getByRole("link", { name: "查看差异", exact: true }).click();
  const diff = page.getByTestId("content-diff");
  await expect(diff.locator('[data-diff="del"]')).toContainText(original);
  await expect(diff.locator('[data-diff="add"]')).toContainText(proposed);
  await expect(diff).not.toContainText(later);
});
