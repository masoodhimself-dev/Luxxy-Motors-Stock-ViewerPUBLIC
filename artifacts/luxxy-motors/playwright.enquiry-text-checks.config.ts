import { defineConfig } from "@playwright/test";
import base from "./playwright.portal-cars.config";
export default defineConfig({ ...base, testMatch: "enquiry-text-checks.spec.ts" });
