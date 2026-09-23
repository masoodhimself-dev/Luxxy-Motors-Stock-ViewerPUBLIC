import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';

test.skip(process.env.LUXXY_LOCAL_PREVIEW !== '1', 'Local preview with mocked reservations only.');

for (const width of [320, 390, 1440]) {
  test(`staff can review and deliberately release an online reservation at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    let cancelled = false;
    let cancellationRequests = 0;
    const record = () => ({
      id: 'test-reservation', reference: 'LM-RES-TEST', vehicleId: 'preview-1',
      vehicleTitle: '2021 BMW 3 Series', depositPence: 10000, amountReceivedPence: 0,
      paymentStatus: 'simulated', status: cancelled ? 'cancelled' : 'reserved', createdAt: '2026-09-23T10:00:00.000Z',
      customerName: 'Alex Smith', email: 'alex@example.test', phone: '07700900123', leadId: 'sample-lead-1',
    });
    await page.route('**/api/reservations', (route) => route.fulfill({ json: { reservations: [record()] } }));
    await page.route('**/api/reservations/test-reservation/cancel', (route) => {
      cancellationRequests++;
      cancelled = true;
      return route.fulfill({ json: record() });
    });
    await page.goto('/portal');
    await page.getByTestId('tab-reservations').click();
    const row = page.getByTestId('staff-reservation-test-reservation');
    await expect(row).toContainText('Payment simulated · £0 received');
    await expect(row).toContainText('£100');
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    if (width !== 320) {
      const directory = resolve('../../docs/screenshots/online-reservations');
      await mkdir(directory, { recursive: true });
      await page.screenshot({ path: resolve(directory, `staff-${width}.png`), fullPage: true });
    }
    await row.getByRole('button', { name: 'Cancel reservation' }).click();
    const dialog = page.getByRole('alertdialog');
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText('there is no payment to refund');
    expect(cancellationRequests).toBe(0);
    await dialog.getByRole('button', { name: 'Keep reservation' }).click();
    await expect(dialog).not.toBeVisible();
    await row.getByRole('button', { name: 'Cancel reservation' }).click();
    await dialog.getByRole('button', { name: 'Cancel and release car' }).click();
    await expect(page.getByText('No reservations to show')).toBeVisible();
    expect(cancellationRequests).toBe(1);
    await page.getByLabel('Reservation status').selectOption('cancelled');
    await expect(row).toContainText('Cancelled');
    await expect(row.getByRole('button', { name: 'Cancel reservation' })).toHaveCount(0);
    await row.getByRole('button', { name: 'Open lead' }).click();
    await expect(page).toHaveURL(/\/portal\/leads\/sample-lead-1$/);
    await expect(page.getByTestId('lead-detail')).toBeVisible();
  });
}
