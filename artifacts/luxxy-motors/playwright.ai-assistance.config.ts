import {defineConfig} from '@playwright/test';
import responsive from './playwright.portal-cars.config';
export default defineConfig({...responsive,testMatch:'ai-assistance.spec.ts',use:{...responsive.use,baseURL:'http://127.0.0.1:4286'},timeout:90000});
