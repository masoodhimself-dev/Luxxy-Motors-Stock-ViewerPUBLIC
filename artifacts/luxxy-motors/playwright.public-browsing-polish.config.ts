import { defineConfig } from "@playwright/test";
import responsive from "./playwright.portal-cars.config";
export default defineConfig({ ...responsive, testMatch: "public-browsing-polish.spec.ts" });
