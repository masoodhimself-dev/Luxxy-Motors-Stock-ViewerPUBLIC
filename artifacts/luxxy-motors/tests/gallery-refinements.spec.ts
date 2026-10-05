import { test, expect } from '@playwright/test';
for (const width of [390, 1280]) {
 test(`stock framing and gallery strip at ${width}`, async ({ page, request }) => {
  await page.setViewportSize({width, height:900});
  await page.emulateMedia({reducedMotion:'reduce'});
  const stock = await (await request.get('/api/stock')).json();
  await page.goto('/stock');
  await expect(page.locator('.vehicle-card img').first()).toHaveCSS('object-fit','contain');
  await page.goto(`/vehicle/${stock.cars[0].id}`);
  const strip=page.locator('.vehicle-thumbnail-grid');
  await expect(strip).toBeVisible();
  const boxes=await strip.locator('button').evaluateAll(items=>items.map(item=>item.getBoundingClientRect().top));
  expect(new Set(boxes).size).toBe(1);
  await expect(page.getByLabel('Photograph sections',{exact:true})).toHaveCount(0);
  const firstThumbnail = strip.locator('button').first();
  await firstThumbnail.focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByText(`2 / ${stock.cars[0].imageCount} photographs`,{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'View gallery fullscreen'}).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByRole('dialog').getByLabel('Photograph sections',{exact:true})).toHaveCount(0);
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('dialog')).toContainText(`3 / ${stock.cars[0].imageCount}`);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).not.toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  await page.screenshot({path:`/tmp/gallery-refined-${width}.png`});
 });
}
