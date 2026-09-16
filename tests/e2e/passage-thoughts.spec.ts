import "dotenv/config";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { expect, test, type APIRequestContext, type Page } from "./fixtures";
import { fixtureRegister } from "./auth-fixture";
import { cleanupTestContent } from "./content-cleanup";
import { getDb } from "../../src/db";
import { replies, user } from "../../src/db/schema";

const content = "第一句包含部分引用。第二句继续讨论。\n\n第三句跨越段落。";

test("个人记录回到原句，游客互动登录后回到感想，管理员可处置公开内容", async ({ page, browser }) => {
  test.skip(!process.env.SEED_ADMIN_PASSWORD, "需要种子管理员密码");
  test.setTimeout(90_000);
  const source = await setup(page);
  const readerContext = await browser.newContext();
  const guestContext = await browser.newContext();
  const email = `thought-review-${randomUUID()}@example.com`;
  try {
    expect((await fixtureRegister(readerContext.request, { data: { name: "感想回归读者", email, password: "thought-reader-password" } })).ok()).toBe(true);
    const response = await readerContext.request.post("/api/thoughts", { data: {
      pageId: source.pageId, anchor: { start: 0, end: 10, quote: "第一句包含部分引用。", baseRevisionId: String(source.revision) },
      content: "用于定位的公开感想", visibility: "public", style: "highlight",
    } });
    expect(response.status()).toBe(201);
    const thought = (await response.json()).thoughts[0];
    const reader = await readerContext.newPage();
    await reader.goto("/profile?records=thought");
    const record = reader.locator(`[data-record-kind="thought"][data-record-id="${thought.id}"]`);
    await record.getByRole("link", { name: "回到原句" }).click();
    await expect(reader.locator(`#thought-${thought.id}`)).toBeFocused();
    await expect(reader.locator(`#thought-${thought.id}`)).toBeInViewport();
    await expect(reader.getByRole("dialog", { name: "句子想法" })).toContainText("用于定位的公开感想");

    const guest = await guestContext.newPage();
    for (const action of ["赞同想法", "回复想法"]) {
      await guest.goto(source.href);
      await sentenceMarker(guest, 0).first().click();
      await guest.getByRole("button", { name: action, exact: true }).click();
      await expect(guest).toHaveURL(/\/login\?/);
      expect(new URL(guest.url()).searchParams.get("redirect")).toBe(`${encodeURI(source.href)}#thought-${thought.id}`);
    }
    await guest.getByLabel("邮箱").fill(email);
    await guest.getByLabel("密码").fill("thought-reader-password");
    await guest.getByRole("button", { name: "登录", exact: true }).click();
    await expect(guest.locator(`#thought-${thought.id}`)).toBeFocused();

    expect((await readerContext.request.post(`/api/thoughts/${thought.id}/replies`, { data: { content: "用于版务的回复" } })).status()).toBe(201);
    await page.goto(`${source.href}#thought-${thought.id}`);
    const panel = page.getByRole("dialog", { name: "句子想法" });
    await expect(panel.locator("blockquote")).toHaveText("引用：第一句包含部分引用。");
    await expect(panel.getByRole("button", { name: "设为仅自己可见" })).toHaveCount(0);
    await expect(panel.getByRole("button", { name: "赞同想法", exact: true })).toBeVisible();
    await panel.getByRole("button", { name: "删除想法", exact: true }).click();
    await expect(panel).toContainText("该想法已被删除");
    await panel.getByRole("button", { name: "删除回复", exact: true }).click();
    await expect(panel).toContainText("该回复已删除");
  } finally {
    await readerContext.close();
    await guestContext.close();
    await cleanupTestContent(source.titles, page.request);
    const [account] = await getDb().select({ id: user.id }).from(user).where(eq(user.email, email));
    // Polymorphic replies have no FK to pages; remove only this fixture's retained reply.
    if (account) await getDb().delete(replies).where(eq(replies.authorId, account.id));
    await getDb().delete(user).where(eq(user.email, email));
  }
});

/** 句子虚线（一句可能被内层个人标记切成多段）：按句起点定位，一段即一句。 */
const sentenceMarker = (scope: Page, sentenceStart: number) =>
  scope.locator(`.pw-thought-marker[data-sentence-start="${sentenceStart}"]`);

/** 该句上是否有「我的想法」红虚线（同样是多段，取第一段即可）。 */
const ownSentenceMarker = (scope: Page, sentenceStart: number) =>
  sentenceMarker(scope, sentenceStart).filter({ hasNot: scope.locator(".pw-thought-marker") });

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

/**
 * 选中正文里的一段文字：在「规范化正文」上定位 —— 块级元素之间按 \n 连接，
 * 与 lib/passage-anchors 的 indexPassage 投影一致（innerText 在段落间是空行，对不上锚点）。
 */
async function selectText(page: Page, quote: string) {
  await page.locator(".wiki-content").waitFor({ state: "visible" });
  await expect.poll(() => page.evaluate(() => {
    const root = document.querySelector(".wiki-content");
    if (!root) return "";
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let text = "";
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (text && !text.endsWith("\n") && (node.parentElement?.matches("p, h1, h2, h3, li, blockquote, pre") ?? false)) {
        text += "\n";
      }
      text += node.nodeValue ?? "";
    }
    return text;
  })).toContain(quote);
  expect(await page.evaluate(quote => {
    const root = document.querySelector(".wiki-content");
    if (!root) return false;
    const block = "p, h1, h2, h3, h4, h5, h6, li, blockquote, pre";
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    // 规范化正文的片段清单：每个文本节点一段，块级起点前补 \n（与 indexPassage 同规则）
    const parts: { node: Text; start: number; end: number }[] = [];
    let text = "";
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const textNode = node as Text;
      if (text && !text.endsWith("\n") && (textNode.parentElement?.matches(block) ?? false)) text += "\n";
      parts.push({ node: textNode, start: text.length, end: text.length + textNode.data.length });
      text += textNode.data;
    }
    const start = text.indexOf(quote);
    if (start < 0) return false;
    const end = start + quote.length;
    const pointAt = (position: number, wantEnd: boolean) => {
      for (const part of parts) {
        if (wantEnd ? position > part.start && position <= part.end : position >= part.start && position < part.end) {
          return { node: part.node, offset: position - part.start };
        }
      }
      const last = parts[parts.length - 1];
      return last ? { node: last.node, offset: wantEnd ? last.node.data.length : 0 } : null;
    };
    const from = pointAt(start, false);
    const to = pointAt(end, true);
    if (!from || !to) return false;
    const range = document.createRange();
    range.setStart(from.node, from.offset);
    range.setEnd(to.node, to.offset);
    document.getSelection()?.removeAllRanges();
    document.getSelection()?.addRange(range);
    return true;
  }, quote)).toBe(true);
}

async function writeThought(page: Page, quote: string, text: string, visibility = "public") {
  await selectText(page, quote);
  // 选完等浮条挂载：选区评估按帧合并，浮条出现前点击会落空
  const write = page.getByRole("button", { name: "写想法", exact: true });
  await write.waitFor({ state: "visible" });
  await write.click();
  await page.locator("#thought-draft").fill(text);
  await page.locator("#thought-visibility").selectOption(visibility);
  await page.getByRole("button", { name: "发布想法", exact: true }).click();
  await expect(page.locator("#thought-draft")).toHaveCount(0);
}

test("句子聚合局部、跨句跨段引用，私密想法仅本人可见，公开想法支持赞同与平铺回复", async ({ page, browser }) => {
  test.skip(!process.env.SEED_ADMIN_PASSWORD, "需要种子管理员密码");
  test.setTimeout(90_000);
  page.setDefaultTimeout(10_000);
  const source = await setup(page);
  const readerContext = await browser.newContext();
  const email = `thought-${randomUUID()}@example.com`;
  try {
    await page.goto(source.href);
    await writeThought(page, "部分引用", "局部公开想法");
    // 规范化正文里段落边界是一个 \n（不是源 Markdown 的空行），跨段引用按此书写
    await writeThought(page, "第二句继续讨论。\n第三句跨越", "跨句跨段想法", "private");
    // 三段虚线：句一（局部公开想法）、句二与句三（跨句跨段想法），全部是自己的红虚线
    for (const start of [0, 10, 19]) {
      await expect(ownSentenceMarker(page, start).first()).toHaveAttribute("data-own", "true");
    }
    await sentenceMarker(page, 0).first().click();
    const panel = page.getByRole("dialog", { name: "句子想法" });
    await expect(panel).toContainText("局部公开想法");
    await expect(panel.getByRole("button", { name: /^赞同/ })).toHaveCount(0);
    await panel.getByRole("button", { name: "关闭想法面板" }).click();
    await page.reload();
    await expect(page.locator(".pw-mark--highlight")).not.toHaveCount(0);

    expect((await fixtureRegister(readerContext.request, { data: { name: "想法读者", email, password: "thought-reader-password" } })).ok()).toBe(true);
    const reader = await readerContext.newPage();
    await reader.goto(source.href);
    // 游客/他人只见公开感想：句二、句三的想法是私密的，读者只看到句一的灰虚线
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
    // 作者自删自己的回复即物理移除（占位语义只用于版务处置他人回复，见集成测试）
    await expect(readPanel).not.toContainText("第一条回复");

    // 作者把自己的私密感想在句二上转公开
    await sentenceMarker(page, 10).first().click();
    const ownPanel = page.getByRole("dialog", { name: "句子想法" });
    await expect(ownPanel).toContainText("跨句跨段想法");
    await ownPanel.getByRole("button", { name: "设为公开" }).click();
    await expect(ownPanel.getByRole("button", { name: "设为仅自己可见" })).toBeVisible();
    // 转公开后读者能看到句二、句三的灰虚线，并能读到内容
    await reader.reload();
    await expect(reader.locator(".pw-thought-marker")).toHaveCount(3);
    await sentenceMarker(reader, 19).first().click();
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
    await page.locator("#thought-draft").fill("不要丢掉这份草稿");
    await page.route("**/api/thoughts", route => route.abort(), { times: 1 });
    await page.getByRole("button", { name: "发布想法", exact: true }).click();
    // Next 的 route announcer 也带 role=alert，断言限定在想法表单内
    await expect(page.getByRole("dialog", { name: "写想法" }).getByRole("alert")).toContainText("重试");
    await expect(page.locator("#thought-draft")).toHaveValue("不要丢掉这份草稿");
    await submit(page.request, { kind: "edit", pageId: source.pageId, content: "完全替换后的正文。", baseRevisionId: source.revision });
    await page.getByRole("button", { name: "发布想法", exact: true }).click();
    await expect(page.getByRole("button", { name: "确认以原选文发布" })).toBeVisible();
    await expect(page.locator("#thought-draft")).toHaveValue("不要丢掉这份草稿");
    await page.getByRole("button", { name: "确认以原选文发布" }).click();
    await expect(page.locator("#thought-draft")).toHaveCount(0);
    await expect(page.getByRole("button", { name: /查看原文已变化的想法/ })).toBeVisible();
    await page.getByRole("button", { name: /查看原文已变化的想法/ }).click();
    const panel = page.getByRole("dialog", { name: "句子想法" });
    await expect(panel).toContainText("部分引用");
    await expect(panel).toContainText("原文已变化");
    await expect(panel.getByRole("link", { name: "查看原修订" })).toHaveAttribute("href", `/history/${source.pageId}?from=${source.revision}&to=${source.revision}`);
  } finally { await cleanupTestContent(source.titles, page.request); }
});
