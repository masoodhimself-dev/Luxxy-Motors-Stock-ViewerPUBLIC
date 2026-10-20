import { defineConfig } from '@playwright/test';

/** Actual sales screens with intercepted, fictional sale mutations only. */
export default defineConfig({
  testDir: './tests', testMatch: 'sale-checklists.spec.ts',
  outputDir: '/tmp/luxxy-sale-checklists-browser', workers: 1, reporter: 'line',
  use: {
    baseURL: 'http://127.0.0.1:4198',
    launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' },
  },
  webServer: { command: 'PORT=4198 SOLD_FOLLOW_UP_PREVIEW=true pnpm dev:preview', url: 'http://127.0.0.1:4198', reuseExistingServer: true },
});
