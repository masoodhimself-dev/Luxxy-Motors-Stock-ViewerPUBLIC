import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';

test.skip(process.env.LUXXY_LOCAL_PREVIEW !== '1', 'Local fixture preview only.');

const screenshots = resolve('../../docs/screenshots/demo-deposit');
const depositName = 'Leave a deposit · demo';

for (const width of [390, 1440]) {
  test(`vehicle deposit is an explicit, reversible demo at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    const writes: string[] = [];
    await page.route('**/api/**', async route => {
      if (['GET', 'HEAD', 'OPTIONS'].includes(route.request().method())) return route.continue();
      writes.push(`${route.request().method()} ${route.request().url()}`);
      await route.fulfill({ status: 400, json: { error: 'Unexpected demo write.' } });
    });
    await page.goto('/vehicle/preview-1');
    const vehicleTitle = await page.getByRole('heading', { level: 1 }).innerText();
    const trigger = page.getByRole('button', { name: depositName, exact: true });
    await trigger.click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText(vehicleTitle, { exact: true })).toBeVisible();
    await expect(dialog.locator('img')).toBeVisible();
    await expect(dialog.locator('input')).toHaveCount(0);
    await expect(dialog.getByText('Demo only · no money taken', { exact: true })).toBeVisible();
    await expect(dialog.getByText('£0 · demo', { exact: true })).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Pretend pay £100', exact: true })).toBeVisible();
    await mkdir(screenshots, { recursive: true });
    await dialog.screenshot({ path: resolve(screenshots, `vehicle-deposit-${width}.png`), animations: 'disabled' });
    const bounds = await dialog.boundingBox();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);

    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(trigger).toBeFocused();
    await trigger.click();
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await trigger.click();
    await dialog.getByRole('button', { name: 'Pretend pay £100', exact: true }).click();
    await expect(dialog.getByRole('heading', { name: 'Demo payment complete', exact: true })).toBeVisible();
    await expect(dialog.getByText('No money was taken and this car has not been reserved. Your viewing or enquiry stays unchanged.', { exact: true })).toBeVisible();
    await dialog.screenshot({ path: resolve(screenshots, `deposit-complete-${width}.png`), animations: 'disabled' });
    await dialog.getByRole('button', { name: 'Close', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await trigger.click();
    await expect(dialog.getByRole('button', { name: 'Pretend pay £100', exact: true })).toBeVisible();
    await expect(dialog.getByRole('heading', { name: 'Demo payment complete', exact: true })).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(page).toHaveURL(/\/vehicle\/preview-1$/);
    expect(writes).toEqual([]);
  });

  test(`deposit does not submit or replace a viewing enquiry at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    const writes: Array<{ url: string; payload: Record<string, unknown> }> = [];
    await page.route('**/api/**', async route => {
      const request = route.request();
      if (['GET', 'HEAD', 'OPTIONS'].includes(request.method())) return route.continue();
      writes.push({ url: request.url(), payload: request.postDataJSON() });
      if (new URL(request.url()).pathname === '/api/enquiries') {
        return route.fulfill({ json: { reference: 'DEMO-VIEWING-TEST', customerNotificationStatus: 'sent' } });
      }
      return route.fulfill({ status: 400, json: { error: 'Unexpected demo write.' } });
    });
    await page.goto('/enquire?type=viewing&vehicleId=preview-1');
    await page.getByTestId('group-viewing-slots').getByRole('button').filter({ visible: true }).and(page.locator(':enabled')).first().click();
    await page.getByTestId('button-continue-to-details').click();
    await page.getByTestId('input-customer-name').fill('Local Deposit Test');
    await page.getByTestId('input-customer-email').fill('local@example.com');
    await page.getByTestId('input-customer-phone').fill('07700900123');
    await page.getByTestId('textarea-enquiry-message').fill('Please have the service history ready.');
    await page.getByRole('button', { name: depositName, exact: true }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('button', { name: 'Pretend pay £100', exact: true }).click();
    await expect(dialog.getByRole('heading', { name: 'Demo payment complete', exact: true })).toBeVisible();
    expect(writes).toEqual([]);
    await dialog.getByRole('button', { name: 'Close', exact: true }).click();
    await expect(page.getByTestId('input-customer-name')).toHaveValue('Local Deposit Test');
    await expect(page.getByTestId('textarea-enquiry-message')).toHaveValue('Please have the service history ready.');
    await expect(page.getByTestId('status-enquiry-success')).toHaveCount(0);
    await page.getByTestId('button-submit-enquiry').click();
    await expect(page.getByTestId('status-enquiry-success')).toBeVisible();
    expect(writes).toHaveLength(1);
    expect(writes[0].payload).toMatchObject({
      vehicleId: 'preview-1', type: 'viewing', customerName: 'Local Deposit Test',
      message: 'Please have the service history ready.',
    });
    expect(writes[0].payload).not.toHaveProperty('deposit');
    expect(writes[0].payload).not.toHaveProperty('payment');
    await page.getByRole('button', { name: depositName, exact: true }).click();
    await expect(dialog.getByRole('button', { name: 'Pretend pay £100', exact: true })).toBeVisible();
    await dialog.getByRole('button', { name: 'Pretend pay £100', exact: true }).click();
    await expect(dialog.getByRole('heading', { name: 'Demo payment complete', exact: true })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('status-enquiry-success')).toBeVisible();
    expect(writes).toHaveLength(1);
  });

  test(`a car is required before offering a deposit at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/enquire?type=viewing');
    await expect(page.getByTestId('viewing-vehicle-required')).toBeVisible();
    await expect(page.getByRole('button', { name: depositName, exact: true })).toHaveCount(0);
  });
}
