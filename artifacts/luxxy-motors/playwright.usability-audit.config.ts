import { defineConfig } from '@playwright/test';

// A dedicated port prevents another regression run from stopping this preview.
const port = 4207;
export default defineConfig({
  testDir: './tests',
  testMatch: ['full-usability-audit.spec.ts', 'simpler-inbox.spec.ts', 'sale-review-reminder.spec.ts', 'booking-responsive.spec.ts', 'customer-edge-consistency.spec.ts'],
  workers: 1,
  reporter: 'line',
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH },
  },
  webServer: {
    command: `PORT=${port} BASE_PATH=/ pnpm run dev:preview`,
    url: `http://127.0.0.1:${port}`,
    reuseExistingServer: false,
  },
});
