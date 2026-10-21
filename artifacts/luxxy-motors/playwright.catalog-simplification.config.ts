import { defineConfig } from '@playwright/test';

const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;

export default defineConfig({
  testDir: './tests',
  testMatch: 'catalog-simplification.spec.ts',
  fullyParallel: true,
  workers: 2,
  reporter: 'line',
  use: {
    baseURL: process.env.CATALOG_TEST_BASE_URL || 'http://127.0.0.1:4200',
    reducedMotion: 'reduce',
    serviceWorkers: 'block',
    launchOptions: executablePath ? {executablePath} : undefined,
  },
});
