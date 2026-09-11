import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { test, expect } from "./fixtures";
import { fixtureRegister } from "./auth-fixture";
import { getDb } from "../../src/db";
import { pages, submissions, user } from "../../src/db/schema";
import { cleanupTestContent } from "./content-cleanup";

test("超级管理员从个人页面管理用户、删除词条并从回收站恢复", async ({ page, browser, baseURL }) => {
  const suffix = randomUUID();
  const title = `删除验收-${suffix}`;
  const ids: string[] = [];
  const other = await browser.newContext({ baseURL });
  try {
    for (const [request, role] of [[page.request, "superadmin"], [other.request, "editor"]] as const) {
      const signed = await fixtureRegister(request, { data: { name: `权限验收-${role}-${suffix}`, email: `roles-${role}-${suffix}@example.com`, password: "roles-browser-password123" } });
      expect(signed.ok()).toBe(true);
      const { user: created } = await signed.json();
      ids.push(created.id);
      await getDb().update(user).set({ role }).where(eq(user.id, created.id));
    }
    await page.goto("/profile");
    await expect(page.getByTestId("session-user")).toContainText("超级管理员");
    await page.getByLabel("查找用户").fill(`roles-editor-${suffix}@example.com`);
    await page.getByRole("button", { name: "查找", exact: true }).click();
    const row = page.getByRole("row").filter({ hasText: `roles-editor-${suffix}@example.com` });
    await row.getByLabel("权限级别").selectOption("admin");
    await row.getByRole("button", { name: "保存权限" }).click();
    await expect(row.getByRole("status")).toContainText("权限已更新");
    const editorPage = await other.newPage();
    await editorPage.goto("/profile");
    await expect(editorPage.getByRole("link", { name: "管理员回收站" })).toBeVisible();
    await expect(editorPage.getByRole("heading", { name: "用户管理", exact: true })).toHaveCount(0);

    const created = await page.request.post("/api/submissions", { data: { kind: "new_term", title, summary: "应随词条隐藏的简介" } });
    expect(created.status()).toBe(201);
    const term = await created.json();
    const interpreterResponse = await page.request.post("/api/submissions", { data: { kind: "new_interpreter", title: `${title}诠释者` } });
    expect(interpreterResponse.status()).toBe(201);
    const interpreter = await interpreterResponse.json();
    const viewResponse = await page.request.post("/api/submissions", { data: { kind: "new_perspective", termId: term.pageId, interpreterId: interpreter.pageId, content: "应随词条隐藏的具名视角" } });
    expect(viewResponse.status()).toBe(201);
    const view = await viewResponse.json();
    await page.goto(term.href);
    await page.getByRole("button", { name: "删除词条", exact: true }).click();
    await expect(page.getByRole("dialog")).toContainText(title);
    await expect(page.getByRole("dialog")).toContainText("1 个");
    await page.getByRole("button", { name: "取消", exact: true }).click();
    await expect(page.getByRole("heading", { level: 1, name: title })).toBeVisible();
    await page.getByRole("button", { name: "删除词条", exact: true }).click();
    await page.getByRole("button", { name: "确认删除", exact: true }).click();
    await expect(page).toHaveURL(/\/admin\/deleted$/);
    expect((await other.request.get(term.href)).status()).toBe(404);
    expect((await other.request.get(view.href)).status()).toBe(404);
    await page.goto("/profile");
    await page.getByRole("link", { name: "管理员回收站" }).click();
    const deleted = page.getByRole("listitem").filter({ hasText: title });
    await deleted.getByRole("button", { name: "恢复页面" }).click();
    await expect(deleted).toHaveCount(0);
    expect((await other.request.get(term.href)).status()).toBe(200);
    expect((await other.request.get(view.href)).status()).toBe(200);
  } finally {
    await other.close();
    await cleanupTestContent([title, `${title}诠释者`], page.request);
    if (ids.length) {
      await getDb().delete(pages).where(inArray(pages.createdBy, ids));
      await getDb().delete(submissions).where(inArray(submissions.submittedBy, ids));
      await getDb().delete(user).where(inArray(user.id, ids));
    }
  }
});
