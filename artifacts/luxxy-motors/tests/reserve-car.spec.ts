import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';

test.skip(process.env.LUXXY_LOCAL_PREVIEW !== '1', 'Dedicated local fixture server only.');
test.describe.configure({ mode: 'serial' });

for (const width of [390, 1440]) {
  test(`reserve online persists, prevents double booking and staff releases at ${width}px`, async ({ page, request }) => {
    const settings = await (await request.get('/api/dealer-settings')).json();
    const stock = await (await request.get('/api/stock')).json();
    const car = stock.cars.find((item: any) => item.inventoryStatus === 'available');
    expect(car).toBeTruthy();
    let reservation: any;
    let submitted: any;
    const localSettings = { ...settings, onlineReservation: { enabled: true, depositPence: 15000, terms: 'Local test reservation: the car is held until the team contacts you. Contact the dealership to cancel. Payment is simulated.' } };
    expect((await request.patch('/api/dealer-settings', { data: localSettings })).ok()).toBeTruthy();
    try {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`/vehicle/${car.id}`);
      await page.getByRole('button', { name: 'Reserve car online', exact: true }).click();
      const dialog = page.getByRole('dialog');
      await dialog.getByLabel('Your name', { exact: true }).fill('Local Reservation Test');
      await dialog.getByLabel('Email address', { exact: true }).fill('reservation@example.test');
      await dialog.getByLabel('Phone number', { exact: true }).fill('07700900123');
      await dialog.getByRole('button', { name: 'Continue · £150 deposit', exact: true }).click();
      const confirm = dialog.getByRole('button', { name: 'Confirm reservation · simulate payment', exact: true });
      await expect(confirm).toBeDisabled();
      await dialog.getByRole('checkbox').check();
      const directory = resolve('../../docs/screenshots/reserve-car-online');
      await mkdir(directory, { recursive: true });
      await dialog.screenshot({ path: resolve(directory, `reserve-${width}.png`), animations: 'disabled' });
      page.on('request', req => { if (req.method() === 'POST' && new URL(req.url()).pathname === '/api/reservations') submitted = req.postDataJSON(); });
      const response = page.waitForResponse(res => new URL(res.url()).pathname === '/api/reservations' && res.request().method() === 'POST');
      await confirm.click();
      reservation = await (await response).json();
      await expect(dialog.getByRole('heading', { name: 'Your car is reserved', exact: true })).toBeVisible();
      await expect(dialog.getByText(reservation.reference, { exact: true })).toBeVisible();
      await dialog.screenshot({ path: resolve(directory, `reserved-${width}.png`), animations: 'disabled' });
      expect(reservation).toMatchObject({ status: 'reserved', depositPence: 15000, amountReceivedPence: 0, paymentStatus: 'simulated' });
      expect(reservation).not.toHaveProperty('email');
      expect((await (await request.post('/api/reservations', { data: submitted })).json()).id).toBe(reservation.id);
      const second = await request.post('/api/reservations', { data: { ...submitted, idempotencyKey: randomUUID(), customerName: 'Another Local Test' } });
      expect(second.status()).toBe(409);
      await dialog.getByRole('button', { name: 'Done', exact: true }).click();
      await page.reload();
      await expect(page.getByRole('button', { name: 'Reserve car online', exact: true })).toHaveCount(0);
      await expect(page.getByText('This car is reserved', { exact: true })).toBeVisible();
      await page.goto('/portal');
      await page.getByRole('button', { name: 'Reservations', exact: true }).click();
      const row = page.getByTestId(`staff-reservation-${reservation.id}`);
      await expect(row).toBeVisible();
      await expect(row.getByText('Payment simulated · £0 received')).toBeVisible();
      await page.screenshot({ path: resolve(directory, `staff-${width}.png`), fullPage: true, animations: 'disabled' });
      await row.getByRole('button', { name: /Cancel/ }).click();
      await page.getByRole('alertdialog').getByRole('button', { name: 'Cancel and release car' }).click();
      await expect(row).toHaveCount(0);
      const released = await (await request.get('/api/stock')).json();
      expect(released.cars.find((item: any) => item.id === car.id).inventoryStatus).toBe('available');
    } finally {
      if (reservation?.id) await request.post(`/api/reservations/${reservation.id}/cancel`);
      await request.patch('/api/dealer-settings', { data: settings });
    }
  });
}

test('settings off hides reservation and rejects a direct request', async ({ page, request }) => {
  const settings = await (await request.get('/api/dealer-settings')).json();
  const stock = await (await request.get('/api/stock')).json();
  const car = stock.cars.find((item: any) => item.inventoryStatus === 'available');
  const disabled = { ...settings, onlineReservation: { enabled: false, depositPence: 10000, terms: 'Test reservation terms' } };
  expect((await request.patch('/api/dealer-settings', { data: disabled })).ok()).toBeTruthy();
  try {
    await page.goto(`/vehicle/${car.id}`);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Reserve car online', exact: true })).toHaveCount(0);
    const result = await request.post('/api/reservations', { data: { vehicleId: car.id, idempotencyKey: randomUUID(), customerName: 'Local Test', email: 'local@example.test', phone: '07700900123', expectedPricePence: car.price * 100, expectedDepositPence: 10000, terms: disabled.onlineReservation.terms, termsAccepted: true } });
    expect(result.status()).toBe(409);
  } finally { await request.patch('/api/dealer-settings', { data: settings }); }
});

test('viewing review has no competing reservation action', async ({ page, request }) => {
  const settings = await (await request.get('/api/dealer-settings')).json();
  const stock = await (await request.get('/api/stock')).json();
  const car = stock.cars.find((item: any) => item.inventoryStatus === 'available');
  let writes = 0;
  await page.route('**/api/**', route => {
    if (['GET', 'HEAD'].includes(route.request().method())) return route.continue();
    writes += 1;
    return route.fulfill({ status: 403, json: { error: 'Test blocked this write.' } });
  });
  await page.route('**/api/dealer-settings', route => route.fulfill({ json: { ...settings, onlineReservation: { enabled: true, depositPence: 10000, terms: 'Local test reservation terms.' } } }));
  await page.setViewportSize({ width: 390, height: 900 });
  await page.goto(`/enquire?type=viewing&vehicleId=${car.id}`);
  await page.getByTestId('group-viewing-slots').getByRole('button').and(page.locator(':enabled')).first().click();
  await page.getByTestId('button-continue-to-details').click();
  await page.getByTestId('input-customer-name').fill('Local Viewing Review');
  await page.getByTestId('input-customer-email').fill('local@example.test');
  await page.getByTestId('input-customer-phone').fill('07700900123');
  await expect(page.getByRole('button', { name: 'Reserve car online', exact: true })).toHaveCount(0);
  await page.getByTestId('button-review-booking').click();
  await expect(page.getByTestId('button-submit-enquiry')).toHaveText('Confirm test drive');
  await expect(page.getByRole('button', { name: 'Reserve car online', exact: true })).toHaveCount(0);
  expect(writes).toBe(0);
});

test('a cancelled retry is never presented as a confirmed hold', async ({ page, request }) => {
  const stock = await (await request.get('/api/stock')).json();
  const car = stock.cars.find((item: any) => item.inventoryStatus === 'available');
  await page.route('**/api/reservations', route => route.fulfill({ json: {
    id: randomUUID(), reference: 'RSV-CANCELLED', vehicleId: car.id, vehicleTitle: car.title,
    status: 'cancelled', depositPence: 10000, amountReceivedPence: 0, paymentStatus: 'simulated', createdAt: new Date().toISOString(),
  } }));
  await page.goto(`/vehicle/${car.id}`);
  await page.getByRole('button', { name: 'Reserve car online', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Your name', { exact: true }).fill('Local Cancelled Test');
  await dialog.getByLabel('Email address', { exact: true }).fill('cancelled@example.test');
  await dialog.getByLabel('Phone number', { exact: true }).fill('07700900123');
  await dialog.getByRole('button', { name: /Continue ·/ }).click();
  await dialog.getByRole('checkbox').check();
  await dialog.getByRole('button', { name: 'Confirm reservation · simulate payment' }).click();
  await expect(dialog.getByRole('heading', { name: 'Reservation cancelled' })).toBeVisible();
  await expect(dialog.getByRole('heading', { name: 'Your car is reserved' })).toHaveCount(0);
});
