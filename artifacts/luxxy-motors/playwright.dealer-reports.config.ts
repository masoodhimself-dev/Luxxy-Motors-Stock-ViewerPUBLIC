import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  testMatch: 'dealer-reports-responsive.spec.ts',
  workers: 1,
  reporter: 'line',
  use: { baseURL: 'http://127.0.0.1:4289', launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' } },
  webServer: { command: 'PORT=4289 BASE_PATH=/ pnpm run dev:preview', url: 'http://127.0.0.1:4289', reuseExistingServer: false, timeout: 60000 },
});
