import { expect, test } from "./fixtures";

// T04 读路径：反链面板、显式视角链接、消歧义分流（依赖 pnpm db:seed 的演示内容）。

test("词条页反链面板：列出引用本页的视角，可点进视角页", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("link", { name: "主体性", exact: true }).click();

  const panel = page.locator("section", { has: page.getByRole("heading", { name: /反链/ }) });
  // 黑格尔论异化 引用主体性：断言落在具体行上
  const row = panel.locator("li").filter({ hasText: "黑格尔论异化" });
  await expect(row).toBeVisible();
  await expect(row.getByText("属于词条 异化")).toBeVisible();

  await panel.getByRole("link", { name: "黑格尔论异化" }).click();
  await expect(page).toHaveURL(/\/perspective\//, { timeout: 5_000 });
  await expect(page.getByRole("heading", { level: 1, name: "黑格尔论异化" })).toBeVisible();
});

test("显式视角链接：[[词条|视角@诠释者]] 直落视角页；视角页也有反链面板", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("link", { name: "意识形态", exact: true }).click();
  await page.getByRole("link", { name: "阿尔都塞论意识形态" }).click();

  // 正文里的显式视角链接显示 @ 之前的文本，点击直达视角页（不经词条枢纽）
  const explicit = page.getByRole("link", { name: "阿尔都塞论主体性", exact: true });
  await expect(explicit).toBeVisible();
  await explicit.click();
  await expect(page).toHaveURL(/\/perspective\//, { timeout: 5_000 });
  await expect(page.getByRole("heading", { level: 1, name: "阿尔都塞论主体性" })).toBeVisible();

  // 视角页的反链面板：入链来自 阿尔都塞论意识形态
  const panel = page.locator("section", { has: page.getByRole("heading", { name: /反链/ }) });
  await expect(panel.getByRole("link", { name: "阿尔都塞论意识形态" })).toBeVisible();
});

test("显式视角语法未命中：红链提示视角尚未创建、不可点击", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("link", { name: "主体性", exact: true }).click();
  await page.getByRole("link", { name: "拉康论主体性" }).click();

  const redLink = page.locator(".wiki-link--red", { hasText: "德里达论主体性" });
  await expect(redLink).toBeVisible();
  await expect(redLink).toHaveAttribute("title", "视角尚未创建");
});

test("同名聚合：价值链接落统一词条，具名视角阅读", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("link", { name: "剩余价值", exact: true }).click();
  await page.getByRole("link", { name: "马克思论剩余价值", exact: true }).click();
  await page.locator(".wiki-content").getByRole("link", { name: "价值", exact: true }).click();
  await expect(page).toHaveURL(/\/term\//);
  await expect(page.getByRole("heading", { level: 1, name: "价值" })).toBeVisible();
  await page.getByRole("link", { name: "马克思论价值", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: "马克思论价值" })).toBeVisible();
});
