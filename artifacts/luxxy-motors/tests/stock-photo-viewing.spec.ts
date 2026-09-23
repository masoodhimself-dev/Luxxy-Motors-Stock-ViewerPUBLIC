import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';

test.skip(process.env.LUXXY_LOCAL_PREVIEW !== '1', 'Local fixture preview only.');

for (const width of [390, 1440]) {
  test(`stock photo arrows and mandatory viewing vehicle at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/#stock');
    const next = page.getByRole('button', { name: /^Next photo of/ }).first();
    const card = next.locator('xpath=ancestor::article');
    await card.scrollIntoViewIfNeeded();
    await card.hover();
    const photo = card.locator('img').first();
    const first = await photo.getAttribute('src');
    await next.click();
    const screenshots = resolve('../../docs/screenshots/stock-photo-viewing');
    await mkdir(screenshots, { recursive: true });
    await card.screenshot({ path: resolve(screenshots, `stock-card-${width}.png`) });
    await expect(photo).not.toHaveAttribute('src', first!);
    await expect(page).not.toHaveURL(/\/vehicle\//);
    await card.getByRole('button', { name: /^Previous photo of/ }).click();
    await expect(photo).toHaveAttribute('src', first!);
    await page.goto('/enquire?type=viewing');
    await expect(page.getByTestId('viewing-vehicle-required')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Select a car to continue' })).toBeDisabled();
    await expect(page.getByTestId('button-submit-enquiry')).toHaveCount(0);
    await page.getByTestId('viewing-vehicle-required').screenshot({ path: resolve(screenshots, `vehicle-required-${width}.png`) });
    await page.locator('#viewing-vehicle').selectOption('preview-1');
    await page.getByRole('link', { name: 'Choose date and time' }).click();
    await expect(page).toHaveURL(/vehicleId=preview-1/);
    await expect(page.getByRole('heading', { name: 'Choose a date and time', exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  });
}
