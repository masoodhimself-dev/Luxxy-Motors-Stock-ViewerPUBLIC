import { mkdir } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';

test.skip(process.env.LUXXY_LOCAL_PREVIEW !== '1', 'Local presentation audit with isolated API fixtures.');
const output = '/tmp/luxxy-customer-edge-consistency';
const token = 'a'.repeat(64);

async function fits(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(await page.evaluate(() => innerWidth));
  for (const action of await page.locator('#main-content button:visible, #main-content a:visible').all()) {
    const bounds = await action.boundingBox();
    if (bounds) expect(bounds.height).toBeGreaterThanOrEqual(43);
  }
}
async function screenshot(page: Page, name: string) {
  await mkdir(output, { recursive: true });
  await page.screenshot({ path: `${output}/${name}.png`, fullPage: true });
}

test.beforeEach(async ({ page }) => {
  await page.route('**/api/**', route => ['GET', 'HEAD'].includes(route.request().method()) ? route.continue()
    : route.fulfill({ status: 403, json: { error: 'This audit blocks real writes.' } }));
});

for (const width of [390, 1440]) {
  test(`404, withdrawn paperwork and expired private links have readable recovery at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/missing-customer-page');
    await expect(page.getByRole('heading', { name: 'Let’s get you back on track.' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Browse stock', exact: true }).first()).toHaveAttribute('href', '/stock');
    await expect(page).toHaveTitle(/Page not found/);
    await fits(page);
    await screenshot(page, `not-found-${width}`);
    for (const path of ['/sign/unavailable-fixture', '/customer-details/unavailable-fixture']) {
      await page.goto(path);
      await expect(page.getByRole('heading', { name: 'This link is no longer available' })).toBeVisible();
      await expect(page.getByRole('link', { name: 'Contact the dealership', exact: true })).toHaveAttribute('href', '/contact');
      await expect(page).toHaveTitle(/Purchase link unavailable/);
      await fits(page);
    }
    await screenshot(page, `retired-purchase-${width}`);
    await page.route('**/api/customer-sale/unavailable-fixture', route => route.fulfill({ status: 410, json: { error: 'internal-validation-code should not appear' } }));
    await page.goto('/my-purchase/unavailable-fixture');
    await expect(page.getByRole('heading', { name: 'This customer link is unavailable' })).toBeVisible();
    await expect(page.getByRole('alert')).toContainText('expired or been replaced');
    await expect(page.getByText('internal-validation-code should not appear')).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Contact the showroom', exact: true })).toHaveAttribute('href', '/contact');
    await fits(page);
    await screenshot(page, `expired-purchase-${width}`);
    await page.route('**/api/viewings/unavailable-fixture', route => route.fulfill({ status: 410, json: { error: 'Internal expired token debug' } }));
    await page.goto('/viewing/unavailable-fixture');
    await expect(page.getByRole('heading', { name: 'Cannot find booking' })).toBeVisible();
    await expect(page.getByTestId('status-viewing-error')).toContainText('expired or been replaced');
    await expect(page.getByText('Internal expired token debug')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Try again', exact: true })).toHaveCount(0);
    await expect(page).toHaveTitle(/Your test drive/);
    await fits(page);
    await screenshot(page, `expired-booking-${width}`);
  });

  test(`payment return distinguishes missing, confirmed, pending and refunded payments at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    let requests = 0;
    let payment = { reference: 'RSV-FIXTURE-' + '1234567890'.repeat(5), vehicleId: 'fixture', vehicleTitle: 'Example 2018 BMW 320i M Sport Touring', vehicleRegistration: 'AB18 XYZ', amountReceivedPence: 10000, depositPence: 10000, paymentStatus: 'confirmed', status: 'reserved', mode: 'live', needsReview: false };
    await page.route('**/api/reservations/payment-status', route => {
      requests++;
      return route.fulfill({ json: { reservation: payment } });
    });
    await page.goto('/reserve/payment-return?reference=RSV-FIXTURE');
    await expect(page.getByRole('heading', { name: 'Payment link unavailable' })).toBeVisible();
    await expect(page.getByRole('alert')).toContainText('incomplete');
    await expect(page.getByRole('status').filter({ hasText: 'Checking the confirmed payment status' })).toHaveCount(0);
    expect(requests).toBe(0);
    await fits(page);
    await screenshot(page, `incomplete-payment-${width}`);
    for (const [status, expected] of [['confirmed', 'Your car is reserved'], ['pending', 'Payment confirmation pending'], ['test_confirmed', 'Test payment completed'], ['refund_pending', 'Your refund update']]) {
      payment = { ...payment, paymentStatus: status, mode: status === 'test_confirmed' ? 'test' : 'live' };
      await page.goto(`/reserve/payment-return?reference=RSV-FIXTURE-${status}&token=${token}&paid=true`);
      await expect(page.getByRole('heading', { name: expected, exact: true })).toBeVisible();
      if (status !== 'confirmed') await expect(page.getByRole('heading', { name: 'Your car is reserved', exact: true })).toHaveCount(0);
      if (status === 'pending') await expect(page.getByRole('status')).toContainText('Please do not pay again');
      if (status === 'test_confirmed') await expect(page.getByRole('status')).toContainText('No real money');
      await fits(page);
    }
    await screenshot(page, `refund-payment-${width}`);
  });
}

test('temporary booking and private purchase errors can be retried without showing backend debug messages', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  for (const [api, path, heading] of [
    ['/api/viewings/temporary-fixture', '/viewing/temporary-fixture', 'Booking temporarily unavailable'],
    ['/api/customer-sale/temporary-fixture', '/my-purchase/temporary-fixture', 'Your purchase is temporarily unavailable'],
  ]) {
    let attempts = 0;
    await page.route(`**${api}`, route => { attempts++; return route.fulfill({ status: 503, json: { error: 'Backend deployment internal debug' } }); });
    await page.goto(path);
    await expect(page.getByRole('heading', { name: heading, exact: true })).toBeVisible();
    await expect(page.getByText('Backend deployment internal debug')).toHaveCount(0);
    const before = attempts;
    await page.getByRole('button', { name: 'Try again', exact: true }).click();
    await expect.poll(() => attempts).toBeGreaterThan(before);
    await fits(page);
  }
});

test('booking and purchase loading states have a real page heading and announce the check', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  for (const [api, path, heading] of [
    ['/api/viewings/slow-fixture', '/viewing/slow-fixture', 'Finding your booking…'],
    ['/api/customer-sale/slow-fixture', '/my-purchase/slow-fixture', 'Opening your purchase…'],
  ]) {
    let release = () => {};
    const waiting = new Promise<void>(resolve => { release = resolve; });
    await page.route(`**${api}`, async route => {
      await waiting;
      await route.fulfill({ status: 410, json: { error: 'Fixture unavailable' } });
    });
    await page.goto(path);
    await expect(page.getByRole('heading', { name: heading, level: 1, exact: true })).toBeVisible();
    await expect(page.locator('#main-content [role="status"][aria-busy="true"]')).toBeVisible();
    await fits(page);
    release();
    await expect(page.locator('#main-content [role="alert"]')).toBeVisible();
  }
});
