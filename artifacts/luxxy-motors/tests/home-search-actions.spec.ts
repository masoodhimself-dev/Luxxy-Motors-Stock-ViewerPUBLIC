import { test, expect } from '@playwright/test';
for (const width of [390, 1280]) {
  test(`homepage reset and all stock at ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/');
    const search = page.getByRole('form', { name: 'Search used cars' });
    await page.getByLabel('Search maximum price', { exact: true }).selectOption('5000');
    await search.getByRole('button', { name: 'Reset', exact: true }).click();
    await expect(page.getByLabel('Search maximum price', { exact: true })).toHaveValue('');
    await page.getByLabel('Search maximum price', { exact: true }).selectOption('5000');
    await search.getByRole('link', { name: 'See all cars' }).click();
    await expect(page).toHaveURL(/\/stock$/);
    await expect(page.getByRole('heading', { name: 'Browse Stock', exact: true })).toBeVisible();
  });
}
