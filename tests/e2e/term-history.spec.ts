import { fixtureRegister } from "./auth-fixture";
import "dotenv/config";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { expect, test, type APIRequestContext } from "./fixtures";

async function submit(request: APIRequestContext, data: object) {
  const response = await request.post("/api/submissions", { data });
  expect(response.status()).toBe(201);
  return response.json();
}
async function signIn(request: APIRequestContext) {
  expect((await request.post("/api/auth/sign-in/email", { data: { email: process.env.SEED_ADMIN_EMAIL, password: process.env.SEED_ADMIN_PASSWORD } })).ok()).toBe(true);
}

test("词条两次编辑、非相邻字段比较、带来源回滚、id链接与撞名失败", async ({ page, browser, baseURL }) => {
  test.setTimeout(120_000);
  await signIn(page.request);
  const token = randomUUID();
  const title = `History Original ${token}`;
  const newestTitle = `History Latest ${token}`;
  const term = await submit(page.request, { kind: "new_term", title, summary: "原始简介", aliases: ["原始别名"] });
  const interpreter = await submit(page.request, { kind: "new_interpreter", title: `History Reader ${token}` });
  await submit(page.request, { kind: "new_perspective", termId: term.pageId, interpreterId: interpreter.pageId, content: "独立具名视角" });
  const source = await submit(page.request, { kind: "new_term", title: `Linked ${token}` });
  const sourcePerspective = await submit(page.request, { kind: "new_perspective", termId: source.pageId, interpreterId: interpreter.pageId, content: `参见 [[${title}]]。` });
  const api = `/api/pages/${term.pageId}/history`;
  const first = (await (await page.request.get(api)).json()).revisions[0].id;
  await page.goto(`/edit/${term.pageId}`);
  await page.getByLabel("词条标题", { exact: true }).fill(`History Middle ${token}`);
  await page.getByLabel("一句话简介（信息框用）").fill("中间简介");
  await page.getByLabel("别名（信息框用，以逗号分隔）").fill("中间别名");
  await page.getByRole("button", { name: "提交（直接生效）", exact: true }).click();
  await expect(page.getByTestId("submit-success")).toBeVisible();
  const middle = (await (await page.request.get(api)).json()).revisions[0].id;
  const editorContext = await browser.newContext({ baseURL });
  try {
    expect((await fixtureRegister(editorContext.request, { data: { email: `history-editor-${token}@example.com`, password: "password123", name: "历史编者" } })).ok()).toBe(true);
    const proposal = await submit(editorContext.request, { kind: "edit", pageId: term.pageId, baseRevisionId: middle, title: newestTitle, summary: "最新简介", aliases: ["最新别名", "另一别名"] });
    expect(proposal.quorum).toBe(1);
    const approved = await page.request.post(`/api/admin/submissions/${proposal.submissionId}/review`, { data: { action: "approve" } });
    expect(await approved.json()).toMatchObject({ outcome: "approved" });
    const before = await (await page.request.get(api)).json();
    const last = before.revisions[0].id;
    await page.goto(`/history/${term.pageId}`);
    await expect(page.getByTestId("history-revision").nth(0)).toContainText("普通受理");
    await expect(page.getByTestId("history-revision").nth(1)).toContainText("管理员直编");
    await expect(page.getByTestId("history-revision").nth(2)).toContainText("新建");
    await page.getByLabel("起始修订", { exact: true }).selectOption(String(first));
    await page.getByLabel("目标修订", { exact: true }).selectOption(String(last));
    await page.getByRole("button", { name: "对比修订", exact: true }).click();
    const diff = page.getByTestId("term-metadata-diff");
    await expect(diff.locator('[data-changed="true"]')).toHaveCount(3);
    await expect(diff).toContainText(title);
    await expect(diff).toContainText(newestTitle);
    await expect(diff).toContainText("原始简介");
    await expect(diff).toContainText("最新简介");
    await expect(diff).toContainText("原始别名");
    await expect(diff).toContainText('"最新别名"、"另一别名"');
    await expect(diff).toContainText("起始修订");
    await page.getByRole("button", { name: `回滚到修订 #${first}`, exact: true }).click();
    await expect(page.getByTestId("history-revision")).toHaveCount(4);
    await expect(page.getByTestId("history-revision").first()).toContainText(`回滚自 #${first}`);
    const after = await (await page.request.get(api)).json();
    expect(after.revisions.slice(1)).toEqual(before.revisions);
    await page.goto(`/term/${before.page.slug}-${term.pageId}`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(title);
    await expect(page).toHaveURL(new RegExp(`/term/history-original-.*-${term.pageId}$`));
    await expect(page.getByText("原始简介", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("原始别名", { exact: true })).toBeVisible();
    await page.getByRole("link", { name: `History Reader ${token}论${title}`, exact: true }).click();
    await expect(page.locator(".wiki-content")).toContainText("独立具名视角");
    await page.goto(sourcePerspective.href);
    await page.locator(".wiki-content").getByRole("link", { name: title, exact: true }).click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(title);
    await submit(page.request, { kind: "new_term", title: newestTitle });
    await page.goto(`/history/${term.pageId}`);
    await page.getByRole("button", { name: `回滚到修订 #${last}`, exact: true }).click();
    await expect(page.getByTestId("history-revision").getByRole("alert")).toContainText("回滚失败：历史标题已存在");
    await expect(page.getByTestId("history-revision")).toHaveCount(4);
    expect(await (await page.request.get(api)).json()).toEqual(after);
    await page.goto(term.href);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(title);
    await expect(page.getByText("原始简介", { exact: true }).first()).toBeVisible();
  } finally { await editorContext.close(); }
});

test("旧词条正文保留可读，不能猜测字段或回滚；起始快照可比较并恢复", async ({ page }) => {
  test.setTimeout(90_000);
  await signIn(page.request);
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  let pageId: number;
  const title = `History Legacy ${randomUUID()}`;
  const legacyContent = '```json\n{"title":"不能猜测的标题","summary":"不能猜测的简介","aliases":["不能猜测的别名"]}\n```';
  try {
    const result = await pool.query("INSERT INTO pages(type,title,slug) VALUES('term',$1,'legacy') RETURNING id", [title]);
    pageId = result.rows[0].id;
    await pool.query("INSERT INTO terms(page_id,summary,aliases) VALUES($1,$2,$3)", [pageId, "真实起始简介", ["真实起始别名"]]);
    await pool.query("INSERT INTO revisions(page_id,content) VALUES($1,$2)", [pageId, legacyContent]);
  } finally { await pool.end(); }
  const api = `/api/pages/${pageId}/history`;
  const original = await (await page.request.get(api)).json();
  const legacy = original.revisions[0].id;
  await page.goto(`/history/${pageId}`);
  await expect(page.getByText(/未保存词条信息快照/)).toBeVisible();
  await expect(page.getByRole("button", { name: `回滚到修订 #${legacy}`, exact: true })).toHaveCount(0);
  await page.getByText("查看修订正文", { exact: true }).click();
  await expect(page.locator("pre")).toHaveText(legacyContent);
  expect((await page.request.post(`/api/admin/pages/${pageId}`, { data: { action: "rollback", revisionId: legacy } })).status()).toBe(409);
  expect(await (await page.request.get(api)).json()).toEqual(original);
  await page.goto(`/edit/${pageId}`);
  const baseline = (await (await page.request.get(api)).json()).revisions[0].id;
  await page.getByLabel("词条标题", { exact: true }).fill(`${title} Renamed`);
  await page.getByLabel("一句话简介（信息框用）").fill("新简介");
  await page.getByLabel("别名（信息框用，以逗号分隔）").fill("新别名");
  await page.getByRole("button", { name: "提交（直接生效）", exact: true }).click();
  await expect(page.getByTestId("submit-success")).toBeVisible();
  const newest = (await (await page.request.get(api)).json()).revisions[0].id;
  await page.goto(`/history/${pageId}?from=${legacy}&to=${newest}`);
  await expect(page.getByRole("region", { name: "修订对比" })).toContainText("无法比较词条信息");
  await expect(page.getByTestId("term-metadata-diff")).toHaveCount(0);
  await expect(page.getByTestId("history-revision").nth(1)).toContainText("起始快照");
  await page.getByLabel("起始修订", { exact: true }).selectOption(String(baseline));
  await page.getByRole("button", { name: "对比修订", exact: true }).click();
  await expect(page.getByTestId("term-metadata-diff")).toContainText("真实起始简介");
  await expect(page.getByTestId("term-metadata-diff")).not.toContainText("不能猜测的简介");
  await page.getByRole("button", { name: `回滚到修订 #${baseline}`, exact: true }).click();
  await expect(page.getByTestId("history-revision")).toHaveCount(4);
  await expect(page.getByTestId("history-revision").first()).toContainText(`回滚自 #${baseline}`);
  await page.getByTestId("history-revision").first().getByText("查看词条信息快照", { exact: true }).click();
  await expect(page.getByTestId("history-revision").first().locator("dl")).toContainText("真实起始别名");
  expect((await (await page.request.get(api)).json()).revisions[3]).toEqual(original.revisions[0]);
  await page.goto(`/term/legacy-${pageId}`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(title);
  await expect(page.getByText("真实起始简介", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("真实起始别名", { exact: true })).toBeVisible();
});
