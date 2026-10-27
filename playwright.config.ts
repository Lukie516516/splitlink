import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "tests/browser",
  workers: 1,
  fullyParallel: false,
  timeout: 45000,
  expect: { timeout: 15000 },
  use: {
    baseURL: "http://127.0.0.1:4274",
    trace: "retain-on-failure",
    launchOptions: process.env.PW_EXECUTABLE
      ? { executablePath: process.env.PW_EXECUTABLE }
      : undefined,
  },
  reporter: [["list"], ["json", { outputFile: "evidence/browser.json" }]],
  webServer: {
    command: "pnpm preview",
    url: "http://127.0.0.1:4274",
    reuseExistingServer: false,
  },
});
