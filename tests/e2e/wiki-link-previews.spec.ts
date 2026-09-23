// 双链 Wikipedia 式紧凑内容预览（#85）端到端验收：
// 延迟触发、卡片内容（词条简介/视角摘录/入口）、键盘与触屏交互、
// 尺寸与边缘避让、个人标记重叠下的点击优先、隐藏目标不泄露、
// 正文/编辑预览/审核提案预览三处边界表现一致、加载失败与快速切换。

import "dotenv/config";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { expect, test, type APIRequestContext, type Locator, type Page } from "./fixtures";
import { getDb } from "../../src/db";
import { pages, personalMarks, user, userMarkStyle } from "../../src/db/schema";
import { fixtureRegister } from "./auth-fixture";

async function submit(request: APIRequestContext, data: Record<string, unknown>) {
  const response = await request.post("/api/submissions", { data });
  expect(response.status()).toBe(201);
  return response.json() as Promise<{ pageId: number; href: string; submissionId: number }>;
}

async function login(request: APIRequestContext) {
  expect((await request.post("/api/auth/sign-in/email", { data: {
    email: process.env.SEED_ADMIN_EMAIL, password: process.env.SEED_ADMIN_PASSWORD,
  } })).ok()).toBe(true);
}

/** 「拉康论主体性」视角（种子里固定存在）：正文含 [[意识形态]]、[[异化]] 与红链。 */
async function lacanPerspective() {
  const [row] = await getDb().select().from(pages).where(eq(pages.title, "拉康论主体性"));
  return { id: row.id, href: `/perspective/${row.slug}-${row.id}` };
}

async function openLacan(page: Page) {
  const { href } = await lacanPerspective();
  await page.goto(href);
  await expect(page.getByRole("heading", { level: 1, name: "拉康论主体性" })).toBeVisible();
  return href;
}

/** 悬停直到卡片内容就绪（650ms 延迟 + 请求），返回卡片定位器。
 *  重载后 React 尚未水合时首批悬停事件会错过；重悬停前先移开指针，
 *  否则 hover() 因指针已在链接上而不再派发事件。 */
async function hoverUntilCard(page: Page, link: Locator) {
  const card = page.getByRole("dialog", { name: "双链预览" });
  for (let attempt = 0; ; attempt++) {
    if (attempt > 0) await page.mouse.move(4, 4);
    await link.hover();
    try {
      await expect(card).toBeVisible({ timeout: 3_000 });
      break;
    } catch (error) {
      if (attempt >= 2) throw error;
    }
  }
  await expect(card.getByText("正在加载预览…")).toHaveCount(0);
  return card;
}

/** 在 .wiki-content 里选中一段字（与 personal-marks.spec 同法）。 */
async function selectText(page: Page, needle: string) {
  const found = await page.evaluate(needle => {
    const root = document.querySelector(".wiki-content");
    if (!root) return false;
    const texts: Text[] = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) texts.push(node as Text);
    const start = texts.map(text => text.nodeValue ?? "").join("").indexOf(needle);
    if (start < 0) return false;
    const end = start + needle.length;
    let anchor: { node: Node; offset: number } | null = null;
    let focus: { node: Node; offset: number } | null = null;
    let cursor = 0;
    for (const text of texts) {
      const length = text.nodeValue?.length ?? 0;
      const nodeStart = cursor;
      const nodeEnd = cursor + length;
      if (!anchor && start >= nodeStart && start <= nodeEnd) anchor = { node: text, offset: start - nodeStart };
      if (!focus && end >= nodeStart && end <= nodeEnd) focus = { node: text, offset: end - nodeStart };
      cursor = nodeEnd;
      if (anchor && focus) break;
    }
    if (!anchor || !focus) return false;
    window.getSelection()?.setBaseAndExtent(anchor.node, anchor.offset, focus.node, focus.offset);
    return true;
  }, needle);
  expect(found, `正文中找不到选段「${needle}」`).toBe(true);
}

async function adminId() {
  const [admin] = await getDb().select().from(user)
    .where(eq(user.email, process.env.SEED_ADMIN_EMAIL ?? "admin@phoskywiki.local"));
  return admin.id;
}

/** 测试自愈：种子管理员在本视角上的标记与样式偏好都清空。 */
async function cleanupMarks() {
  const { id: pageId } = await lacanPerspective();
  await getDb().delete(personalMarks).where(and(eq(personalMarks.pageId, pageId), eq(personalMarks.userId, await adminId())));
  await getDb().delete(userMarkStyle).where(eq(userMarkStyle.userId, await adminId()));
}

async function loginInBrowser(page: Page) {
  await page.goto("/login");
  await page.getByLabel("邮箱").fill(process.env.SEED_ADMIN_EMAIL ?? "admin@phoskywiki.local");
  await page.getByLabel("密码").fill(process.env.SEED_ADMIN_PASSWORD!);
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page.getByTestId("session-user")).toContainText("管理员");
}

/** 卡片紧贴链接、尺寸受约束且无内部滚动。 */
async function expectCompactCard(page: Page, card: Locator) {
  const box = await card.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.width).toBeLessThanOrEqual(336); // 320px + 容差
  expect(box!.width).toBeGreaterThanOrEqual(240);
  expect(box!.height).toBeLessThanOrEqual(292); // 280px + 容差
  expect(box!.x).toBeGreaterThanOrEqual(-1);
  expect(box!.y).toBeGreaterThanOrEqual(-1);
  expect(box!.x + box!.width).toBeLessThanOrEqual(page.viewportSize()!.width + 1);
  expect(box!.y + box!.height).toBeLessThanOrEqual(page.viewportSize()!.height + 1);
  expect(await card.evaluate(root => [root, ...root.querySelectorAll("*")].some(node => {
    const style = getComputedStyle(node);
    return /(auto|scroll)/.test(style.overflowY) && node.scrollHeight > node.clientHeight;
  }))).toBe(false);
}

test("普通词条双链：短暂划过不弹卡，停留后出简介与视角入口，查看全部可达", async ({ page }) => {
  await openLacan(page);
  const link = page.locator(".wiki-content").getByRole("link", { name: "意识形态", exact: true });
  const card = page.getByRole("dialog", { name: "双链预览" });

  // F01 回归（未悬停）：蓝色、默认无下划线、不加粗
  const styles = await link.evaluate(el => ({
    color: getComputedStyle(el).color,
    body: getComputedStyle(el.parentElement!).color,
    weight: getComputedStyle(el).fontWeight,
    parentWeight: getComputedStyle(el.parentElement!).fontWeight,
    decoration: getComputedStyle(el).textDecorationLine,
  }));
  expect(styles.color).not.toBe(styles.body);
  expect(styles.weight).toBe(styles.parentWeight);
  expect(styles.decoration).not.toContain("underline");

  // 短暂停留（<650ms）不弹卡；停留到延迟后弹卡
  await link.hover();
  await page.waitForTimeout(350);
  expect(await card.count()).toBe(0);
  await expect(card).toBeVisible({ timeout: 3_000 });

  // 悬停（鼠标仍在链接上）出现下划线；词条名 + 已有简介 + 视角入口 + 查看全部
  await expect(link).toHaveCSS("text-decoration-line", /underline/);
  await expect(card.getByText("正在加载预览…")).toHaveCount(0);
  await expect(card.getByText("意识形态", { exact: true })).toBeVisible();
  await expect(card).toContainText("意义系统还是虚假意识");
  const entries = card.locator('a[href^="/perspective/"]');
  expect(await entries.count()).toBeLessThanOrEqual(2);
  await expect(card.getByRole("link", { name: /查看全部/ })).toBeVisible();
  await expectCompactCard(page, card);

  // 查看全部 → 词条枢纽页
  await card.getByRole("link", { name: /查看全部/ }).click();
  await expect(page).toHaveURL(/\/term\//);
  await expect(page.getByRole("heading", { level: 1, name: "意识形态" })).toBeVisible();
});

test("卡片视角入口直达视角页，卡内链接不递归弹卡", async ({ page }) => {
  await openLacan(page);
  const link = page.locator(".wiki-content").getByRole("link", { name: "意识形态", exact: true });
  const card = await hoverUntilCard(page, link);
  const entry = card.locator('a[href^="/perspective/"]').first();
  await expect(entry).toBeVisible();
  // 卡内入口悬停不再叠出第二张卡片
  await entry.hover();
  await page.waitForTimeout(1_200);
  await expect(page.getByRole("dialog", { name: "双链预览" })).toHaveCount(1);
  await entry.click();
  await expect(page).toHaveURL(/\/perspective\//);
});

test("移入卡片保持打开，离开链接与卡片后关闭，快速切换目标不串内容", async ({ page }) => {
  await openLacan(page);
  const card = page.getByRole("dialog", { name: "双链预览" });
  const first = page.locator(".wiki-content").getByRole("link", { name: "意识形态", exact: true });
  const second = page.locator(".wiki-content").getByRole("link", { name: "异化", exact: true });

  await first.hover();
  await expect(card).toBeVisible({ timeout: 3_000 });
  await expect(card).toContainText("意义系统还是虚假意识");
  await card.hover();
  await page.waitForTimeout(700);
  await expect(card).toBeVisible();
  await expect(card).toContainText("意义系统还是虚假意识");

  // 移开链接与卡片后关闭
  await page.mouse.move(20, 60);
  await expect(card).toBeHidden({ timeout: 2_000 });

  // 快速切换：悬停另一目标，卡片最终只显示新目标内容
  await second.hover();
  await expect(card).toBeVisible({ timeout: 3_000 });
  await expect(card.getByText("异化", { exact: true })).toBeVisible();
  await expect(card).not.toContainText("意义系统还是虚假意识");
  await expectCompactCard(page, card);
});

test("键盘聚焦打开卡片：Esc 关闭并归还焦点，Tab 进入卡内入口可达", async ({ page }) => {
  test.setTimeout(60_000);
  await openLacan(page);
  const link = page.locator(".wiki-content").getByRole("link", { name: "意识形态", exact: true });
  const card = page.getByRole("dialog", { name: "双链预览" });

  // 真键盘导航到链接（连续 Tab）：聚焦即开卡、聚焦状态可见
  for (let i = 0; i < 40 && !(await link.evaluate(el => document.activeElement === el)); i++) {
    await page.keyboard.press("Tab");
  }
  await expect(link).toBeFocused();
  await expect(card).toBeVisible({ timeout: 3_000 });
  await expect(card.getByText("正在加载预览…")).toHaveCount(0);
  await expect(link).toHaveCSS("text-decoration-line", /underline/); // 聚焦可见

  // Tab 进入卡片入口，Esc 关闭并把焦点还给链接
  await page.keyboard.press("Tab");
  const entry = card.locator("a").filter({ hasNotText: "查看全部" }).first();
  await expect(entry).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(card).toBeHidden();
  await expect(link).toBeFocused();

  // 键盘重新聚焦（Tab 离开再 Shift+Tab 返回）再次开卡：Tab 进入入口并回车导航
  await page.keyboard.press("Tab");
  await page.keyboard.press("Shift+Tab");
  await expect(link).toBeFocused();
  await expect(card).toBeVisible({ timeout: 3_000 });
  await expect(card.getByText("正在加载预览…")).toHaveCount(0); // 卡内入口就位后才接管 Tab
  await page.keyboard.press("Tab");
  await expect(card.locator("a").filter({ hasNotText: "查看全部" }).first()).toBeFocused();
  const viewAll = card.getByRole("link", { name: /查看全部/ });
  await viewAll.focus();
  await viewAll.press("Enter");
  await expect(page).toHaveURL(/\/term\//);
});

test("显式视角双链：展示诠释者与正文开头摘录，约 150 字截断", async ({ page, request }) => {
  test.setTimeout(120_000);
  test.skip(!process.env.SEED_ADMIN_PASSWORD, "需要种子管理员密码");
  await login(request);
  const suffix = randomUUID();
  const termTitle = `预览词条 ${suffix}`;
  const interpTitle = `预览诠释者 ${suffix}`;
  const term = await submit(request, { kind: "new_term", title: termTitle, summary: "词条简介。" });
  const interp = await submit(request, { kind: "new_interpreter", title: interpTitle, summary: "诠释者简介。" });
  const body = "这一视角的开头段落会进入预览摘录，重复若干次以验证约一百五十字的服务端截断。".repeat(12);
  const target = await submit(request, { kind: "new_perspective", termId: term.pageId, interpreterId: interp.pageId, content: body });
  const srcTerm = await submit(request, { kind: "new_term", title: `预览来源 ${suffix}` });
  const source = await submit(request, {
    kind: "new_perspective", termId: srcTerm.pageId, interpreterId: interp.pageId,
    content: `显式指向[[${termTitle}|该视角@${interpTitle}]]以及普通指向[[${termTitle}]]。`,
  });

  await page.goto(source.href);
  const explicit = page.locator(".wiki-content").getByRole("link", { name: "该视角", exact: true });
  const card = await hoverUntilCard(page, explicit);
  await expect(card.getByText(`预览诠释者 ${suffix}论预览词条 ${suffix}`, { exact: true })).toBeVisible();
  await expect(card).toContainText(`诠释者：${interpTitle}`);
  const excerpt = card.locator("p").last();
  const text = await excerpt.textContent();
  expect(text!.length).toBeLessThanOrEqual(152);
  expect(text).toContain("…");
  expect(text).toContain("开头段落会进入预览摘录");
  await expectCompactCard(page, card);

  // 同一目标的普通词条链接：简介 + 该视角作为入口
  await page.mouse.move(20, 60);
  const normal = page.locator(".wiki-content").getByRole("link", { name: termTitle, exact: true });
  const termCard = await hoverUntilCard(page, normal);
  await expect(termCard).toContainText("词条简介。");
  await expect(termCard.getByRole("link", { name: `${interpTitle}论${termTitle}`, exact: true })).toHaveAttribute("href", target.href);
});

test("长简介截断、空简介、空正文与零视角词条的占位提示", async ({ page, request }) => {
  test.setTimeout(120_000);
  test.skip(!process.env.SEED_ADMIN_PASSWORD, "需要种子管理员密码");
  await login(request);
  const suffix = randomUUID();
  const interpTitle = `占位诠释者 ${suffix}`;
  const interp = await submit(request, { kind: "new_interpreter", title: interpTitle });
  const longSummary = "长简介段落。".repeat(60); // 300 字
  const longTerm = await submit(request, { kind: "new_term", title: `长简介词条 ${suffix}`, summary: longSummary });
  await submit(request, { kind: "new_term", title: `空简介词条 ${suffix}` });
  const srcTerm = await submit(request, { kind: "new_term", title: `占位来源 ${suffix}` });
  // 纯分隔线正文：可见文本为空 → 暂无正文；另两位诠释者补足 3 个视角，验证入口截断到 2
  await submit(request, {
    kind: "new_perspective", termId: longTerm.pageId, interpreterId: interp.pageId, content: "---",
  });
  const interp2 = await submit(request, { kind: "new_interpreter", title: `占位诠释者二 ${suffix}` });
  await submit(request, { kind: "new_perspective", termId: longTerm.pageId, interpreterId: interp2.pageId, content: "第二视角正文。" });
  const interp3 = await submit(request, { kind: "new_interpreter", title: `占位诠释者三 ${suffix}` });
  await submit(request, { kind: "new_perspective", termId: longTerm.pageId, interpreterId: interp3.pageId, content: "第三视角正文。" });
  const source = await submit(request, {
    kind: "new_perspective", termId: srcTerm.pageId, interpreterId: interp.pageId,
    content: `[[长简介词条 ${suffix}|长简介@${interpTitle}]]、[[空简介词条 ${suffix}]]、[[长简介词条 ${suffix}]]`,
  });

  await page.goto(source.href);
  const card = page.getByRole("dialog", { name: "双链预览" });

  // 显式视角 + 空正文 → 暂无正文
  const explicit = page.locator(".wiki-content").getByRole("link", { name: "长简介", exact: true });
  await explicit.hover();
  await expect(card).toBeVisible({ timeout: 3_000 });
  await expect(card).toContainText("暂无正文");
  await page.mouse.move(20, 60);
  await expect(card).toBeHidden({ timeout: 2_000 });

  // 长简介：服务端 150 字截断 + 卡片空间内收紧
  const normal = page.locator(".wiki-content").getByRole("link", { name: `空简介词条 ${suffix}`, exact: true });
  await normal.hover();
  await expect(card).toBeVisible({ timeout: 3_000 });
  await expect(card).toContainText("暂无简介");
  // 零视角：不制造视角入口，词条标题仍可导航
  await expect(card.locator('a[href^="/perspective/"]')).toHaveCount(0);
  await expect(card.getByRole("link", { name: `空简介词条 ${suffix}`, exact: true })).toHaveAttribute("href", /\/term\//);

  // 长简介词条的普通卡片：约 150 字服务端截断；3 个视角入口截断到 2 + 查看全部
  await page.mouse.move(20, 60);
  const longLink = page.locator(".wiki-content").getByRole("link", { name: `长简介词条 ${suffix}` }).first();
  await longLink.hover();
  await expect(card).toBeVisible({ timeout: 3_000 });
  const summaryText = await card.locator("p").first().textContent();
  expect(summaryText!.length).toBeLessThanOrEqual(152);
  await expect(card.locator('a[href^="/perspective/"]')).toHaveCount(2);
  await expectCompactCard(page, card);
});

test("红链与暂不可用目标不弹卡片", async ({ page }) => {
  await openLacan(page);
  const red = page.locator(".wiki-content .wiki-link--red").filter({ hasText: "镜像阶段" });
  await expect(red).toBeVisible();
  await red.hover();
  await page.waitForTimeout(1_200);
  await expect(page.getByRole("dialog", { name: "双链预览" })).toHaveCount(0);
});

test("预览加载中直接点击仍立即导航；加载失败提示且不阻断点击；触屏一次点击直接跳转", async ({ page, browser }) => {
  test.setTimeout(90_000);
  await openLacan(page);
  const link = page.locator(".wiki-content").getByRole("link", { name: "意识形态", exact: true });
  const card = page.getByRole("dialog", { name: "双链预览" });

  // 预览响应被拖慢：悬停出加载态后点击，不等预览
  await page.route("**/api/wiki-preview?*", async route => {
    await new Promise(resolve => setTimeout(resolve, 4_000));
    try { await route.continue(); } catch { /* 页面已随导航销毁 */ }
  });
  await link.hover();
  await expect(card).toBeVisible({ timeout: 3_000 });
  await expect(card).toContainText("正在加载预览…");
  await link.click();
  await expect(page).toHaveURL(/\/term\//);
  await page.unrouteAll({ behavior: "ignoreErrors" });
  await page.goto((await lacanPerspective()).href);

  // 加载失败：卡片提示，原始链接照常可点
  await page.route("**/api/wiki-preview?*", route => route.abort());
  await link.hover();
  await expect(card).toBeVisible({ timeout: 3_000 });
  await expect(card).toContainText("预览暂不可用");
  await link.click();
  await expect(page).toHaveURL(/\/term\//);
  await page.unrouteAll({ behavior: "ignoreErrors" });

  // 触屏：一次点击直接导航，无需先出卡片
  const touchContext = await browser.newContext({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } });
  try {
    const touch = await touchContext.newPage();
    await touch.goto((await lacanPerspective()).href);
    await touch.locator(".wiki-content").getByRole("link", { name: "意识形态", exact: true }).tap();
    await expect(touch).toHaveURL(/\/term\//, { timeout: 5_000 });
    await expect(touch.getByRole("heading", { level: 1, name: "意识形态" })).toBeVisible();
  } finally {
    await touchContext.close();
  }
});

test("预览打开前后复制内容一致（Chromium 剪贴板权限）", async ({ page }) => {
  test.skip(!process.env.SEED_ADMIN_PASSWORD, "需要种子管理员密码");
  try {
    await loginInBrowser(page);
    await openLacan(page);
    const toolbar = page.getByRole("toolbar", { name: "划线工具条" });
    await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
    await selectText(page, "主体不是先于语言的存在");
    await toolbar.getByRole("button", { name: "复制所选文字" }).click();
    const copiedBefore = await page.evaluate(() => navigator.clipboard.readText());
    const link = page.locator(".wiki-content").getByRole("link", { name: "意识形态", exact: true });
    await link.hover();
    const card = page.getByRole("dialog", { name: "双链预览" });
    await expect(card).toBeVisible({ timeout: 3_000 });
    await page.mouse.move(20, 60); // 移开指针收起卡片，回到划线流程
    await expect(card).toBeHidden({ timeout: 2_000 });
    await selectText(page, "主体不是先于语言的存在");
    await toolbar.getByRole("button", { name: "复制所选文字" }).click();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(copiedBefore);
  } finally {
    await cleanupMarks();
  }
});

test("个人标记与双链重叠：三种样式下点击仍优先跳转，标记保留", async ({ page }) => {
  test.setTimeout(120_000);
  test.skip(!process.env.SEED_ADMIN_PASSWORD, "需要种子管理员密码");
  try {
    await loginInBrowser(page);
    const href = await openLacan(page);
    const toolbar = page.getByRole("toolbar", { name: "划线工具条" });

    // 高光覆盖可跳转双链：标记 span 垫在链接文字内（跨元素会拆成多段），点击仍优先导航
    await selectText(page, "参照意识形态词条下");
    await toolbar.getByRole("button", { name: /马克笔划线/ }).click();
    await expect(page.locator(".pw-mark--highlight").filter({ hasText: "意识形态" })).toBeVisible();
    await page.locator(".wiki-content").getByRole("link", { name: "意识形态", exact: true }).click();
    await expect(page).toHaveURL(/\/term\//);
    await expect(page.getByRole("heading", { level: 1, name: "意识形态" })).toBeVisible();

    // 直线覆盖另一条双链：点击仍导航；刷新后标记保留
    await page.goto(href);
    await selectText(page, "对象颠倒的问题亦见异化");
    await toolbar.getByRole("button", { name: /直线划线/ }).click();
    await expect(page.locator(".pw-mark--underline").filter({ hasText: "异化" })).toBeVisible();
    await page.locator(".wiki-content").getByRole("link", { name: "异化", exact: true }).click();
    await expect(page).toHaveURL(/\/term\//);
    await page.goto(href);
    await page.reload();
    await expect(page.locator(".pw-mark--highlight").filter({ hasText: "意识形态" })).toBeVisible();
    await expect(page.locator(".pw-mark--underline").filter({ hasText: "异化" })).toBeVisible();

    // 波浪线下的双链同样可点
    await selectText(page, "参照意识形态词条下");
    await toolbar.getByRole("button", { name: /波浪线划线/ }).click();
    await expect(page.locator(".pw-mark--squiggle").filter({ hasText: "意识形态" })).toBeVisible();
    // 悬停时链接出下划线，波浪线保留自己的线型与颜色（#96 叠加分层可辨）
    const squiggled = page.locator(".wiki-content").getByRole("link", { name: "意识形态", exact: true });
    await squiggled.hover();
    await expect(squiggled).toHaveCSS("text-decoration-line", /underline/);
    const squiggle = page.locator(".pw-mark--squiggle").filter({ hasText: "意识形态" }).first();
    await expect(squiggle).toHaveCSS("text-decoration-style", "wavy");
    expect(await squiggle.evaluate(el => getComputedStyle(el).textDecorationColor)).not.toBe(await squiggled.evaluate(el => getComputedStyle(el).color));
    await page.locator(".wiki-content").getByRole("link", { name: "意识形态", exact: true }).click();
    await expect(page).toHaveURL(/\/term\//);
  } finally {
    await cleanupMarks();
  }
});

test("隐藏目标不弹卡片，公开预览接口不泄露内容", async ({ request, browser }) => {
  test.setTimeout(120_000);
  test.skip(!process.env.SEED_ADMIN_PASSWORD, "需要种子管理员密码");
  await login(request);
  const suffix = randomUUID();
  const termTitle = `隐藏词条 ${suffix}`;
  const interpTitle = `隐藏诠释者 ${suffix}`;
  const term = await submit(request, { kind: "new_term", title: termTitle });
  const interp = await submit(request, { kind: "new_interpreter", title: interpTitle });
  const target = await submit(request, { kind: "new_perspective", termId: term.pageId, interpreterId: interp.pageId, content: "隐藏前的正文内容。" });
  const srcTerm = await submit(request, { kind: "new_term", title: `隐藏来源 ${suffix}` });
  const source = await submit(request, {
    kind: "new_perspective", termId: srcTerm.pageId, interpreterId: interp.pageId,
    content: `[[${termTitle}|视角@${interpTitle}]]与[[${termTitle}]]`,
  });
  const readerContext = await browser.newContext();
  try {
    const reader = await readerContext.newPage();
    await reader.goto(source.href);
    // 同一请求上下文：可见目标可预览
    expect((await reader.request.get(`/api/pages/${target.pageId}/preview`)).status()).toBe(200);
    expect((await reader.request.get(`/api/pages/${term.pageId}/preview`)).status()).toBe(200);

    // 视角软删除：链接变灰、悬停无卡，接口 404 不给内容
    expect((await request.post(`/api/admin/pages/${target.pageId}`, { data: { action: "delete" } })).status()).toBe(200);
    await reader.goto(source.href);
    await expect(reader.locator(".wiki-content a.wiki-link")).toHaveCount(1); // 只剩词条链接
    const gray = reader.locator(".wiki-content .wiki-link--unavailable").first();
    await gray.hover();
    await reader.waitForTimeout(1_200);
    await expect(reader.getByRole("dialog", { name: "双链预览" })).toHaveCount(0);
    const hiddenPerspective = await reader.request.get(`/api/pages/${target.pageId}/preview`);
    expect(hiddenPerspective.status()).toBe(404);
    expect(await hiddenPerspective.text()).not.toContain("隐藏前的正文内容");

    // 词条软删除连带隐藏视角：词条与视角的预览都 404
    expect((await request.post(`/api/admin/pages/${term.pageId}`, { data: { action: "delete" } })).status()).toBe(200);
    expect((await reader.request.get(`/api/pages/${term.pageId}/preview`)).status()).toBe(404);
    expect((await reader.request.get(`/api/pages/${target.pageId}/preview`)).status()).toBe(404);
    await reader.goto(source.href);
    await expect(reader.locator(".wiki-content a.wiki-link")).toHaveCount(0);

    // 恢复后单独下线诠释者：视角自身未删，但经预览同样不可得
    await request.post(`/api/admin/pages/${term.pageId}`, { data: { action: "restore" } });
    await request.post(`/api/admin/pages/${target.pageId}`, { data: { action: "restore" } });
    expect((await reader.request.get(`/api/pages/${target.pageId}/preview`)).status()).toBe(200);
    expect((await request.post(`/api/admin/pages/${interp.pageId}`, { data: { action: "delete" } })).status()).toBe(200);
    expect((await reader.request.get(`/api/pages/${target.pageId}/preview`)).status()).toBe(404);
  } finally {
    await request.post(`/api/admin/pages/${term.pageId}`, { data: { action: "restore" } });
    await request.post(`/api/admin/pages/${target.pageId}`, { data: { action: "restore" } });
    await request.post(`/api/admin/pages/${interp.pageId}`, { data: { action: "restore" } });
    await readerContext.close();
  }
});

test("编辑实时预览与审核提案预览的双链与正文表现一致", async ({ page, request }) => {
  test.setTimeout(150_000);
  test.skip(!process.env.SEED_ADMIN_PASSWORD, "需要种子管理员密码");
  await login(request);
  const suffix = randomUUID();
  const interpTitle = `一致诠释者 ${suffix}`;
  const interp = await submit(request, { kind: "new_interpreter", title: interpTitle });
  const term = await submit(request, { kind: "new_term", title: `一致目标 ${suffix}`, summary: "目标词条简介。" });
  const srcTerm = await submit(request, { kind: "new_term", title: `一致来源 ${suffix}` });
  const source = await submit(request, {
    kind: "new_perspective", termId: srcTerm.pageId, interpreterId: interp.pageId,
    content: "初始正文。",
  });

  // 编辑实时预览：目录加载后双链可点且可预览；正文主动加粗的双链保留强调
  // （** 需与汉字留空格才是合法的粗体 markdown，否则星号按字面渲染）
  await loginInBrowser(page);
  await page.goto(`/edit/${source.pageId}`);
  const editor = page.getByRole("textbox", { name: "正文（Markdown）" });
  await editor.fill(`引用 **[[一致目标 ${suffix}]]** 与[[意识形态]]。`);
  const livePreview = page.getByRole("region", { name: "实时预览" });
  const boldLink = livePreview.getByRole("link", { name: `一致目标 ${suffix}`, exact: true });
  await expect(boldLink).toHaveAttribute("href", /\/term\//);
  await expect(boldLink).toHaveCSS("font-weight", "700");
  const plainLink = livePreview.getByRole("link", { name: "意识形态", exact: true });
  await expect(plainLink).toHaveCSS("font-weight", "400");
  const liveCard = await hoverUntilCard(page, boldLink);
  await expect(liveCard).toContainText("目标词条简介。");
  await page.mouse.move(20, 60);

  // 审核提案预览：普通编者提交编辑提案，管理员看到的提案预览里双链同样可点可预览
  const editorEmail = `preview-e2e-${suffix}@example.com`;
  expect((await fixtureRegister(page.request, { data: { email: editorEmail, password: "preview-e2e-password", name: "预览编者" } })).ok()).toBe(true);
  const head = await (await request.get(`/api/pages/${source.pageId}/history`)).json();
  const proposal = await submit(page.request, {
    kind: "edit", pageId: source.pageId, baseRevisionId: head.revisions[0].id,
    content: `提案正文引用[[一致目标 ${suffix}]]与[[异化]]。`,
  });
  // 提案只在断言期间存在：中途失败也清队列，不把悬挂提交留给后续场景
  try {
    // 注册把浏览器会话切到普通编者；审核页需要管理员重新登录
    await loginInBrowser(page);
    await page.goto("/review");
    const entry = page.locator(`li[data-submission-id="${proposal.submissionId}"]`);
    await entry.getByText("对比当前版与提案").click();
    const proposalPreview = entry.getByRole("region", { name: "提案预览" });
    await expect(proposalPreview.getByRole("link", { name: `一致目标 ${suffix}`, exact: true })).toHaveAttribute("href", term.href);
    await expect(proposalPreview.locator(".wiki-link--red")).toHaveCount(0);
    const reviewCard = await hoverUntilCard(page, proposalPreview.getByRole("link", { name: `一致目标 ${suffix}`, exact: true }));
    await expect(reviewCard).toContainText("目标词条简介。");
  } finally {
    expect((await request.post(`/api/admin/submissions/${proposal.submissionId}/review`, { data: { action: "reject", reason: "验收夹具清理" } })).status()).toBe(200);
  }
});

test("窄窗口与屏幕边缘：卡片留在视口内；深浅主题下均可读", async ({ page }) => {
  test.setTimeout(60_000);
  await page.setViewportSize({ width: 480, height: 640 });
  await openLacan(page);
  // 落在窄屏右缘附近的链接
  const link = page.locator(".wiki-content").getByRole("link", { name: "意识形态", exact: true });
  const card = await hoverUntilCard(page, link);
  await expectCompactCard(page, card);
  const box = await card.boundingBox();
  expect(box!.x).toBeGreaterThanOrEqual(7);
  expect(box!.x + box!.width).toBeLessThanOrEqual(473);
  await page.mouse.move(20, 60);
  await expect(card).toBeHidden({ timeout: 2_000 });

  // 深色主题：卡片可见且随主题换底色
  await page.addInitScript(() => localStorage.setItem("phoskywiki:theme", "dark"));
  await page.reload();
  await expect(page.locator("html")).toHaveClass(/dark/);
  const darkCard = await hoverUntilCard(page, link);
  await expect(darkCard).toBeVisible();
  const darkBackground = await darkCard.evaluate(el => getComputedStyle(el).backgroundColor);
  await page.addInitScript(() => localStorage.setItem("phoskywiki:theme", "light"));
  await page.reload();
  const lightCard = await hoverUntilCard(page, link);
  const lightBackground = await lightCard.evaluate(el => getComputedStyle(el).backgroundColor);
  expect(darkBackground).not.toBe(lightBackground);
});
