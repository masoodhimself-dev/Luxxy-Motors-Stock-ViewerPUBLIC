import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests', testMatch: 'practice-retirement.spec.ts', workers: 1,
  reporter: 'line', timeout: 60_000,
  use: { baseURL: 'http://127.0.0.1:4271', launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } },
  webServer: { command: 'PORT=4271 BASE_PATH=/ pnpm run dev:preview', url: 'http://127.0.0.1:4271', reuseExistingServer: false },
});
