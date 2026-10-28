import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  testDir: "./tests",
  testMatch: ["stock-refinement.spec.ts"],
  workers: 1,
  fullyParallel: false,
  maxFailures: 1,
  reporter: "line",
  timeout: 60000,
  use: { baseURL: "http://127.0.0.1:4283", locale: "en-GB" },
  projects: [
    {
      name: "Small phone",
      use: {
        ...devices["iPhone 13"],
        browserName: "webkit",
        viewport: { width: 320, height: 740 },
      },
    },
    { name: "iPhone", use: { ...devices["iPhone 13"], browserName: "webkit" } },
    { name: "iPad", use: { ...devices["iPad Pro 11"], browserName: "webkit" } },
    {
      name: "Desktop",
      use: { browserName: "webkit", viewport: { width: 1440, height: 1000 } },
    },
  ],
  webServer: {
    command: "PORT=4283 BASE_PATH=/ pnpm run dev:preview",
    url: "http://127.0.0.1:4283",
    reuseExistingServer: true,
  },
});
