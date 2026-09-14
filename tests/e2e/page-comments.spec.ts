import "dotenv/config";
import { expect, test, type Page } from "./fixtures";

async function openTerm(page: Page) {
  await page.goto("/");
  await page.getByRole("link", { name: "主体性", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: "主体性" })).toBeVisible();
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
