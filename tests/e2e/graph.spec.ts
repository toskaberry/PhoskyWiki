// 图谱 e2e（T11）：全站图谱页（缩放/拖拽/搜索定位/学派着色）+ 词条页局部图谱。
// 依赖 pnpm db:seed 灌入的演示内容（与其他 e2e 相同前置）。

import { expect, test } from "./fixtures";

test("全站图谱页：画布渲染、学派图例、缩放拖拽冒烟", async ({ page }) => {
  await page.goto("/graph");

  await expect(page.getByRole("heading", { level: 1, name: "全站图谱" })).toBeVisible();
  await expect(page.getByTestId("graph-canvas")).toBeVisible();
  // 概要计数（节点 + 边）就位
  await expect(page.getByTestId("graph-summary")).toContainText("个词条");
  await expect(page.getByTestId("graph-summary")).toContainText("条双链关系");

  // 学派配色图例（HTML 渲染，含种子学派与未归属项）
  await expect(page.getByTestId("graph-legend")).toContainText("精神分析");
  await expect(page.getByTestId("graph-legend")).toContainText("暂无学派成员视角");

  // 缩放 + 拖拽冒烟：画布保持响应（无渲染卡死）
  const canvas = page.getByTestId("graph-canvas");
  const box = await canvas.boundingBox();
  expect(box).not.toBeNull();
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
  await page.mouse.wheel(0, -300);
  await page.mouse.down();
  await page.mouse.move(box!.x + 80, box!.y + 60, { steps: 5 });
  await page.mouse.up();
  await expect(page.getByTestId("graph-canvas")).toBeVisible();
});

test("全站图谱：搜索定位节点后点击画布中心进入词条页", async ({ page }) => {
  await page.goto("/graph");

  // 定位把视口中心移到节点上；data-located 标记出现说明定位已真正生效
  //（画布初始化是异步的，状态文本先于定位出现）
  const search = page.getByTestId("graph-search");
  await search.fill("主体性");
  await page.getByRole("option", { name: /主体性/ }).first().click();
  await expect(page.getByTestId("graph-located")).toContainText("已定位：主体性");

  const canvas = page.getByTestId("graph-canvas");
  await expect(canvas).toHaveAttribute("data-located", /\d+/);
  const box = await canvas.boundingBox();
  expect(box).not.toBeNull();
  await page.mouse.click(box!.x + box!.width / 2, box!.y + box!.height / 2);
  await expect(page).toHaveURL(/\/term\/.+/, { timeout: 5_000 });
  await expect(page.getByRole("heading", { level: 1, name: "主体性" })).toBeVisible();
});

test("词条页局部图谱：邻居网络、跳数切换、邻居链接跳转", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("link", { name: "主体性", exact: true }).click();

  await expect(page.getByRole("heading", { name: "局部图谱" })).toBeVisible();
  await expect(page.getByTestId("graph-canvas")).toBeVisible();

  // 跳数切换 1 → 2：画布重绘不卡死
  await page.getByRole("button", { name: "2 跳" }).click();
  await expect(page.getByRole("button", { name: "2 跳" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("graph-canvas")).toBeVisible();

  // 邻居词条链接：点击进入对应词条页
  const neighbor = page
    .getByTestId("graph-neighbors")
    .getByRole("link", { name: /^意识形态（双链热度/ });
  await neighbor.click();
  await expect(page).toHaveURL(/\/term\/.+/, { timeout: 5_000 });
  await expect(page.getByRole("heading", { level: 1, name: "意识形态" })).toBeVisible();
});

test("只读端点返回节点/边/学派图例数据", async ({ request }) => {
  const site = await request.get("/api/graph/site");
  expect(site.status()).toBe(200);
  const siteData = await site.json();
  expect(siteData.nodes.length).toBeGreaterThan(0);
  expect(siteData.edges.length).toBeGreaterThan(0);
  expect(siteData.schools.length).toBeGreaterThanOrEqual(2);
  expect(siteData.nodes[0].url).toMatch(/^\/term\//);

  // 用任一节点 id 走局部端点
  const termId = siteData.nodes[0].id;
  const local = await request.get(`/api/graph/local?termId=${termId}&hops=2`);
  expect(local.status()).toBe(200);
  const localData = await local.json();
  expect(localData.rootId).toBe(termId);
  expect(localData.nodes.some((n: { id: number }) => n.id === termId)).toBe(true);

  expect((await request.get("/api/graph/local")).status()).toBe(400);
  expect((await request.get("/api/graph/local?termId=999999")).status()).toBe(404);
});
