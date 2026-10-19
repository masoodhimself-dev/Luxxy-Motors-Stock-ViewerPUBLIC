import { defineConfig } from '@playwright/test';

const port = 4189;

/** Read-only UI regressions against the fixture-backed React application. */
export default defineConfig({
  testDir: './tests',
  testMatch: 'portal-responsive-audit.spec.ts',
  outputDir: './output/portal-responsive-audit',
  workers: 1,
  reporter: 'line',
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH },
  },
  webServer: {
    command: `PORT=${port} BASE_PATH=/ pnpm run dev:preview`,
    url: `http://127.0.0.1:${port}/portal`,
    reuseExistingServer: !process.env.CI,
  },
});
