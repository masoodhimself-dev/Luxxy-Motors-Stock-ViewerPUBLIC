import { defineConfig } from "@playwright/test";

/** Pure renderer QA: no app server, account, database or email provider. */
export default defineConfig({
  testDir: "./tests",
  testMatch: "email-layout.spec.ts",
  outputDir: "./output/email-layout",
  workers: 1,
  reporter: "line",
  use: {
    browserName: "chromium",
    launchOptions: {
      executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
    },
  },
});
