import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/browser",
  fullyParallel: false,
  workers: 1,
  timeout: 45000,
  expect: { timeout: 12000 },
  use: {
    baseURL: "http://127.0.0.1:4173",
    trace: "retain-on-failure",
    launchOptions: process.env.PW_EXECUTABLE
      ? { executablePath: process.env.PW_EXECUTABLE }
      : undefined,
  },
  reporter: [
    ["list"],
    ["json", { outputFile: "outputs/browser-results.json" }],
  ],
  webServer: {
    command: "pnpm preview --port 4173",
    url: "http://127.0.0.1:4173",
    reuseExistingServer: !process.env.CI,
  },
});
