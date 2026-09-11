import { invitationFixture } from "../auth-fixture";
import "dotenv/config";
import { randomUUID } from "node:crypto";
import { expect, test } from "./fixtures";
import { cleanupTestContent } from "./content-cleanup";

test("编者用词条向导填写导航信息并提交审核", async ({ page }) => {
  const title = `向导词条-${randomUUID()}`;
  try {
    await page.goto(`/register#${await invitationFixture()}`);
    await page.getByLabel("名称").fill("T15向导编者");
    await page.getByLabel("邮箱").fill(`t15-wizard-${randomUUID()}@example.com`);
    await page.getByLabel("密码（至少 8 位）").fill("password123");
    await page.getByRole("button", { name: "注册并登录" }).click();
    await expect(page.getByTestId("session-user")).toContainText("编者");
    await page.goto("/new/term");
    await page.getByLabel("词条标题").fill(title);
    await page.getByLabel("一句话简介（信息框用）").fill("向导填写的简介");
    await page.getByLabel("别名（信息框用，以逗号分隔）").fill("别名一,别名二");
    const editor = page.getByRole("textbox", { name: "正文（Markdown）" });
    await expect(editor).toHaveCount(0);
    await expect(page.getByText(/草稿已自动保存/)).toBeVisible();
    await page.reload();
    await expect(editor).toHaveCount(0);
    await expect(page.getByLabel("一句话简介（信息框用）")).toHaveValue("向导填写的简介");
    await expect(page.getByLabel("别名（信息框用，以逗号分隔）")).toHaveValue("别名一,别名二");
    await page.getByRole("button", { name: "提交审核" }).click();
    await expect(page.getByTestId("submit-success")).toContainText("等待审核");
    await page.getByRole("link", { name: "查看提交历史 →" }).click();
    await page.getByRole("link", { name: /查看差异|查看详情|提交详情/ }).first().click();
    await expect(page.getByTestId("content-diff")).toContainText("向导填写的简介");
    await expect(page.getByTestId("content-diff")).toContainText("别名一");
  } finally { await cleanupTestContent([title], page.request); }
});

test("管理员从向导进入 JSON 导入后可打开新词条导航页", async ({ page }) => {
  test.skip(!process.env.SEED_ADMIN_PASSWORD, "需要种子管理员密码");
  const title = `导入词条-${randomUUID()}`;
  const interpreterTitle = `导入诠释者-${randomUUID()}`;
  try {
    await page.goto("/login");
    await page.getByLabel("邮箱").fill(process.env.SEED_ADMIN_EMAIL ?? "admin@phoskywiki.local");
    await page.getByLabel("密码").fill(process.env.SEED_ADMIN_PASSWORD!);
    await page.getByRole("button", { name: "登录" }).click();
    await expect(page.getByTestId("session-user")).toContainText("管理员");
    await page.goto("/new/term");
    await page.getByRole("link", { name: "批量导入 JSON →" }).click();
    await page.getByLabel("导入 JSON").fill(JSON.stringify({ interpreters: [{ title: interpreterTitle }], terms: [{ title, aliases: ["导入别名"] }] }));
    await page.getByRole("button", { name: "导入并直接发布" }).click();
    await expect(page.getByRole("status")).toContainText("已导入 2 个");
    await page.getByRole("link", { name: new RegExp(title) }).click();
    await expect(page.getByRole("heading", { level: 1, name: title })).toBeVisible();
    await expect(page.getByRole("heading", { name: "诠释者视角（0）" })).toBeVisible();
    await expect(page.getByText("导入别名", { exact: true })).toBeVisible();
  } finally { await cleanupTestContent([title, interpreterTitle], page.request); }
});

test("测试导入后的异常仍清理本次词条、视角和诠释者，保留其他内容", async ({ page }) => {
  test.skip(!process.env.SEED_ADMIN_PASSWORD, "需要种子管理员密码");
  expect((await page.request.post("/api/auth/sign-in/email", { data: { email: process.env.SEED_ADMIN_EMAIL ?? "admin@phoskywiki.local", password: process.env.SEED_ADMIN_PASSWORD } })).ok()).toBe(true);
  const title = `清理验收-${randomUUID()}`;
  const keptTitle = `保留验收-${randomUUID()}`;
  const interpreterTitle = `清理诠释者-${randomUUID()}`;
  const created: { pageId: number; href: string }[] = [];
  try {
    const kept = await (await page.request.post("/api/submissions", { data: { kind: "new_term", title: keptTitle } })).json();
    try {
      for (const input of [{ kind: "new_term", title }, { kind: "new_interpreter", title: interpreterTitle }]) {
        const response = await page.request.post("/api/submissions", { data: input });
        expect(response.status()).toBe(201);
        created.push(await response.json());
      }
      const perspective = await page.request.post("/api/submissions", { data: { kind: "new_perspective", termId: created[0].pageId, interpreterId: created[1].pageId, content: "清理测试视角" } });
      expect(perspective.status()).toBe(201);
      created.push(await perspective.json());
      throw new Error("模拟断言失败");
    } catch (error) { expect((error as Error).message).toBe("模拟断言失败"); }
    finally { await cleanupTestContent([title, interpreterTitle], page.request); }
    for (const row of created) expect((await page.request.get(row.href)).status()).toBe(404);
    expect((await page.request.get(kept.href)).status()).toBe(200);
  } finally { await cleanupTestContent([title, interpreterTitle, keptTitle], page.request); }
});
