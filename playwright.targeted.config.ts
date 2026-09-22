// 定向跨浏览器验证配置（#85）：Firefox / WebKit 的双链链接样式、紧凑卡片与重叠点击。
// 不进入默认测试矩阵（CI 仍以 Chromium 为主）；需要复验时运行：
//   DATABASE_URL=<*_test 库> … pnpm exec playwright test --config=playwright.targeted.config.ts
import { defineConfig, devices } from "@playwright/test";
import "dotenv/config";
import { assertIsolatedTestEnvironment } from "./tests/isolated-environment";

assertIsolatedTestEnvironment();
process.env.MEILI_HOST = process.env.E2E_MEILI_HOST ?? "";

const PORT = Number(process.env.PW_PORT ?? 3000);
const baseURL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: "wiki-link-previews.spec.ts",
  timeout: 60_000,
  fullyParallel: true,
  workers: 1,
  reporter: "list",
  use: { baseURL, trace: "on-first-retry" },
  projects: [
    { name: "firefox", use: { ...devices["Desktop Firefox"] } },
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
  ],
  webServer: {
    command: `pnpm dev --port ${PORT}`,
    url: `${baseURL}/`,
    reuseExistingServer: false,
    stdout: "ignore",
    timeout: 120_000,
  },
});
