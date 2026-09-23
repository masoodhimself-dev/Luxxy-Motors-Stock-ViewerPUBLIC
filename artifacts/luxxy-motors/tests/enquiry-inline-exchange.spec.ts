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
    await details.getByLabel('Registration', { exact: true }).fill('AB12 CDE');
    await details.getByLabel('Make and model', { exact: true }).fill('Ford Focus');
    await details.getByLabel('Current mileage (miles)', { exact: true }).fill('42000');
    await details.getByLabel('Overall condition', { exact: true }).selectOption('good');
    await details.getByLabel('Number of keys', { exact: true }).selectOption('2');
    await details.getByLabel('Do you have the V5C logbook?', { exact: true }).selectOption('Yes');
    await page.getByRole('radio', { name: 'No', exact: true }).check();
    await expect(details).toHaveCount(0);
    await page.getByRole('radio', { name: 'Yes', exact: true }).check();
    await page.getByTestId('input-customer-name').fill('Local Test');
    await page.getByTestId('input-customer-email').fill('local@example.com');
    await page.getByTestId('button-submit-enquiry').click();
    await expect(page.getByTestId('status-enquiry-success')).toBeVisible();
    expect(payload.partExchange).toEqual({ registration: 'AB12 CDE', mileage: 42000, condition: 'good' });
    expect(payload.message).toContain('Make / model: Ford Focus');
    expect(payload.message).toContain('Keys: 2');
    expect(payload.message).toContain('V5C logbook: Yes');
  });
}
