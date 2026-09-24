import { expect, test } from '@playwright/test';
test.skip(process.env.LUXXY_LOCAL_PREVIEW !== '1', 'Local preview only');
for (const width of [390, 1440]) {
  test(`old sales workflow is unavailable at ${width}px`, async ({ page, request }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/portal');
    await expect(page.getByTestId('work-queue')).toBeVisible();
    await expect(page.getByTestId('tab-deals')).toHaveCount(0);
    await expect(page.getByText('Deposits without a deal')).toHaveCount(0);
    await page.getByTestId('tab-reservations').click();
    await expect(page.getByTestId('tab-settings')).toBeVisible();
    await page.getByTestId('tab-settings').click();
    await expect(page.getByTestId('input-identity-name')).toBeVisible();
    for (const path of ['/sign/sample', '/customer-details/sample']) {
      await page.goto(path);
      await expect(page.getByRole('heading', { name: 'This link is no longer available' })).toBeVisible();
      await expect(page.getByRole('link', { name: 'Contact the dealership' })).toHaveAttribute('href', '/contact');
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    }
    for (const path of ['/api/sales', '/api/sales/sample/complete', '/api/signing/sample/complete', '/api/customer-intake-sessions']) {
      expect((await request.get(path)).status()).toBe(410);
      expect((await request.post(path, { data: {} })).status()).toBe(410);
    }
  });
}
