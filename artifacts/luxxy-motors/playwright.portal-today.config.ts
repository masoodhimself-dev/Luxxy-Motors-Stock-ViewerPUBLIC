import { defineConfig } from '@playwright/test';

const baseURL = 'http://127.0.0.1:4328';

export default defineConfig({
  testDir: './tests',
  testMatch: 'portal-today.spec.ts',
  workers: 1,
  reporter: 'line',
  timeout: 60_000,
  use: { baseURL, browserName: 'webkit', locale: 'en-GB', reducedMotion: 'reduce' },
  projects: [
    { name: 'phone-390', use: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } },
    { name: 'tablet-820', use: { viewport: { width: 820, height: 1180 }, hasTouch: true } },
    { name: 'desktop-1440', use: { viewport: { width: 1440, height: 900 } } },
  ],
  webServer: {
    command: 'pnpm exec vite --config vite.preview.config.ts --port 4328 --strictPort',
    url: baseURL,
    reuseExistingServer: false,
  },
});
