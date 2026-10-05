import { expect, test } from '@playwright/test';

test.skip(process.env.LUXXY_LOCAL_PREVIEW !== '1', 'Local preview only.');

test.beforeEach(async ({ page, request }) => {
  const stock = await (await request.get('/api/stock')).json();
  const car = {
    ...stock.cars[0],
    sourceExtras: {
      ...stock.cars[0].sourceExtras,
      historyExtras: { ownersData: { value: 2 }, serviceHistory: { description: 'Partial service history' } },
      runningCosts: { items: [{ label: 'Tax per year', value: '£20' }, { label: 'Insurance group', value: '11E' }, { label: 'Average', value: '61.4mpg' }] },
      vehicleHighlights: [],
    },
  };
  await page.route('**/api/stock', route => route.fulfill({ json: { ...stock, cars: [car], count: 1 } }));
});

test('desktop hover explains a fact and allows the pointer into the explanation', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 950 });
  await page.goto('/stock');
  const term = page.getByRole('button', { name: '2 previous keepers', exact: true });
  await term.hover();
  const help = page.getByRole('tooltip');
  await expect(help).toContainText('previous registered keepers');
  await help.hover();
  await expect(help).toBeVisible();
  await page.mouse.move(0, 0);
  await expect(help).toBeHidden();
  await term.hover();
  await expect(help).toBeVisible();
  await page.screenshot({ path: '/tmp/luxxy-customer-help-desktop.png', animations: 'disabled' });
});

test('keyboard help opens on focus and closes with Escape', async ({ page }) => {
  await page.goto('/stock');
  const term = page.locator('.vehicle-specs button').first();
  await term.focus();
  await expect(page.getByRole('tooltip')).toContainText('first registered');
  await term.press('Escape');
  await expect(page.getByRole('tooltip')).toBeHidden();
  await expect(term).toBeFocused();
});

test('action explanations do not consume the Save click', async ({ page }) => {
  await page.goto('/stock');
  const save = page.getByRole('button', { name: /^Save .* to your saved cars$/ });
  await save.hover();
  await expect(page.getByRole('tooltip')).toContainText('return to it later');
  await save.click();
  await expect(page.getByRole('button', { name: /^Remove .* from your saved cars$/ })).toHaveAttribute('aria-pressed', 'true');
  await expect(page).toHaveURL(/\/stock$/);
});

for (const width of [390, 820]) {
  test.describe(`touch help at ${width}px`, () => {
    test.use({ viewport: { width, height: 950 }, isMobile: true, hasTouch: true });
    test('tap explains facts without navigating, and detail explanations fit the screen', async ({ page }) => {
      await page.goto('/stock');
      const term = page.getByRole('button', { name: '£20 annual tax', exact: true });
      await term.tap();
      const help = page.getByRole('tooltip');
      await expect(help).toContainText('Confirm the current amount');
      await expect(page).toHaveURL(/\/stock$/);
      const bounds = await help.boundingBox();
      expect(bounds!.x).toBeGreaterThanOrEqual(0);
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
      await term.tap();
      await expect(help).toBeHidden();
      await page.locator('.vehicle-card h3 a').click();
      await expect(page).toHaveURL(/\/vehicle\//);
      const insurance = page.getByRole('button', { name: 'Insurance group', exact: true });
      await insurance.tap();
      await expect(help).toContainText('actual quote');
      await page.screenshot({ path: `/tmp/luxxy-customer-help-${width}.png`, animations: 'disabled' });
      await insurance.press('Escape');
      const history = page.getByRole('button', { name: 'Service history', exact: true });
      await history.tap();
      await expect(help).toContainText('history may have gaps');
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    });
  });
}
