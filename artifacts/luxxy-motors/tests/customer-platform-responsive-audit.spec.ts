import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.route('**/api/**', route =>
    ['GET', 'HEAD'].includes(route.request().method()) ? route.continue() : route.abort(),
  );
});

for (const width of [1440, 820, 390, 320]) {
  test(`customer navigation and hero search work at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('button', { name: /^Search \d+ cars?$/ })).toBeEnabled();
    const moreFilters = page.getByRole('button', { name: 'More filters', exact: true });
    await moreFilters.click();
    await expect(page.getByLabel('Search fuel', { exact: true })).toBeVisible();
    await moreFilters.click();
    await expect(page.getByLabel('Search fuel', { exact: true })).not.toBeVisible();
    const openMenu = page.getByRole('button', { name: 'Open navigation menu', exact: true });
    if (await openMenu.isVisible()) {
      await openMenu.click();
      await expect(page.getByRole('navigation', { name: 'Mobile navigation', exact: true })).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(openMenu).toBeFocused();
    }
    await page.getByLabel('Search make', { exact: true }).selectOption('Ford');
    await page.getByRole('button', { name: /^Search \d+ cars?$/ }).click();
    await expect(page).toHaveURL(/\/stock\?.*make=Ford/);
    await expect(page.getByRole('heading', { name: 'Browse Stock', exact: true })).toBeVisible();
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  });

  test(`long dealer branding stays readable and contained at ${width}px`, async ({ page }) => {
    const name = 'North West Prestige and Performance Motor Company Limited';
    await page.setViewportSize({ width, height: 900 });
    await page.route('**/api/dealer-settings', async route => {
      const response = await route.fetch();
      const settings = await response.json();
      settings.identity = { ...settings.identity, name, logoText: name, logoAsset: '' };
      settings.presentation = { ...settings.presentation, footerLogoUrl: '' };
      settings.legal = { ...settings.legal, companyName: 'NorthWestPrestigeAndPerformanceMotorCompanyLimitedRegisteredBusiness' };
      await route.fulfill({ response, json: settings });
    });
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    const brand = page.getByRole('button', { name: `${name} home`, exact: true });
    await expect(brand).toHaveAttribute('title', name);
    await expect.poll(() => brand.evaluate(element => {
      const item = element.getBoundingClientRect();
      const row = element.closest('.site-header-inner')!.getBoundingClientRect();
      return item.top >= row.top - 1 && item.bottom <= row.bottom + 1;
    })).toBe(true);
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    const copyright = page.locator('.footer-bottom p').first();
    await copyright.scrollIntoViewIfNeeded();
    await expect(copyright).toContainText('NorthWestPrestigeAndPerformanceMotorCompanyLimitedRegisteredBusiness');
    await expect.poll(() => copyright.evaluate(element => {
      const rect = element.getBoundingClientRect();
      return rect.left >= 0 && rect.right <= innerWidth + 1;
    })).toBe(true);
  });
}
