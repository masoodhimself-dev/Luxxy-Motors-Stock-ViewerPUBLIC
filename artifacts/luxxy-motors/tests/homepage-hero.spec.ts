import { expect, test } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
test.skip(process.env.LUXXY_LOCAL_PREVIEW !== '1', 'Local fixtures only');
for (const width of [390, 1440]) {
  test(`used-car hero search and stock browsing at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/');
    const hero = page.getByRole('form', { name: 'Search used cars' });
    await expect(hero).toBeVisible();
    await expect(page.getByTestId('input-showroom-search')).toHaveCount(0);
    const strip = page.locator('.rolling-stock-window');
    await page.getByRole('button', {name: 'Pause cars'}).click();
    await expect(strip).toHaveAttribute('data-paused', 'true');
    if (width === 1440) {
      const card = await strip.locator('.rolling-stock-group').first().locator('article').first().boundingBox();
      expect(card!.width).toBeGreaterThan(300);
      expect(card!.width).toBeLessThan(360);
    }
    await page.screenshot({path: '/tmp/luxxy-rolling-' + width + '.png', fullPage: true, animations: 'disabled'});

    await expect(hero.getByRole('combobox', { name: 'Search model', exact: true })).toBeDisabled();
    await expect(page.getByTestId('showroom-hero-photo').locator('img')).toHaveJSProperty('complete', true);
    await expect(page.getByRole('button', { name: /^Search \d+ used cars$/ })).toBeVisible();
    await expect(hero).not.toContainText(/monthly|finance|new cars/i);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await mkdir('../../docs/screenshots/rolling-stock', { recursive: true });
    await page.screenshot({ path: `../../docs/screenshots/rolling-stock/hero-${width}.png`, animations: 'disabled' });
    await hero.getByRole('combobox', { name: 'Search make', exact: true }).selectOption('MG');
    await hero.getByRole('combobox', { name: 'Search model', exact: true }).selectOption('MG HS');
    await hero.getByRole('button', { name: 'Search 1 used car', exact: true }).click();
    await expect(page).toHaveURL(/\/stock$/);
    await expect(page.getByRole('heading', {name: 'Browse Stock'})).toBeVisible();
    await expect(page.locator('[data-testid^="card-vehicle-"]')).toHaveCount(1);
    await expect(page.getByTestId('card-vehicle-preview-2')).toBeVisible();
    await page.goto('/');
    await hero.getByRole('combobox', { name: 'Search make', exact: true }).selectOption('');
    await hero.getByRole('combobox', { name: 'Search maximum price', exact: true }).selectOption('5000');
    await hero.getByRole('button', { name: /^Search/ }).click();
    await expect(page.getByTestId('card-vehicle-preview-4')).toBeVisible();

    await page.goto('/');
    await hero.getByRole('combobox', { name: 'Search maximum price', exact: true }).selectOption('');
    await hero.getByText('Advanced options', { exact: true }).click();
    await hero.getByRole('combobox', { name: 'Search transmission', exact: true }).selectOption('Automatic');
    await hero.getByRole('button', { name: /^Search/ }).click();
    await expect(page.locator('[data-testid^="card-vehicle-"]').first()).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: `../../docs/screenshots/rolling-stock/stock-${width}.png`, animations: 'disabled' });
    const first = page.locator('[data-testid^="card-vehicle-"]').first();
    await first.getByRole('button', { name: /^Next photo/ }).click();
    await expect(first).toContainText('2 /');
    await first.getByRole('button', { name: /^Save .* to your saved cars/ }).click();
    await first.getByRole('link', {name: /View vehicle/}).click();
    await expect(page).toHaveURL(/\/vehicle\//);
    await page.getByRole('link', {name: 'Back to Browse Stock'}).click();
    await expect(page).toHaveURL(/\/stock$/);
    await expect(page.getByRole('heading', {name: 'Browse Stock'})).toBeAttached();
  });
}

test('rolling cars move left, pause and respect reduced motion', async ({ page }) => {
  await page.goto('/');
  const track = page.locator('.rolling-stock-track');
  await page.mouse.move(0, 0);
  const before = await track.evaluate(node => new DOMMatrix(getComputedStyle(node).transform).m41);
  await expect.poll(() => track.evaluate(node => new DOMMatrix(getComputedStyle(node).transform).m41)).toBeLessThan(before - 5);
  await page.getByRole('button', {name: 'Pause cars'}).click();
  await expect(track).toHaveCSS('animation-play-state', 'paused');
  await page.emulateMedia({reducedMotion: 'reduce'});
  await expect(track).toHaveCSS('animation-name', 'none');
  await expect(page.locator('.rolling-stock-copy')).toBeHidden();
  await page.goto('/#stock');
  await expect(page).toHaveURL(/\/stock$/);
  await expect(page.getByRole('heading', {name: 'Browse Stock'})).toBeVisible();
});
