import { mkdir } from 'node:fs/promises';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import type { Car, StockData } from '../src/lib/stock-context';

test.skip(process.env.LUXXY_LOCAL_PREVIEW !== '1', 'Isolated local preview with browser-only stock and settings fixtures.');

test.beforeEach(async ({ page, request }) => {
  const settings = await (await request.get('/api/dealer-settings')).json();
  await page.route('**/api/**', route => ['GET', 'HEAD'].includes(route.request().method())
    ? route.continue()
    : route.fulfill({ status: 405, json: { error: 'Read-only stock edge audit.' } }));
  await page.route('**/api/dealer-settings', route => route.fulfill({
    json: {
      ...settings,
      presentation: { ...settings.presentation, featuredEnabled: true, comparisonEnabled: true },
    },
  }));
});

async function baseStock(request: APIRequestContext): Promise<StockData> {
  const response = await request.get('/api/stock');
  expect(response.ok()).toBe(true);
  const stock = await response.json() as StockData;
  expect(stock.cars.length).toBeGreaterThan(0);
  return stock;
}

function fixtureCar(base: Car, id: string, status: string): Car {
  return { ...base, id, advertId: id, make: id, model: 'Audit model', title: `${id} Audit model`, inventoryStatus: status };
}

async function mockStock(page: Page, stock: StockData, cars: Car[]) {
  await page.route('**/api/stock', route => route.fulfill({ json: { ...stock, cars, count: cars.length } }));
}

async function capture(page: Page, name: string) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(page.viewportSize()!.width + 1);
  if (process.env.LUXXY_STOCK_EDGE_CAPTURE !== '1') return;
  await mkdir('/tmp/luxxy-stock-edge-audit', { recursive: true });
  await page.screenshot({ path: `/tmp/luxxy-stock-edge-audit/${name}-${page.viewportSize()!.width}.png`, animations: 'disabled' });
}

for (const width of [390, 820, 1440]) {
  test.describe(`stock edge states at ${width}px`, () => {
    test.use({ viewport: { width, height: 900 }, hasTouch: width < 1000, reducedMotion: 'reduce' });

    test('archived-only stock shows the upcoming-stock empty state on home and browse', async ({ page, request }) => {
      const stock = await baseStock(request);
      const cars = ['archived', 'sold', 'hidden'].map(status => fixtureCar(stock.cars[0], `Audit ${status}`, status));
      await mockStock(page, stock, cars);
      await page.goto('/stock');
      await expect(page.getByTestId('empty-stock')).toBeVisible();
      await expect(page.getByRole('heading', { name: 'No vehicles currently listed' })).toBeVisible();
      await expect(page.getByTestId('text-filtered-stock-count')).toHaveText('0 vehicles available');
      await expect(page.getByRole('heading', { name: 'No matches', exact: true })).toHaveCount(0);
      await expect(page.locator('#vehicle-results .vehicle-card')).toHaveCount(0);
      await capture(page, 'unavailable-stock');
      await page.goto('/');
      await expect(page.locator('.rolling-stock')).toContainText('No vehicles currently listed');
      await expect(page.locator('.rolling-stock .vehicle-card')).toHaveCount(0);
      await expect(page.getByRole('combobox', { name: 'Search make', exact: true }).locator('option')).toHaveText(['Any make']);
      await capture(page, 'unavailable-home');
    });

    test('unavailable vehicles stay out of featured cards, search options and stock counts', async ({ page, request }) => {
      const stock = await baseStock(request);
      const available = fixtureCar(stock.cars[0], 'Available audit car', 'available');
      const unavailable = ['archived', 'sold', 'hidden'].map(status => fixtureCar(stock.cars[0], `Audit ${status}`, status));
      await mockStock(page, stock, [available, ...unavailable]);
      await page.goto('/');
      await expect(page.locator('.rolling-stock .vehicle-card')).toHaveCount(1);
      await expect(page.getByRole('combobox', { name: 'Search make', exact: true }).locator('option')).toHaveText(['Any make', available.make!]);
      for (const car of unavailable) await expect(page.locator(`[data-stock-link="${car.id}"]`)).toHaveCount(0);
      await page.goto('/stock');
      await expect(page.locator('#vehicle-results .vehicle-card')).toHaveCount(1);
      await expect(page.getByTestId('text-filtered-stock-count')).toHaveText('1 vehicle available');
      await expect(page.locator('#vehicle-results [data-stock-link]')).toHaveAttribute('data-stock-link', available.id);
      await capture(page, 'mixed-stock');
    });

    test('failed comparison photos show a readable fallback without hiding vehicle details', async ({ page, request, context }) => {
      const stock = await baseStock(request);
      const cars = [0, 1].map(index => ({
        ...fixtureCar(stock.cars[0], `Compare audit ${index}`, 'available'),
        heroImage: `http://127.0.0.1:4175/__audit_missing_${index}.jpg`,
        thumbnail: `http://127.0.0.1:4175/__audit_missing_${index}.jpg`,
        images: [{ url: `http://127.0.0.1:4175/__audit_missing_${index}.jpg`, caption: null }],
      }));
      await mockStock(page, stock, cars);
      await page.route('**/__audit_missing_*.jpg', route => route.fulfill({ status: 404, body: '' }));
      await context.addInitScript(ids => localStorage.setItem('luxxy.compare-cars.v1', JSON.stringify(ids)), cars.map(car => car.id));
      await page.goto('/compare');
      await expect(page.getByTestId('compare-table')).toBeVisible();
      const fallbacks = page.getByText('Photograph unavailable', { exact: true });
      await expect(fallbacks).toHaveCount(2);
      for (const fallback of await fallbacks.all()) await expect(fallback).toBeVisible();
      await expect(page.locator('#main-content img')).toHaveCount(0);
      for (const car of cars) {
        await expect(page.getByTestId(`compare-price-${car.id}`)).toBeVisible();
        await expect(page.getByTestId(`button-compare-remove-${car.id}`)).toBeVisible();
      }
      await capture(page, 'comparison-photo-fallback');
    });
  });
}
