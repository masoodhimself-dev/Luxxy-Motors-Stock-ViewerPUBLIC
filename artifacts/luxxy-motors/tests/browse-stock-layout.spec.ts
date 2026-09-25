import { expect, test } from '@playwright/test';
import { mkdir } from 'node:fs/promises';

test.skip(process.env.LUXXY_LOCAL_PREVIEW !== '1', 'Local preview only');
for (const width of [390, 1440]) {
  test(`Browse Stock toolbar and cards at ${width}px`, async ({page}) => {
    await page.setViewportSize({width, height: 900});
    await page.goto('/stock');
    const toolbar = page.getByTestId('stock-search-toolbar');
    await expect(page.getByRole('heading', {name: 'Browse Stock'})).toBeVisible();
    await expect(page.getByRole('button', {name: 'View matching cars'})).toHaveCount(0);
    const cards = page.locator('.browse-stock .vehicle-card-grid');
    await expect(cards).toHaveCount(6);
    if (width === 1440) {
      const first = await cards.nth(0).boundingBox();
      const third = await cards.nth(2).boundingBox();
      const fourth = await cards.nth(3).boundingBox();
      expect(Math.abs(first!.y - third!.y)).toBeLessThan(2);
      expect(fourth!.y).toBeGreaterThan(first!.y + 200);
      expect(first!.width).toBeGreaterThan(380);
    } else {
      await page.evaluate(() => window.scrollTo(0, 500));
      const headerHeight = await page.locator('[data-site-header]').evaluate(el => el.getBoundingClientRect().height);
      expect(Math.abs((await toolbar.boundingBox())!.y - headerHeight)).toBeLessThan(3);
    }
    await page.getByRole('button', {name: 'Advanced search'}).click();
    await page.getByRole('combobox', {name:'Make', exact:true}).selectOption('MG');
    await expect(cards).toHaveCount(2);
    await page.getByRole('button', {name: 'Advanced search'}).click();
    await expect(page.getByRole('button', {name:'Remove MG filter'})).toBeVisible();
    await page.getByLabel('Sort results').selectOption('price-asc');
    await expect(cards.first()).toContainText('MG ZS');
    await page.getByRole('button', {name:'Clear all', exact:true}).click();
    await expect(cards).toHaveCount(6);
    await expect(page.getByLabel('Sort results')).toHaveValue('');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.evaluate(() => window.scrollTo({top:0, behavior:'instant'}));
    await mkdir('../../docs/screenshots/browse-stock-refinement', {recursive:true});
    await page.screenshot({path: `../../docs/screenshots/browse-stock-refinement/stock-${width}.png`, animations:'disabled'});
  });
}
