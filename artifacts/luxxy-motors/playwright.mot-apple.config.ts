import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  testDir: "./tests",
  testMatch: ["mot-apple-device.spec.ts"],
  workers: 1,
  fullyParallel: false,
  reporter: "line",
  timeout: 90000,
  expect: { timeout: 15000 },
  use: {
    baseURL: "http://127.0.0.1:4279",
    locale: "en-GB",
    timezoneId: "Europe/London",
  },
  projects: [
    {
      name: "iPhone Safari",
      use: { ...devices["iPhone 13"], browserName: "webkit" },
    },
    {
      name: "iPad Safari",
      use: { ...devices["iPad Pro 11"], browserName: "webkit" },
    },
  ],
  webServer: {
    command: "PORT=4279 BASE_PATH=/ pnpm run dev:preview",
    url: "http://127.0.0.1:4279",
    reuseExistingServer: true,
  },
});
