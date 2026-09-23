import { randomUUID } from "node:crypto";
import { invitationFixture } from "../auth-fixture";
import { expect, test } from "./fixtures";

test("从新建视角登录后保留任务与预选词条", async ({ page }) => {
  await page.goto("/terms");
  const href = await page.getByRole("link", { name: "主体性", exact: true }).getAttribute("href");
  const termId = href!.match(/(\d+)$/)![1];
  const destination = `/new/perspective?term=${termId}`;
  await page.goto(destination);
  await page.locator("main").getByRole("link", { name: "登录", exact: true }).click();
  await page.getByLabel("邮箱").fill(process.env.SEED_ADMIN_EMAIL ?? "admin@phoskywiki.local");
  await page.getByLabel("密码", { exact: true }).fill(process.env.SEED_ADMIN_PASSWORD!);
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/new/perspective\\?term=${termId}$`));
  await expect(page.getByLabel("所属词条")).toHaveValue(termId);
});

test("任务的登录、恢复和注册入口保留来路，注册后继续任务", async ({ page }) => {
  await page.goto("/new/term");
  await page.locator("main").getByRole("link", { name: "登录", exact: true }).click();
  await page.getByRole("link", { name: "忘记密码？联系管理员恢复" }).click();
  await page.getByRole("link", { name: "返回登录" }).click();
  await page.locator("main").getByRole("link", { name: "注册", exact: true }).click();
  await page.getByLabel("邀请码").fill(await invitationFixture());
  await page.getByLabel("名称", { exact: true }).fill("继续任务的编者");
  await page.getByLabel("邮箱").fill(`return-${randomUUID()}@example.com`);
  await page.getByLabel("密码（至少 8 位）").fill("return-password123");
  await page.getByRole("button", { name: "注册并登录" }).click();
  await expect(page).toHaveURL(/\/new\/term$/);
  await expect(page.getByLabel("词条标题")).toBeVisible();
});

test("标题、别名和作品错误关联到对应字段且草稿不丢失", async ({ page }) => {
  expect((await page.request.post("/api/auth/sign-in/email", {
    data: { email: process.env.SEED_ADMIN_EMAIL ?? "admin@phoskywiki.local", password: process.env.SEED_ADMIN_PASSWORD },
  })).ok()).toBe(true);
  await page.goto("/new/term");
  const title = page.locator('input[name="title"]');
  const summary = page.getByLabel("一句话简介（信息框用）");
  const aliases = page.locator('input[name="aliases"]');
  const submit = page.getByRole("button", { name: "提交（直接生效）" });
  await summary.fill("校验错误之后仍保留的简介");
  await submit.click();
  await expect(title).toHaveAttribute("aria-invalid", "true");
  await expect(title).toHaveAccessibleDescription(/标题不能为空/);
  await expect(title).toBeFocused();
  await title.fill(`字段反馈 ${randomUUID()}`);
  await aliases.fill('"未闭合');
  await submit.click();
  await expect(aliases).toHaveAttribute("aria-invalid", "true");
  await expect(aliases).toHaveAccessibleDescription(/引号/);
  await aliases.fill(Array.from({ length: 51 }, (_, index) => `别名${index}`).join(","));
  await submit.click();
  await expect(aliases).toHaveAccessibleDescription(/最多 50 项/);
  await aliases.fill("有效别名");
  await page.getByRole("button", { name: "添加作品" }).click();
  await submit.click();
  const work = page.getByLabel("作品名 1", { exact: true });
  await expect(work).toHaveAttribute("aria-invalid", "true");
  await expect(work).toHaveAccessibleDescription(/需要作品名/);
  await work.fill("代表作品");
  const url = page.getByLabel("作品链接 1", { exact: true });
  await url.fill("invalid-url");
  await submit.click();
  await expect(url).toHaveAttribute("aria-invalid", "true");
  await expect(url).toHaveAccessibleDescription(/HTTP\(S\)/);
  await expect(summary).toHaveValue("校验错误之后仍保留的简介");
  await expect(aliases).toHaveValue("有效别名");
  await page.reload();
  await expect(summary).toHaveValue("校验错误之后仍保留的简介");
  await expect(work).toHaveValue("代表作品");
  await expect(url).toHaveValue("invalid-url");
});

test("新建视角缺少归属或正文时反馈到对应控件", async ({ page }) => {
  expect((await page.request.post("/api/auth/sign-in/email", {
    data: { email: process.env.SEED_ADMIN_EMAIL ?? "admin@phoskywiki.local", password: process.env.SEED_ADMIN_PASSWORD },
  })).ok()).toBe(true);
  await page.goto("/new/perspective");
  const term = page.getByLabel("所属词条");
  const interpreter = page.getByRole("combobox", { name: /^诠释者/ });
  const editor = page.getByRole("textbox", { name: "正文（Markdown）" });
  const submit = page.getByRole("button", { name: "提交（直接生效）" });
  await submit.click();
  await expect(term).toHaveAccessibleDescription(/缺少目标词条/);
  await expect(term).toBeFocused();
  await term.selectOption({ label: "剩余价值" });
  await submit.click();
  await expect(interpreter).toHaveAccessibleDescription(/缺少诠释者/);
  await expect(interpreter).toBeFocused();
  await interpreter.selectOption({ label: "拉康" });
  await submit.click();
  await expect(editor).toHaveAttribute("aria-invalid", "true");
  await expect(editor).toHaveAccessibleDescription(/正文不能为空/);
  await expect(editor).toBeFocused();
  await editor.fill("保留编辑器历史的草稿");
  await expect(editor).not.toHaveAttribute("aria-invalid", "true");
  await page.getByRole("button", { name: "撤销", exact: true }).click();
  await submit.click();
  await expect(editor).toHaveAccessibleDescription(/正文不能为空/);
  await page.getByRole("button", { name: "重做", exact: true }).click();
  await expect(editor).toHaveText("保留编辑器历史的草稿");
});
