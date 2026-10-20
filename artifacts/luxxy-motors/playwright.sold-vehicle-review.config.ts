import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests', testMatch: 'sold-vehicle-review.spec.ts', outputDir: '/tmp/luxxy-sold-vehicle-review-browser', workers: 1, reporter: 'line',
  use: { baseURL: 'http://127.0.0.1:4198', launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' } },
  webServer: { command: 'PORT=4198 SOLD_FOLLOW_UP_PREVIEW=true pnpm dev:preview', url: 'http://127.0.0.1:4198', reuseExistingServer: true },
});
