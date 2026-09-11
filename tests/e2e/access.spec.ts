import "dotenv/config";
import { randomUUID } from "node:crypto";
import { expect, test } from "./fixtures";
import { eq } from "drizzle-orm";
import { seedAdminAccount } from "../../src/db/seed-admin";
import { getDb } from "../../src/db";
import { user } from "../../src/db/schema";

test("管理员签发邀请、编者注册与双人受理，恢复密码使旧会话失效", async ({ browser, page }) => {
  test.setTimeout(120000);
  const suffix = randomUUID();
  const admins = [`d02-one-${suffix}@example.com`, `d02-two-${suffix}@example.com`];
  const password = "browser-access-123";
  for (const email of admins) await seedAdminAccount({ email, password });
  const firstContext = await browser.newContext();
  const secondContext = await browser.newContext();
  const first = await firstContext.newPage();
  const second = await secondContext.newPage();
  try {
    for (const [index, adminPage] of [first, second].entries()) {
      await adminPage.goto("/login");
      await adminPage.getByLabel("邮箱").fill(admins[index]);
      await adminPage.getByLabel("密码", { exact: true }).fill(password);
      await adminPage.getByRole("button", { name: "登录", exact: true }).click();
      await expect(adminPage.getByTestId("session-user")).toContainText("管理员");
    }
    await first.goto("/admin/access");
    await first.getByRole("button", { name: "签发编者邀请" }).click();
    const invitation = await first.getByLabel("一次性链接").inputValue();
    expect(invitation).toContain("/register#");
    const leaked: string[] = [];
    const token = invitation.split("#")[1];
    page.on("request", request => { if (request.url().includes(token)) leaked.push(request.url()); });
    await page.goto(invitation);
    const email = `d02-author-${suffix}@example.com`;
    await page.getByLabel("名称", { exact: true }).fill("邀请编者");
    await page.getByLabel("邮箱", { exact: true }).fill(email);
    await page.getByLabel("密码（至少 8 位）").fill(password);
    await page.getByRole("button", { name: "注册并登录" }).click();
    await expect(page.getByTestId("session-user")).toContainText("邀请编者");
    await page.reload();
    await expect(page.getByTestId("session-user")).toContainText("编者");
    expect(leaked).toEqual([]);
    const title = `邀请双人受理-${suffix}`;
    await page.goto("/new/term");
    await page.getByLabel("词条标题").fill(title);
    await page.getByLabel("一句话简介（信息框用）").fill("两名管理员受理后可见的词条简介。");
    await page.getByRole("button", { name: "提交审核" }).click();
    await expect(page.getByTestId("submit-success")).toContainText("等待审核");
    await first.goto("/review");
    const proposal = first.locator("[data-submission-id]").filter({ hasText: title });
    await expect(proposal).toContainText("0/2");
    await proposal.getByRole("button", { name: "受理", exact: true }).click();
    await expect(proposal).toContainText("1/2");
    await second.goto("/review");
    const next = second.locator("[data-submission-id]").filter({ hasText: title });
    await next.getByRole("button", { name: "受理", exact: true }).click();
    await expect(next).toHaveCount(0);
    await page.getByRole("button", { name: "登出" }).click();
    await page.goto("/terms");
    await page.getByRole("link", { name: title, exact: true }).click();
    await expect(page.getByText("两名管理员受理后可见的词条简介。")).toBeVisible();
    await page.goto("/login");
    await page.getByLabel("邮箱", { exact: true }).fill(email);
    await page.getByLabel("密码", { exact: true }).fill(password);
    await page.getByRole("button", { name: "登录", exact: true }).click();
    await expect(page.getByTestId("session-user")).toContainText("邀请编者");
    await first.goto("/admin/access");
    await first.getByLabel("目标账号邮箱").fill(email);
    await first.getByRole("checkbox").check();
    await first.getByRole("button", { name: "签发密码恢复" }).click();
    const recovery = await first.getByLabel("一次性链接").inputValue();
    const resetContext = await browser.newContext();
    try {
      const reset = await resetContext.newPage();
      await reset.goto(recovery);
      await reset.getByLabel("新密码（8–128 位）").fill("browser-new-password456");
      await reset.getByRole("button", { name: "重设密码", exact: true }).click();
      await expect(reset.getByRole("status")).toContainText("密码已重设");
      await page.reload();
      await expect(page.getByRole("banner")).toContainText("登录");
      await page.goto("/login");
      await page.getByLabel("邮箱", { exact: true }).fill(email);
      await page.getByLabel("密码", { exact: true }).fill(password);
      await page.getByRole("button", { name: "登录", exact: true }).click();
      await expect(page.getByTestId("form-error")).toContainText("邮箱或密码错误");
      await page.getByLabel("密码", { exact: true }).fill("browser-new-password456");
      const signIn = page.waitForResponse(response => response.url().endsWith('/api/auth/sign-in/email') && response.request().method() === 'POST');
      await page.getByRole("button", { name: "登录", exact: true }).click();
      const response = await signIn;
      if (response.status() === 429) {
        // This scenario deliberately makes four sign-ins with one visitor.
        // Respect the production limiter before retrying the new password.
        await page.waitForTimeout(Number(response.headers()['retry-after'] ?? 10) * 1000 + 100);
        await page.getByRole("button", { name: "登录", exact: true }).click();
      }
      await expect(page.getByTestId("session-user")).toContainText("邀请编者");
    } finally { await resetContext.close(); }
    await first.getByRole("button", { name: "签发编者邀请" }).click();
    const revoked = await first.getByLabel("一次性链接").inputValue();
    await first.getByTestId("grant-record").first().getByRole("button", { name: "撤销", exact: true }).click();
    await expect(first.getByRole("status")).toHaveText("已撤销");
    await page.goto(revoked);
    await page.getByLabel("名称", { exact: true }).fill("拒绝注册");
    await page.getByLabel("邮箱", { exact: true }).fill(`rejected-${suffix}@example.com`);
    await page.getByLabel("密码（至少 8 位）").fill(password);
    await page.getByRole("button", { name: "注册并登录" }).click();
    await expect(page.getByTestId("form-error")).toContainText("已撤销");
  } finally {
    await firstContext.close(); await secondContext.close();
    // Preserve content/votes but restore the suite's original administrator count.
    for (const email of admins) await getDb().update(user).set({ role: "editor" }).where(eq(user.email, email));
  }
});
