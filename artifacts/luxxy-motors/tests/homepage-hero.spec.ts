import { expect, test } from '@playwright/test';
import { mkdir } from 'node:fs/promises';

test.skip(process.env.LUXXY_LOCAL_PREVIEW !== '1', 'Uses local fixture stock only');

for (const width of [390, 1440]) {
  test(`homepage introduction stays balanced and independent of featured stock at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.route('**/api/dealer-settings', async route => {
      const response = await route.fetch();
      const settings = await response.json();
      await route.fulfill({
        response,
        json: {
          ...settings,
          identity: { ...settings.identity, name: 'Luxxy Motors' },
          hero: {
            ...settings.hero,
            copy: 'Find your next car.',
            subcopy: 'Independent used-car dealership in Harrow. Browse our stock and arrange a viewing.',
            primaryCta: 'Browse cars',
          },
          featuredVehicleIds: ['preview-1', 'preview-2'],
          presentation: { ...settings.presentation, heroImageUrl: '', heroImageAlt: '' },
        },
      });
    });
    await page.goto('/');
    const copy = page.getByTestId('showroom-hero-copy');
    const photo = page.getByTestId('showroom-hero-photo');
    await expect(copy.getByRole('heading', { name: 'Find your next car.' })).toBeVisible();
    await expect(copy.getByRole('link', { name: 'Browse cars' })).toBeVisible();
    await expect(photo).toHaveAttribute('href', '/#stock');
    await expect(photo).toHaveAccessibleName('Explore our current stock');
    await expect(photo.locator('img')).toHaveAttribute('src', /luxxy-hero/);
    await expect(photo).not.toContainText('£');
    await expect(photo.locator('img')).toHaveJSProperty('complete', true);
    expect(await photo.locator('img').evaluate(image => (image as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);

    const copyBounds = await copy.boundingBox();
    const photoBounds = await photo.boundingBox();
    if (!copyBounds || !photoBounds) throw new Error('The homepage introduction must be rendered');
    if (width >= 1024) {
      expect(Math.abs(copyBounds.y - photoBounds.y)).toBeLessThan(2);
      expect(Math.abs(copyBounds.height - photoBounds.height)).toBeLessThan(2);
      expect(copyBounds.height).toBeLessThanOrEqual(480);
      expect(photoBounds.width / copyBounds.width).toBeGreaterThan(1.3);
      expect(photoBounds.width / copyBounds.width).toBeLessThan(1.8);
    } else {
      expect(Math.abs(copyBounds.width - photoBounds.width)).toBeLessThan(2);
      expect(Math.abs(photoBounds.y - copyBounds.y - copyBounds.height)).toBeLessThan(2);
      expect(photoBounds.width / photoBounds.height).toBeCloseTo(16 / 9, 1);
      expect(copyBounds.height + photoBounds.height).toBeLessThan(540);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    const notice = page.getByRole('complementary', { name: 'Preview mode' });
    const noticeBounds = await notice.boundingBox();
    expect(noticeBounds?.y).toBeGreaterThan(photoBounds.y + photoBounds.height);
    expect(await notice.evaluate(node => getComputedStyle(node).position)).toBe('static');
    await mkdir('../../docs/screenshots/homepage-hero', { recursive: true });
    await page.screenshot({ path: `../../docs/screenshots/homepage-hero/home-${width}.png` });

    await copy.getByRole('link', { name: 'Browse cars' }).click();
    await expect(page).toHaveURL(/#stock$/);
    await expect(page.locator('#stock')).toBeInViewport();
    await page.goto('/');
    await photo.click();
    await expect(page).toHaveURL(/#stock$/);
    await expect(page.locator('#stock')).toBeInViewport();
  });
}
