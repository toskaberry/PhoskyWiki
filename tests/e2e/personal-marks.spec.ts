// 个人标记（划线）端到端流程（spec 0009 #72）：选区浮条（复制 + 三样式）、
// 云端随账号保存与跨浏览器恢复、样式记忆默认值、改样式、相交并集合并、
// 删除、隐私边界（他人与游客不可见）、键盘可达、移动端只读不出浮条。

import "dotenv/config";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { expect, test, type Page } from "./fixtures";
import { getDb } from "../../src/db";
import { pages, personalMarks, user, userMarkStyle } from "../../src/db/schema";
import { fixtureRegister } from "./auth-fixture";

/** 「拉康论主体性」视角（种子里固定存在）的页面行与直达地址。 */
async function lacanPerspective() {
  const [row] = await getDb().select().from(pages).where(eq(pages.title, "拉康论主体性"));
  return { id: row.id, href: `/perspective/${row.slug}-${row.id}` };
}

async function openPerspective(page: Page) {
  const { href } = await lacanPerspective();
  await page.goto(href);
  await expect(page.getByRole("heading", { level: 1, name: "拉康论主体性" })).toBeVisible();
}

async function login(page: Page) {
  await page.goto("/login");
  await page.getByLabel("邮箱").fill(process.env.SEED_ADMIN_EMAIL ?? "admin@phoskywiki.local");
  await page.getByLabel("密码").fill(process.env.SEED_ADMIN_PASSWORD!);
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page.getByTestId("session-user")).toContainText("管理员");
}

/** 在 .wiki-content 里选中一段字（触发真实的 selectionchange 流程）。
 *  选段可能落在标记 span 的边界两侧，按合并文本偏移映射回 (节点, 偏移)。 */
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

const toolbar = (page: Page) => page.getByRole("toolbar", { name: "划线工具条" });

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

test("游客可选文出浮条：尖角指向选区，复制可用，样式按钮引导登录带回跳", async ({ page }) => {
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await openPerspective(page);
  await selectText(page, "无意识像语言一样被结构");
  const bar = toolbar(page);
  await expect(bar).toBeVisible();
  await expect(bar.locator(".pw-selection-toolbar-caret")).toBeVisible();
  await bar.getByRole("button", { name: "复制所选文字" }).click();
  await expect(bar.getByText("已复制")).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("无意识像语言一样被结构");
  await bar.getByRole("button", { name: /马克笔划线/ }).click();
  await expect(page.getByRole("heading", { level: 1, name: "登录" })).toBeVisible();
  const redirect = new URL(page.url()).searchParams.get("redirect");
  expect(new URL(redirect!, "http://localhost").pathname).toMatch(/\/perspective\//);
  expect((await page.request.post("/api/marks", { data: { pageId: 1, anchor: {}, style: "highlight" } })).status()).toBe(401);
});

test("登录后三种样式渲染正确，云端保存：刷新与另一浏览器（同账号）可见，他人与游客不可见", async ({ page, browser }) => {
  test.skip(!process.env.SEED_ADMIN_PASSWORD, "需要种子管理员密码");
  test.setTimeout(90_000);
  const { href } = await lacanPerspective();
  const otherEmail = `marks-e2e-${randomUUID()}@example.com`;
  const secondContext = await browser.newContext();
  const guestContext = await browser.newContext();
  const otherContext = await browser.newContext();
  try {
    await login(page);
    await openPerspective(page);
    await selectText(page, "无意识像语言一样被结构");
    await toolbar(page).getByRole("button", { name: /马克笔划线/ }).click();
    await expect(page.locator(".pw-mark--highlight")).toHaveText("无意识像语言一样被结构");
    await selectText(page, "言说的「我」永远无法与被言说的「我」重合");
    await toolbar(page).getByRole("button", { name: /直线划线/ }).click();
    await expect(page.locator(".pw-mark--underline")).toHaveText("言说的「我」永远无法与被言说的「我」重合");
    await selectText(page, "镜像阶段");
    await toolbar(page).getByRole("button", { name: /波浪线划线/ }).click();
    await expect(page.locator(".pw-mark--squiggle")).toHaveText("镜像阶段");

    // 刷新后仍在（云端随账号，非本地缓存）
    await page.reload();
    await expect(page.locator(".pw-mark--highlight")).toHaveText("无意识像语言一样被结构");
    await expect(page.locator(".pw-mark--underline")).toHaveText("言说的「我」永远无法与被言说的「我」重合");
    await expect(page.locator(".pw-mark--squiggle")).toHaveText("镜像阶段");

    // 换浏览器登录同一账号：标记完整恢复
    const second = await secondContext.newPage();
    await login(second);
    await second.goto(href);
    await expect(second.locator(".pw-mark--highlight")).toHaveText("无意识像语言一样被结构");
    await expect(second.locator(".pw-mark--underline")).toHaveText("言说的「我」永远无法与被言说的「我」重合");
    await expect(second.locator(".pw-mark--squiggle")).toHaveText("镜像阶段");
    // 他人与未登录用户看不到任何个人标记
    expect((await fixtureRegister(otherContext.request, { data: { name: "划线旁观者", email: otherEmail, password: "marks-e2e-password" } })).ok()).toBe(true);
    const other = await otherContext.newPage();
    await other.goto(href);
    await expect(other.locator(".pw-mark")).toHaveCount(0);
    const guest = await guestContext.newPage();
    await guest.goto(href);
    await expect(guest.locator(".pw-mark")).toHaveCount(0);
  } finally {
    await secondContext.close();
    await guestContext.close();
    await otherContext.close();
    await getDb().delete(user).where(eq(user.email, otherEmail));
    await cleanupMarks();
  }
});

test("样式记忆：上次选择的样式成为默认，浮条聚焦后 Enter 直接应用", async ({ page }) => {
  test.skip(!process.env.SEED_ADMIN_PASSWORD, "需要种子管理员密码");
  try {
    await login(page);
    await openPerspective(page);
    await selectText(page, "无意识像语言一样被结构");
    await toolbar(page).getByRole("button", { name: /波浪线划线/ }).click();
    await expect(page.locator(".pw-mark--squiggle")).toHaveText("无意识像语言一样被结构");
    // 新选区：波浪线按钮带默认标记，Enter 应用默认样式
    await selectText(page, "镜像阶段");
    const defaultButton = toolbar(page).getByRole("button", { name: "波浪线划线（默认样式）" });
    await expect(defaultButton).toHaveAttribute("data-default", "true");
    await toolbar(page).focus();
    await expect(toolbar(page)).toBeFocused();
    await page.keyboard.press("Enter");
    // 首个波浪线标记仍在；新默认样式标记落在新选段上
    const squiggleOnSelection = page.locator(".pw-mark--squiggle").filter({ hasText: "镜像阶段" });
    await expect(squiggleOnSelection).toHaveText("镜像阶段");
    await expect(page.locator(".pw-mark--squiggle")).toHaveCount(2);
  } finally { await cleanupMarks(); }
});

test("选中已有标记可更改样式且不叠画多条", async ({ page }) => {
  test.skip(!process.env.SEED_ADMIN_PASSWORD, "需要种子管理员密码");
  try {
    await login(page);
    await openPerspective(page);
    await selectText(page, "主体不是先于语言的存在");
    await toolbar(page).getByRole("button", { name: /马克笔划线/ }).click();
    await expect(page.locator(".pw-mark--highlight")).toHaveText("主体不是先于语言的存在");
    // 重选同一段已标记文本：换直线，仍是一条标记
    await selectText(page, "主体不是先于语言的存在");
    await toolbar(page).getByRole("button", { name: /直线划线/ }).click();
    await expect(page.locator(".pw-mark")).toHaveCount(1);
    await expect(page.locator(".pw-mark--underline")).toHaveText("主体不是先于语言的存在");
    await expect(page.locator(".pw-mark--highlight")).toHaveCount(0);
  } finally { await cleanupMarks(); }
});

test("相交选区按范围并集合并：删旧建新，不出现叠画", async ({ page }) => {
  test.skip(!process.env.SEED_ADMIN_PASSWORD, "需要种子管理员密码");
  try {
    await login(page);
    await openPerspective(page);
    await selectText(page, "主体不是先于语言的存在");
    await toolbar(page).getByRole("button", { name: /马克笔划线/ }).click();
    await expect(page.locator(".pw-mark")).toHaveCount(1);
    // 新选区从旧标记内部开始、延伸到标记之外：合并为并集单条
    await selectText(page, "先于语言的存在，而是在能指链中被构成的");
    await toolbar(page).getByRole("button", { name: /马克笔划线/ }).click();
    await expect(page.locator(".pw-mark")).toHaveCount(1);
    await expect(page.locator(".pw-mark--highlight"))
      .toHaveText("主体不是先于语言的存在，而是在能指链中被构成的");
    const [stored] = await getDb().select().from(personalMarks)
      .where(eq(personalMarks.userId, await adminId()));
    expect(stored.quote).toBe("主体不是先于语言的存在，而是在能指链中被构成的");
  } finally { await cleanupMarks(); }
});

test("选中已标记文本可删除标记，刷新后不再出现", async ({ page }) => {
  test.skip(!process.env.SEED_ADMIN_PASSWORD, "需要种子管理员密码");
  try {
    await login(page);
    await openPerspective(page);
    await selectText(page, "无意识像语言一样被结构");
    await toolbar(page).getByRole("button", { name: /马克笔划线/ }).click();
    await expect(page.locator(".pw-mark")).toHaveCount(1);
    await selectText(page, "无意识像语言一样被结构");
    await toolbar(page).getByRole("button", { name: "删除标记" }).click();
    await expect(page.locator(".pw-mark")).toHaveCount(0);
    const [stored] = await getDb().select().from(personalMarks)
      .where(eq(personalMarks.userId, await adminId()));
    expect(stored).toBeUndefined();
    await page.reload();
    await expect(page.locator(".pw-mark")).toHaveCount(0);
  } finally { await cleanupMarks(); }
});

test("桌面键盘可达：Shift+方向键选文出浮条，浮条可聚焦并有 aria 标注", async ({ page }) => {
  test.skip(!process.env.SEED_ADMIN_PASSWORD, "需要种子管理员密码");
  try {
    await login(page);
    await openPerspective(page);
    // 键盘扩选（无鼠标参与）：先给一个 3 字选区，Shift+方向键在 Chromium 中
    // 对既有选区做焦点端扩展——这正是键盘用户的连续操作形态
    const placed = await page.evaluate(() => {
      const root = document.querySelector(".wiki-content");
      if (!root) return false;
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const index = node.nodeValue?.indexOf("无意识像语言一样被结构") ?? -1;
        if (index >= 0) {
          window.getSelection()?.setBaseAndExtent(node, index, node, index + 3);
          return true;
        }
      }
      return false;
    });
    expect(placed).toBe(true);
    for (let i = 0; i < 3; i++) await page.keyboard.press("Shift+ArrowRight");
    const bar = toolbar(page);
    await expect(bar).toBeVisible();
    expect(await bar.getAttribute("tabindex")).toBe("0");
    expect(await bar.getAttribute("role")).toBe("toolbar");
    await bar.focus();
    await expect(bar).toBeFocused();
    await page.keyboard.press("Enter");
    // 点击落点与扩选长度有 ±1 字的容差，断言标记覆盖目标字中段
    await expect(page.locator(".pw-mark--highlight")).toHaveCount(1);
    await expect(page.locator(".pw-mark--highlight")).toContainText("意识");
  } finally { await cleanupMarks(); }
});

test("移动端只读：选区不出现浮条", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openPerspective(page);
  await selectText(page, "无意识像语言一样被结构");
  await expect(toolbar(page)).toHaveCount(0);
  await expect(page.locator(".pw-selection-toolbar")).toHaveCount(0);
});
