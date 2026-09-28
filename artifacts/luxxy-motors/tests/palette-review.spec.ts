import { test, expect } from '@playwright/test';
for (const width of [390,1280]) test(`shared palette pages ${width}`, async ({page}) => {
 await page.setViewportSize({width,height:900});
 for (const path of ['/', '/stock','/vehicle/preview-2','/saved','/contact','/warranty','/enquire?type=viewing&vehicleId=preview-2','/portal/sales-demo']) {
  await page.goto(path);
  await expect(page.locator('h1').first()).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:`/tmp/palette-${width}-${path.split('?')[0].replaceAll('/','_') || 'home'}.png`});
 }
});
