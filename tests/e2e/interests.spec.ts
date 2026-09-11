import { invitationFixture } from "../auth-fixture";
// T12 兴趣标签全流程：游客 localStorage 路径（不注册也有体验）+
// 登录账号同步路径（换设备不丢）→ 词条页视角列表按兴趣重排。
// 每个用例独立浏览器上下文，localStorage 互不串扰。

import { randomUUID } from "node:crypto";

import { expect, test, type Page } from "./fixtures";

// 词条页的视角列表区
const SECTION = '[aria-labelledby="perspectives-heading"]';

async function perspectiveTitles(page: Page): Promise<string[]> {
  return page.locator(`${SECTION} li > div > a.font-medium`).allTextContents();
}

async function gotoSubjectivity(page: Page) {
  await page.goto("/");
  await page.getByRole("link", { name: "主体性", exact: true }).click();
  // 等词条页真正渲染（click 不等导航完成）
  await expect(page.getByRole("heading", { level: 1, name: "主体性" })).toBeVisible();
  // 视角列表默认折叠 5 条：先展开，取完整序（8 条视角都在断言范围内）
  const expand = page.getByRole("button", { name: /展开全部/ });
  if ((await expand.count()) > 0) {
    await expand.click();
  }
}

test("游客单选学派使成员视角与相关词条即时参与发现，刷新保留", async ({ page }) => {
  await page.goto("/interests");
  await page.getByRole("group", { name: /^学派/ }).getByLabel("精神分析", { exact: true }).check();
  await gotoSubjectivity(page);
  await expect.poll(async () => (await perspectiveTitles(page)).slice(0, 2))
    .toEqual(["拉康论主体性", "弗洛伊德论主体性"]);
  await expect(page.getByTestId("interest-reorder-hint")).toBeVisible();
  await page.reload();
  await expect.poll(async () => (await perspectiveTitles(page)).slice(0, 2))
    .toEqual(["拉康论主体性", "弗洛伊德论主体性"]);
});

test("游客主题、三类组合、跨标签页修改保持同步，与账号结果一致且访客之间隔离", async ({ page, context, browser }) => {
  await gotoSubjectivity(page);
  const defaultTitles = await perspectiveTitles(page);
  const settings = await context.newPage();
  await settings.goto("/interests");
  const topic = settings.getByRole("group", { name: /^主题/ }).getByLabel("政治经济学", { exact: true });
  await topic.check();
  await expect(page.getByTestId("related-terms").locator("li").first()).toContainText("剩余价值");
  expect(await perspectiveTitles(page)).toEqual(defaultTitles);
  await settings.getByLabel("德勒兹", { exact: true }).check();
  await settings.getByRole("group", { name: /^学派/ }).getByLabel("精神分析", { exact: true }).check();
  await expect.poll(async () => (await perspectiveTitles(page)).slice(0, 3)).toEqual([
    "拉康论主体性", "德勒兹论主体性", "弗洛伊德论主体性",
  ]);
  const guestTitles = await perspectiveTitles(page);
  const guestRelated = await page.getByTestId("related-terms").locator("li").allTextContents();
  const separateVisitor = await browser.newContext();
  const separatePage = await separateVisitor.newPage();
  await separatePage.goto(page.url());
  await separatePage.getByRole("button", { name: /展开全部/ }).click();
  expect(await perspectiveTitles(separatePage)).toEqual(defaultTitles);
  await expect(separatePage.getByTestId("related-terms").locator("li").first()).toContainText("异化");
  await separateVisitor.close();
  await page.goto(`/register#${await invitationFixture()}`);
  await page.getByLabel("名称").fill("游客兴趣等价编者");
  await page.getByLabel("邮箱").fill(`r09-equivalent-${randomUUID()}@example.com`);
  await page.getByLabel("密码（至少 8 位）").fill("password123");
  await page.getByRole("button", { name: "注册并登录" }).click();
  await expect(page.getByTestId("session-user")).toBeVisible({ timeout: 15_000 });
  await page.goto("/interests");
  await expect(page.getByTestId("interest-import-hint")).toBeVisible();
  await page.getByRole("button", { name: "保存到账号" }).click();
  await expect(page.getByTestId("interest-saved")).toBeVisible();
  await gotoSubjectivity(page);
  expect(await perspectiveTitles(page)).toEqual(guestTitles);
  expect(await page.getByTestId("related-terms").locator("li").allTextContents()).toEqual(guestRelated);
});

test("游客同页通知、清空、坏数据、失效 id 与请求失败均回退默认结果并保留选择", async ({ page, context }) => {
  await gotoSubjectivity(page);
  const defaultTitles = await perspectiveTitles(page);
  const defaultRelated = await page.getByTestId("related-terms").locator("li").allTextContents();
  const settings = await context.newPage();
  await settings.goto("/interests");
  const school = settings.getByRole("group", { name: /^学派/ }).getByLabel("精神分析", { exact: true });
  await school.check();
  await expect.poll(async () => (await perspectiveTitles(page))[0]).toBe("拉康论主体性");
  const schoolSelection = await settings.evaluate(() => localStorage.getItem("phoskywiki:interest-tags"));
  await school.uncheck();
  await expect.poll(() => perspectiveTitles(page)).toEqual(defaultTitles);
  // storage 原生事件不会发送给写入页；应用的同页变更通知也必须能更新发现区块。
  await page.evaluate((stored) => {
    localStorage.setItem("phoskywiki:interest-tags", stored!);
    window.dispatchEvent(new Event("phoskywiki:interests-changed"));
  }, schoolSelection);
  await expect.poll(async () => (await perspectiveTitles(page))[0]).toBe("拉康论主体性");
  await page.evaluate(() => {
    localStorage.setItem("phoskywiki:interest-tags", "broken-json");
    window.dispatchEvent(new Event("phoskywiki:interests-changed"));
  });
  await expect.poll(() => perspectiveTitles(page)).toEqual(defaultTitles);
  await page.reload();
  await expect(page.getByRole("heading", { name: "主体性", level: 1 })).toBeVisible();
  await page.getByRole("button", { name: /展开全部/ }).click();
  const invalid = { v: 1, interpreters: [999999], schools: [999999], categories: [999999] };
  const invalidResponse = page.waitForResponse((response) => response.url().includes("/discovery?"));
  await page.evaluate((value) => {
    localStorage.setItem("phoskywiki:interest-tags", JSON.stringify(value));
    window.dispatchEvent(new Event("phoskywiki:interests-changed"));
  }, invalid);
  expect((await invalidResponse).status()).toBe(200);
  await expect.poll(() => perspectiveTitles(page)).toEqual(defaultTitles);
  expect(await page.getByTestId("related-terms").locator("li").allTextContents()).toEqual(defaultRelated);
  await page.route("**/discovery?**", (route) => route.abort());
  const failedRequest = page.waitForEvent("requestfailed", (request) => request.url().includes("/discovery?"));
  await school.check();
  await failedRequest;
  const chosen = await settings.evaluate(() => localStorage.getItem("phoskywiki:interest-tags"));
  await expect.poll(() => perspectiveTitles(page)).toEqual(defaultTitles);
  expect(await page.evaluate(() => localStorage.getItem("phoskywiki:interest-tags"))).toBe(chosen);
  await expect(school).toBeChecked();
  await page.unroute("**/discovery?**");
  await page.reload();
  await expect.poll(async () => (await perspectiveTitles(page))[0]).toBe("拉康论主体性");
});

test("浏览器拒绝 localStorage 时仍可阅读并保留本页选择", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, "localStorage", { get() { throw new DOMException("denied", "SecurityError"); } });
  });
  await gotoSubjectivity(page);
  await expect(page.getByTestId("related-terms")).toBeVisible();
  await page.goto("/interests");
  await page.getByLabel("德勒兹", { exact: true }).check();
  await expect(page.getByLabel("德勒兹", { exact: true })).toBeChecked();
  await expect(page.getByRole("status")).toContainText("浏览器无法保存兴趣");
});

test("游客：选择兴趣即存本浏览器，词条页视角按兴趣重排", async ({ page }) => {
  await gotoSubjectivity(page);

  // 默认序（未设兴趣）：唯一被站内引用的 阿尔都塞论主体性 在首位，拉康不在首位
  await expect.poll(() => perspectiveTitles(page)).toContain("拉康论主体性");
  const before = await perspectiveTitles(page);
  expect(before[0]).not.toBe("拉康论主体性");

  // 相关词条区块：游客按共同引用强度（异化 10 > 意识形态 8 > 剩余价值 2 > 价值1）
  const related = page.getByTestId("related-terms");
  await expect(related).toBeVisible();
  await expect(related).toContainText("异化");
  await expect(related).toContainText("意识形态");
  await expect(related.locator("li").first()).toContainText("异化");
  // 游客无兴趣：不出现兴趣匹配徽标
  await expect(page.getByTestId("interest-match-badge")).toHaveCount(0);

  await page.goto("/interests");
  await page.getByLabel("拉康", { exact: true }).check();

  // localStorage 已写入（游客路径不落服务端）
  const stored = await page.evaluate(() =>
    window.localStorage.getItem("phoskywiki:interest-tags"),
  );
  expect(stored).not.toBeNull();
  expect(JSON.parse(stored!).interpreters).toHaveLength(1);

  await gotoSubjectivity(page);
  // 水合后重排：拉康论主体性 升到首位，其余保持默认序，并出现提示
  await expect
    .poll(() => perspectiveTitles(page))
    .toEqual(["拉康论主体性", ...before.filter((title) => title !== "拉康论主体性")]);
  await expect(page.getByTestId("interest-reorder-hint")).toBeVisible();
});

test("登录：兴趣保存到账号并跨页持久，词条页视角按兴趣重排", async ({ page }) => {
  // 注册前先以游客视角记录默认序（独立上下文，无本地兴趣）
  await gotoSubjectivity(page);
  await expect.poll(() => perspectiveTitles(page)).toContain("德勒兹论主体性");
  const before = await perspectiveTitles(page);

  const email = `t12-e2e-${randomUUID()}@example.com`;
  await page.goto(`/register#${await invitationFixture()}`);
  await page.getByLabel("名称").fill("兴趣同步编者");
  await page.getByLabel("邮箱").fill(email);
  await page.getByLabel("密码（至少 8 位）").fill("password123");
  await page.getByRole("button", { name: "注册并登录" }).click();
  await expect(page.getByTestId("session-user")).toContainText("编者");

  await page.goto("/interests");
  await page.getByLabel("德勒兹", { exact: true }).check();
  await page.getByRole("button", { name: "保存到账号" }).click();
  await expect(page.getByTestId("interest-saved")).toBeVisible();

  // 服务端持久：整页重开仍勾选
  await page.goto("/interests");
  await expect(page.getByLabel("德勒兹", { exact: true })).toBeChecked();

  // 个人主页展示当前兴趣
  await page.goto("/profile");
  await expect(page.getByTestId("profile-interest-chips")).toContainText("德勒兹");

  // 登录路径：SSR 即重排（无需等水合），德勒兹论主体性 升到首位
  await gotoSubjectivity(page);
  await expect
    .poll(() => perspectiveTitles(page))
    .toEqual(["德勒兹论主体性", ...before.filter((title) => title !== "德勒兹论主体性")]);
  await expect(page.getByTestId("interest-reorder-hint")).toBeVisible();
});
