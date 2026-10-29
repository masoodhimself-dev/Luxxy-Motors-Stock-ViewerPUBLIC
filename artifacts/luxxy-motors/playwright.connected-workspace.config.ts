import { defineConfig } from "@playwright/test";
import cars from "./playwright.portal-cars.config";
export default defineConfig({
  ...cars,
  testMatch: "connected-workspace.spec.ts",
  timeout: 90_000,
});
