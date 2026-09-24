import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';

test.skip(process.env.LUXXY_LOCAL_PREVIEW !== '1', 'Read-only local preview and mocked submissions only.');
for (const width of [320, 390, 768, 1440]) {
  test(`non-sales pages and staff sections fit at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    const pageErrors: string[] = [];
    page.on('pageerror', error => pageErrors.push(error.message));
    for (const path of ['/', '/vehicle/preview-1', '/saved', '/compare',  '/enquire?type=general', '/enquire?type=delivery', '/enquire?type=warranty', '/enquire?type=viewing&vehicleId=preview-1', '/enquire?type=part_exchange', '/viewing/sample', '/missing']) {
      await page.goto(path);
      await expect(page.locator('#main-content h1')).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth), path).toBeLessThanOrEqual(width);
    }
    await page.goto('/portal');
    await expect(page.getByTestId('work-queue')).toBeVisible();
    for (const tab of ['today', 'leads', 'channels', 'settings']) {
      await page.getByTestId(`tab-${tab}`).click();
      if (tab === 'channels') await expect(page.getByTestId('channel-summary')).toBeVisible();
      if (tab === 'settings') await expect(page.getByTestId('input-identity-name')).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth), tab).toBeLessThanOrEqual(width);
    }
    await page.goto('/portal/leads/sample-lead-1');
    await expect(page.getByTestId('lead-detail')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    expect(pageErrors).toEqual([]);
    if (width === 390 || width === 1440) {
      const directory = resolve('../../docs/screenshots/non-sales-regression');
      await mkdir(directory, { recursive: true });
      for (const [name, url] of [['home', '/'], ['vehicle', '/vehicle/preview-1'], ['lead', '/portal/leads/sample-lead-1']]) {
        await page.goto(url);
        await expect(page.locator('#main-content h1')).toBeVisible();
        await page.evaluate(async () => {
          const images = Array.from(document.images);
          images.forEach(image => { image.loading = 'eager'; });
          await Promise.race([Promise.all(images.map(image => image.decode().catch(() => undefined))), new Promise(resolve => setTimeout(resolve, 5000))]);
          window.scrollTo({ top: 0, behavior: 'instant' });
        });
        await page.screenshot({ path: resolve(directory, `${name}-${width}.png`), fullPage: true });
      }
    }
  });
}

test('viewing cancellation reflects the latest response after rescheduling', async ({ page }) => {
  let booking = { reference: 'TEST-VIEWING', customerName: 'Test Customer', status: 'booked', appointmentAt: '2030-06-18T14:30:00.000Z', canChange: true, timezone: 'Europe/London', cancelledAt: null as string | null, vehicleTitle: 'Test car', vehicleUrl: '/vehicle/preview-1', calendarIcs: '' };
  await page.route('**/api/viewings/sample', route => route.fulfill({ json: booking }));
  await page.route('**/api/viewings/sample/reschedule', route => {
    booking = { ...booking, appointmentAt: route.request().postDataJSON().appointmentAt };
    return route.fulfill({ json: booking });
  });
  await page.route('**/api/viewings/sample/cancel', route => {
    booking = { ...booking, status: 'cancelled', canChange: false, cancelledAt: new Date().toISOString() };
    return route.fulfill({ json: booking });
  });
  await page.goto('/viewing/sample');
  await page.getByTestId('button-viewing-reschedule').click();
  await page.getByTestId('group-viewing-slots').getByRole('button').first().click();
  await page.getByTestId('button-confirm-reschedule').click();
  await expect(page.getByTestId('status-reschedule-success')).toBeVisible();
  await page.getByTestId('button-viewing-cancel').click();
  await page.getByTestId('button-confirm-cancel').click();
  await expect(page.getByRole('heading', { name: 'Viewing cancelled', exact: true })).toBeVisible();
  await expect(page.getByTestId('button-viewing-reschedule')).toHaveCount(0);
  await expect(page.getByTestId('button-confirm-cancel')).toHaveCount(0);
});

test('viewing lookup network failure offers retry and recovers', async ({ page }) => {
  let fails = true;
  await page.route('**/api/viewings/sample', async route => {
    if (fails) await route.fulfill({ status: 503, json: { error: 'Temporary outage' } });
    else await route.continue();
  });
  await page.goto('/viewing/sample');
  await expect(page.getByRole('heading', { name: 'Booking temporarily unavailable' })).toBeVisible();
  fails = false;
  await page.getByRole('button', { name: 'Try again' }).click();
  await expect(page.getByRole('heading', { name: 'Your viewing', exact: true })).toBeVisible();
});

for (const type of ['general', 'delivery', 'warranty']) {
  test(`${type} enquiry preserves details and recovers from submission failure`, async ({ page }) => {
    let attempt = 0;
    let payload: any;
    await page.route('**/api/enquiries', async route => {
      payload = route.request().postDataJSON();
      await route.fulfill(++attempt === 1 ? { status: 503, json: { error: 'Please try again' } } : { json: { reference: 'TEST-ENQ', customerNotificationStatus: 'sent' } });
    });
    await page.goto(`/enquire?type=${type}&vehicleId=preview-1`);
    await page.getByTestId('input-customer-name').fill('Test Customer');
    await page.getByTestId('input-customer-email').fill('test@example.com');
    await page.getByTestId('textarea-enquiry-message').fill('Please tell me more.');
    await page.getByTestId('button-submit-enquiry').click();
    await expect(page.getByTestId('status-enquiry-error')).toBeVisible();
    await expect(page.getByTestId('textarea-enquiry-message')).toHaveValue('Please tell me more.');
    await page.getByTestId('button-submit-enquiry').click();
    await expect(page.getByTestId('status-enquiry-success')).toBeVisible();
    expect(payload).toMatchObject({ type, vehicleId: 'preview-1', customerName: 'Test Customer', email: 'test@example.com', message: 'Please tell me more.' });
  });
}

test('booking navigation updates an already-open enquiry without losing contact details', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/enquire?type=general&vehicleId=preview-1');
  await page.getByTestId('input-customer-name').fill('Test Customer');
  await page.getByRole('navigation', { name: 'Primary navigation' }).getByRole('button', { name: 'Book a Viewing' }).click();
  await expect(page).toHaveURL(/enquire\?type=viewing$/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Book a viewing');
  await page.getByTestId('group-viewing-slots').getByRole('button').first().click();
  await page.getByTestId('button-continue-to-details').click();
  await expect(page.getByTestId('input-customer-name')).toHaveValue('Test Customer');
  await expect(page.getByTestId('card-enquiry-vehicle')).toHaveCount(0);
});
