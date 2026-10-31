import { defineConfig } from '@playwright/test';

const baseURL = process.env.BASE_URL || 'http://127.0.0.1:4285';
if (!/^http:\/\/127\.0\.0\.1:\d+\/?$/.test(baseURL)) throw new Error('Public-sheet fixtures require a local loopback preview.');
const port = new URL(baseURL).port;

export default defineConfig({
  testDir: './tests', testMatch: 'vehicle-sheet-public.spec.ts',
  workers: 1, fullyParallel: false, maxFailures: 1,
  timeout: 90_000, expect: { timeout: 15_000 },
  reporter: [['line'], ['json', { outputFile: process.env.LUXXY_SHEET_REPORT || '/tmp/luxxy-vehicle-sheet-public-results.json' }]],
  outputDir: '/tmp/luxxy-vehicle-sheet-public-artifacts',
  use: { baseURL, locale: 'en-GB', reducedMotion: 'reduce', actionTimeout: 15_000, screenshot: 'off', trace: 'off' },
  projects: [
    { name: 'webkit-responsive', use: { browserName: 'webkit' }, grepInvert: /@pdf/ },
    { name: 'chromium-pdf', use: { browserName: 'chromium', channel: 'chrome' }, grep: /@pdf/ },
    { name: 'webkit-pdf', use: { browserName: 'webkit' }, grep: /autotrader @pdf/ },
  ],
  webServer: { command: `BASE_PATH=/ '${process.execPath.replace(/'/g, "'\\''")}' node_modules/vite/bin/vite.js --config vite.preview.config.ts --host 127.0.0.1 --port ${port}`, url: baseURL, reuseExistingServer: true },
});
