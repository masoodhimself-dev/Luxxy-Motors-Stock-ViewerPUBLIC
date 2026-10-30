import { defineConfig } from '@playwright/test';
import cars from './playwright.portal-cars.config';
export default defineConfig({...cars, testMatch: 'service-photos.spec.ts'});
