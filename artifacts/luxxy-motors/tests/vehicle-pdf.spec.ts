import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';

test.skip(process.env.LUXXY_LOCAL_PREVIEW !== '1', 'Uses read-only local preview stock.');
for (const width of [390, 1440]) {
  test(`vehicle print sheet at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.addInitScript(() => { window.print = () => { document.documentElement.dataset.printRequested = 'true'; }; });
    await page.goto('/vehicle/preview-4');
    const button = page.getByTestId('button-print-vehicle');
    await expect(button).toHaveAccessibleName(/Print vehicle details for .*Jeep Renegade/);
    await button.scrollIntoViewIfNeeded();
    await button.focus();
    await expect(button).toBeFocused();
    expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await button.press('Enter');
    await expect(page.locator('html')).toHaveAttribute('data-print-requested', 'true');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.emulateMedia({ media: 'print' });
    await expect(page.locator('.vehicle-print-sheet')).toBeVisible();
    await expect(page.locator('#root')).toBeHidden();
    const images = page.locator('.vehicle-print-sheet img');
    expect(await images.count()).toBeGreaterThan(0);
    expect(await images.evaluateAll(images => images.every(img => (img as HTMLImageElement).naturalWidth > 0))).toBe(true);
    const directory = resolve('../../output/pdf');
    await mkdir(directory, { recursive: true });
    await page.pdf({ path: resolve(directory, `luxxy-vehicle-print-${width}.pdf`), preferCSSPageSize: true, printBackground: true, displayHeaderFooter: false });
  });
}

test('long print summaries remain within one printable sheet', async ({ page }) => {
  await page.goto('/vehicle/preview-2');
  await page.emulateMedia({ media: 'print' });
  await page.locator('.vehicle-print-sheet').evaluate(sheet => {
    sheet.querySelector('h1')!.textContent = 'A long vehicle make and model with a detailed trim specification '.repeat(2).slice(0, 110);
    sheet.querySelector('.vehicle-print-description p')!.textContent = 'Detailed vehicle description and supplied maintenance information. '.repeat(12).slice(0, 650);
    sheet.querySelector('.vehicle-print-features')!.innerHTML = '<h2>Features & equipment</h2><ul>' + Array.from({length: 15}, () => '<li>' + 'Long equipment description with additional specification information.'.slice(0, 68) + '</li>').join('') + '</ul><p>+ 25 more features on the vehicle page.</p>';
  });
  const dimensions = await page.locator('.vehicle-print-sheet').evaluate(sheet => ({ height: sheet.clientHeight, scroll: sheet.scrollHeight }));
  expect(dimensions.scroll).toBeLessThanOrEqual(dimensions.height + 1);
  await page.pdf({ path: resolve('../../output/pdf/luxxy-vehicle-print-long.pdf'), preferCSSPageSize: true, printBackground: true, displayHeaderFooter: false });
});
