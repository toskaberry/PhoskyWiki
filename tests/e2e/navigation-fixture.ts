import { expect, type Page } from "./fixtures";

/** Follow the visible account entry at the current viewport. */
export async function openAccountMenu(page: Page) {
  const mobile = page.getByRole("button", { name: "打开导航", exact: true });
  const isMobile = await mobile.isVisible();
  await (isMobile ? mobile : page.getByRole("button", { name: "账户菜单", exact: true })).click();
  const menu = page.getByRole("dialog", { name: isMobile ? "站点导航" : "账户菜单", exact: true });
  await expect(menu).toBeVisible();
  return menu;
}

export async function toggleTheme(page: Page) {
  const mobile = page.getByRole("button", { name: "打开导航", exact: true });
  const isMobile = await mobile.isVisible();
  if (isMobile) await mobile.click();
  await page.getByRole("button", { name: "深色主题", exact: true }).click();
  if (isMobile) await page.getByRole("button", { name: "关闭导航", exact: true }).click();
}
