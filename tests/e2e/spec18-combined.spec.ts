import { fixtureRegister } from "./auth-fixture";
import "dotenv/config";
import { randomUUID } from "node:crypto";
import { expect, test, type APIRequestContext } from "./fixtures";

async function submit(request: APIRequestContext, data: object) {
  const response = await request.post("/api/submissions", { data });
  expect(response.status()).toBe(201);
  return response.json();
}
async function signIn(request: APIRequestContext) {
  expect((await request.post("/api/auth/sign-in/email", { data: {
    email: process.env.SEED_ADMIN_EMAIL, password: process.env.SEED_ADMIN_PASSWORD,
  } })).ok()).toBe(true);
}
async function manage(request: APIRequestContext, pageId: number, action: "delete" | "restore") {
  expect((await request.post(`/api/admin/pages/${pageId}`, { data: { action } })).status()).toBe(200);
}

for (const parent of ["term", "interpreter"] as const) {
  test(`组合：${parent} 删除→系统驳回→恢复→从详情 UI 重提→公开阅读`, async ({ page, request }) => {
    test.setTimeout(120_000);
    await signIn(request);
    const token = randomUUID();
    expect((await fixtureRegister(page.request, { data: {
      email: `combined-${token}@example.com`, name: "组合验收编者", password: "password123",
    } })).ok()).toBe(true);
    const term = await submit(request, { kind: "new_term", title: `组合父词条 ${token}` });
    const interpreter = await submit(request, { kind: "new_interpreter", title: `组合诠释者 ${token}` });
    const content = `恢复后保留的完整提案 ${token}`;
    const old = await submit(page.request, { kind: "new_perspective", termId: term.pageId, interpreterId: interpreter.pageId, content });
    const parentId = parent === "term" ? term.pageId : interpreter.pageId;
    try {
      await manage(request, parentId, "delete");
      const decision = await request.post(`/api/admin/submissions/${old.submissionId}/review`, { data: { action: "approve" } });
      expect(decision.status()).toBe(200);
      const { outcome, message } = await decision.json();
      expect(outcome).toBe("rejected");
      expect(message).toContain("系统驳回");
      await page.goto(`/profile/submissions/${old.submissionId}`);
      await expect(page.getByText(message, { exact: true })).toBeVisible();
      const oldReview = await page.getByRole("region", { name: "审核记录" }).innerText();
      await page.getByRole("link", { name: "修改后重新提交", exact: true }).click();
      await page.waitForURL(`**/profile/submissions/${old.submissionId}/resubmit`);
      await expect(page.getByRole("textbox", { name: "正文（Markdown）" })).toContainText(content);
      await expect(page.getByRole("alert").filter({ hasText: "不可用" })).toBeVisible();
      await expect(page.getByLabel("所属词条")).toHaveValue(String(term.pageId));
      await expect(page.getByRole("combobox", { name: "诠释者", exact: true })).toHaveValue(String(interpreter.pageId));
      await page.getByRole("textbox", { name: "正文（Markdown）" }).fill(`${content}\n补充来源后重提`);
      await expect(page.getByText(/草稿已自动保存/)).toBeVisible();
      await manage(request, parentId, "restore");
      await page.reload();
      await expect(page.getByRole("textbox", { name: "正文（Markdown）" })).toContainText("补充来源后重提");
      const response = page.waitForResponse(r => r.url().endsWith("/api/submissions") && r.request().method() === "POST");
      await page.getByRole("button", { name: "提交审核", exact: true }).click();
      const posted = await response;
      expect(posted.status()).toBe(201);
      const next = await posted.json();
      expect(next.submissionId).not.toBe(old.submissionId);
      await expect(page.getByTestId("submit-success")).toBeVisible();
      await page.goto(`/profile/submissions/${next.submissionId}`);
      await expect(page.getByRole("link", { name: `原驳回提交 #${old.submissionId}` })).toBeVisible();
      await expect(page.getByTestId("content-diff")).toContainText("补充来源后重提");
      const approved = await request.post(`/api/admin/submissions/${next.submissionId}/review`, { data: { action: "approve" } });
      expect(await approved.json()).toMatchObject({ outcome: "approved" });
      await page.goto(term.href);
      await page.getByRole("link", { name: `组合诠释者 ${token}论组合父词条 ${token}`, exact: true }).click();
      await expect(page.locator(".wiki-content")).toContainText(content);
      await expect(page.locator(".wiki-content")).toContainText("补充来源后重提");
      await page.goto(`/profile/submissions/${old.submissionId}`);
      await expect(page.getByText("已驳回", { exact: true })).toBeVisible();
      expect(await page.getByRole("region", { name: "审核记录" }).innerText()).toBe(oldReview);
      expect((await request.post(`/api/admin/submissions/${old.submissionId}/review`, { data: { action: "approve" } })).status()).toBe(409);
    } finally { await manage(request, parentId, "restore"); }
  });
}

for (const hidden of ["perspective", "term", "interpreter"] as const) {
  test(`组合：游客兴趣推荐过滤 ${hidden} 删除形成的不可见视角，恢复后重新出现`, async ({ page, request }) => {
    test.setTimeout(90_000);
    await signIn(request);
    const token = randomUUID();
    const title = `兴趣目标 ${token}`;
    const name = `兴趣诠释者 ${token}`;
    const target = await submit(request, { kind: "new_term", title });
    const interpreter = await submit(request, { kind: "new_interpreter", title: name });
    const perspective = await submit(request, { kind: "new_perspective", termId: target.pageId, interpreterId: interpreter.pageId, content: "兴趣匹配正文" });
    const source = await submit(request, { kind: "new_term", title: `兴趣起点 ${token}` });
    const sourceInterpreter = await submit(request, { kind: "new_interpreter", title: `兴趣起点诠释者 ${token}` });
    const sourcePerspective = await submit(request, { kind: "new_perspective", termId: source.pageId, interpreterId: sourceInterpreter.pageId, content: `[[${title}|兴趣目标@${name}]]` });
    const hiddenId = { perspective: perspective.pageId, term: target.pageId, interpreter: interpreter.pageId }[hidden];
    await page.goto("/interests");
    await page.getByLabel(name, { exact: true }).check();
    const discovery = `/api/terms/${source.pageId}/discovery?interests=${encodeURIComponent(JSON.stringify({ interpreters: [interpreter.pageId] }))}`;
    const related = page.getByTestId("related-terms");
    try {
      await page.goto(source.href);
      await expect(page.getByTestId("session-user")).toHaveCount(0);
      await expect(related.getByRole("link", { name: title, exact: true })).toBeVisible();
      expect((await (await page.request.get(discovery)).json()).relatedTerms).toEqual([
        expect.objectContaining({ id: target.pageId, interestMatchCount: 1 }),
      ]);
      await manage(request, hiddenId, "delete");
      await page.reload();
      await expect(related.getByRole("link", { name: title, exact: true })).toHaveCount(0);
      await page.goto(sourcePerspective.href);
      await expect(page.locator(".wiki-content .wiki-link--unavailable")).toHaveText("兴趣目标");
      expect((await (await page.request.get(discovery)).json()).relatedTerms).toEqual([]);
      await manage(request, hiddenId, "restore");
      await page.goto(source.href);
      await expect(related.getByRole("link", { name: title, exact: true })).toBeVisible();
      await page.goto(sourcePerspective.href);
      await expect(page.locator(".wiki-content a.wiki-link")).toHaveAttribute("href", perspective.href);
      expect((await (await page.request.get(discovery)).json()).relatedTerms).toEqual([
        expect.objectContaining({ id: target.pageId, interestMatchCount: 1 }),
      ]);
    } finally { await manage(request, hiddenId, "restore"); }
  });
}
