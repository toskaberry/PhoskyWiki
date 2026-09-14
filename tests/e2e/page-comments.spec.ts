import "dotenv/config";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { expect, test, type Page } from "./fixtures";
import { getDb } from "../../src/db";
import { pageComments, pages, user } from "../../src/db/schema";
import { fixtureRegister } from "./auth-fixture";

async function openTerm(page: Page) {
  await page.goto("/");
  await page.getByRole("link", { name: "主体性", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: "主体性" })).toBeVisible();
}

async function termPageId() {
  const [term] = await getDb().select().from(pages).where(eq(pages.title, "主体性"));
  return term.id;
}

async function login(page: Page) {
  await page.goto("/login");
  await page.getByLabel("邮箱").fill(process.env.SEED_ADMIN_EMAIL ?? "admin@phoskywiki.local");
  await page.getByLabel("密码").fill(process.env.SEED_ADMIN_PASSWORD!);
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page.getByTestId("session-user")).toContainText("管理员");
}

test("游客在词条和视角底部只读评论，登录引导保留位置", async ({ page }) => {
  await openTerm(page);
  for (const title of ["词条总评论", "视角评论"]) {
    const comments = page.getByRole("region", { name: title });
    await expect(comments).toBeVisible();
    await expect(comments.getByRole("textbox")).toHaveCount(0);
    const href = await comments.getByRole("link", { name: "登录" }).getAttribute("href");
    const redirect = new URL(href!, "http://localhost").searchParams.get("redirect");
    expect(new URL(redirect!, page.url()).href).toBe(`${page.url().split("#")[0]}#comments`);
    expect((await page.request.post("/api/comments", { data: { pageId: 1, content: "guest" } })).status()).toBe(401);
    expect((await page.request.delete("/api/comments/1")).status()).toBe(401);
    if (title === "词条总评论") await page.getByRole("link", { name: "拉康论主体性" }).first().click();
  }
});

test("发表后即时可见、两区不混排、游客可读、作者可删除，移动端只读", async ({ page, browser }) => {
  test.skip(!process.env.SEED_ADMIN_PASSWORD, "需要种子管理员密码");
  await login(page);
  await openTerm(page);
  const termUrl = page.url();
  const termComment = `词条评论 ${Date.now()} **纯文本**`;
  const perspectiveComment = `视角评论 ${Date.now()} <b>纯文本</b>`;
  const region = page.locator("#comments");
  await region.getByLabel("评论内容").fill(termComment);
  await region.getByRole("button", { name: "发表评论", exact: true }).click();
  await expect(region.getByText(termComment, { exact: true })).toBeVisible();
  await page.getByRole("link", { name: "拉康论主体性" }).first().click();
  await expect(page).toHaveURL(/\/perspective\//);
  await expect(page.getByRole("heading", { level: 1, name: "拉康论主体性" })).toBeVisible();
  const perspectiveUrl = page.url();
  await expect(region.getByText(termComment)).toHaveCount(0);
  await region.getByLabel("评论内容").fill(perspectiveComment);
  await region.getByRole("button", { name: "发表评论", exact: true }).click();
  await expect(region.getByText(perspectiveComment, { exact: true })).toBeVisible();
  await expect(region.locator("b")).toHaveCount(0);

  const guestContext = await browser.newContext();
  const guest = await guestContext.newPage();
  try {
    for (const [url, content] of [[termUrl, termComment], [perspectiveUrl, perspectiveComment]]) {
      await guest.goto(url);
      await expect(guest.locator("#comments").getByText(content, { exact: true })).toBeVisible();
      await expect(guest.locator("#comments").getByRole("button")).toHaveCount(0);
      await page.goto(url);
      await page.setViewportSize({ width: 390, height: 844 });
      await expect(region.getByText(content, { exact: true })).toBeVisible();
      await expect(region.getByLabel("评论内容")).toBeHidden();
      await expect(region.getByRole("button", { name: "删除评论", exact: true })).toBeHidden();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      await page.setViewportSize({ width: 1280, height: 900 });
      const item = region.getByRole("listitem").filter({ hasText: content });
      await item.getByRole("button", { name: "删除评论", exact: true }).click();
      await expect(region.getByText(content, { exact: true })).toHaveCount(0);
    }
  } finally { await guestContext.close(); }
});

test("评论发布网络失败时保留输入并允许重试", async ({ page }) => {
  test.skip(!process.env.SEED_ADMIN_PASSWORD, "需要种子管理员密码");
  await login(page);
  await openTerm(page);
  const region = page.locator("#comments");
  const content = `重试评论 ${Date.now()}`;
  await region.getByLabel("评论内容").fill(content);
  await page.route("**/api/comments", route => route.abort("failed"));
  await region.getByRole("button", { name: "发表评论", exact: true }).click();
  await expect(region.getByRole("alert")).toBeVisible();
  await expect(region.getByLabel("评论内容")).toHaveValue(content);
  await page.unroute("**/api/comments");
  await region.getByRole("button", { name: "发表评论", exact: true }).click();
  const item = region.getByRole("listitem").filter({ hasText: content });
  await expect(item).toBeVisible();
  await item.getByRole("button", { name: "删除评论", exact: true }).click();
  await expect(item).toHaveCount(0);
});

test("新评论经真实搜索服务命中并跳回原评论，删除后不可搜", async ({ page }) => {
  test.skip(!process.env.SEED_ADMIN_PASSWORD || !process.env.E2E_MEILI_HOST, "需要种子登录及隔离 Meilisearch");
  await login(page);
  await openTerm(page);
  const query = `pagecomment${Date.now()}`;
  const region = page.locator("#comments");
  await region.getByLabel("评论内容").fill(query);
  await region.getByRole("button", { name: "发表评论", exact: true }).click();
  await expect(region.getByText(query, { exact: true })).toBeVisible();
  const anchor = await region.getByRole("listitem").filter({ hasText: query }).getAttribute("id");
  await page.goto(`/search?q=${query}&type=comment`);
  await page.getByRole("link", { name: "「主体性」的评论" }).click();
  await expect(page).toHaveURL(new RegExp(`#${anchor}$`));
  await region.getByRole("listitem").filter({ hasText: query }).getByRole("button", { name: "删除评论", exact: true }).click();
  await expect(region.getByText(query, { exact: true })).toHaveCount(0);
  const result = await page.request.get(`/api/search?q=${query}`);
  expect((await result.json()).hits).toEqual([]);
});

test("游客点击赞同被引导登录并带回跳，未登录赞同 API 返回 401", async ({ page }) => {
  const pageId = await termPageId();
  const [author] = await getDb().select().from(user).limit(1);
  const [seeded] = await getDb().insert(pageComments)
    .values({ pageId, authorId: author.id, content: `游客赞同引导 ${Date.now()}` }).returning();
  try {
    await openTerm(page);
    const comments = page.getByRole("region", { name: "词条总评论" });
    const seededItem = comments.locator(`#comment-${seeded.id}`);
    const agreeLink = seededItem.getByRole("link", { name: "赞同", exact: true });
    await expect(agreeLink).toBeVisible();
    await expect(seededItem.getByText("0 赞同", { exact: true })).toBeVisible();
    const href = await agreeLink.getAttribute("href");
    const redirect = new URL(href!, "http://localhost").searchParams.get("redirect");
    expect(new URL(redirect!, page.url()).href).toBe(`${page.url().split("#")[0]}#comments`);
    await agreeLink.click();
    await expect(page.getByRole("heading", { level: 1, name: "登录" })).toBeVisible();
    expect((await page.request.post(`/api/comments/${seeded.id}/agree`)).status()).toBe(401);
    expect((await page.request.delete(`/api/comments/${seeded.id}/agree`)).status()).toBe(401);
  } finally { await getDb().delete(pageComments).where(eq(pageComments.id, seeded.id)); }
});

test("他人评论可赞同/取消且计数即时增减，自己的评论无赞同入口，重复赞同请求幂等", async ({ page, browser }) => {
  test.skip(!process.env.SEED_ADMIN_PASSWORD, "需要种子管理员密码");
  const commenterContext = await browser.newContext();
  const email = `agree-${randomUUID()}@example.com`;
  expect((await fixtureRegister(commenterContext.request, {
    data: { name: "赞同流程编者", email, password: "agree-test-password" },
  })).ok()).toBe(true);
  const pageId = await termPageId();
  const otherContent = `待赞同评论 ${Date.now()}`;
  const created = await commenterContext.request.post("/api/comments", { data: { pageId, content: otherContent } });
  expect(created.status()).toBe(201);
  const { id: otherId } = await created.json();
  try {
    await login(page);
    await openTerm(page);
    const region = page.locator("#comments");
    // 自己的评论：只有计数，没有赞同按钮
    const ownContent = `我的评论 ${Date.now()}`;
    await region.getByLabel("评论内容").fill(ownContent);
    await region.getByRole("button", { name: "发表评论", exact: true }).click();
    const ownItem = region.getByRole("listitem").filter({ hasText: ownContent });
    await expect(ownItem.getByText("0 赞同", { exact: true })).toBeVisible();
    await expect(ownItem.getByRole("button", { name: /赞同/ })).toHaveCount(0);
    // 他人评论：赞同后计数即时 +1，按钮进入已赞同态
    const otherItem = region.getByRole("listitem").filter({ hasText: otherContent });
    await otherItem.getByRole("button", { name: "赞同", exact: true }).click();
    await expect(otherItem.getByRole("button", { name: "已赞同", exact: true })).toBeVisible();
    await expect(otherItem.getByText("1 赞同", { exact: true })).toBeVisible();
    // 重复赞同请求幂等：计数仍为 1
    expect((await (await page.request.post(`/api/comments/${otherId}/agree`)).json()).count).toBe(1);
    await expect(otherItem.getByText("1 赞同", { exact: true })).toBeVisible();
    // 取消赞同计数即时 -1，移动端只读无入口
    await otherItem.getByRole("button", { name: "已赞同", exact: true }).click();
    await expect(otherItem.getByRole("button", { name: "赞同", exact: true })).toBeVisible();
    await expect(otherItem.getByText("0 赞同", { exact: true })).toBeVisible();
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(otherItem.getByText("0 赞同", { exact: true })).toBeVisible();
    await expect(region.getByRole("button", { name: /赞同/ })).toHaveCount(0);
    await page.setViewportSize({ width: 1280, height: 900 });
    // 清理：删除两条评论（评论删除连带清理赞同）
    await expect((await commenterContext.request.delete(`/api/comments/${otherId}`)).ok()).toBe(true);
    await ownItem.getByRole("button", { name: "删除评论", exact: true }).click();
    await expect(region.getByText(ownContent, { exact: true })).toHaveCount(0);
  } finally { await commenterContext.close(); }
});

test("评论区按赞同数降序、同票按发表时间新→旧排列", async ({ page, browser }) => {
  test.skip(!process.env.SEED_ADMIN_PASSWORD, "需要种子管理员密码");
  const commenterContext = await browser.newContext();
  const email = `sort-${randomUUID()}@example.com`;
  expect((await fixtureRegister(commenterContext.request, {
    data: { name: "排序编者", email, password: "agree-test-password" },
  })).ok()).toBe(true);
  const pageId = await termPageId();
  const marker = Date.now();
  const contents = { oldZero: `零票旧 ${marker}`, newZero: `零票新 ${marker}`, oneAgree: `一票新 ${marker}` };
  const created = new Map<string, number>();
  for (const [key, content] of Object.entries(contents)) {
    const response = await commenterContext.request.post("/api/comments", { data: { pageId, content } });
    expect(response.status()).toBe(201);
    created.set(key, (await response.json()).id);
  }
  const ids = Object.fromEntries(created);
  try {
    await login(page);
    await openTerm(page);
    const region = page.locator("#comments");
    // 最新的一条获得赞同，另两条零票：排序 = 一票新 → 零票新 → 零票旧
    const agreed = await page.request.post(`/api/comments/${ids.oneAgree}/agree`);
    expect(await agreed.json()).toMatchObject({ agreed: true, count: 1 });
    await page.reload();
    const order = await region.getByRole("listitem").allTextContents();
    const position = (content: string) => order.findIndex(text => text.includes(content));
    expect(position(contents.oneAgree)).toBeLessThan(position(contents.newZero));
    expect(position(contents.newZero)).toBeLessThan(position(contents.oldZero));
    await expect(region.getByRole("listitem").filter({ hasText: contents.oneAgree })
      .getByRole("button", { name: "已赞同", exact: true })).toBeVisible();
    await expect(region.getByRole("listitem").filter({ hasText: contents.oneAgree })
      .getByText("1 赞同", { exact: true })).toBeVisible();
  } finally {
    for (const id of created.values()) await commenterContext.request.delete(`/api/comments/${id}`);
    await commenterContext.close();
  }
});
