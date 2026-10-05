import { test, expect, type Page } from '@playwright/test';
test.skip(process.env.LUXXY_LOCAL_PREVIEW !== '1', 'Local mocked customer journeys only.');
async function prepare(page: Page) {
  await page.route('**/api/**', route => ['GET', 'HEAD'].includes(route.request().method()) ? route.continue() : route.abort());
  await page.route('**/api/dealer-settings', async route => {
    const response = await route.fetch(); const data = await response.json();
    await route.fulfill({ json: { ...data, presentation: { ...data.presentation, comparisonEnabled: true } } });
  });
}
for (const width of [390, 820, 1440]) {
  test(`simple phone enquiry, summaries and comparison at ${width}`, async ({ page, request }) => {
    await page.setViewportSize({ width, height: 950 }); await prepare(page);
    const data = await (await request.get('/api/stock')).json();
    const cars = data.cars.slice(0, 2).map((car: any, i: number) => ({ ...car, inventoryStatus: i ? 'reserved' : 'available', sourceExtras: { ...car.sourceExtras, serviceHistory: 'Full service history', historyExtras: null }, specifications: { ...car.specifications, numberOfKeys: 2 } }));
    await page.route('**/api/stock', route => route.fulfill({ json: { ...data, cars, count: 2 } }));
    await page.goto(`/vehicle/${cars[0].id}`);
    await expect(page.getByRole('navigation', { name: 'Vehicle information sections' })).toBeVisible();
    const form = page.getByTestId('form-enquiry');
    await form.getByRole('radio', { name: 'Phone', exact: true }).check();
    await expect(form.getByTestId('input-customer-email')).toHaveCount(0);
    await form.getByTestId('textarea-enquiry-message').fill('Can I see the service records?');
    await form.getByTestId('input-customer-name').fill('Customer Test');
    await form.getByTestId('input-customer-phone').fill('07700900123');
    let payload: any;
    await page.route('**/api/enquiries', route => { payload = route.request().postDataJSON(); return route.fulfill({ status: 201, json: { ...payload, id: 'test', reference: 'ENQ-TEST', customerNotificationStatus: 'not_sent' } }); });
    await form.getByTestId('button-submit-enquiry').click();
    await expect(page.getByTestId('text-enquiry-reference')).toHaveText('ENQ-TEST');
    expect(payload).toMatchObject({ vehicleId: cars[0].id, email: null, phone: '07700900123', preferredContact: 'phone' });
    await page.evaluate(ids => localStorage.setItem('luxxy.compare-cars.v1', JSON.stringify(ids)), cars.map((car: any) => car.id));
    await page.goto('/compare');
    await expect(page.getByTestId('compare-table')).toContainText('Full service history');
    await expect(page.getByTestId('compare-table')).toContainText('2 keys');
    await expect(page.getByTestId('compare-table')).toContainText('Reserved');
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    await page.screenshot({ path: `/tmp/customer-compare-${width}.png`, fullPage: true, animations: 'disabled' });
  });
  test(`saved changes and managed appointment at ${width}`, async ({ page, request }) => {
    await page.setViewportSize({ width, height: 950 }); await prepare(page);
    const data = await (await request.get('/api/stock')).json(); const car = data.cars[0];
    await page.goto('/');
    await page.evaluate(car => {
      localStorage.setItem('luxxy.saved-cars.v1', JSON.stringify([car.id, 'departed-car']));
      localStorage.setItem('luxxy.saved-car-snapshots.v1', JSON.stringify({ [car.id]: { title: car.title, photo: '', price: car.price + 200, currency: car.currency || 'GBP', status: 'available', savedAt: new Date().toISOString() }, 'departed-car': { title: 'Previously saved Ford Fiesta', photo: '', price: 5000, currency: 'GBP', status: 'available', savedAt: new Date().toISOString() } }));
    }, car);
    await page.goto('/saved');
    await expect(page.getByText('Price reduced by £200 since you saved it')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Previously saved Ford Fiesta' })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    await page.route('**/api/viewings/customer-test', route => route.fulfill({ json: { reference: 'DRIVE-TEST', status: 'booked', customerName: 'Customer Test', appointmentAt: '2027-01-05T11:00:00Z', cancelledAt: null, durationMinutes: 30, timezone: 'Europe/London', vehicleTitle: car.title, vehicleUrl: `/vehicle/${car.id}`, calendarIcs: 'BEGIN:VCALENDAR\nEND:VCALENDAR', canChange: true } }));
    await page.goto('/viewing/customer-test');
    await expect(page.getByRole('status').filter({ hasText: 'Confirmed' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Add to calendar' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Before your visit' })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    await page.screenshot({ path: `/tmp/customer-booking-${width}.png`, fullPage: true, animations: 'disabled' });
  });
}

test('return to results retains shared filters, loaded cars and scroll position', async ({ page, request }) => {
 await prepare(page);
 const stock = await (await request.get('/api/stock')).json();
 const cars = Array.from({ length: 25 }, (_, i) => ({ ...stock.cars[0], id: `return-car-${i}`, advertId: `return-${i}`, inventoryStatus: 'available' }));
 await page.route('**/api/stock', route => route.fulfill({ json: { ...stock, cars, count: cars.length } }));
 await page.goto(`/stock?make=${encodeURIComponent(cars[0].make)}&sort=price-asc`);
 await page.getByRole('button', { name: 'Show more cars' }).click();
 const link = page.locator('[data-stock-link="return-car-20"]');
 await link.scrollIntoViewIfNeeded();
 const before = await page.evaluate(() => scrollY);
 await link.click();
 await page.getByRole('link', { name: 'Back to your results' }).click();
 await expect(page).toHaveURL(/make=.*sort=price-asc/);
 await expect(page.locator('[data-stock-link="return-car-20"]')).toBeVisible();
 await expect.poll(async () => Math.abs(await page.evaluate(() => scrollY) - before)).toBeLessThan(120);
});

test('reserved vehicle has no booking action and phone form works without images or motion', async ({ page, request }) => {
 await page.setViewportSize({ width: 390, height: 844 }); await page.emulateMedia({ reducedMotion: 'reduce' }); await prepare(page);
 const stock = await (await request.get('/api/stock')).json(); const car = { ...stock.cars[0], inventoryStatus: 'reserved' };
 await page.route('**/api/stock', route => route.fulfill({ json: { ...stock, cars: [car], count: 1 } }));
 await page.route('**/*', route => route.request().resourceType() === 'image' ? route.abort() : route.fallback());
 await page.goto(`/vehicle/${car.id}`);
 await expect(page.locator('[data-vehicle-contact="booking"]')).toHaveCount(0);
 await expect(page.getByTestId('form-enquiry')).toBeVisible();
 const input = page.getByTestId('input-customer-name');
 expect(await input.evaluate(el => parseFloat(getComputedStyle(el).fontSize))).toBeGreaterThanOrEqual(16);
 await input.focus(); await page.keyboard.type('Keyboard Customer');
 await expect(input).toHaveValue('Keyboard Customer');
 expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
 await page.screenshot({ path: '/tmp/customer-vehicle-mobile.png', fullPage: true, animations: 'disabled' });
});

for (const width of [390, 820, 1440]) {
 test(`customer page layout audit at ${width}`, async ({ page, request }) => {
  await page.setViewportSize({ width, height: 900 }); await prepare(page);
  const stock = await (await request.get('/api/stock')).json();
  const paths = ['/', '/stock', '/saved', '/compare', '/contact', '/warranty', `/enquire?type=part_exchange&vehicleId=${stock.cars[0].id}`, `/vehicle/${stock.cars[0].id}`];
  for (const path of paths) {
   await page.goto(path);
   await expect(page.locator('main')).toBeVisible();
   await page.evaluate(() => document.fonts.ready);
   await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
   await expect(page.locator('h1').first()).toBeVisible();
  }
  await page.getByTestId('form-enquiry').screenshot({ path: `/tmp/customer-enquiry-${width}.png`, animations: 'disabled' });
 });
}
