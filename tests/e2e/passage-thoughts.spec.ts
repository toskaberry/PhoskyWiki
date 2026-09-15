import "dotenv/config";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { expect, test, type APIRequestContext, type Page } from "./fixtures";
import { fixtureRegister } from "./auth-fixture";
import { cleanupTestContent } from "./content-cleanup";
import { getDb } from "../../src/db";
import { user } from "../../src/db/schema";

const content = "第一句包含部分引用。第二句继续讨论。\n\n第三句跨越段落。";

async function submit(request: APIRequestContext, data: Record<string, unknown>) {
  const response = await request.post("/api/submissions", { data });
  expect(response.status()).toBe(201);
  return response.json() as Promise<{ pageId: number; href: string }>;
}

async function setup(page: Page) {
  const signed = await page.request.post("/api/auth/sign-in/email", {
    data: { email: process.env.SEED_ADMIN_EMAIL ?? "admin@phoskywiki.local", password: process.env.SEED_ADMIN_PASSWORD },
  });
  expect(signed.ok()).toBe(true);
  const suffix = randomUUID();
  const titles = [`想法词条 ${suffix}`, `想法作者 ${suffix}`];
  const term = await submit(page.request, { kind: "new_term", title: titles[0] });
  const interpreter = await submit(page.request, { kind: "new_interpreter", title: titles[1] });
  const perspective = await submit(page.request, { kind: "new_perspective", termId: term.pageId, interpreterId: interpreter.pageId, content });
  const revision = (await (await page.request.get(`/api/pages/${perspective.pageId}/history`)).json()).revisions[0].id as number;
  return { ...perspective, revision, titles };
}

async function selectText(page: Page, quote: string) {
  expect(await page.evaluate(quote => {
    const root = document.querySelector(".wiki-content");
    if (!root) return false;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const texts: Text[] = [];
    for (let node = walker.nextNode(); node; node = walker.nextNode()) texts.push(node as Text);
    const start = texts.map(text => text.data).join("").indexOf(quote);
    if (start < 0) return false;
    let cursor = 0;
    const range = document.createRange();
    let started = false;
    for (const text of texts) {
      if (!started && start <= cursor + text.length) { range.setStart(text, start - cursor); started = true; }
      if (started && start + quote.length <= cursor + text.length) {
        range.setEnd(text, start + quote.length - cursor);
        document.getSelection()?.removeAllRanges();
        document.getSelection()?.addRange(range);
        return true;
      }
      cursor += text.length;
    }
    return false;
  }, quote)).toBe(true);
}

async function writeThought(page: Page, quote: string, text: string, visibility = "public") {
  await selectText(page, quote);
  await page.getByRole("button", { name: "写想法", exact: true }).click();
  await page.getByLabel("想法内容", { exact: true }).fill(text);
  await page.getByLabel("想法可见性").selectOption(visibility);
  await page.getByRole("button", { name: "发布想法", exact: true }).click();
  await expect(page.getByLabel("想法内容", { exact: true })).toHaveCount(0);
}

test("句子聚合局部、跨句跨段引用，私密想法仅本人可见，公开想法支持赞同与平铺回复", async ({ page, browser }) => {
  test.skip(!process.env.SEED_ADMIN_PASSWORD, "需要种子管理员密码");
  test.setTimeout(90_000);
  const source = await setup(page);
  const readerContext = await browser.newContext();
  const email = `thought-${randomUUID()}@example.com`;
  try {
    await page.goto(source.href);
    await writeThought(page, "部分引用", "局部公开想法");
    await writeThought(page, "第二句继续讨论。第三句跨越", "跨句跨段想法", "private");
    await expect(page.locator(".pw-thought-marker[data-own=true]")).toHaveCount(3);
    await page.locator(".pw-thought-marker").first().click();
    const panel = page.getByRole("dialog", { name: "句子想法" });
    await expect(panel).toContainText("局部公开想法");
    await expect(panel.getByRole("button", { name: /^赞同/ })).toHaveCount(0);
    await panel.getByRole("button", { name: "关闭想法面板" }).click();
    await page.reload();
    await expect(page.locator(".pw-mark--highlight")).not.toHaveCount(0);

    expect((await fixtureRegister(readerContext.request, { data: { name: "想法读者", email, password: "thought-reader-password" } })).ok()).toBe(true);
    const reader = await readerContext.newPage();
    await reader.goto(source.href);
    await expect(reader.locator(".pw-thought-marker")).toHaveCount(1);
    await expect(reader.locator(".pw-thought-marker")).toHaveAttribute("data-own", "false");
    await expect(reader.locator(".pw-mark")).toHaveCount(0);
    await reader.locator(".pw-thought-marker").click();
    const readPanel = reader.getByRole("dialog", { name: "句子想法" });
    await expect(readPanel).not.toContainText("跨句跨段想法");
    await readPanel.getByRole("button", { name: /^赞同/ }).click();
    await expect(readPanel.getByRole("button", { name: /^取消赞同/ })).toBeVisible();
    await readPanel.getByRole("button", { name: "回复想法" }).click();
    await readPanel.getByLabel("回复内容").fill("第一条回复");
    await readPanel.getByRole("button", { name: "发送回复" }).click();
    await expect(readPanel).toContainText("第一条回复");
    await readPanel.getByRole("button", { name: "删除回复" }).click();
    await expect(readPanel).toContainText("该回复已删除");

    await page.locator(".pw-thought-marker").nth(1).click();
    await page.getByRole("button", { name: "设为公开" }).click();
    await reader.reload();
    await expect(reader.locator(".pw-thought-marker")).toHaveCount(3);
    await reader.locator(".pw-thought-marker").nth(2).click();
    await expect(reader.getByRole("dialog", { name: "句子想法" })).toContainText("跨句跨段想法");
    await reader.setViewportSize({ width: 390, height: 844 });
    await expect(reader.getByRole("button", { name: /回复想法|发送回复|赞同|删除回复/ })).toHaveCount(0);
    await reader.getByRole("button", { name: "关闭想法面板" }).click();
    await selectText(reader, "部分引用");
    await expect(reader.getByRole("toolbar")).toHaveCount(0);
  } finally {
    await readerContext.close();
    await getDb().delete(user).where(eq(user.email, email));
    await cleanupTestContent(source.titles, page.request);
  }
});

test("失败保留想法草稿，旧修订明确确认后提交，失定位想法保留引用和版本入口", async ({ page }) => {
  test.skip(!process.env.SEED_ADMIN_PASSWORD, "需要种子管理员密码");
  test.setTimeout(90_000);
  const source = await setup(page);
  try {
    await page.goto(source.href);
    await selectText(page, "部分引用");
    const bar = page.getByRole("toolbar", { name: "划线工具条" });
    await bar.focus();
    await bar.getByRole("button", { name: "写想法" }).focus();
    await page.keyboard.press("Enter");
    await page.getByLabel("想法内容", { exact: true }).fill("不要丢掉这份草稿");
    await page.route("**/api/thoughts", route => route.abort(), { times: 1 });
    await page.getByRole("button", { name: "发布想法", exact: true }).click();
    await expect(page.getByRole("alert")).toContainText("重试");
    await expect(page.getByLabel("想法内容", { exact: true })).toHaveValue("不要丢掉这份草稿");
    await submit(page.request, { kind: "edit", pageId: source.pageId, content: "完全替换后的正文。", baseRevisionId: source.revision });
    await page.getByRole("button", { name: "发布想法", exact: true }).click();
    await expect(page.getByRole("button", { name: "确认以原选文发布" })).toBeVisible();
    await expect(page.getByLabel("想法内容", { exact: true })).toHaveValue("不要丢掉这份草稿");
    await page.getByRole("button", { name: "确认以原选文发布" }).click();
    await expect(page.getByLabel("想法内容", { exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /查看原文已变化的想法/ })).toBeVisible();
    await page.getByRole("button", { name: /查看原文已变化的想法/ }).click();
    const panel = page.getByRole("dialog", { name: "句子想法" });
    await expect(panel).toContainText("部分引用");
    await expect(panel).toContainText("原文已变化");
    await expect(panel.getByRole("link", { name: "查看原修订" })).toHaveAttribute("href", `/history/${source.pageId}?from=${source.revision}&to=${source.revision}`);
  } finally { await cleanupTestContent(source.titles, page.request); }
});
