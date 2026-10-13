import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  testDir: "./tests",
  fullyParallel: true,
  timeout: 45000,
  retries: 0,
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:5177",
    trace: "retain-on-failure",
    ...devices["Desktop Chrome"],
    channel: process.env.CI ? undefined : "chrome",
  },
  webServer: {
    command: "pnpm dev",
    url: "http://127.0.0.1:5177",
    reuseExistingServer: !process.env.CI,
  },
  projects: [{ name: "chromium" }],
});
