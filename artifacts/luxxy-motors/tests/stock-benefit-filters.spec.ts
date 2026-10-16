import { expect, test } from '@playwright/test';

test.skip(process.env.LUXXY_LOCAL_PREVIEW !== '1', 'Fictional stock in isolated local preview only.');
test.use({ serviceWorkers: 'block', reducedMotion: 'reduce' });

for (const width of [320, 820, 1440]) {
  test(`supplied vehicle benefits stay usable and shareable at ${width}px`, async ({ page, request }) => {
    await page.setViewportSize({ width, height: 900 });
    const base = await (await request.get('/api/stock')).json();
    const cost = (tax: string, group: string) => ({ runningCosts: { items: [
      { key: 'Tax', label: 'Tax per year', value: tax },
      { key: 'Insurance', label: 'Insurance group', value: group },
    ] } });
    const fixture = [
      { id: 'fictional-benefits-0', mileage: 30000, fuel: 'Diesel', emissionClass: 'Euro 6', sourceExtras: cost('£35', '15E') },
      { id: 'fictional-benefits-1', mileage: 30001, fuel: 'Diesel', emissionClass: 'Euro 6', sourceExtras: cost('£36', '16E') },
      { id: 'fictional-benefits-2', mileage: 1000, fuel: 'Diesel', emissionClass: 'Euro 5', sourceExtras: cost('£0', '8E') },
      { id: 'fictional-benefits-3', mileage: null, fuel: null, emissionClass: 'Euro 6', sourceExtras: null },
      { id: 'fictional-benefits-sold', mileage: 1000, fuel: 'Diesel', emissionClass: 'Euro 6', sourceExtras: cost('£20', '8E'), inventoryStatus: 'sold' },
    ].map((details, i) => ({ ...base.cars[0], specifications: null, title: `Fictional benefit car ${i}`, inventoryStatus: 'available', ...details }));
    await page.route('**/api/**', route => {
      if (!['GET', 'HEAD'].includes(route.request().method())) return route.abort('blockedbyclient');
      if (new URL(route.request().url()).pathname === '/api/stock') return route.fulfill({ json: { ...base, count: fixture.length, cars: fixture } });
      return route.continue();
    });
    await page.goto('/stock');
    await expect(page.getByTestId('text-filtered-stock-count')).toHaveText('4 vehicles available');
    await page.getByRole('button', { name: 'Advanced search', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Filter used cars' });
    await expect(dialog).toBeVisible();
    await expect(page.getByTestId('button-quick-low-mileage')).toHaveText('Up to 30,000 miles (2)');
    await expect(page.getByTestId('button-quick-ulez')).toHaveText('ULEZ compliant (2)');
    await expect(page.getByTestId('button-quick-lowAnnualTax')).toHaveText('Road tax up to £35/year (2)');
    await expect(page.getByTestId('button-quick-lowInsuranceGroup')).toHaveText('Insurance groups 1–15 (2)');
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width + 1);
    const overflow = await dialog.locator('.stock-quick-choices button').evaluateAll(buttons => buttons.flatMap(button => {
      const box = button.getBoundingClientRect();
      return box.width > 0 && (box.left < 0 || box.right > innerWidth + 1) ? [button.textContent] : [];
    }));
    expect(overflow).toEqual([]);
    await page.getByTestId('button-quick-low-mileage').click();
    await expect(dialog).not.toBeVisible();
    await expect(page.getByTestId('text-filtered-stock-count')).toHaveText('2 cars match your search');
    await expect(page).toHaveURL(/lowMileage=true/);
    await page.getByRole('button', { name: 'Advanced search', exact: true }).click();
    await expect(page.getByTestId('button-quick-low-mileage')).toHaveAttribute('aria-pressed', 'true');
    await page.getByTestId('button-quick-ulez').click();
    await expect(page.getByTestId('text-filtered-stock-count')).toHaveText('1 car matches your search');
    await expect(page.getByTestId('card-vehicle-fictional-benefits-0')).toBeVisible();
    await expect(page.getByTestId('card-vehicle-fictional-benefits-1')).toHaveCount(0);
    await page.reload();
    await expect(page.getByTestId('text-filtered-stock-count')).toHaveText('1 car matches your search');
    await page.getByRole('button', { name: 'Remove ULEZ compliant filter' }).click();
    await expect(page.getByTestId('text-filtered-stock-count')).toHaveText('2 cars match your search');
    await page.getByRole('button', { name: 'Reset all', exact: true }).click();
    await expect(page).toHaveURL(/\/stock$/);
    await expect(page.getByTestId('text-filtered-stock-count')).toHaveText('4 vehicles available');
    await page.getByRole('button', { name: 'Advanced search', exact: true }).click();
    await page.getByTestId('button-quick-lowAnnualTax').click();
    await page.getByRole('button', { name: 'Advanced search', exact: true }).click();
    await page.getByTestId('button-quick-lowInsuranceGroup').click();
    await expect(page.getByTestId('text-filtered-stock-count')).toHaveText('2 cars match your search');
    await expect(page.getByTestId('card-vehicle-fictional-benefits-2')).toBeVisible();
    await expect(page.getByTestId('card-vehicle-fictional-benefits-3')).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width + 1);
    await expect(page.getByTestId('stock-search-toolbar')).toHaveCSS('position', 'static');
  });
}
