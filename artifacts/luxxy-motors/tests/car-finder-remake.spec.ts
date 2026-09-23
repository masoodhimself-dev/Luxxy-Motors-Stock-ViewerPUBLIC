import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';

test.skip(process.env.LUXXY_LOCAL_PREVIEW !== '1', 'Uses local stock fixtures.');
for (const width of [390, 1440]) {
  test(`guided car finder at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/find-my-car');
    await expect(page.getByTestId('button-next-question')).toBeDisabled();
    const directory = resolve('../../docs/screenshots/car-finder-remake');
    await mkdir(directory, { recursive: true });
    await page.screenshot({ path: resolve(directory, `questions-${width}.png`), fullPage: true });
    const values = ['10000-15000', 'suv', 'petrol', 'automatic', 'family'];
    for (let index = 0; index < values.length; index++) {
      await page.getByTestId(`option-${values[index]}`).click();
      await page.getByTestId(index === 4 ? 'button-see-matches' : 'button-next-question').click();
      await expect(page.locator(index === 4 ? '#results-title' : '#question-title')).toBeFocused();
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    }
    await expect(page.getByTestId('list-recommendations').locator(':scope > div')).toHaveCount(3);
    await page.evaluate(async () => {
      const images = Array.from(document.images);
      images.forEach(image => { image.loading = 'eager'; });
      await Promise.race([Promise.all(images.map(image => image.decode().catch(() => undefined))), new Promise(resolve => setTimeout(resolve, 5000))]);
      window.scrollTo({ top: 0, behavior: 'instant' });
    });
    await page.screenshot({ path: resolve(directory, `results-${width}.png`), fullPage: true });
    await page.getByTestId('button-change-answers').click();
    await page.getByRole('button', { name: 'Edit Fuel: Petrol', exact: true }).click();
    await expect(page.locator('#question-title')).toBeFocused();
    await expect(page.getByTestId('option-petrol')).toHaveAttribute('aria-pressed', 'true');
    await page.getByTestId('option-diesel').click();
    await expect(page.getByRole('button', { name: 'Edit Fuel: Diesel', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Update my matches', exact: true }).click();
    await expect(page.locator('#results-title')).toBeFocused();
    await page.getByTestId('button-change-answers').click();
    await page.getByTestId('button-restart-quiz').click();
    await expect(page.getByTestId('button-next-question')).toBeDisabled();
    await expect(page.getByText('0 of 5 answered')).toBeVisible();
    await page.getByRole('link', { name: 'Browse all stock' }).click();
    await expect(page).toHaveURL(/\/#stock$/);
  });
}
