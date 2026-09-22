import "dotenv/config";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { expect, test as base, type APIRequestContext, type Page } from "./fixtures";
import { cleanupTestContent } from "./content-cleanup";
import { fixtureRegister } from "./auth-fixture";
import { getDb } from "../../src/db";
import { submissions, user } from "../../src/db/schema";

type Target = { pageId: number; href: string; submissionId: number };
type PreviewFixture = { term: Target; empty: Target; interpreters: Target[]; perspectives: Target[]; source: Target; title: string; names: string[]; content: string };
async function login(request: APIRequestContext) {
  expect((await request.post("/api/auth/sign-in/email", { data: {
    email: process.env.SEED_ADMIN_EMAIL ?? "admin@phoskywiki.local", password: process.env.SEED_ADMIN_PASSWORD,
  } })).ok()).toBe(true);
}
async function submit(request: APIRequestContext, data: Record<string, unknown>): Promise<Target> {
  const response = await request.post("/api/submissions", { data });
  expect(response.status(), await response.text()).toBe(201);
  return response.json();
}
const test = base.extend<{ sample: PreviewFixture }>({
  sample: async ({ request }, provide) => {
    test.skip(!process.env.SEED_ADMIN_PASSWORD, "需要独立数据库种子管理员");
    await login(request);
    const suffix = randomUUID();
    const title = `预览词条 ${suffix}`;
    const names = [0, 1, 2].map(i => `预览诠释者${i} ${suffix}`);
    const titles = [title, `空简介 ${suffix}`, `预览来源 ${suffix}`, ...names];
    try {
      const term = await submit(request, { kind: "new_term", title, summary: "词条简介。".repeat(50) });
      const empty = await submit(request, { kind: "new_term", title: titles[1] });
      const sourceTerm = await submit(request, { kind: "new_term", title: titles[2] });
      const interpreters: Target[] = [];
      const perspectives: Target[] = [];
      for (const name of names) {
        const interpreter = await submit(request, { kind: "new_interpreter", title: name });
        interpreters.push(interpreter);
        perspectives.push(await submit(request, { kind: "new_perspective", termId: term.pageId, interpreterId: interpreter.pageId,
          content: "## 公开开头\n\n**原有正文**与[外部参考](https://example.com)。".repeat(30) }));
      }
      const content = `这里是[[${title}|普通双链]]，**[[${title}|加粗双链]]**，[[${title}|具名视角@${names[0]}]]。\n\n[[${titles[1]}|空词条]]与[[尚未创建 ${suffix}|红链]]。`;
      const source = await submit(request, { kind: "new_perspective", termId: sourceTerm.pageId, interpreterId: interpreters[0].pageId, content });
      await provide({ term, empty, interpreters, perspectives, source, title, names, content });
    } finally { await cleanupTestContent(titles, request); }
  },
});
test.setTimeout(120_000);

const card = (page: Page) => page.getByRole("dialog", { name: "双链预览" });
const bodyLink = (page: Page, name = "普通双链") => page.locator(".wiki-content").getByRole("link", { name, exact: true });
async function compactCard(page: Page) {
  await expect(card(page)).toBeVisible();
  const size = await card(page).boundingBox();
  expect(size).not.toBeNull();
  expect(size!.width).toBeLessThanOrEqual(330);
  expect(size!.height).toBeLessThanOrEqual(281);
  expect(size!.x).toBeGreaterThanOrEqual(0);
  expect(size!.y).toBeGreaterThanOrEqual(0);
  expect(size!.x + size!.width).toBeLessThanOrEqual(page.viewportSize()!.width);
  expect(size!.y + size!.height).toBeLessThanOrEqual(page.viewportSize()!.height);
  // Clamped text is allowed; an independently scrollable region is not.
  expect(await card(page).evaluate(root => [root, ...root.querySelectorAll("*")].some(node => {
    const style = getComputedStyle(node);
    return /(auto|scroll)/.test(style.overflowY) && node.scrollHeight > node.clientHeight;
  }))).toBe(false);
}

test("蓝色正文链接保留强调，小浮卡显示词条简介与两个视角 @cross-browser", async ({ page, sample }) => {
  await page.goto(sample.source.href);
  const link = bodyLink(page);
  await expect(link).toHaveCSS("text-decoration-line", "none");
  expect(Number(await link.evaluate(el => getComputedStyle(el).fontWeight))).toBeLessThan(600);
  expect(Number(await bodyLink(page, "加粗双链").evaluate(el => getComputedStyle(el).fontWeight))).toBeGreaterThanOrEqual(600);
  const assertBlue = async () => {
    const rgb = await link.evaluate(el => {
      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d")!;
      ctx.fillStyle = getComputedStyle(el).color;
      ctx.fillRect(0, 0, 1, 1);
      return [...ctx.getImageData(0, 0, 1, 1).data];
    });
    expect(rgb[2]).toBeGreaterThan(rgb[0]);
  };
  await assertBlue();
  await link.hover();
  await expect(link).toHaveCSS("text-decoration-line", "underline");
  await expect(card(page)).toBeHidden();
  await page.mouse.move(0, 0);
  await page.waitForTimeout(750);
  await expect(card(page)).toBeHidden();
  await link.hover();
  await expect(card(page)).toContainText("词条简介");
  await compactCard(page);
  await expect(card(page).getByRole("link", { name: sample.title, exact: true })).toHaveAttribute("href", sample.term.href);
  await expect(card(page).locator('a[href^="/perspective/"]')).toHaveCount(2);
  await expect(card(page).getByRole("link", { name: /查看全部/ })).toHaveAttribute("href", sample.term.href);
  await card(page).hover();
  await page.waitForTimeout(800);
  await expect(card(page)).toHaveCount(1);
  await expect(card(page)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(card(page)).toBeHidden();
  await page.locator("html").evaluate(el => el.classList.add("dark"));
  await assertBlue();
  await page.setViewportSize({ width: 375, height: 450 });
  // Establish keyboard modality; Safari may skip anchors in its native Tab order.
  await page.keyboard.press("Tab");
  await link.focus();
  await expect(link).toBeFocused();
  await expect(card(page)).toContainText("词条简介");
  await compactCard(page);
  const linkBox = await link.boundingBox();
  const cardBox = await card(page).boundingBox();
  expect(cardBox!.y + cardBox!.height <= linkBox!.y || cardBox!.y >= linkBox!.y + linkBox!.height).toBe(true);
  await expect(card(page).getByRole("link", { name: /查看全部/ })).toBeInViewport();
  await page.evaluate(() => window.scrollBy(0, window.innerHeight));
  await expect(link).not.toBeInViewport();
  await expect(card(page)).toBeHidden();
  await link.hover();
  await expect(card(page)).toContainText("词条简介");
  await compactCard(page);
  await link.click();
  await expect(page).toHaveURL(new RegExp(`${sample.term.pageId}$`));
});

test("低矮窗口中的预览入口完整可见且可点击 @cross-browser", async ({ page, sample }) => {
  await page.setViewportSize({ width: 900, height: 200 });
  await page.goto(sample.source.href);
  const link = bodyLink(page);
  await page.keyboard.press("Tab");
  await link.focus();
  await link.evaluate(element => element.scrollIntoView({ block: "center" }));
  await expect(card(page)).toContainText("查看全部");
  await compactCard(page);
  const all = card(page).getByRole("link", { name: /查看全部/ });
  await expect(all).toBeInViewport({ ratio: 1 });
  await all.click();
  await expect(page).toHaveURL(new RegExp(`${sample.term.pageId}$`));
  await page.setViewportSize({ width: 900, height: 160 });
  await page.goto(sample.source.href);
  await page.keyboard.press("Tab");
  await bodyLink(page).focus();
  await bodyLink(page).evaluate(element => element.scrollIntoView({ block: "center" }));
  await expect(card(page)).toContainText(sample.title);
  await compactCard(page);
  for (const entry of await card(page).getByRole("link").all()) {
    await expect(entry).toBeInViewport({ ratio: 1 });
  }
});

test("键盘访问具名视角与浮卡链接，离开关闭，空简介保持可读", async ({ page, sample }) => {
  await page.goto(sample.source.href);
  await bodyLink(page, "具名视角").focus();
  await expect(bodyLink(page, "具名视角")).toHaveCSS("text-decoration-line", "underline");
  await expect(card(page)).toContainText(sample.names[0]);
  await expect(card(page)).toContainText("原有正文");
  await expect(card(page)).not.toContainText("**");
  await page.keyboard.press("Tab");
  await expect(card(page).getByRole("link").first()).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(bodyLink(page, "空词条")).toBeFocused();
  await expect(card(page)).toContainText("暂无简介");
  await bodyLink(page, "具名视角").focus();
  await expect(card(page)).toContainText(sample.names[0]);
  await page.keyboard.press("Tab");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(new RegExp(`${sample.perspectives[0].pageId}$`));
  await page.goto(sample.source.href);
  await bodyLink(page, "空词条").hover();
  await expect(card(page)).toContainText("暂无简介");
  await expect(card(page).locator('a[href^="/perspective/"]')).toHaveCount(0);
  await page.mouse.move(0, 0);
  await expect(card(page)).toBeHidden();
  await page.locator(".wiki-content").getByText("红链", { exact: true }).hover();
  await page.waitForTimeout(800);
  await expect(card(page)).toBeHidden();
  await expect(page.locator(".wiki-content").getByRole("link", { name: "红链", exact: true })).toHaveCount(0);
});

test("公开预览接口限制摘录，不泄露提案或不可见目标，并禁止缓存", async ({ page, request, sample }) => {
  const read = async (id: string | number, status = 200) => {
    const response = await page.request.get(`/api/wiki-preview?pageId=${id}`);
    expect(response.status()).toBe(status);
    expect(response.headers()["cache-control"]).toContain("no-store");
    return response.json();
  };
  const term = await read(sample.term.pageId);
  expect(term.type).toBe("term");
  expect(term.href).toBe(sample.term.href);
  expect([...term.excerpt].length).toBeLessThanOrEqual(151);
  expect(term.perspectives).toHaveLength(2);
  expect(term.perspectiveCount).toBe(3);
  const perspective = await read(sample.perspectives[0].pageId);
  expect(perspective.interpreterName).toBe(sample.names[0]);
  expect(perspective.excerpt).toContain("原有正文");
  expect(perspective.excerpt).not.toMatch(/\*\*|https:\/\//);
  expect([...perspective.excerpt].length).toBeLessThanOrEqual(151);
  await read("bad", 400);
  await read(0, 400);
  await read(2147483647, 404);
  await read(sample.interpreters[0].pageId, 404);
  const email = `preview-${randomUUID()}@example.com`;
  try {
    expect((await fixtureRegister(page.request, { data: { name: "预览编者", email, password: "preview-password-123" } })).ok()).toBe(true);
    const history = await (await request.get(`/api/pages/${sample.perspectives[0].pageId}/history`)).json();
    await submit(page.request, { kind: "edit", pageId: sample.perspectives[0].pageId, baseRevisionId: history.revisions[0].id, content: "绝不可公开的待审核内容" });
    expect(JSON.stringify(await read(sample.perspectives[0].pageId))).not.toContain("绝不可公开");
    for (const hidden of [sample.perspectives[0], sample.term, sample.interpreters[0]]) {
      try {
        expect((await request.post(`/api/admin/pages/${hidden.pageId}`, { data: { action: "delete" } })).ok()).toBe(true);
        expect(JSON.stringify(await read(sample.perspectives[0].pageId, 404))).not.toContain("原有正文");
        if (hidden !== sample.term) expect((await read(sample.term.pageId)).perspectiveCount).toBe(2);
        await page.goto(sample.source.href);
        // A deleted interpreter also hides this fixture's source perspective.
        if (hidden !== sample.interpreters[0]) {
          const unavailable = page.locator(".wiki-content").getByText("具名视角", { exact: true });
          await expect(unavailable).toHaveAttribute("title", "页面暂不可用");
          await unavailable.hover();
          await page.waitForTimeout(750);
          await expect(card(page)).toBeHidden();
        }
      } finally { expect((await request.post(`/api/admin/pages/${hidden.pageId}`, { data: { action: "restore" } })).ok()).toBe(true); }
    }
  } finally {
    const [account] = await getDb().select({ id: user.id }).from(user).where(eq(user.email, email));
    if (account) {
      await getDb().delete(submissions).where(eq(submissions.submittedBy, account.id));
      await getDb().delete(user).where(eq(user.id, account.id));
    }
  }
});

test("加载失败及空正文不阻断跳转，迟到响应不重开旧卡片", async ({ page, sample }) => {
  await page.goto(sample.source.href);
  await page.route("**/api/wiki-preview?*", route => route.fulfill({ status: 500, json: { error: "unavailable" } }));
  await bodyLink(page).hover();
  await expect(card(page)).toContainText("预览暂不可用");
  await bodyLink(page).click();
  await expect(page).toHaveURL(new RegExp(`${sample.term.pageId}$`));
  await page.unrouteAll({ behavior: "wait" });
  await page.goto(sample.source.href);
  await page.route("**/api/wiki-preview?*", route => route.fulfill({ json: { type: "perspective", title: "空正文视角", href: sample.perspectives[0].href, excerpt: "", interpreterName: sample.names[0], perspectives: [], perspectiveCount: 0 } }));
  await bodyLink(page, "具名视角").hover();
  await expect(card(page)).toContainText("暂无正文");
  await page.mouse.move(0, 0);
  await expect(card(page)).toBeHidden();
  await page.unrouteAll({ behavior: "wait" });
  let release!: () => void;
  const delayed = new Promise<void>(resolve => { release = resolve; });
  await page.route(`**/api/wiki-preview?pageId=${sample.term.pageId}`, async route => {
    await delayed;
    await route.fulfill({ json: { type: "term", title: "迟到的旧目标", href: sample.term.href, excerpt: "旧目标内容", perspectives: [], perspectiveCount: 0 } });
  });
  try {
    const started = page.waitForRequest(`**/api/wiki-preview?pageId=${sample.term.pageId}`);
    await bodyLink(page).hover();
    await started;
    await bodyLink(page, "空词条").hover();
    await expect(card(page)).toContainText("暂无简介");
    release();
    await page.waitForTimeout(300);
    await expect(card(page)).not.toContainText("旧目标");
    await page.mouse.move(0, 0);
    await expect(card(page)).toBeHidden();
  } finally { release(); await page.unrouteAll({ behavior: "wait" }); }
});

for (const [style, label] of [["highlight", "马克笔划线"], ["underline", "直线划线"], ["squiggle", "波浪线划线"]] as const) {
  test(`真实双链上的${label}刷新后保留，悬停不改变选区，点击优先导航 @cross-browser`, async ({ page, sample }) => {
    await login(page.request);
    await page.goto(sample.source.href);
    const before = await page.locator(".wiki-content").innerText();
    await bodyLink(page).evaluate(el => {
      const range = document.createRange(); range.selectNodeContents(el);
      const selection = window.getSelection()!; selection.removeAllRanges(); selection.addRange(range);
    });
    await page.getByRole("toolbar", { name: "划线工具条" }).getByRole("button", { name: new RegExp(label) }).click();
    await expect(bodyLink(page).locator(`.pw-mark--${style}`)).toHaveText("普通双链");
    await page.reload();
    await expect(bodyLink(page).locator(`.pw-mark--${style}`)).toHaveText("普通双链");
    await bodyLink(page).evaluate(el => {
      const range = document.createRange(); range.selectNodeContents(el);
      const selection = window.getSelection()!; selection.removeAllRanges(); selection.addRange(range);
    });
    await bodyLink(page).hover();
    await expect(card(page)).toContainText("词条简介");
    expect(await page.evaluate(() => window.getSelection()?.toString())).toBe("普通双链");
    expect(await page.locator(".wiki-content").innerText()).toBe(before);
    await page.keyboard.press("Escape");
    await page.evaluate(() => window.getSelection()?.removeAllRanges());
    await bodyLink(page).click();
    await expect(page).toHaveURL(new RegExp(`${sample.term.pageId}$`));
  });
}

test("触屏一次点按直接跳转", async ({ browser, baseURL, sample }) => {
  const context = await browser.newContext({ baseURL, hasTouch: true, viewport: { width: 390, height: 844 } });
  try {
    const page = await context.newPage();
    await page.goto(sample.source.href);
    await bodyLink(page).tap();
    await expect(page).toHaveURL(new RegExp(`${sample.term.pageId}$`));
    await expect(card(page)).toBeHidden();
  } finally { await context.close(); }
});

test("编辑实时预览读取目标公开内容", async ({ page, sample }) => {
  await login(page.request);
  await page.goto(`/edit/${sample.source.pageId}`);
  const preview = page.getByRole("region", { name: "实时预览" });
  await preview.getByRole("link", { name: "普通双链", exact: true }).hover();
  await expect(card(page)).toContainText("词条简介");
  await compactCard(page);
});


test("审核提案预览的双链展示当前公开简介", async ({ page, request, sample }) => {
  const email = `preview-review-${randomUUID()}@example.com`;
  try {
    expect((await fixtureRegister(page.request, { data: { name: "提案预览编者", email, password: "preview-password-123" } })).ok()).toBe(true);
    const history = await (await request.get(`/api/pages/${sample.source.pageId}/history`)).json();
    const proposal = await submit(page.request, { kind: "edit", pageId: sample.source.pageId, baseRevisionId: history.revisions[0].id, content: `${sample.content}\n\n提案附加内容` });
    await page.context().addCookies((await request.storageState()).cookies);
    await page.goto("/review");
    const item = page.locator(`[data-submission-id="${proposal.submissionId}"]`);
    await item.locator("summary").click();
    const preview = item.getByRole("region", { name: "提案预览" });
    await preview.getByRole("link", { name: "普通双链", exact: true }).hover();
    await expect(card(page)).toContainText("词条简介");
    await compactCard(page);
  } finally {
    const [account] = await getDb().select({ id: user.id }).from(user).where(eq(user.email, email));
    if (account) {
      await getDb().delete(submissions).where(eq(submissions.submittedBy, account.id));
      await getDb().delete(user).where(eq(user.id, account.id));
    }
  }
});
