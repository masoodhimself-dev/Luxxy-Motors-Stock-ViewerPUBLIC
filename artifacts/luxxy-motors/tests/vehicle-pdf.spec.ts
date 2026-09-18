import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';

test.skip(process.env.LUXXY_LOCAL_PREVIEW !== '1', 'Uses archived stock in the read-only local preview.');

for (const width of [390, 1440]) {
  test(`vehicle PDF opens from the ${width}px detail page with real embedded photographs`, async ({ page, context }) => {
    test.setTimeout(60_000);
    await page.setViewportSize({ width, height: width < 600 ? 844 : 1000 });
    await page.goto('/vehicle/preview-4');
    const link = page.getByTestId('link-vehicle-pdf');
    await expect(link).toBeVisible();
    await expect(link).toHaveAccessibleName(/View PDF details and photographs for .*Jeep Renegade.*opens in a new tab/);
    await link.scrollIntoViewIfNeeded();
    await link.focus();
    await expect(link).toBeFocused();
    expect((await link.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    if (process.env.CAPTURE_VEHICLE_PDF === '1') {
      const directory = resolve('../../docs/screenshots/vehicle-pdf');
      await mkdir(directory, { recursive: true });
      await page.screenshot({ path: resolve(directory, `vehicle-${width}.png`), animations: 'disabled' });
    }
    // Exercise the actual anchor. Native PDF viewer DOM varies between browser versions.
    const responsePromise = context.waitForEvent('response', { predicate: response => response.url().endsWith('/api/vehicles/preview-4/brochure.pdf') });
    const popupPromise = context.waitForEvent('page');
    await link.press('Enter');
    const response = await responsePromise;
    expect(response.status()).toBe(200);
    expect(response.headers()['content-type']).toContain('application/pdf');
    expect(response.headers()['content-disposition']).toContain('inline; filename="2015-Jeep-Renegade-details.pdf"');
    const popup = await popupPromise;
    await popup.close();
    // Inspect the bytes independently of browser PDF-plugin internals.
    const pdf = await page.request.get('/api/vehicles/preview-4/brochure.pdf');
    expect(pdf.ok()).toBe(true);
    const bytes = await pdf.body();
    expect(bytes.subarray(0, 5).toString()).toBe('%PDF-');
    expect((bytes.toString('latin1').match(/\/Subtype \/Image\b/g) ?? []).length).toBe(58);
    const downloadPromise = page.waitForEvent('download');
    await page.getByTestId('link-download-vehicle-pdf').click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe('2015-Jeep-Renegade-details.pdf');
    expect(await download.failure()).toBeNull();
    expect(page.url()).toContain('/vehicle/preview-4');
  });
}

test('a missing vehicle returns an honest unavailable response instead of a PDF', async ({ request }) => {
  const response = await request.get('/api/vehicles/no-such-car/brochure.pdf');
  expect(response.status()).toBe(404);
  expect(response.headers()['content-type']).toContain('text/plain');
  expect(await response.text()).toContain('no longer available');
});
