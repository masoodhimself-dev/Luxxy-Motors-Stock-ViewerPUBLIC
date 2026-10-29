import { defineConfig } from "@playwright/test";
import devices from "./playwright.portal-cars.config";

export default defineConfig({
  ...devices,
  testMatch: "enquiry-deletion.spec.ts",
  timeout: 90_000,
});
