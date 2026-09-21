import { openAccountMenu } from "./navigation-fixture";
import { fixtureRegister } from "./auth-fixture";
import "dotenv/config";
import { randomUUID } from "node:crypto";
import { expect, test, type APIRequestContext } from "./fixtures";

const ADMIN_EMAIL = process.env.SEED_ADMIN_EMAIL ?? "admin@phoskywiki.local";
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD;

async function submit(request: APIRequestContext, data: Record<string, unknown>) {
  const response = await request.post("/api/submissions", { data });
  expect(response.status()).toBe(201);
  return response.json() as Promise<{ pageId: number; href: string }>;
}

test("历史选择任意修订并高亮行内差异，回滚更新正文，删除与恢复控制读者可见性", async ({ page, browser, baseURL }) => {
  test.skip(!ADMIN_PASSWORD, "需要 SEED_ADMIN_PASSWORD");
  const signed = await page.request.post("/api/auth/sign-in/email", {
    data: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
  });
  expect(signed.ok()).toBe(true);
  const suffix = randomUUID();
  const term = await submit(page.request, { kind: "new_term", title: `历史词条 ${suffix}` });
  const interpreter = await submit(page.request, { kind: "new_interpreter", title: `历史诠释者 ${suffix}` });
  const initialContent = "旧论点😀与旧结论\n参见[[异化]]。";
  const perspective = await submit(page.request, {
    kind: "new_perspective", termId: term.pageId, interpreterId: interpreter.pageId, content: initialContent,
  });
  const historyUrl = `/history/${perspective.pageId}`;
  const apiUrl = `/api/pages/${perspective.pageId}/history`;
  const first = (await (await page.request.get(apiUrl)).json()).revisions[0].id;
  for (const content of ["中间修订", "新论点😀与新结论\n参见[[异化]]。\n另见[[剩余价值]]。"]) {
    const current = (await (await page.request.get(apiUrl)).json()).revisions[0].id;
    await submit(page.request, { kind: "edit", pageId: perspective.pageId, content, baseRevisionId: current });
  }
  const newest = (await (await page.request.get(apiUrl)).json()).revisions[0].id;
  const readerContext = await browser.newContext({ baseURL });
  try {
    const reader = await readerContext.newPage();
    await page.goto(perspective.href);
    await page.getByRole("link", { name: "修订历史", exact: true }).click();
    await expect(page.getByTestId("history-revision")).toHaveCount(3);
    await page.getByLabel("起始修订", { exact: true }).selectOption(String(first));
    await page.getByLabel("目标修订", { exact: true }).selectOption(String(newest));
    await page.getByRole("button", { name: "对比修订", exact: true }).click();
    const diff = page.getByTestId("revision-diff");
    await expect(diff.locator("tr").nth(1).locator("del")).toHaveText(["旧", "旧"]);
    await expect(diff.locator("tr").nth(1).locator("ins")).toHaveText(["新", "新"]);
    await expect(diff.locator('[data-diff="same"]')).toHaveCount(2);
    await reader.goto(perspective.href);
    await expect(reader.locator("article").getByRole("link", { name: "剩余价值", exact: true })).toBeVisible();
    await reader.getByRole("link", { name: "剩余价值", exact: true }).click();
    const surplusHref = reader.url();
    await expect(reader.getByRole("link", { name: new RegExp(`历史诠释者 ${suffix}论`) })).toBeVisible();
    await page.getByRole("button", { name: `回滚到修订 #${first}`, exact: true }).click();
    await expect(page.getByTestId("history-revision")).toHaveCount(4);
    await expect(page.getByTestId("history-revision").first()).toContainText(`回滚自 #${first}`);
    await reader.goto(perspective.href);
    await expect(reader.locator("article")).toContainText("旧论点😀与旧结论");
    await expect(reader.locator("article").getByRole("link", { name: "异化", exact: true })).toBeVisible();
    await reader.goto(surplusHref);
    await expect(reader.getByRole("link", { name: new RegExp(suffix) })).toHaveCount(0);
    await reader.goto(historyUrl);
    await expect(reader.getByRole("button", { name: /回滚到|软删除页面|恢复页面/ })).toHaveCount(0);

    // 编者自己的提案可保留，但其提交详情不能绕过删除门禁读取 base 修订。
    const registered = await fixtureRegister(reader.request, {
      data: { email: `history-reader-${suffix}@example.com`, password: "history-reader-pass123", name: "历史测试编者" },
    });
    expect(registered.ok()).toBe(true);
    const proposedText = "这是我提交的提案，继续保留。";
    const pendingResponse = await reader.request.post("/api/submissions", {
      data: { kind: "edit", pageId: perspective.pageId, content: proposedText, baseRevisionId: newest },
    });
    expect(pendingResponse.status()).toBe(201);
    const pending = await pendingResponse.json();
    const submissionHref = `/profile/submissions/${pending.submissionId}`;
    await reader.goto(submissionHref);
    await expect(reader.getByTestId("content-diff")).toContainText("新论点😀与新结论");

    await page.getByRole("button", { name: "软删除页面", exact: true }).click();
    await expect(page.getByRole("button", { name: "恢复页面", exact: true })).toBeVisible();
    await reader.goto(submissionHref);
    await expect(reader.getByText(/历史正文不予展示/)).toBeVisible();
    await expect(reader.getByTestId("content-diff")).toHaveCount(0);
    await expect(reader.getByText("新论点😀与新结论", { exact: true })).toHaveCount(0);
    await expect(reader.getByText(proposedText, { exact: true })).toBeVisible();
    await reader.goto(perspective.href);
    await expect(reader.getByRole("heading", { name: "404", exact: true })).toBeVisible();
    await reader.goto(historyUrl);
    await expect(reader.getByRole("heading", { name: "404", exact: true })).toBeVisible();
    await reader.goto(term.href);
    await expect(reader.getByRole("link", { name: /历史诠释者.*论历史词条/ })).toHaveCount(0);
    await (await openAccountMenu(page)).getByRole("link", { name: "已删除页面", exact: true }).click();
    await page.getByRole("link", { name: new RegExp(suffix) }).click();
    await expect(page.getByTestId("history-revision")).toHaveCount(4);
    await page.getByRole("button", { name: "恢复页面", exact: true }).click();
    await expect(page.getByRole("button", { name: "软删除页面", exact: true })).toBeVisible();
    await reader.goto(perspective.href);
    await expect(reader.locator("article")).toContainText("旧论点😀与旧结论");
    await expect(reader.locator("article").getByRole("link", { name: "异化", exact: true })).toBeVisible();
    await reader.goto(historyUrl);
    await expect(reader.getByTestId("history-revision")).toHaveCount(4);
    await reader.goto(submissionHref);
    await expect(reader.getByTestId("content-diff")).toContainText("新论点😀与新结论");
    await reader.setViewportSize({ width: 390, height: 844 });
    await reader.goto(`${historyUrl}?from=${first}&to=${newest}`);
    await expect(reader.getByTestId("revision-diff")).toBeVisible();
    expect(await reader.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  } finally {
    await readerContext.close();
  }
});
