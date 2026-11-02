import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  testMatch: 'inbox-rebuild.spec.ts',
  workers: 1,
  fullyParallel: false,
  reporter: 'line',
  timeout: 60_000,
  use: { baseURL: 'http://127.0.0.1:4294', browserName: 'webkit', locale: 'en-GB', reducedMotion: 'reduce' },
  projects: [
    { name: 'phone-375', use: { viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true } },
    { name: 'phone-390', use: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } },
    { name: 'iPad-820', use: { viewport: { width: 820, height: 1180 }, hasTouch: true } },
    { name: 'desktop-1440', use: { viewport: { width: 1440, height: 1000 } } },
  ],
  webServer: {
    command: '/Users/masoodhaqdad/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node node_modules/vite/bin/vite.js --config vite.preview.config.ts --port 4294',
    url: 'http://127.0.0.1:4294', reuseExistingServer: true,
  },
});
