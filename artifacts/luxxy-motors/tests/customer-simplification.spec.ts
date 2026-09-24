import { test, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';

test.skip(process.env.LUXXY_LOCAL_PREVIEW !== '1', 'Local fixture preview only');
for (const width of [390, 1440]) {
  test(`simplified customer pages and optional comparison at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    let comparisonEnabled = false;
    await page.route('**/api/dealer-settings', async route => {
      const response = await route.fetch();
      const data = await response.json();
      await route.fulfill({ response, json: { ...data, presentation: { ...data.presentation, comparisonEnabled } } });
    });
    await page.goto('/#stock');
    await expect(page.locator('[data-testid^="card-vehicle-"]').first()).toBeVisible();
    await expect(page.locator('[data-testid^="button-compare-"]')).toHaveCount(0);
    await page.goto('/vehicle/preview-1');
    await expect(page.getByTestId('link-vehicle-pdf')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Share this vehicle', exact: true })).toHaveCount(1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await mkdir('../../docs/screenshots/customer-simplification', { recursive: true });
    await page.screenshot({ path: `../../docs/screenshots/customer-simplification/vehicle-${width}.png`, fullPage: true });
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Recently viewed', exact: true })).toBeVisible();
    await page.screenshot({ path: `../../docs/screenshots/customer-simplification/home-${width}.png`, fullPage: true });
    await page.goto('/compare');
    await expect(page.getByRole('heading', { name: 'Browse your next car' })).toBeVisible();
    comparisonEnabled = true;
    await page.goto('/#stock');
    const buttons = page.locator('[data-testid^="button-compare-"]');
    await expect(buttons.first()).toBeVisible();
    await buttons.nth(0).click();
    await buttons.nth(1).click();
    await page.goto('/compare');
    await expect(page.getByTestId('compare-table')).toBeAttached();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}
