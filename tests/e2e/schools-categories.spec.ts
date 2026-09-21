import { expect, test } from "./fixtures";

// 学派轴与分类轴的游客浏览全流程（依赖 pnpm db:seed 灌入的演示内容）

test("学派轴：学派列表 → 学派页（成员诠释者 + 核心词条）→ 诠释者页与词条页", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("link", { name: "学派", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: "学派" })).toBeVisible();

  // 学派列表：两个学派卡片
  await expect(page.getByRole("link", { name: "精神分析", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "法兰克福学派", exact: true })).toBeVisible();

  await page.getByRole("link", { name: "精神分析", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: "精神分析" })).toBeVisible();
  await expect(page).toHaveURL(/\/school\/.+/, { timeout: 5_000 });

  // 成员诠释者列表可点入诠释者页
  await page.getByRole("link", { name: "弗洛伊德", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: "弗洛伊德" })).toBeVisible();

  // 诠释者页信息框有所属学派，点回学派页
  await page.getByRole("link", { name: "精神分析", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: "精神分析" })).toBeVisible();

  // 核心词条（成员视角派生）可点入词条枢纽页
  await page.getByRole("link", { name: "主体性", exact: true }).click();
  await expect(page).toHaveURL(/\/term\/.+/, { timeout: 5_000 });
  await expect(page.getByRole("heading", { level: 1, name: "主体性" })).toBeVisible();
});

test("分类轴：分类树浏览 → 分类页词条列表；词条页显示所属分类并可点入", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "更多导航", exact: true }).click();
  await page.getByRole("dialog", { name: "更多导航", exact: true }).getByRole("link", { name: "分类", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: "分类" })).toBeVisible();

  // 树上子分类可点入
  await page.getByRole("link", { name: "主体理论" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "主体理论" })).toBeVisible();
  await expect(page).toHaveURL(/\/categories\/.+/, { timeout: 5_000 });

  // 面包屑露出祖先链
  await expect(page.getByRole("link", { name: "哲学", exact: true })).toBeVisible();

  // 分类词条列表可点入词条页
  await page.getByRole("link", { name: "主体性", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: "主体性" })).toBeVisible();

  // 词条页信息框显示所属分类并可点入（主体性 多挂：主体理论 + 马克思主义）
  await page.getByRole("link", { name: "马克思主义", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: "马克思主义" })).toBeVisible();
  // 分类页列出子分类与其词条
  await expect(page.getByRole("link", { name: "意识形态批判" })).toBeVisible();
  await expect(page.getByRole("link", { name: "剩余价值", exact: true })).toBeVisible();
});
