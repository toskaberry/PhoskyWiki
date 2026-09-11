import "dotenv/config";
import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "./fixtures";
import { Pool } from "pg";

// Run after db:migrate + db:seed in an isolated test database, like graph.spec.ts.
// Prepare historical content directly; all assertions use rendered pages and browser requests.
const marker = `graph-tooltip-${randomUUID()}`;
const title = `${marker} <img data-graph-injected src="https://graph-tooltip.invalid/title" onerror="document.documentElement.dataset.graphProbe='executed'"> & "词条" < >`;
const school = `学派 <svg data-graph-injected onload="document.documentElement.dataset.graphProbe='executed'"></svg> & '名称' <img data-graph-injected src="https://graph-tooltip.invalid/school">`;
let rootId: number;
let rootUrl: string;
const fixtureIds: number[] = [];
let pool: Pool;

test.beforeAll(async () => {
  pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const connection = await pool.connect();
  try {
    await connection.query("BEGIN");
    const addPage = async (type: string, name: string) => {
      const result = await connection.query(
        "INSERT INTO pages (type, title, slug) VALUES ($1, $2, $3) RETURNING id",
        [type, name, marker],
      );
      const id: number = result.rows[0].id;
      fixtureIds.push(id);
      return id;
    };
    rootId = await addPage("term", title);
    const neighborId = await addPage("term", `${marker} 邻居`);
    const neighbor2Id = await addPage("term", `${marker} 邻居二`);
    const neighbor3Id = await addPage("term", `${marker} 邻居三`);
    const schoolId = await addPage("school", school);
    const interpreterId = await addPage("interpreter", `${marker} 诠释者`);
    const perspectiveId = await addPage("perspective", `${marker} 视角`);
    await connection.query("INSERT INTO terms (page_id) VALUES ($1), ($2), ($3), ($4)", [rootId, neighborId, neighbor2Id, neighbor3Id]);
    await connection.query("INSERT INTO schools (page_id) VALUES ($1)", [schoolId]);
    await connection.query("INSERT INTO interpreters (page_id) VALUES ($1)", [interpreterId]);
    await connection.query("INSERT INTO school_members (school_id, interpreter_id) VALUES ($1, $2)", [schoolId, interpreterId]);
    await connection.query("INSERT INTO perspectives (page_id, term_id, interpreter_id) VALUES ($1, $2, $3)", [perspectiveId, rootId, interpreterId]);
    await connection.query("INSERT INTO links (source_page_id, target_page_id, target_name) VALUES ($1, $2, $3)", [perspectiveId, neighborId, `${marker} 邻居`]);
    await connection.query("INSERT INTO links (source_page_id, target_page_id, target_name) VALUES ($1, $2, $3), ($1, $4, $5)", [perspectiveId, neighbor2Id, `${marker} 邻居二`, neighbor3Id, `${marker} 邻居三`]);
    await connection.query("COMMIT");
    rootUrl = `/term/${marker}-${rootId}`;
  } catch (error) {
    await connection.query("ROLLBACK");
    throw error;
  } finally {
    connection.release();
  }
});

test.afterAll(async () => {
  await pool.query("DELETE FROM pages WHERE id = ANY($1::int[])", [fixtureIds]);
  await pool.end();
});

async function assertSafeTooltip(page: Page) {
  const canvas = page.getByTestId("graph-canvas");
  await expect(canvas.locator("strong")).toHaveText(title);
  await expect(canvas).toContainText(`${school} · 1 个视角`);
  await expect(canvas).toContainText("双链热度 3");
  await expect(page.locator("[data-graph-injected]")).toHaveCount(0);
  await expect(page.locator("html")).not.toHaveAttribute("data-graph-probe", "executed");
}

test("全站图谱：历史特殊名称按文本显示，悬停无注入且点击仍进入词条", async ({ page }) => {
  const resourceRequests: string[] = [];
  page.on("request", (request) => {
    if (request.url().startsWith("https://graph-tooltip.invalid/")) resourceRequests.push(request.url());
  });
  await page.route("https://graph-tooltip.invalid/**", (route) => route.abort());
  await page.goto("/graph");
  await page.getByTestId("graph-search").fill(marker);
  await page.getByRole("option").filter({ hasText: title }).click();
  const canvas = page.getByTestId("graph-canvas");
  await expect(canvas).toHaveAttribute("data-located", String(rootId));
  await canvas.scrollIntoViewIfNeeded();
  const box = (await canvas.boundingBox())!;
  // Move away from the search-triggered tooltip, then hover the actual canvas node.
  await page.mouse.move(box.x + 2, box.y + 2);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await assertSafeTooltip(page);
  expect(resourceRequests).toEqual([]);
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await expect(page).toHaveURL(rootUrl);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(title);
});

test("局部图谱：历史特殊名称按文本显示，悬停无注入且点击仍进入词条", async ({ page }) => {
  const resourceRequests: string[] = [];
  page.on("request", (request) => {
    if (request.url().startsWith("https://graph-tooltip.invalid/")) resourceRequests.push(request.url());
  });
  await page.route("https://graph-tooltip.invalid/**", (route) => route.abort());
  // A query distinguishes the current URL from the node destination, so a no-op click fails.
  const entryUrl = `${rootUrl}?graph-tooltip=entry`;
  await page.goto(entryUrl);
  await expect(page).toHaveURL(entryUrl);
  const canvas = page.getByTestId("graph-canvas");
  await expect(canvas.locator(`[data-node-id="${rootId}"]`)).toBeVisible();
  await canvas.scrollIntoViewIfNeeded();
  const box = (await canvas.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await assertSafeTooltip(page);
  expect(resourceRequests).toEqual([]);
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await expect(page).toHaveURL(rootUrl);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(title);
});

test("窄屏长标题和学派详情可以滚动读完并进入词条", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${rootUrl}?graph-tooltip=scroll`);
  const graph = page.getByTestId("graph-canvas");
  const node = graph.locator(`[data-node-id="${rootId}"]`);
  await expect(node).toBeVisible();
  await node.focus();
  const details = graph.getByRole("region", { name: "词条关联详情" });
  await expect(details.locator("strong")).toHaveText(title);
  expect(await details.evaluate(element => element.scrollHeight > element.clientHeight)).toBe(true);
  await details.getByRole("button", { name: "进入词条" }).click();
  await expect(page).toHaveURL(rootUrl);
});
