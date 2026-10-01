import { test, expect } from '@playwright/test';

for (const viewport of [{ width: 844, height: 390 }, { width: 740, height: 360 }]) {
  test(`landscape gallery keeps a large photo and accessible actions at ${viewport.width}`, async ({ page, request }) => {
    await page.setViewportSize(viewport);
    const stock = await (await request.get('/api/stock')).json();
    await page.goto(`/vehicle/${stock.cars[0].id}`);
    await page.getByRole('button', { name: 'View gallery fullscreen' }).click();
    const gallery = page.getByRole('dialog', { name: 'Vehicle image gallery' });
    const photo = gallery.locator('.vehicle-lightbox-photo');
    const photoBounds = await photo.boundingBox();
    expect(photoBounds!.height).toBeGreaterThan(viewport.height * 0.5);
    expect(photoBounds!.width).toBeGreaterThan(viewport.width * 0.8);

    for (const button of [
      gallery.getByRole('button', { name: 'Next photograph' }),
      gallery.getByRole('button', { name: 'Previous photograph' }),
      gallery.getByRole('button', { name: 'Close', exact: true }),
      gallery.getByRole('button', { name: 'Message', exact: true }),
      gallery.getByRole('link', { name: /Show phone number/ }),
    ]) {
      await expect(button).toBeInViewport();
      // Wait for the opening zoom transition before measuring the touch targets.
      await expect.poll(async () => Math.round((await button.boundingBox())!.height)).toBeGreaterThanOrEqual(44);
      await expect.poll(async () => Math.round((await button.boundingBox())!.width)).toBeGreaterThanOrEqual(44);
    }

    const counter = gallery.locator('.vehicle-lightbox-navigation p');
    await expect(counter).toContainText('1 /');
    await page.keyboard.press('ArrowRight');
    await expect(counter).toContainText('2 /');
    await gallery.getByRole('button', { name: 'Previous photograph' }).click();
    await expect(counter).toContainText('1 /');
    await gallery.getByRole('link', { name: /Show phone number/ }).click();
    await expect(page.getByRole('dialog')).toHaveCount(2);
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(1);
    await page.screenshot({ path: `/tmp/gallery-landscape-${viewport.width}.png` });
    await gallery.getByRole('button', { name: 'Message', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.locator('#vehicle-enquiry-heading')).toBeFocused();
    await expect(page.locator('#vehicle-enquiry-heading')).toBeInViewport();
  });
}
