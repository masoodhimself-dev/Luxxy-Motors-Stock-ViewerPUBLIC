import { defineConfig } from '@playwright/test';
export default defineConfig({testDir:'./tests',testMatch:'test-workspace-responsive.spec.ts',workers:1,reporter:'line',use:{baseURL:'http://127.0.0.1:4290',launchOptions:{executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'}}});
