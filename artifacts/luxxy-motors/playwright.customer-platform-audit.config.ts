import { defineConfig } from '@playwright/test';

const port = 4192;

export default defineConfig({
  testDir: './tests',
  testMatch: 'customer-platform-responsive-audit.spec.ts',
  outputDir: './output/customer-platform-responsive-audit',
  workers: 1,
  reporter: 'line',
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH },
  },
  webServer: {
    command: `PORT=${port} BASE_PATH=/ pnpm run dev:preview`,
    url: `http://127.0.0.1:${port}/`,
    reuseExistingServer: !process.env.CI,
  },
});
