import { defineConfig } from '@playwright/test';

/** Fictional, read-only fixtures against the local React preview. */
export default defineConfig({
  testDir: './tests',
  testMatch: 'enquiry-simplification.spec.ts',
  outputDir: './output/enquiry-simplification',
  workers: 1,
  reporter: 'line',
  use: {
    baseURL: 'http://127.0.0.1:4196',
    launchOptions: {
      executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ??
        '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    },
  },
  webServer: {
    command: 'PORT=4196 VEHICLE_DESCRIPTION_PREVIEW=true pnpm dev:preview',
    url: 'http://127.0.0.1:4196',
    reuseExistingServer: true,
  },
});
