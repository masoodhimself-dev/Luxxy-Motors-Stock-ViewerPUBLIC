import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.route('**/api/**', route => ['GET', 'HEAD'].includes(route.request().method()) ? route.continue() : route.fulfill({ status: 403, json: { error: 'Test blocked this write.' } }));
});

for (const width of [375, 820]) {
  test(`selected vehicle stays identifiable through booking at ${width}px`, async ({ page, request }) => {
    await page.setViewportSize({ width, height: width < 640 ? 812 : 1180 });
    const stock = await (await request.get('/api/stock')).json();
    const car = stock.cars[0];
    await page.route('**/api/enquiries', route => route.abort());
    await page.goto(`/enquire?type=viewing&vehicleId=${car.id}`);
    const selection = page.getByTestId('card-enquiry-vehicle');
    await expect(selection).toBeVisible();
    await expect(selection.locator('img')).toBeVisible();
    await expect(selection).toContainText(String(car.year));
    await expect(selection).toContainText(car.transmission);
    await expect(selection).toContainText(new Intl.NumberFormat('en-GB', { style: 'currency', currency: car.currency ?? 'GBP', maximumFractionDigits: 0 }).format(car.price));
    await expect(selection.getByRole('button', { name: 'Change car' })).toBeVisible();
    await page.getByTestId('group-viewing-slots').getByRole('button').first().click();
    await page.getByTestId('button-continue-to-details').click();
    await expect(page.getByTestId('input-customer-name')).toBeVisible();
    await expect(selection).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    await selection.screenshot({ path: `/tmp/booking-selected-car-${width}.png` });
  });
}

test('unavailable selected-car photo disappears and short desktop sidebar scrolls normally', async ({ page, request }) => {
  const stock = await (await request.get('/api/stock')).json();
  const car = stock.cars[0];
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route('**/*', route => route.request().resourceType() === 'image' ? route.abort() : route.continue());
  await page.goto(`/enquire?type=viewing&vehicleId=${car.id}`);
  const selection = page.getByTestId('card-enquiry-vehicle');
  await expect(selection).toBeVisible();
  await expect(selection.locator('img')).toHaveCount(0);
  await expect(selection).toContainText(car.transmission);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.setViewportSize({ width: 1024, height: 768 });
  await expect(selection).toHaveCSS('position', 'static');
});
