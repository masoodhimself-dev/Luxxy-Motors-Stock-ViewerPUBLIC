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
    await expect(strip.locator('.rolling-stock-group')).toHaveCount(1);
    await expect(strip.locator('.rolling-stock-copy')).toHaveCount(0);
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
    await expect(page.getByRole('button', { name: /^Search \d+ cars?$/ })).toBeVisible();
    await expect(hero).not.toContainText(/monthly|finance|new cars/i);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await mkdir('../../docs/screenshots/rolling-stock', { recursive: true });
    await page.screenshot({ path: `../../docs/screenshots/rolling-stock/hero-${width}.png`, animations: 'disabled' });
    await hero.getByRole('combobox', { name: 'Search make', exact: true }).selectOption('MG');
    await hero.getByRole('combobox', { name: 'Search model', exact: true }).selectOption('MG HS');
    await hero.getByRole('button', { name: 'Search 1 car', exact: true }).click();
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
    const vehicleLink = first.locator('h3 a');
    const vehicleHref = await vehicleLink.getAttribute('href');
    await vehicleLink.click();
    await expect(page).toHaveURL(new RegExp(`${vehicleHref!}$`));
    await page.getByRole('link', {name: 'Back to your results'}).click();
    await expect(page).toHaveURL(/\/stock(?:\?.*)?$/);
    await expect(page.getByRole('heading', {name: 'Browse Stock'})).toBeAttached();
  });
}

test('featured cars stay still until browsed and respect reduced motion', async ({ page }) => {
  await page.goto('/');
  const viewport = page.locator('.rolling-stock-window');
  await page.mouse.move(0, 0);
  await expect(viewport.locator('article').first()).toBeVisible();
  await expect(viewport.locator('.rolling-stock-group')).toHaveCount(1);
  await expect(viewport.locator('.rolling-stock-copy')).toHaveCount(0);
  const initialScroll = await viewport.evaluate(node => node.scrollLeft);
  await page.waitForTimeout(4200);
  expect(await viewport.evaluate(node => node.scrollLeft)).toBe(initialScroll);
  await page.getByRole('button', { name: 'Next featured cars' }).click();
  await expect.poll(() => viewport.evaluate(node => node.scrollLeft)).toBeGreaterThan(initialScroll + 40);
  await expect(page).toHaveURL(/\/$/);
  await page.emulateMedia({reducedMotion: 'reduce'});
  const beforePrevious = await viewport.evaluate(node => node.scrollLeft);
  await page.getByRole('button', { name: 'Previous featured cars' }).click();
  await expect.poll(() => viewport.evaluate(node => node.scrollLeft)).toBeLessThan(beforePrevious);
  await page.goto('/#stock');
  await expect(page).toHaveURL(/\/stock(?:\?.*)?$/);
  await expect(page.getByRole('heading', {name: 'Browse Stock'})).toBeVisible();
});

test('homepage has one visit section and featured title links open the full vehicle', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  const hero = page.getByRole('form', { name: 'Search used cars' });
  await expect(hero.getByRole('combobox')).toHaveCount(2);
  await expect(page.getByRole('heading', { name: 'Plan your visit' })).toHaveCount(1);
  await expect(page.getByRole('heading', { name: 'Meet the team' })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Featured cars' })).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  const cards = page.locator('.rolling-stock-group').first().locator('article');
  // Read the visible card so the assertion also works after manual browsing.
  const visibleIndex = await cards.evaluateAll(elements => elements.findIndex(element => {
    const bounds = element.getBoundingClientRect();
    return bounds.left + bounds.width / 2 > 0 && bounds.left + bounds.width / 2 < innerWidth;
  }));
  expect(visibleIndex).toBeGreaterThanOrEqual(0);
  const card = cards.nth(visibleIndex);
  await expect(card.getByText('Available', { exact: true })).toHaveCount(0);
  const link = card.locator('h3 a');
  const href = await link.getAttribute('href');
  await link.click();
  await expect(page).toHaveURL(new RegExp(href! + '$'));
});
