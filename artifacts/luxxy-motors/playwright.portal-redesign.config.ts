import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir:'./tests', testMatch:'portal-redesign.spec.ts', workers:1, reporter:'line', timeout:90_000,
  use:{baseURL:'http://127.0.0.1:4276',launchOptions:{executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH}},
  webServer:{command:'PORT=4276 BASE_PATH=/ pnpm run dev:preview',url:'http://127.0.0.1:4276',reuseExistingServer:false},
});
