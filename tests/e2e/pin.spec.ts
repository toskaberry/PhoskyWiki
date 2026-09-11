import { expect, test } from "./fixtures";

test("公共置顶接口和页面控件已移除", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("link", { name: "主体性", exact: true }).click();
  await expect(page.getByTestId("pin-badge")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /置顶/ })).toHaveCount(0);
  const href = await page.getByRole("link", { name: "福柯论主体性", exact: true }).getAttribute("href");
  const id = href!.match(/(\d+)$/)![1];
  for (const method of ["POST", "DELETE"]) {
    expect((await page.request.fetch(`/api/admin/perspectives/${id}/pin`, { method })).status()).toBe(404);
  }
});
