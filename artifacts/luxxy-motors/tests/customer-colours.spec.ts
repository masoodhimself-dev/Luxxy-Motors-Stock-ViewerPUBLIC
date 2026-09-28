import { test, expect } from '@playwright/test';

// Exercise the coloured customer surfaces with enabled services and a real shortlist.
// Dealer settings are overridden in this browser only; no settings are saved.
for (const width of [390, 1280]) {
  test(`customer colours and actions at ${width}px`, async ({ page, request }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const settings = await (await request.get('/api/dealer-settings')).json();
    settings.warranty = { ...settings.warranty, enabled: true };
    await page.route('**/api/dealer-settings', route => route.fulfill({ json: settings }));
    const capture = async (name: string) => {
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
      await page.screenshot({ path: `/tmp/customer-colours-${width}-${name}.png` });
    };

    await page.goto('/stock?all=1');
    await expect(page.locator('.vehicle-card').first()).toBeVisible();
    await expect.poll(() => page.locator('.vehicle-card img').first().evaluate(image => (image as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
    await capture('stock');
    await page.locator('.vehicle-card').first().getByRole('button', { name: /Save .* to your saved cars/ }).click();
    await page.goto('/saved');
    await expect(page.getByTestId('text-saved-count')).toContainText('1 car');
    await expect(page.getByRole('button', { name: 'Share shortlist' })).toBeVisible();
    await expect.poll(() => page.locator('.vehicle-card img').first().evaluate(image => (image as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
    await capture('saved');

    await page.goto('/contact');
    await expect(page.getByTestId('contact-phone')).toBeVisible();
    await capture('contact');
    await page.locator('#contact-message').scrollIntoViewIfNeeded();
    await expect(page.getByTestId('input-customer-name')).toBeVisible();
    const reception = page.locator('#contact-message img');
    if (await reception.count()) await expect.poll(() => reception.evaluate(image => (image as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
    await capture('contact-form');

    await page.goto('/warranty');
    await expect(page.getByRole('link', { name: 'Ask about warranty', exact: true })).toBeVisible();
    await capture('warranty');
    await page.getByRole('link', { name: 'Ask about warranty', exact: true }).click();
    await expect(page.locator('#warranty-enquiry-heading')).toBeFocused();
    await capture('warranty-enquiry');

    await page.goto('/enquire?type=viewing&vehicleId=preview-2');
    await expect(page.getByTestId('group-viewing-slots')).toBeVisible();
    await expect(page.getByTestId('section-viewing-availability')).toHaveCSS('opacity', '1');
    await capture('test-drive');
    await page.goto('/enquire?type=part_exchange&vehicleId=preview-2');
    await expect(page.locator('h1')).toBeVisible();
    await capture('part-exchange');
  });
}
