import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests",
  testMatch: ["mot-history.spec.ts"],
  workers: 1,
  reporter: "line",
  timeout: 90000,
  expect: { timeout: 15000 },
  use: {
    baseURL: "http://127.0.0.1:4279",
    launchOptions: {
      executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
    },
  },
  webServer: {
    command: "PORT=4279 BASE_PATH=/ pnpm run dev:preview",
    url: "http://127.0.0.1:4279",
    reuseExistingServer: true,
  },
});
