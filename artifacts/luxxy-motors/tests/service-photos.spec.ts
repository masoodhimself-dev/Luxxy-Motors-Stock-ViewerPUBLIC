import { test, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
test('Multi-Choice homepage photography fits and remains dealer scoped', async ({page}, info) => {
 let multi = true;
 await page.route('**/api/dealer-settings', async route => {
   const response = await route.fetch();
   const settings = await response.json();
   await route.fulfill({json: {...settings, identity: {...settings.identity, name: multi ? 'Multi Choice Motors' : 'Shore Drive Limited'}, presentation: {...settings.presentation, servicesEnabled: true, visitEnabled: true}, delivery: {...settings.delivery, enabled: true}, partExchange: {...settings.partExchange, enabled: true}}});
 });
 await page.goto('/');
 const delivery = page.getByAltText('Vehicle delivery to a UK home');
 await expect(delivery).toBeVisible();
 for (const alt of ['Vehicle delivery to a UK home','A customer handing over car keys for part exchange','A customer discussing a car with an adviser']) {
  const image = page.getByAltText(alt);
  await image.scrollIntoViewIfNeeded();
  await expect.poll(() => image.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0)).toBe(true);
  const box = await image.boundingBox();
  expect(box!.width).toBeLessThanOrEqual(page.viewportSize()!.width);
  if (page.viewportSize()!.width <= 640) expect(box!.height).toBeLessThanOrEqual(190);
  else expect(box!.width / box!.height).toBeCloseTo(1.5, 1);
 }
 await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(page.viewportSize()!.width);
 await page.locator('#part-exchange').scrollIntoViewIfNeeded();
 const out = path.resolve('../../../multi-choice-service-images');
 await mkdir(out,{recursive:true});
 await page.screenshot({path: path.join(out,`homepage-${info.project.name}.png`)});
 multi = false;
 await page.reload();
 await expect(page.getByAltText('Vehicle delivery to a UK home')).toHaveCount(0);
});
