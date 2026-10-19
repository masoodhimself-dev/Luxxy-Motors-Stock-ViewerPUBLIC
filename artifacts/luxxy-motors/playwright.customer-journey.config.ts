import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  testMatch: 'customer-journey-polish.spec.ts',
  outputDir: './output/customer-journey-polish',
  workers: 1,
  reporter: 'line',
  use: {
    baseURL: 'http://127.0.0.1:4192',
    launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH },
  },
  webServer: {
    command: 'PORT=4192 BASE_PATH=/ pnpm run dev:preview',
    url: 'http://127.0.0.1:4192/',
    reuseExistingServer: !process.env.CI,
  },
});
