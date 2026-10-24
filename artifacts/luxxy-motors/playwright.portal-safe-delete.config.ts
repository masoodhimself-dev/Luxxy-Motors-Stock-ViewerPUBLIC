import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests', testMatch: 'portal-safe-delete.spec.ts', workers: 1, reporter: 'line',
  use: { baseURL: 'http://127.0.0.1:4212', launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } },
  webServer: { command: 'PORT=4212 BASE_PATH=/ pnpm run dev:preview', url: 'http://127.0.0.1:4212', reuseExistingServer: true },
});
