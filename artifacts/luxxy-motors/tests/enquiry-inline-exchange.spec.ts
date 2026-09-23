import { expect, test } from '@playwright/test';
test.skip(process.env.LUXXY_LOCAL_PREVIEW !== '1', 'Local fixture preview only.');
for (const width of [390, 1440]) {
  test(`inline part exchange saves with enquiry at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    let payload: any;
    await page.route('**/api/enquiries', route => {
      payload = route.request().postDataJSON();
      return route.fulfill({ json: { reference: 'LOCAL-TEST', customerNotificationStatus: 'sent' } });
    });
    await page.goto('/enquire?type=general&vehicleId=preview-1');
    await expect(page.getByText('Questions about this car')).toHaveCount(0);
    await page.getByRole('radio', { name: 'Yes', exact: true }).check();
    const details = page.getByTestId('enquiry-part-exchange-details');
    await details.getByLabel('Your car’s UK registration number', { exact: true }).fill('AB12 CDE');
    await details.getByLabel('Current mileage (miles)', { exact: true }).fill('42000');
    await expect(details.locator('input')).toHaveCount(2);
    await page.getByRole('radio', { name: 'No', exact: true }).check();
    await expect(details).toHaveCount(0);
    await page.getByRole('radio', { name: 'Yes', exact: true }).check();
    await page.getByTestId('input-customer-name').fill('Local Test');
    await page.getByTestId('input-customer-email').fill('local@example.com');
    await page.getByTestId('button-submit-enquiry').click();
    await expect(page.getByTestId('status-enquiry-success')).toBeVisible();
    expect(payload.partExchange).toEqual({ registration: 'AB12 CDE', mileage: 42000, condition: null });
  });
}
