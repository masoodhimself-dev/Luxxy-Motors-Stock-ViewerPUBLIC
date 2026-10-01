import { mkdir } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';

test.skip(process.env.LUXXY_LOCAL_PREVIEW !== '1', 'Read-only local audit with intercepted submissions.');
const output = '/tmp/luxxy-customer-audit';

test.beforeEach(async ({ page }) => {
  await page.route('**/api/**', route => ['GET', 'HEAD'].includes(route.request().method())
    ? route.continue() : route.fulfill({ status: 403, json: { error: 'Audit blocked this write.' } }));
  await page.addInitScript(() => { window.open = () => null; });
});

async function fits(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(await page.evaluate(() => innerWidth));
}

async function capture(page: Page, filename: string) {
  if (process.env.LUXXY_CAPTURE_AUDIT !== '1') return;
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
  await page.screenshot({ path: `${output}/${filename}.png`, fullPage: true });
}

for (const width of [390, 820, 1440]) {
  test(`customer information and booking pages at ${width}px`, async ({ page, request }) => {
    await page.setViewportSize({ width, height: 900 });
    const stock = await (await request.get('/api/stock')).json();
    const vehicle = stock.cars.find((car: any) => car.inventoryStatus === 'available') ?? stock.cars[0];
    await mkdir(output, { recursive: true });
    for (const [name, path] of [
      ['contact', '/contact'], ['warranty', '/warranty'], ['general', '/enquire'],
      ['delivery', '/enquire?type=delivery'], ['warranty-question', '/enquire?type=warranty'],
      ['part-exchange', `/enquire?type=part_exchange&vehicleId=${vehicle.id}`],
      ['choose-car', '/enquire?type=viewing'], ['test-drive', `/enquire?type=viewing&vehicleId=${vehicle.id}`],
      ['manage-booking', '/viewing/sample'], ['retired-sign', '/sign/sample'], ['retired-details', '/customer-details/sample'],
    ]) {
      await page.goto(path);
      await expect(page.locator('#main-content h1').first()).toBeVisible();
      await fits(page);
      await capture(page, `${name}-${width}`);
    }
    await page.goto('/enquire?type=viewing');
    await expect(page.getByRole('button', { name: 'Select a car to continue' })).toBeDisabled();
    await page.locator('input[name="viewing-vehicle"]').first().check();
    await page.getByRole('link', { name: 'Choose date and time' }).click();
    await expect(page).toHaveURL(/type=viewing&vehicleId=/);
    await page.getByTestId('group-viewing-slots').getByRole('button').first().click();
    await page.getByTestId('button-continue-to-details').click();
    await expect(page.getByTestId('input-customer-name')).toBeFocused();
    await page.getByTestId('input-customer-name').fill('Audit Customer');
    await page.getByTestId('input-customer-email').fill('audit@example.com');
    await page.getByTestId('input-customer-phone').fill('07700 900123');
    let submission: any;
    await page.route('**/api/enquiries', async route => {
      submission = route.request().postDataJSON();
      await route.fulfill({ json: { reference: 'AUDIT-BOOKING', customerNotificationStatus: 'sent', managePath: '/viewing/sample' } });
    });
    await page.getByTestId('button-submit-enquiry').click();
    await expect(page.getByTestId('status-enquiry-success')).toBeVisible();
    await expect(page.getByTestId('status-enquiry-success').getByRole('heading')).toBeFocused();
    expect(submission).toMatchObject({ type: 'viewing', customerName: 'Audit Customer', phone: '07700900123' });
    expect(submission.vehicleId).toBeTruthy();
    await fits(page);
  });
}

test('reservation can be reviewed and retried on the HTTP local network', async ({ page, request }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const stock = await (await request.get('/api/stock')).json();
  const vehicle = stock.cars.find((car: any) => car.inventoryStatus === 'available') ?? stock.cars[0];
  const settings = await (await request.get('/api/dealer-settings')).json();
  settings.onlineReservation = { enabled: true, depositPence: 10000, terms: 'Audit reservation terms.' };
  await page.route('**/api/dealer-settings', route => route.fulfill({ json: settings }));
  // HTTP LAN browsers expose getRandomValues, but not secure-context randomUUID.
  await page.addInitScript(() => Object.defineProperty(crypto, 'randomUUID', { value: undefined, configurable: true }));
  const submissions: any[] = [];
  await page.route('**/api/reservations', async route => {
    submissions.push(route.request().postDataJSON());
    await route.fulfill(submissions.length === 1 ? { status: 503, json: { error: 'Please try again.' } } : { json: { reference: 'AUDIT-RESERVATION', status: 'reserved', depositPence: 10000 } });
  });
  await page.goto(`/enquire?type=general&vehicleId=${vehicle.id}`);
  await page.getByRole('button', { name: 'Or reserve this car', exact: true }).click();
  const reserve = page.getByRole('button', { name: 'Reserve car online', exact: true });
  await reserve.click();
  const dialog = page.getByTestId('reserve-car-dialog');
  await expect(dialog).toBeVisible();
  await dialog.getByLabel('Your name').fill('Audit Customer');
  await dialog.getByLabel('Email address').fill('audit@example.com');
  await dialog.getByLabel('Phone number').fill('07700 900123');
  await dialog.getByRole('button', { name: /Continue/ }).click();
  await expect(dialog.getByRole('heading', { name: 'Review your reservation' })).toBeFocused();
  await dialog.getByRole('checkbox').check();
  const confirm = dialog.getByRole('button', { name: 'Confirm reservation · simulate payment' });
  await confirm.click();
  await expect(dialog.getByRole('alert')).toContainText('Please try again');
  await confirm.click();
  await expect(dialog.getByTestId('reservation-success')).toBeVisible();
  expect(submissions).toHaveLength(2);
  expect(submissions[0].idempotencyKey).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  expect(submissions[1].idempotencyKey).toBe(submissions[0].idempotencyKey);
  await fits(page);
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();
  await expect(page.getByRole('button', { name: 'View reservation', exact: true })).toBeFocused();
});

for (const width of [390, 820, 1440]) {
  test(`part exchange preserves the car and validates before WhatsApp at ${width}px`, async ({ page, request }) => {
    await page.setViewportSize({ width, height: 900 });
    const stock = await (await request.get('/api/stock')).json();
    const vehicle = stock.cars[0];
    await page.addInitScript(() => { window.open = (url) => { (window as any).auditWhatsApp = String(url); return null; }; });
    await page.goto(`/enquire?type=part_exchange&vehicleId=${vehicle.id}`);
    const next = page.getByTestId('button-part-exchange-continue');
    await next.click();
    await expect(page.getByTestId('input-part-exchange-registration')).toBeFocused();
    await page.getByTestId('input-part-exchange-registration').fill('AB12 CDE');
    await page.getByTestId('input-part-exchange-model').fill('Volkswagen Golf');
    await page.getByTestId('input-part-exchange-mileage').fill('42000');
    await next.click();
    await page.getByTestId('select-part-exchange-condition').selectOption({ label: 'Good — normal wear for its age' });
    await page.getByTestId('select-part-exchange-keys').selectOption('2 keys');
    await page.getByTestId('select-part-exchange-v5').selectOption('Yes');
    await page.getByTestId('select-part-exchange-history').selectOption('Full history');
    await next.click();
    await expect(page.getByTestId('select-part-exchange-target-vehicle')).toHaveValue(vehicle.id);
    await expect(page.getByTestId('card-part-exchange-target-vehicle')).toBeVisible();
    await next.click();
    await page.getByRole('radio', { name: /Send everything on WhatsApp/ }).check();
    await page.getByTestId('input-customer-name').fill('Audit Buyer');
    await page.getByTestId('input-customer-phone').fill('07700 900123');
    await next.click();
    expect(await page.evaluate(() => (window as any).auditWhatsApp)).toBeUndefined();
    await page.getByRole('checkbox').check();
    await next.click();
    const handoff = new URL(await page.evaluate(() => (window as any).auditWhatsApp));
    expect(handoff.hostname).toBe('wa.me');
    const message = handoff.searchParams.get('text');
    for (const value of ['AB12 CDE', 'Volkswagen Golf', '42,000', vehicle.id, 'Audit Buyer', '07700 900123']) expect(message).toContain(value);
    await expect(page.getByRole('status').filter({ hasText: 'WhatsApp was requested' })).toBeVisible();
    await fits(page);
    await capture(page, `part-exchange-review-${width}`);
  });
}

test('contact enquiry recovers from a failure and announces successful completion', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  let attempts = 0;
  await page.route('**/api/enquiries', async route => {
    attempts++;
    await route.fulfill(attempts === 1 ? { status: 503, json: { error: 'Please try again.' } }
      : { json: { reference: 'AUDIT-CONTACT', customerNotificationStatus: 'sent' } });
  });
  await page.goto('/contact');
  await page.getByRole('link', { name: 'Send an enquiry online' }).click();
  await expect(page.locator('#contact-message-heading')).toBeFocused();
  await page.getByTestId('input-customer-name').fill('Audit Customer');
  await page.getByTestId('input-customer-email').fill('audit@example.com');
  await page.getByTestId('textarea-enquiry-message').fill('Can you tell me about visiting the showroom?');
  await page.getByTestId('button-submit-enquiry').click();
  await expect(page.getByTestId('status-enquiry-error')).toBeFocused();
  await expect(page.getByTestId('input-customer-name')).toHaveValue('Audit Customer');
  await page.getByTestId('button-submit-enquiry').click();
  await expect(page.getByTestId('status-enquiry-success').getByRole('heading')).toBeFocused();
  expect(attempts).toBe(2);
  await fits(page);
});

for (const width of [390, 820, 1440]) {
  test(`enabled warranty and booking management controls at ${width}px`, async ({ page, request }) => {
    await page.setViewportSize({ width, height: 900 });
    const stock = await (await request.get('/api/stock')).json();
    const vehicle = stock.cars[0];
    const settings = await (await request.get('/api/dealer-settings')).json();
    settings.warranty = { ...settings.warranty, enabled: true };
    await page.route('**/api/dealer-settings', route => route.fulfill({ json: settings }));
    await page.goto(`/warranty?vehicleId=${vehicle.id}`);
    await expect(page.getByTestId('warranty-enquiry-link')).toHaveAttribute('href', `/enquire?type=warranty&vehicleId=${vehicle.id}`);
    await page.getByRole('button', { name: 'What does the warranty cover?' }).click();
    await expect(page.getByText('Ask for the policy wording', { exact: false })).toBeVisible();
    await fits(page);
    await capture(page, `warranty-enabled-${width}`);
    await page.goto('/viewing/sample');
    await page.getByTestId('button-viewing-reschedule').click();
    await expect(page.getByTestId('button-confirm-reschedule')).toBeDisabled();
    await page.getByTestId('group-viewing-slots').getByRole('button').first().click();
    await expect(page.getByTestId('button-confirm-reschedule')).toBeEnabled();
    await fits(page);
    await capture(page, `booking-reschedule-${width}`);
    await page.getByTestId('button-cancel-reschedule').click();
    await page.getByTestId('button-viewing-cancel').click();
    await expect(page.getByTestId('button-confirm-cancel')).toBeVisible();
    await page.getByTestId('button-abort-cancel').click();
    await expect(page.getByTestId('button-viewing-cancel')).toBeVisible();
  });
}

test('cancelled booking links directly back to stock and an expired link has recovery actions', async ({ page, request }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const booking = await (await request.get('/api/viewings/sample')).json();
  await page.route('**/api/viewings/sample', route => route.fulfill({ json: { ...booking, status: 'cancelled' } }));
  await page.goto('/viewing/sample');
  await expect(page.getByTestId('status-viewing-cancelled')).toHaveAttribute('role', 'status');
  await expect(page.getByRole('link', { name: 'Browse stock', exact: true })).toHaveAttribute('href', '/stock');
  await page.route('**/api/viewings/expired', route => route.fulfill({ status: 410, json: { error: 'This booking link has expired.' } }));
  await page.goto('/viewing/expired');
  await expect(page.getByRole('heading', { name: 'Cannot find booking' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Call us', exact: true })).toHaveAttribute('href', /^tel:/);
  await fits(page);
});
