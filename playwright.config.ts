import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: "http://127.0.0.1:3100",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: "npm run test:e2e:server",
    url: "http://127.0.0.1:3100/api/health",
    timeout: 120_000,
    reuseExistingServer: false,
    env: {
      ...process.env,
      DEALHUNTER_DATA_DIR: ".dealhunter-test",
      DEALHUNTER_DEMO_MODE: "1",
      DEALHUNTER_ALLOW_LOCAL_WEBHOOKS: "1",
      DEALHUNTER_LLM_PROVIDER: "fixture",
    },
  },
});
