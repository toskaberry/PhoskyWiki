import { fixtureRegister } from "./auth-fixture";
import "dotenv/config";
import { randomUUID } from "node:crypto";
import { expect, test } from "./fixtures";
import { Pool } from "pg";

test("驳回词条从详情完整预填、网络失败保留独立草稿、重提两票公开", async ({ page, browser, baseURL }) => {
  test.setTimeout(120_000);
  await page.request.post("/api/auth/sign-in/email", { data: { email: process.env.SEED_ADMIN_EMAIL, password: process.env.SEED_ADMIN_PASSWORD } });
  const context = await browser.newContext({ baseURL });
  const editor = await context.newPage();
  const reviewer = await browser.newContext({ baseURL });
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  let secondAdmin: string | undefined;
  const title = `Resubmit ${randomUUID()}`;
  try {
    await fixtureRegister(editor.request, { data: { email: `${randomUUID()}@example.com`, password: "password123", name: "重提编者" } });
    const created = await editor.request.post("/api/submissions", { data: { kind: "new_term", title, summary: "原提案简介", aliases: ["别名甲", "别名乙"] } });
    const { submissionId } = await created.json();
    await page.goto("/review");
    const rejectedEntry = page.locator(`[data-submission-id="${submissionId}"]`);
    await rejectedEntry.getByRole("button", { name: "驳回…" }).click();
    await rejectedEntry.getByLabel("驳回理由（必填，提交者可见）").fill("请补充来源");
    await rejectedEntry.getByRole("button", { name: "确认驳回" }).click();
    await expect(rejectedEntry).toHaveCount(0);
    await editor.goto(`/profile/submissions/${submissionId}`);
    const oldReview = await editor.getByRole("region", { name: "审核记录" }).innerText();
    const signed = await fixtureRegister(reviewer.request, { data: { email: `${randomUUID()}@example.com`, password: "password123", name: "第二管理员" } });
    secondAdmin = (await signed.json()).user.id;
    await pool.query('UPDATE "user" SET role = $1 WHERE id = $2', ["admin", secondAdmin]);
    await editor.getByRole("link", { name: "修改后重新提交", exact: true }).click();
    await editor.waitForURL(`**/profile/submissions/${submissionId}/resubmit`);
    await expect(editor.getByText("请补充来源", { exact: true })).toBeVisible();
    await expect(editor.getByLabel("词条标题", { exact: true })).toHaveValue(title);
    await expect(editor.getByLabel("一句话简介（信息框用）")).toHaveValue("原提案简介");
    await expect(editor.getByLabel("别名（信息框用，以逗号分隔）")).toHaveValue("别名甲,别名乙");
    await expect(editor.getByRole("textbox", { name: "正文（Markdown）" })).toHaveCount(0);
    await editor.getByLabel("一句话简介（信息框用）").fill("整理后简介");
    await editor.route("**/api/submissions", route => route.abort());
    await editor.getByRole("button", { name: "提交审核", exact: true }).click();
    await expect(editor.getByTestId("form-error")).toContainText("网络");
    await editor.reload();
    await expect(editor.getByLabel("一句话简介（信息框用）")).toHaveValue("整理后简介");
    await editor.unroute("**/api/submissions");
    const response = editor.waitForResponse(r => r.url().endsWith("/api/submissions") && r.request().method() === "POST");
    await editor.getByRole("button", { name: "提交审核", exact: true }).click();
    const next = await (await response).json();
    expect(next.submissionId).not.toBe(submissionId);
    expect(next.quorum).toBe(2);
    await expect(editor.getByTestId("submit-success")).toBeVisible();
    expect(await editor.evaluate(() => Object.keys(localStorage).filter(key => key.includes(":resubmit:")))).toEqual([]);
    await editor.goto(`/profile/submissions/${next.submissionId}`);
    await expect(editor.getByRole("link", { name: `原驳回提交 #${submissionId}` })).toBeVisible();
    await page.goto("/review");
    const entry = page.locator(`[data-submission-id="${next.submissionId}"]`);
    await entry.getByRole("button", { name: "受理", exact: true }).click();
    await expect(entry).toContainText("批准 1/2");
    const second = await reviewer.newPage();
    await second.goto("/review");
    await second.locator(`[data-submission-id="${next.submissionId}"]`).getByRole("button", { name: "受理", exact: true }).click();
    await expect(second.locator(`[data-submission-id="${next.submissionId}"]`)).toHaveCount(0);
    await editor.reload();
    await expect(editor.getByText("已受理", { exact: true })).toBeVisible();
    await editor.goto("/terms");
    await editor.getByRole("link", { name: title, exact: true }).click();
    await editor.waitForURL("**/term/**");
    await expect(editor.getByText("整理后简介", { exact: true }).first()).toBeVisible();
    await expect(editor.getByRole("heading", { level: 1, name: title })).toBeVisible();
    await editor.goto(`/profile/submissions/${submissionId}`);
    await expect(editor.getByText("已驳回", { exact: true })).toBeVisible();
    expect(await editor.getByRole("region", { name: "审核记录" }).innerText()).toBe(oldReview);
    expect((await page.request.post(`/api/admin/submissions/${submissionId}/review`, { data: { action: "approve" } })).status()).toBe(409);
  } finally {
    if (secondAdmin) await pool.query('UPDATE "user" SET role = $1 WHERE id = $2', ["editor", secondAdmin]);
    await pool.end();
    await Promise.all([context.close(), reviewer.close()]);
  }
});


test("词条和视角过期提案需人工整理，校验失败与目标删除仍保留草稿，其他编者不可访问", async ({ page, browser, baseURL }) => {
  test.setTimeout(120_000);
  await page.request.post("/api/auth/sign-in/email", { data: { email: process.env.SEED_ADMIN_EMAIL, password: process.env.SEED_ADMIN_PASSWORD } });
  const context = await browser.newContext({ baseURL });
  const outsider = await browser.newContext({ baseURL });
  const editor = await context.newPage();
  const create = async (data: object) => { const r = await page.request.post("/api/submissions", { data }); expect(r.status()).toBe(201); return r.json(); };
  try {
    await fixtureRegister(editor.request, { data: { email: `${randomUUID()}@example.com`, password: "password123", name: "整理编者" } });
    await fixtureRegister(outsider.request, { data: { email: `${randomUUID()}@example.com`, password: "password123", name: "其他编者" } });
    const term = await create({ kind: "new_term", title: `Rebase ${randomUUID()}`, summary: "当前简介" });
    const interpreter = await create({ kind: "new_interpreter", title: `Rebase reader ${randomUUID()}` });
    const perspective = await create({ kind: "new_perspective", termId: term.pageId, interpreterId: interpreter.pageId, content: "当前正文" });
    for (const [type, target] of [["term", term], ["perspective", perspective]] as const) {
      const head = (await (await page.request.get(`/api/pages/${target.pageId}/history`)).json()).revisions[0];
      const payload = type === "term" ? { kind: "edit", pageId: target.pageId, baseRevisionId: head.id, title: head.snapshot.title, summary: "原提案简介", aliases: ["提案别名"] } : { kind: "edit", pageId: target.pageId, baseRevisionId: head.id, content: "原提案正文" };
      const { submissionId } = await (await editor.request.post("/api/submissions", { data: payload })).json();
      await page.request.post(`/api/admin/submissions/${submissionId}/review`, { data: { action: "reject", reason: "重新整理" } });
      await create(type === "term" ? { ...payload, summary: "最新版简介" } : { ...payload, content: "最新版正文" });
      expect((await outsider.request.get(`/profile/submissions/${submissionId}/resubmit`)).status()).toBe(404);
      expect((await outsider.request.post("/api/submissions", { data: { ...payload, supersedes: submissionId } })).status()).toBe(403);
      await editor.goto(`/profile/submissions/${submissionId}/resubmit`);
      await expect(editor.getByRole("region", { name: "最新版与原提案" })).toContainText(type === "term" ? "最新版简介" : "最新版正文");
      await expect(editor.getByRole("region", { name: "最新版与原提案" })).toContainText(type === "term" ? "原提案简介" : "原提案正文");
      await expect(editor.getByRole("button", { name: "提交审核", exact: true })).toBeDisabled();
      const input = type === "term" ? editor.getByLabel("一句话简介（信息框用）") : editor.getByRole("textbox", { name: "正文（Markdown）" });
      await input.fill(type === "term" ? "人工整理简介" : "人工整理正文");
      await editor.getByRole("checkbox", { name: /人工整理并确认/ }).check();
      if (type === "term") {
        await editor.getByLabel("词条标题", { exact: true }).fill("");
        await editor.getByRole("button", { name: "提交审核", exact: true }).click();
        await expect(editor.getByTestId("form-error")).toContainText("标题不能为空");
        await editor.reload();
        await expect(input).toHaveValue("人工整理简介");
        await editor.getByLabel("词条标题", { exact: true }).fill(head.snapshot.title);
        await editor.getByRole("checkbox", { name: /人工整理并确认/ }).check();
      }
      const submitted = editor.waitForResponse(r => r.url().endsWith("/api/submissions") && r.request().method() === "POST");
      await editor.getByRole("button", { name: "提交审核", exact: true }).click();
      const next = await (await submitted).json();
      await expect(editor.getByTestId("submit-success")).toBeVisible();
      expect((await page.request.post(`/api/admin/submissions/${next.submissionId}/review`, { data: { action: "approve" } })).ok()).toBe(true);
      await editor.goto(target.href);
      await expect(editor.getByText(type === "term" ? "人工整理简介" : "人工整理正文", { exact: true }).first()).toBeVisible();
      await editor.goto(`/profile/submissions/${submissionId}/resubmit`);
      await input.fill("删除后仍需保留的草稿");
      await expect(editor.getByText(/草稿已自动保存/)).toBeVisible();
      await page.request.post(`/api/admin/pages/${target.pageId}`, { data: { action: "delete" } });
      await editor.reload();
      await expect(editor.getByRole("alert").filter({ hasText: "目标页面" })).toBeVisible();
      await expect(editor.getByRole("button", { name: "提交审核", exact: true })).toBeDisabled();
      if (type === "term") await expect(input).toHaveValue("删除后仍需保留的草稿");
      else await expect(input).toContainText("删除后仍需保留的草稿");
      await page.request.post(`/api/admin/pages/${target.pageId}`, { data: { action: "restore" } });
    }
  } finally { await Promise.all([context.close(), outsider.close()]); }
});

test("新诠释者与新视角完整恢复，父页失效保留选择且可以调整目标重提", async ({ page, browser, baseURL }) => {
  test.setTimeout(120_000);
  await page.request.post("/api/auth/sign-in/email", { data: { email: process.env.SEED_ADMIN_EMAIL, password: process.env.SEED_ADMIN_PASSWORD } });
  const context = await browser.newContext({ baseURL });
  const editor = await context.newPage();
  const create = async (data: object) => { const r = await page.request.post("/api/submissions", { data }); expect(r.status()).toBe(201); return r.json(); };
  try {
    await fixtureRegister(editor.request, { data: { email: `${randomUUID()}@example.com`, password: "password123", name: "视角编者" } });
    const title = `Interpreter retry ${randomUUID()}`;
    const { submissionId } = await (await editor.request.post("/api/submissions", { data: { kind: "new_interpreter", title, summary: "诠释者完整简介" } })).json();
    await page.request.post(`/api/admin/submissions/${submissionId}/review`, { data: { action: "reject", reason: "补充人物资料" } });
    await editor.goto(`/profile/submissions/${submissionId}/resubmit`);
    await expect(editor.getByLabel("诠释者名称")).toHaveValue(title);
    await expect(editor.getByLabel("一句话简介（信息框用）")).toHaveValue("诠释者完整简介");
    await editor.getByLabel("一句话简介（信息框用）").fill("补充后的资料");
    await expect(editor.getByText(/草稿已自动保存/)).toBeVisible();
    await editor.reload();
    await expect(editor.getByLabel("一句话简介（信息框用）")).toHaveValue("补充后的资料");
    const response = editor.waitForResponse(r => r.url().endsWith("/api/submissions") && r.request().method() === "POST");
    await editor.getByRole("button", { name: "提交审核", exact: true }).click();
    const next = await (await response).json();
    expect((await page.request.post(`/api/admin/submissions/${next.submissionId}/review`, { data: { action: "approve" } })).ok()).toBe(true);
    const interpreter = await create({ kind: "new_interpreter", title: `Perspective retry ${randomUUID()}` });
    const term = await create({ kind: "new_term", title: `Unavailable ${randomUUID()}` });
    const replacement = await create({ kind: "new_term", title: `Replacement ${randomUUID()}` });
    const { submissionId: perspectiveId } = await (await editor.request.post("/api/submissions", { data: { kind: "new_perspective", termId: term.pageId, interpreterId: interpreter.pageId, content: "完整视角提案" } })).json();
    await page.request.post(`/api/admin/submissions/${perspectiveId}/review`, { data: { action: "reject", reason: "调整目标" } });
    await editor.goto(`/profile/submissions/${perspectiveId}/resubmit`);
    await expect(editor.getByLabel("所属词条")).toHaveValue(String(term.pageId));
    await expect(editor.getByRole("combobox", { name: "诠释者", exact: true })).toHaveValue(String(interpreter.pageId));
    await expect(editor.getByRole("textbox", { name: "正文（Markdown）" })).toContainText("完整视角提案");
    await page.request.post(`/api/admin/pages/${term.pageId}`, { data: { action: "delete" } });
    await editor.getByRole("button", { name: "提交审核", exact: true }).click();
    await expect(editor.getByTestId("form-error")).toContainText("已删除");
    await editor.reload();
    await expect(editor.getByRole("alert").filter({ hasText: "原所属词条不可用" })).toBeVisible();
    await expect(editor.getByLabel("所属词条")).toHaveValue(String(term.pageId));
    await editor.getByLabel("所属词条").selectOption(String(replacement.pageId));
    const resubmitted = editor.waitForResponse(r => r.url().endsWith("/api/submissions") && r.request().method() === "POST");
    await editor.getByRole("button", { name: "提交审核", exact: true }).click();
    const moved = await (await resubmitted).json();
    expect((await page.request.post(`/api/admin/submissions/${moved.submissionId}/review`, { data: { action: "approve" } })).ok()).toBe(true);
    await editor.goto(replacement.href);
    await editor.getByRole("link", { name: /Perspective retry.*论Replacement/ }).click();
    await expect(editor.getByText("完整视角提案", { exact: true })).toBeVisible();
  } finally { await context.close(); }
});


test("编者成为管理员后重提直接生效，仅清理该重提草稿", async ({ page, browser, baseURL }) => {
  test.setTimeout(90_000);
  await page.request.post("/api/auth/sign-in/email", { data: { email: process.env.SEED_ADMIN_EMAIL, password: process.env.SEED_ADMIN_PASSWORD } });
  const context = await browser.newContext({ baseURL });
  const editor = await context.newPage();
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  let editorId: string | undefined;
  try {
    const account = await fixtureRegister(editor.request, { data: { email: `${randomUUID()}@example.com`, password: "password123", name: "晋升编者" } });
    editorId = (await account.json()).user.id;
    const title = `Promoted ${randomUUID()}`;
    const { submissionId } = await (await editor.request.post("/api/submissions", { data: { kind: "new_interpreter", title, summary: "原资料" } })).json();
    await page.request.post(`/api/admin/submissions/${submissionId}/review`, { data: { action: "reject", reason: "补全后重提" } });
    await editor.goto(`/profile/submissions/${submissionId}/resubmit`);
    await editor.getByLabel("一句话简介（信息框用）").fill("晋升后的完整资料");
    await expect(editor.getByText(/草稿已自动保存/)).toBeVisible();
    await editor.evaluate(() => localStorage.setItem("phoskywiki:draft:new-term", "unrelated draft"));
    await pool.query('UPDATE "user" SET role = $1 WHERE id = $2', ["admin", editorId]);
    await editor.reload();
    await editor.getByRole("button", { name: "提交（直接生效）" }).click();
    await expect(editor.getByTestId("submit-success")).toContainText("已直接生效");
    expect(await editor.evaluate(() => Object.keys(localStorage).filter(key => key.includes(":resubmit:")))).toEqual([]);
    expect(await editor.evaluate(() => localStorage.getItem("phoskywiki:draft:new-term"))).toBe("unrelated draft");
    await editor.getByRole("link", { name: "查看页面 →" }).click();
    await editor.waitForURL("**/interpreter/**");
    await expect(editor.getByText("晋升后的完整资料", { exact: true })).toBeVisible();
    await editor.goto(`/profile/submissions/${submissionId}`);
    await expect(editor.getByText("已驳回", { exact: true })).toBeVisible();
  } finally {
    if (editorId) await pool.query('UPDATE "user" SET role = $1 WHERE id = $2', ["editor", editorId]);
    await pool.end();
    await context.close();
  }
});
