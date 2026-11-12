import { test, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { attachGuidedSale, confirmInvoiceVehicle, chooseGuidedCar, finishGuidedSetup, openedPdf, openInvoiceCompose, pdfText, saveGuidedCustomer, startGuidedSale } from './sales-pdf-fixture';

test.skip(process.env.LUXXY_LOCAL_PREVIEW !== '1', 'Isolated local UI checks');
for (const width of [390, 820, 1440]) {
  test(`guided invoice uses edited sale figures only after explicit issuance at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    const state = await attachGuidedSale(page);
    await startGuidedSale(page);
    await chooseGuidedCar(page, '12500');
    await saveGuidedCustomer(page, 'Invoice Test Buyer');
    await openInvoiceCompose(page);
    await page.getByText('Review customer, vehicle and amounts', { exact: true }).click();
    await expect(page.locator('.invoice-review')).toContainText('Invoice Test Buyer');
    await expect(page.locator('.invoice-review')).toContainText('£12,500.00');
    expect(state.sale?.documents).toEqual([]);
    expect(state.pdfRequests).toBe(0);
    await page.getByRole('button', { name: 'Edit price', exact: true }).click();
    await page.getByLabel('Agreed vehicle price (£)', { exact: true }).fill('12000');
    await page.getByRole('button', { name: 'Save details', exact: true }).click();
    await expect.poll(() => state.sale?.draft.price).toBe('12000');
    await page.getByRole('button', { name: 'Choose customer', exact: true }).click();
    await finishGuidedSetup(page);
    await openInvoiceCompose(page);
    await page.getByText('Review customer, vehicle and amounts', { exact: true }).click();
    await expect(page.locator('.invoice-review')).toContainText('£12,000.00');
    expect(state.sale?.documents).toEqual([]);
    await confirmInvoiceVehicle(page);
    await page.getByRole('checkbox', { name: /checked the customer, vehicle, agreed price/ }).check();
    const screenshots = process.env.SALES_INVOICE_CHECK_SCREENSHOTS;
    if (screenshots) {
      await mkdir(screenshots, { recursive: true });
      await page.getByRole('region', { name: 'Vehicle check', exact: true }).scrollIntoViewIfNeeded();
      await page.screenshot({ path: join(screenshots, `invoice-vehicle-check-${width}.png`), animations: 'disabled' });
    }
    await page.getByRole('button', { name: 'Create & save invoice', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Sales invoice', exact: true })).toBeVisible();
    expect(state.sale?.documents).toHaveLength(1);
    expect(state.sale?.documents[0].snapshot.totals.totalDue).toBe(1200000);
    expect(state.sale?.documents[0].snapshot.vehicle?.invoiceReview).toMatchObject({ mileage: 64150, verification: 'dvla', motExpiry: '2027-08-30' });
    expect(await pdfText(await openedPdf(page))).toContain('12,000.00');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    expect(state.blockedWrites).toEqual([]);
    expect(errors).toEqual([]);
  });
}
