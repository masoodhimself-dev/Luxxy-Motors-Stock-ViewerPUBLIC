import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  testDir: "./tests",
  testMatch: ["mot-mileage-form.spec.ts"],
  workers: 1,
  fullyParallel: false,
  reporter: "line",
  timeout: 60000,
  use: { baseURL: "http://127.0.0.1:4282", locale: "en-GB" },
  projects: [
    { name: "iPhone", use: { ...devices["iPhone 13"], browserName: "webkit" } },
    { name: "iPad", use: { ...devices["iPad Pro 11"], browserName: "webkit" } },
    {
      name: "Desktop",
      use: { browserName: "webkit", viewport: { width: 1440, height: 1000 } },
    },
  ],
  webServer: {
    command: "PORT=4282 BASE_PATH=/ pnpm run dev:preview",
    url: "http://127.0.0.1:4282",
    reuseExistingServer: true,
  },
});
