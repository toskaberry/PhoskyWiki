import { defineConfig, devices } from "@playwright/test";
import config from "./playwright.config";

// Opt-in targeted regression matrix; leaves the ordinary suite Chromium-only.
export default defineConfig({
  ...config,
  testMatch: "wiki-preview.spec.ts",
  grep: /@cross-browser/,
  use: { ...config.use, channel: undefined },
  projects: [
    { name: "firefox", use: { ...devices["Desktop Firefox"], launchOptions: { firefoxUserPrefs: { "network.proxy.type": 0 } } } },
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
  ],
});
