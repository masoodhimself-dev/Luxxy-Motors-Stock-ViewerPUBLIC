import { expect, test } from '@playwright/test';

test.skip(process.env.LUXXY_LOCAL_PREVIEW !== '1', 'Local fixture preview only.');
test.use({ serviceWorkers: 'block' });

for (const width of [390, 1440]) {
  test(`inline part exchange saves with enquiry at ${width}px`, async ({ page, context, request }) => {
    await page.setViewportSize({ width, height: 900 });
    await context.route('**/api/**', route => ['GET', 'HEAD', 'OPTIONS'].includes(route.request().method())
      ? route.continue()
      : route.abort('blockedbyclient'));
    const stockResponse = await request.get('/api/stock');
    expect(stockResponse.ok()).toBe(true);
    const stock = await stockResponse.json();
    const vehicle = stock.cars[0];
    expect(vehicle?.id).toBeTruthy();
    await page.route('**/api/stock', route => route.request().method() === 'GET'
      ? route.fulfill({ json: stock })
      : route.fallback());
    let payload: any;
    await page.route('**/api/enquiries', route => {
      if (route.request().method() !== 'POST') return route.fallback();
      payload = route.request().postDataJSON();
      return route.fulfill({ status: 201, json: { reference: 'LOCAL-TEST', customerNotificationStatus: 'not_sent' } });
    });
    await page.goto(`/enquire?type=general&vehicleId=${encodeURIComponent(vehicle.id)}`);
    await expect(page.getByTestId('status-vehicle-unavailable')).toHaveCount(0);
    await expect(page.getByText('Questions about this car')).toHaveCount(0);
    await page.getByRole('radio', { name: 'Yes', exact: true }).check();
    const details = page.getByTestId('enquiry-part-exchange-details');
    await details.getByLabel('Your car’s UK registration number', { exact: true }).fill('AB12 CDE');
    await details.getByLabel('Current mileage (miles)', { exact: true }).fill('42000');
    await expect(details.locator('input')).toHaveCount(2);
    await page.getByRole('radio', { name: 'No', exact: true }).check();
    await expect(details).toHaveCount(0);
    await page.getByRole('radio', { name: 'Yes', exact: true }).check();
    await expect(details.getByLabel('Your car’s UK registration number', { exact: true })).toHaveValue('AB12 CDE');
    await expect(details.getByLabel('Current mileage (miles)', { exact: true })).toHaveValue('42000');
    await page.getByTestId('input-customer-name').fill('Local Test');
    await page.getByTestId('input-customer-email').fill('local@example.com');
    await page.getByTestId('button-submit-enquiry').click();
    await expect(page.getByTestId('status-enquiry-success')).toBeVisible();
    expect(payload.vehicleId).toBe(vehicle.id);
    expect(payload.partExchange).toEqual({ registration: 'AB12 CDE', mileage: 42000, condition: null });
  });
}
