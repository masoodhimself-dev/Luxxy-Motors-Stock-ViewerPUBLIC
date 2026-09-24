import { defineConfig, devices } from '@playwright/test';

const port = 4175;
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  retries: process.env.CI ? 2 : 0,
  reporter: 'line',
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    ...devices['Desktop Chrome'],
    launchOptions: executablePath ? { executablePath } : undefined,
  },
  webServer: {
    command: `PORT=${port} BASE_PATH=/ pnpm run ${process.env.LUXXY_LOCAL_PREVIEW === '1' ? 'dev:preview' : 'dev'}`,
    url: `http://127.0.0.1:${port}`,
    reuseExistingServer: !process.env.CI,
  },
});