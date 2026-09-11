import { expect, test, type Page } from "./fixtures";

async function expectSeparated(page: Page) {
  const nodes = page.locator("[data-node-boundary]");
  await expect(nodes.first()).toBeVisible();
  const minimumGap = await nodes.evaluateAll(elements => {
    const circles = elements.map(element => {
      const box = element.getBoundingClientRect();
      return { x: box.x + box.width / 2, y: box.y + box.height / 2, radius: box.width / 2 };
    });
    let minimum = Infinity;
    for (let i = 0; i < circles.length; i++) for (let j = i + 1; j < circles.length; j++) {
      const a = circles[i], b = circles[j];
      minimum = Math.min(minimum, Math.hypot(a.x - b.x, a.y - b.y) - a.radius - b.radius);
    }
    return minimum;
  });
  expect(minimumGap).toBeGreaterThan(1);
}

test("实心饼图保留多个学派，搜索和键盘聚焦显示完整关联", async ({ page }) => {
  await page.goto("/graph");
  await page.getByTestId("graph-search").fill("主体性");
  await page.getByRole("option", { name: /主体性/ }).first().click();
  const graph = page.getByTestId("graph-canvas");
  await expect(graph).toHaveAttribute("data-located", /\d+/);
  const id = await graph.getAttribute("data-located");
  const node = graph.locator(`[data-node-id="${id}"]`);
  expect(await node.locator("[data-school-sector]").count()).toBeGreaterThan(1);
  // A sector starts at the circle centre: the chosen design is a solid pie.
  await expect(node.locator("[data-school-sector]").first()).toHaveAttribute("d", /^M 0 0 L /);
  await node.focus();
  await expect(graph).toContainText("精神分析 · 2 个视角");
  await expect(graph).toContainText("不表示概念归属比例");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/term\//);
});

test("触屏先选中词条，详情可滚动并通过明确按钮进入词条", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true });
  const page = await context.newPage();
  try {
    await page.goto("/graph");
    await page.getByTestId("graph-search").fill("主体性");
    await page.getByRole("option", { name: /主体性/ }).first().click();
    const graph = page.getByTestId("graph-canvas");
    await expect(graph).toHaveAttribute("data-located", /\d+/);
    const id = await graph.getAttribute("data-located");
    await graph.locator(`[data-node-id="${id}"]`).tap();
    await expect(page).toHaveURL(/\/graph$/);
    const details = graph.getByRole("region", { name: "词条关联详情" });
    await expect(details).toContainText("主体性");
    await expect(details).toHaveCSS("overflow-y", "auto");
    await details.getByRole("button", { name: "进入词条" }).click();
    await expect(page).toHaveURL(/\/term\//);
  } finally { await context.close(); }
});

test("可沿悬停桥自然移入详情并操作", async ({ page }) => {
  await page.goto("/graph");
  const graph = page.getByTestId("graph-canvas");
  await page.getByTestId("graph-search").fill("主体性");
  await page.getByRole("option", { name: /主体性/ }).first().click();
  await expect(graph).toHaveAttribute("data-located", /\d+/);
  const id = await graph.getAttribute("data-located");
  const node = graph.locator(`[data-node-id="${id}"]`);
  await graph.locator("[data-graph-surface]").click({ position: { x: 2, y: 620 } });

  await node.hover();
  const details = graph.getByRole("region", { name: "词条关联详情" });
  await expect(details).toBeVisible();
  const from = (await node.boundingBox())!;
  const to = (await details.boundingBox())!;
  for (let step = 1; step <= 20; step++) {
    await page.mouse.move(
      from.x + from.width / 2 + (to.x + to.width / 2 - from.x - from.width / 2) * step / 20,
      from.y + from.height / 2 + (to.y + to.height / 2 - from.y - from.height / 2) * step / 20,
    );
    await page.waitForTimeout(15);
    expect(await details.isVisible(), `详情不应在第 ${step} 步消失`).toBe(true);
  }
  await details.getByRole("button", { name: "进入词条" }).click();
  await expect(page).toHaveURL(/\/term\//);
});

test("从悬停桥直接离开画布会恢复未聚焦状态", async ({ page }) => {
  await page.goto("/graph");
  const graph = page.getByTestId("graph-canvas");
  const node = graph.locator("[data-node-id]").first();
  await node.hover();
  const details = graph.getByRole("region", { name: "词条关联详情" });
  const from = (await node.boundingBox())!;
  const to = (await details.boundingBox())!;
  await page.mouse.move((from.x + to.x + to.width / 2) / 2, (from.y + to.y + to.height / 2) / 2);
  await page.getByRole("heading", { level: 1, name: "全站图谱" }).hover();
  await expect(details).toBeHidden();
});

test("悬停离开期间父级搜索重绘仍会按时清除临时聚焦", async ({ page }) => {
  await page.goto("/graph");
  const graph = page.getByTestId("graph-canvas");
  const node = graph.locator("[data-node-id]").first();
  await node.hover();
  await expect(graph.getByRole("region", { name: "词条关联详情" })).toBeVisible();

  await node.evaluate(element => {
    element.dispatchEvent(new PointerEvent("pointerout", { bubbles: true }));
    const input = document.querySelector<HTMLInputElement>("[data-testid=graph-search]")!;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    setter.call(input, "重绘");
    input.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: "重绘" }));
  });
  await expect(graph.getByRole("region", { name: "词条关联详情" })).toBeHidden();
});

test("布局完成前重置不会让待定位节点重新获得聚焦", async ({ page }) => {
  await page.addInitScript(() => {
    const NativeWorker = window.Worker;
    class DelayedWorker extends NativeWorker {
      set onmessage(listener: ((this: Worker, ev: MessageEvent) => unknown) | null) {
        super.onmessage = listener
          ? event => setTimeout(() => listener.call(this, event), 250)
          : null;
      }
    }
    Object.defineProperty(window, "Worker", { configurable: true, value: DelayedWorker });
  });
  await page.goto("/graph");
  const graph = page.getByTestId("graph-canvas");
  await page.getByTestId("graph-search").fill("主体性");
  await page.getByRole("option", { name: /主体性/ }).first().click();
  await page.keyboard.press("Escape");
  await expect(graph.getByText("正在排列词条…")).toBeHidden();
  await expect(graph).not.toHaveAttribute("data-located", /.+/);
  await expect(graph.getByRole("region", { name: "词条关联详情" })).toBeHidden();
  await expect(page.getByTestId("graph-located")).toBeHidden();
});

test("空白、Escape 与适应画布清除聚焦及搜索定位提示", async ({ page }) => {
  await page.goto("/graph");
  const graph = page.getByTestId("graph-canvas");
  const search = page.getByTestId("graph-search");

  async function locateSubjectivity() {
    await search.fill("主体性");
    await page.getByRole("option", { name: /主体性/ }).first().click();
    await expect(graph.getByRole("region", { name: "词条关联详情" })).toContainText("主体性");
    await expect(page.getByTestId("graph-located")).toContainText("已定位：主体性");
  }

  await locateSubjectivity();
  await graph.locator("[data-graph-surface]").click({ position: { x: 2, y: 2 } });
  await expect(graph.getByRole("region", { name: "词条关联详情" })).toBeHidden();
  await expect(page.getByTestId("graph-located")).toBeHidden();

  await locateSubjectivity();
  await page.keyboard.press("Escape");
  await expect(graph.getByRole("region", { name: "词条关联详情" })).toBeHidden();
  await expect(page.getByTestId("graph-located")).toBeHidden();

  await locateSubjectivity();
  await page.getByRole("button", { name: "适应画布" }).click();
  await expect(graph.getByRole("region", { name: "词条关联详情" })).toBeHidden();
  await expect(page.getByTestId("graph-located")).toBeHidden();
});

test("局部图谱也可用 Escape 清除触屏式选择", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("link", { name: "主体性", exact: true }).click();
  const graph = page.getByTestId("graph-canvas");
  const node = graph.locator("[data-node-id]").first();
  await node.focus();
  await page.keyboard.press(" ");
  await expect(graph.getByRole("region", { name: "词条关联详情" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(graph.getByRole("region", { name: "词条关联详情" })).toBeHidden();
});

test("全站和局部圆点在拖拽、缩放、窄屏与跳数切换后均不重叠", async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto("/graph");
  await expectSeparated(page);
  const graph = page.getByTestId("graph-canvas");
  await graph.scrollIntoViewIfNeeded();
  const box = (await graph.boundingBox())!;
  const visible = await page.locator("[data-node-boundary]").evaluateAll((elements, box) => elements.map(e => {
    const b = e.getBoundingClientRect();
    return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  }).filter(p => p.x > box.x + 30 && p.x < box.x + box.width - 30 && p.y > box.y + 30 && p.y < box.y + box.height - 60), box);
  expect(visible.length).toBeGreaterThan(1);
  await page.mouse.move(visible[0].x, visible[0].y);
  await page.mouse.down();
  await page.mouse.move(visible[1].x, visible[1].y, { steps: 10 });
  await expectSeparated(page);
  await page.mouse.up();
  await expect(page).toHaveURL(/\/graph$/);
  await expectSeparated(page);
  await page.getByRole("button", { name: "放大图谱" }).click();
  await expectSeparated(page);
  for (let i = 0; i < 8; i++) await page.getByRole("button", { name: "缩小图谱" }).click();
  await expectSeparated(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await expectSeparated(page);
  await page.screenshot({ path: testInfo.outputPath("graph-mobile.png"), fullPage: true });
  await page.getByTestId("graph-search").fill("主体性");
  await page.getByRole("option", { name: /主体性/ }).first().click();
  const id = await graph.getAttribute("data-located");
  await graph.locator(`[data-node-id="${id}"]`).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: "局部图谱" })).toBeVisible();
  await expectSeparated(page);
  await page.getByRole("button", { name: "2 跳" }).click();
  await expect(page.getByRole("button", { name: "2 跳" })).toHaveAttribute("aria-pressed", "true");
  await expectSeparated(page);
  expect(errors).toEqual([]);
});
