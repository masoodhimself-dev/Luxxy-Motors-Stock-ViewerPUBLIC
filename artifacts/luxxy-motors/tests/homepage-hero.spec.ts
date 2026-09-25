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
      expect(card!.width).toBeLessThanOrEqual(360);
    }
    await page.evaluate(() => { (document.activeElement as HTMLElement)?.blur(); window.scrollTo({top: 0, behavior: 'instant'}); });
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
    await page.screenshot({path: '/tmp/luxxy-rolling-' + width + '.png', fullPage: true, animations: 'disabled'});

    if (width === 390) await hero.getByText('More filters', { exact: true }).click();
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
    await expect(page).toHaveURL(/\/stock(?:\?.*)?$/);
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
    await hero.getByText('More filters', { exact: true }).click();
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
    await expect(page).toHaveURL(/\/stock(?:\?.*)?$/);
    await expect(page.getByRole('heading', {name: 'Browse Stock'})).toBeAttached();
  });
}

test('rolling cars move left, pause and respect reduced motion', async ({ page }) => {
  await page.goto('/');
  const viewport = page.locator('.rolling-stock-window');
  await page.mouse.move(0, 0);
  const step = await viewport.locator('article').first().evaluate(node => node.getBoundingClientRect().width);
  await expect.poll(() => viewport.evaluate(node => node.scrollLeft), {timeout: 6500}).toBeGreaterThan(step - 2);
  expect(await viewport.evaluate(node => node.scrollLeft)).toBeLessThan(step + 2);
  await page.getByRole('button', {name: 'Pause cars'}).click();
  await expect(viewport).toHaveAttribute('data-paused', 'true');
  await page.emulateMedia({reducedMotion: 'reduce'});
  await expect(page.locator('.rolling-stock-copy')).toBeHidden();
  await page.goto('/#stock');
  await expect(page).toHaveURL(/\/stock(?:\?.*)?$/);
  await expect(page.getByRole('heading', {name: 'Browse Stock'})).toBeVisible();
});

test('homepage has one visit section and a clickable featured price panel', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  const hero = page.getByRole('form', { name: 'Search used cars' });
  await expect(hero.getByRole('combobox')).toHaveCount(2);
  await expect(page.getByRole('heading', { name: 'Plan your visit' })).toHaveCount(1);
  await expect(page.getByRole('heading', { name: 'Meet the team' })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Featured cars' })).toBeVisible();
  await page.getByRole('button', { name: 'Pause cars' }).click();
  const card = page.locator('.rolling-stock-group').first().locator('article').first();
  await expect(card.getByText('Available', { exact: true })).toHaveCount(0);
  const link = card.locator('h3 a');
  const href = await link.getAttribute('href');
  const bounds = await card.boundingBox();
  await page.mouse.click(bounds!.x + bounds!.width / 2, bounds!.y + bounds!.height - 12);
  await expect(page).toHaveURL(new RegExp(href! + '$'));
});
