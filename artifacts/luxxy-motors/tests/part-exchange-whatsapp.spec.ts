import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';

test.skip(process.env.LUXXY_LOCAL_PREVIEW !== '1', 'Local stock preview only.');
test.beforeEach(async ({ page, request }) => {
  const response = await request.get('/api/stock');
  const stock = await response.json();
  expect(stock.cars.length, 'A schema-shaped stock record is needed for the isolated fixture').toBeGreaterThan(0);
  const image = new URL('/__part-exchange-test/car.svg', response.url()).href;
  const car = {
    ...stock.cars[0], id: 'preview-1', advertId: 'part-exchange-fixture-1',
    title: 'BMW 3 Series', make: 'BMW', model: '3 Series', variant: null, trim: null,
    year: 2018, price: 8995, currency: 'GBP', mileage: 64000, mileageText: null,
    plate: 'AB18 XYZ', vrm: 'AB18 XYZ', vrmVerified: false, registration: '2018', registrationBand: '18',
    inventoryStatus: 'available', sourceMissingAt: null, sourceExtras: null, specifications: null,
    heroImage: image, images: [{ url: image, caption: 'Fictional test vehicle' }], imageCount: 1,
  };
  await page.route('**/api/**', route => ['GET', 'HEAD'].includes(route.request().method()) ? route.continue()
    : route.fulfill({ status: 403, json: { error: 'Part-exchange audit blocked this write.' } }));
  await page.route('**/api/stock', route => route.fulfill({ json: { ...stock, count: 1, cars: [car] } }));
  await page.route('**/__part-exchange-test/car.svg', route => route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600"><rect width="800" height="600" fill="#dde4e9"/><path d="M100 380V300l130-100h330l130 100v80Z" fill="#30404b"/><circle cx="240" cy="380" r="50" fill="#172129"/><circle cx="570" cy="380" r="50" fill="#172129"/></svg>' }));
});

for (const width of [390, 1440]) {
  test(`part exchange validates, reviews and prepares WhatsApp at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    // Capture the external handoff without opening WhatsApp or sending anything.
    await page.addInitScript(() => {
      window.open = (url) => { (window as unknown as { capturedWhatsApp: string }).capturedWhatsApp = String(url); return null; };
    });
    const enquiryPosts: string[] = [];
    page.on('request', request => { if (request.method() === 'POST' && request.url().includes('/api/enquiries')) enquiryPosts.push(request.url()); });
    await page.goto('/enquire?type=part_exchange');
    const next = page.getByTestId('button-part-exchange-continue');
    await next.click();
    await expect(page.getByTestId('input-part-exchange-registration')).toBeVisible();
    await page.getByTestId('input-part-exchange-registration').fill('AB12 CDE');
    await page.getByTestId('input-part-exchange-model').fill('Volkswagen Golf');
    await page.getByTestId('input-part-exchange-mileage').fill('45000');
    await next.click();
    await expect(page.locator('#enquiry-form-heading')).toBeFocused();
    await next.click();
    await expect(page.getByTestId('select-part-exchange-condition')).toBeVisible();
    await page.getByTestId('select-part-exchange-condition').selectOption({ label: 'Good — normal wear for its age' });
    await page.getByTestId('select-part-exchange-keys').selectOption('2 keys');
    await page.getByTestId('select-part-exchange-v5').selectOption('Yes');
    await page.getByTestId('select-part-exchange-history').selectOption('Full history');
    await page.getByTestId('input-part-exchange-notes').fill('Small scratch on rear bumper.');
    await expect(page.getByTestId('part-exchange-photo-guide')).toContainText('Photos are not uploaded on this website');
    const directory = '/tmp/customer-wording-part-exchange';
    await mkdir(directory, { recursive: true });
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
    await page.screenshot({ path: resolve(directory, `condition-${width}.png`), fullPage: true });
    await next.click();
    await expect(next).toBeDisabled();
    await page.getByTestId('select-part-exchange-target-vehicle').selectOption('preview-1');
    await expect(page.getByTestId('card-part-exchange-target-vehicle')).toBeVisible();
    await next.click();
    await page.getByRole('radio', { name: /Send everything on WhatsApp/ }).check();
    await page.getByTestId('input-customer-name').fill('Test Buyer');
    await page.getByTestId('input-customer-phone').fill('07700 900123');
    await page.getByTestId('input-customer-email').fill('buyer@customer.example.test');
    await expect(page.getByTestId('part-exchange-message-preview')).toContainText('V5C logbook: Yes');
    await expect(page.getByTestId('part-exchange-message-preview')).toContainText('Stock reference: preview-1');
    await next.click();
    expect(await page.evaluate(() => (window as unknown as { capturedWhatsApp?: string }).capturedWhatsApp)).toBeUndefined();
    await page.getByRole('checkbox').check();
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
    await page.screenshot({ path: resolve(directory, `review-${width}.png`), fullPage: true });
    await next.click();
    const url = await page.evaluate(() => (window as unknown as { capturedWhatsApp: string }).capturedWhatsApp);
    expect(new URL(url).hostname).toBe('wa.me');
    const message = new URL(url).searchParams.get('text')!;
    for (const detail of ['AB12 CDE', 'Volkswagen Golf', '45,000 miles', '2 keys', 'V5C logbook: Yes', 'Full history', 'Small scratch', 'preview-1', 'Test Buyer', '07700 900123', 'buyer@customer.example.test']) expect(message).toContain(detail);
    await expect(page.getByRole('status').filter({ hasText: 'WhatsApp was requested' })).toBeVisible();
    expect(enquiryPosts).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    await page.getByRole('button', { name: '01 Your car' }).click();
    await expect(page.getByTestId('input-part-exchange-registration')).toHaveValue('AB12 CDE');
  });
}

test('stock vehicle link preselects a current car', async ({ page }) => {
  await page.goto('/enquire?type=part_exchange&vehicleId=preview-1');
  await page.getByTestId('input-part-exchange-registration').fill('AB12 CDE');
  await page.getByTestId('input-part-exchange-model').fill('Ford Focus');
  await page.getByTestId('input-part-exchange-mileage').fill('0');
  await page.getByTestId('button-part-exchange-continue').click();
  await page.getByTestId('select-part-exchange-condition').selectOption({ index: 1 });
  await page.getByTestId('select-part-exchange-keys').selectOption('1 key');
  await page.getByTestId('select-part-exchange-v5').selectOption('Replacement requested');
  await page.getByTestId('select-part-exchange-history').selectOption('Not sure');
  await page.getByTestId('button-part-exchange-continue').click();
  await expect(page.getByTestId('select-part-exchange-target-vehicle')).toHaveValue('preview-1');
});

test('save details first, recover from failure, then offer photos with the enquiry reference', async ({ page }) => {
  let payload: any;
  let requests = 0;
  await page.route('**/api/enquiries', async route => {
    requests++;
    payload = route.request().postDataJSON();
    await route.fulfill(requests === 1 ? { status: 503, json: { error: 'Unavailable' } } : { json: { reference: 'PX-TEST-42', customerNotificationStatus: 'sent' } });
  });
  await page.goto('/enquire?type=part_exchange&vehicleId=preview-1');
  const next = page.getByTestId('button-part-exchange-continue');
  await page.getByTestId('input-part-exchange-registration').fill('AB12 CDE');
  await page.getByTestId('input-part-exchange-model').fill('Ford Focus');
  await page.getByTestId('input-part-exchange-mileage').fill('42000');
  await next.click();
  await page.getByTestId('select-part-exchange-condition').selectOption({ label: 'Good — normal wear for its age' });
  await page.getByTestId('select-part-exchange-keys').selectOption('2 keys');
  await page.getByTestId('select-part-exchange-v5').selectOption('Yes');
  await page.getByTestId('select-part-exchange-history').selectOption('Full history');
  await next.click();
  await next.click();
  await expect(page.getByRole('radio', { name: /Send details here/ })).toBeChecked();
  await page.getByTestId('input-customer-name').fill('Test Buyer');
  await page.getByTestId('input-customer-phone').fill('07700 900123');
  await page.getByRole('checkbox').check();
  await next.click();
  expect(requests).toBe(0); // Email is required for the existing enquiry API.
  await page.getByTestId('input-customer-email').fill('buyer@customer.example.test');
  await page.getByRole('checkbox').check();
  await next.click();
  await expect(page.getByRole('alert')).toContainText('Your details are still here');
  await expect(page.getByTestId('input-customer-email')).toHaveValue('buyer@customer.example.test');
  await next.click();
  await expect(page.getByTestId('status-part-exchange-success')).toBeVisible();
  await expect(page.locator('#enquiry-form-heading')).toBeFocused();
  expect(payload).toMatchObject({ type: 'part_exchange', vehicleId: 'preview-1', customerName: 'Test Buyer', email: 'buyer@customer.example.test', phone: '07700900123', preferredContact: 'whatsapp', partExchange: { registration: 'AB12 CDE', mileage: 42000, condition: 'good' } });
  for (const value of ['Ford Focus', 'Keys: 2 keys', 'V5C logbook: Yes', 'Service history: Full history']) expect(payload.message).toContain(value);
  const photoLink = await page.getByTestId('link-part-exchange-photos').getAttribute('href');
  const text = new URL(photoLink!).searchParams.get('text');
  expect(text).toContain('PX-TEST-42');
  expect(text).toContain('AB12 CDE');
  expect(requests).toBe(2);
});
