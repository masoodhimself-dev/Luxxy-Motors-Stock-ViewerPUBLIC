import { test, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
test.skip(process.env.LUXXY_LOCAL_PREVIEW !== '1', 'Local preview only');
for (const width of [390, 834, 1194]) {
  test(`browse and enquire at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/stock');
    const cards = page.locator('[data-testid^="card-vehicle-"]');
    await expect(cards.first()).toBeVisible();
    await expect(cards.first().locator('img').first()).toHaveAttribute('loading', 'eager');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const card = cards.nth(3);
    await card.scrollIntoViewIfNeeded();
    const before = await page.evaluate(() => window.scrollY);
    await card.getByRole('link', { name: /View full details/ }).click();
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    const gallery = page.locator('.touch-pan-y').first();
    const image = gallery.locator('img').first();
    const initial = await image.getAttribute('src');
    await gallery.evaluate(node => {
      node.dispatchEvent(new TouchEvent('touchstart', { bubbles: true, touches: [new Touch({ identifier: 1, target: node, clientX: 300, clientY: 200 })] }));
      node.dispatchEvent(new TouchEvent('touchend', { bubbles: true, changedTouches: [new Touch({ identifier: 1, target: node, clientX: 80, clientY: 205 })] }));
    });
    await expect.poll(() => gallery.locator('img').last().getAttribute('src')).not.toBe(initial);
    const enquiry = page.locator('#vehicle-enquiry');
    await enquiry.scrollIntoViewIfNeeded();
    await expect(page.getByTestId('mobile-conversion-bar')).toHaveCount(0);
    if (width === 834) await page.setViewportSize({ width: 1194, height: 834 });
    await page.getByRole('link', { name: 'Back to Browse Stock' }).click();
    await expect(cards.nth(3)).toBeAttached();
    if (width !== 834) await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(Math.max(0, before - 150));
    else await expect(cards.nth(3).getByRole('link', { name: /View full details/ })).toBeInViewport();
    await mkdir('../../docs/screenshots/customer-polish', { recursive: true });
    await page.screenshot({ path: `../../docs/screenshots/customer-polish/stock-${width}.png` });
  });
}
test('settings show draft previews and launch checks', async ({ page }) => {
  await page.goto('/portal');
  await page.getByTestId('tab-settings').click();
  await page.getByText(/Launch readiness ·/).click();
  await expect(page.getByText('Replace the sample address', { exact: true })).toBeVisible();
  await expect(page.getByText('Payments are simulated — connect and test payments before launch', { exact: true })).toBeVisible();
  await page.getByText('Preview your draft appearance', { exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Customer review preview' })).toBeVisible();
  await page.screenshot({ path: '../../docs/screenshots/customer-polish/settings.png' });
});
