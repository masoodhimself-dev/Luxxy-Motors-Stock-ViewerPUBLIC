import { test, expect } from '@playwright/test';
test.skip(process.env.LUXXY_LOCAL_PREVIEW !== '1', 'Local preview only');
for (const width of [390, 820, 1440]) test(`fact icons and supplied highlights at ${width}`, async ({ page, request }) => {
 await page.setViewportSize({ width, height: 950 });
 const stock = await (await request.get('/api/stock')).json();
 const car = { ...stock.cars[0], owners: 2, sourceExtras: { ...stock.cars[0].sourceExtras, historyExtras: null, vehicleHighlights: [], runningCosts: { items: [{ label: 'Tax per year', value: '£20' }] } } };
 await page.route('**/api/stock', route => route.fulfill({ json: { ...stock, cars: [car], count: 1 } }));
 await page.goto('/stock');
 const card = page.locator('.vehicle-card').first();
 await expect(card.getByText('2 previous keepers')).toBeVisible();
 await expect(card.getByText('£20 annual tax')).toBeVisible();
 await expect(card.locator('.vehicle-specs svg')).toHaveCount(4);
 for (const icon of await card.locator('.vehicle-specs svg').all()) await expect(icon).toBeVisible();
 await card.screenshot({ path: `/tmp/fact-card-${width}.png`, animations: 'disabled' });
 await page.goto(`/vehicle/${car.id}`);
 await expect(page.locator('.vehicle-summary').getByText('2 previous keepers')).toBeVisible();
 expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
 await page.locator('.vehicle-summary').screenshot({ path: `/tmp/fact-summary-${width}.png`, animations: 'disabled' });
});
