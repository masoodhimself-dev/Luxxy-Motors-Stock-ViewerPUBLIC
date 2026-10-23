import { test, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';

test.skip(process.env.LUXXY_LOCAL_PREVIEW !== '1', 'Fixture-backed preview only.');
test.use({ reducedMotion: 'reduce', serviceWorkers: 'block' });
for (const width of [390, 834, 1440]) {
  for (const area of ['customer', 'staff']) {
    test(`${area} rendered page audit at ${width}px`, async ({ page, request }) => {
      test.setTimeout(120000);
      await page.setViewportSize({ width, height: 900 });
      const errors: string[] = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.route('**/api/**', route => ['GET', 'HEAD'].includes(route.request().method()) ? route.continue() : route.abort());
      const stock = await (await request.get('/api/stock')).json();
      const car = stock.cars.find((car: any) => car.inventoryStatus === 'available') || stock.cars[0];
      const paths = area === 'customer'
        ? ['/', '/stock', `/vehicle/${car.id}`, '/saved', '/compare', '/contact', '/warranty', '/enquire?type=general', `/enquire?type=viewing&vehicleId=${car.id}`, '/enquire?type=part_exchange', '/enquire?type=delivery', '/missing-audit-page', '/phone-share', '/staff-upload', '/enquiry-photo-upload', '/join']
        : ['notifications', 'notifications&workView=customers', 'notifications&workView=email', 'notifications&workView=test-drives', 'notifications&workView=test-drives&deskView=calendar', 'inventory', `inventory&vehicleId=${car.id}`, 'sales', 'reservations', 'history', 'settings', ...['dealership', 'website', 'bookings', 'emails', 'paperwork', 'sharing', 'team', 'integrations', 'search', 'history'].map(tab => `settings&settingsTab=${tab}`)].map(section => `/portal?section=${section}`);
      await mkdir('/tmp/luxxy-full-usability-audit', { recursive: true });
      for (const [index, path] of paths.entries()) {
        await page.goto(path);
        await expect(page.locator('h1').first(), path).toBeVisible();
        await expect(page.getByText('Loading page…', { exact: true })).toHaveCount(0);
        await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth), {message: path}).toBeLessThanOrEqual(width + 1);
        if (path.includes('workView=customers')) {
          const nav = page.getByRole('navigation', {name:'Notifications views'});
          await expect(nav.getByRole('button')).toHaveCount(3);
          for (const button of await nav.getByRole('button').all()) {
            expect(await button.evaluate(el => { const r=el.getBoundingClientRect(); return r.left>=0 && r.right<=innerWidth; })).toBe(true);
          }
        }
        await page.screenshot({ path: `/tmp/luxxy-full-usability-audit/${area}-${width}-${index}.png`, fullPage: true });
      }
      expect(errors).toEqual([]);
    });
  }
}

for (const width of [390, 834, 1440]) {
  test(`five-step sale review preserves the car and requires confirmation at ${width}px`, async ({ page, request }) => {
    await page.setViewportSize({ width, height: 900 });
    const writes: string[] = [];
    await page.route('**/api/**', route => ['GET', 'HEAD'].includes(route.request().method()) ? route.continue() : (writes.push(route.request().url()), route.abort()));
    const stock = await (await request.get('/api/stock')).json();
    const car = stock.cars.find((car: any) => car.inventoryStatus === 'available');
    expect(car).toBeTruthy();
    await page.goto('/portal?section=sales');
    await page.getByRole('button', { name: 'New invoice', exact: true }).click();
    await page.getByLabel('Vehicle', { exact: true }).selectOption(car.id);
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
    const selected = page.getByRole('complementary', { name: 'Selected car' });
    await expect(selected).toContainText(car.make);
    await expect(selected.getByRole('button', { name: 'Change car' })).toBeVisible();
    await page.getByRole('combobox', { name: 'Customer’s full name', exact: true }).fill('Fictional Audit Buyer');
    for (const heading of ['What has the customer paid?', 'Which invoice do you need?', 'Are these details correct?']) {
      await page.getByRole('button', { name: 'Continue', exact: true }).click();
      await expect(page.getByRole('heading', { name: heading, exact: true })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    }
    await expect(page.getByRole('button', { name: 'Create full invoice', exact: true })).toBeDisabled();
    await expect(page.getByRole('complementary', { name: 'Before completing the sale' }).getByRole('checkbox')).toHaveCount(0);
    await page.screenshot({ path: `/tmp/luxxy-full-usability-audit/sale-review-${width}.png`, fullPage: true });
    expect(writes).toEqual([]);
  });
}
