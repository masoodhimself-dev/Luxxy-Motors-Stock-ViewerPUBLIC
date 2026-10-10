import { test, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';

test.skip(process.env.LUXXY_LOCAL_PREVIEW !== '1', 'Isolated local UI checks');
for (const width of [390, 820, 1440]) {
  test(`live invoice editing at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/api/**', route => ['GET', 'HEAD', 'OPTIONS'].includes(route.request().method()) ? route.continue() : route.abort('blockedbyclient'));
    await page.goto('/portal?section=sales');
    await page.getByRole('button', { name: 'New sale', exact: true }).first().click();
    await page.getByLabel('Customer name', { exact: true }).fill('Invoice Test Buyer');
    const vehicle = page.getByLabel('Vehicle', { exact: true });
    await expect(vehicle.locator('option[value]:not([value=""])').first()).toBeAttached();
    await vehicle.selectOption((await vehicle.locator('option[value]:not([value=""])').first().getAttribute('value'))!);
    await page.getByLabel('Agreed vehicle price (£)').fill('12500');
    if (width <= 1100) await page.getByRole('button', { name: 'Invoice preview', exact: true }).click();
    const preview = page.locator('.sales-live-paper');
    await expect(preview).toBeVisible();
    await expect(preview).toContainText('Invoice Test Buyer');
    await expect(preview).toContainText('£12,500.00');
    await expect(preview).toContainText('NOT ISSUED');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await mkdir('output/ui-premium/live-invoice', { recursive: true });
    await page.screenshot({ path: `output/ui-premium/live-invoice/preview-${width}.png`, fullPage: true });
    if (width <= 1100) await page.getByRole('button', { name: 'Edit sale', exact: true }).click();
    await page.getByLabel('Agreed vehicle price (£)').fill('12000');
    if (width <= 1100) await page.getByRole('button', { name: 'Invoice preview', exact: true }).click();
    await expect(preview).toContainText('£12,000.00');
    expect(errors).toEqual([]);
  });
}
