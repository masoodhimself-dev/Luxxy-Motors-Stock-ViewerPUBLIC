import { test, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
test.skip(process.env.LUXXY_LOCAL_PREVIEW !== '1', 'Local fixtures only');
for (const width of [390, 1440]) {
  test(`customer reviews at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/');
    const section = page.getByRole('region', { name: 'What our customers say' });
    await section.scrollIntoViewIfNeeded();
    await expect(section.getByRole('listitem')).toHaveCount(20);
    await expect(section.getByText('James W.', { exact: true })).toBeVisible();
    await expect(section.getByRole('link')).toHaveCount(0);
    const list = section.getByRole('list');
    await section.getByRole('button', { name: 'Next reviews' }).click();
    await expect.poll(() => list.evaluate(node => node.scrollLeft)).toBeGreaterThan(100);
    await section.getByRole('button', { name: 'Previous reviews' }).click();
    await expect.poll(() => list.evaluate(node => node.scrollLeft)).toBeLessThan(3);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await mkdir('../../docs/screenshots/customer-reviews', { recursive: true });
    await section.screenshot({ path: `../../docs/screenshots/customer-reviews/reviews-${width}.png` });
  });
}
