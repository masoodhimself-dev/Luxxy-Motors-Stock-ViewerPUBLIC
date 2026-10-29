import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  testMatch: "portal-cars.spec.ts",
  workers: 1,
  fullyParallel: false,
  maxFailures: 1,
  reporter: "line",
  timeout: 120_000,
  use: {
    baseURL: "http://127.0.0.1:4285",
    locale: "en-GB",
    reducedMotion: "reduce",
  },
  projects: [
    {
      name: "phone-320",
      use: {
        ...devices["iPhone 13"],
        browserName: "webkit",
        viewport: { width: 320, height: 740 },
      },
    },
    {
      name: "iPhone-390",
      use: {
        ...devices["iPhone 13"],
        browserName: "webkit",
        viewport: { width: 390, height: 844 },
      },
    },
    {
      name: "iPad-820",
      use: {
        ...devices["iPad Pro 11"],
        browserName: "webkit",
        viewport: { width: 820, height: 1180 },
      },
    },
    {
      name: "iPad-landscape-1194",
      use: {
        ...devices["iPad Pro 11"],
        browserName: "webkit",
        viewport: { width: 1194, height: 834 },
      },
    },
    {
      name: "desktop-1440",
      use: {
        browserName: "webkit",
        viewport: { width: 1440, height: 1000 },
        hasTouch: false,
      },
    },
  ],
  webServer: {
    command: "PORT=4285 BASE_PATH=/ pnpm run dev:preview",
    url: "http://127.0.0.1:4285",
    reuseExistingServer: true,
  },
});
