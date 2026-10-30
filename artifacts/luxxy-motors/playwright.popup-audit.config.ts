import { defineConfig } from '@playwright/test';
import responsive from './playwright.portal-cars.config';
export default defineConfig({...responsive, testMatch: 'popup-audit.spec.ts', timeout: 120000});
