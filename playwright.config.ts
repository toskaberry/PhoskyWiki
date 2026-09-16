import { defineConfig, devices } from "@playwright/test";
import "dotenv/config";
import { randomBytes } from 'node:crypto';
import { assertIsolatedTestEnvironment } from "./tests/isolated-environment";

assertIsolatedTestEnvironment();
process.env.MEILI_HOST = process.env.E2E_MEILI_HOST ?? "";

// 本地可用 PW_PORT 换端口起被测服务器（例如同机并行跑多份检出时避免占用 3000）
const PORT = Number(process.env.PW_PORT ?? 3000);
const baseURL = `http://localhost:${PORT}`;

// 默认用 Playwright 自带 Chromium；本地可用 PW_CHANNEL=chrome 复用系统浏览器，免去下载
const channel = process.env.PW_CHANNEL;
if (process.env.TEST_APP_IMAGE) process.env.PW_CONTAINER_NAME ??= `phosky-e2e-${randomBytes(6).toString('hex')}`;

export default defineConfig({
  testDir: "./tests/e2e",
  globalTeardown: './tests/e2e-container-teardown.ts',
  timeout: 30_000,
  fullyParallel: true,
  // Several legacy scenarios change the global administrator count and share
  // seed data; serialize them so quorum and quota state cannot cross scenarios.
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL,
    channel,
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    // Never reuse a server whose database/storage identity the runner cannot verify.
    command: process.env.TEST_APP_IMAGE ? "node scripts/serve-ci-image.mjs" : process.env.CI ? "pnpm start" : `pnpm dev --port ${PORT}`,
    url: `${baseURL}/`,
    reuseExistingServer: false,
    stdout: "ignore",
    timeout: 120_000,
  },
});
