import { defineConfig } from "@playwright/test";
import responsive from "./playwright.portal-cars.config";

export default defineConfig({
  ...responsive,
  testMatch: "vehicle-check-placement.spec.ts",
});
