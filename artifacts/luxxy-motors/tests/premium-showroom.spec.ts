import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import type { StockData } from '../src/lib/stock-context';

test.skip(process.env.LUXXY_LOCAL_PREVIEW !== '1', 'Read-only customer preview checks.');
const longTitle = 'Mercedes-Benz E Class Premium Plus Long Wheelbase Estate';

async function fixture(page: Page, request: APIRequestContext, options: { empty?: boolean; longNames?: boolean } = {}) {
  const stockResponse = await request.get('/api/stock');
  const stock = await stockResponse.json() as StockData;
  const image = new URL('/__premium-test/car.svg', stockResponse.url()).href;
  const cars = options.empty ? [] : stock.cars.slice(0, 3).map((car, i) => ({
    ...car, inventoryStatus: 'available', heroImage: image,
    images: [{ url: image, caption: 'Front exterior' }, { url: image + '?rear', caption: 'Rear exterior' }],
    title: options.longNames ? `2019 ${longTitle} ${i + 1}` : car.title,
    make: options.longNames ? 'Mercedes-Benz' : car.make,
    model: options.longNames ? `E Class Premium Plus Long Wheelbase Estate ${i + 1}` : car.model,
    variant: options.longNames ? '2.0 Premium Plus Automatic Euro 6 with panoramic roof and leather upholstery' : car.variant,
    sourceMissingAt: null,
  }));
  await page.route('**/api/**', route => ['GET', 'HEAD'].includes(route.request().method()) ? route.continue() : route.fulfill({ status: 405, json: { error: 'Read-only preview audit.' } }));
  await page.route('**/api/stock', route => route.fulfill({ json: { ...stock, cars, count: cars.length } }));
  await page.route('**/__premium-test/car.svg*', route => route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="750"><rect width="1000" height="750" fill="#d3dce2"/><path d="M150 480V380l160-120h330l160 120v100Z" fill="#30404b"/><circle cx="300" cy="480" r="65" fill="#172129"/><circle cx="680" cy="480" r="65" fill="#172129"/></svg>' }));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  return { stock, cars };
}

async function fits(page: Page) {
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
}

for (const width of [390, 820, 1024, 1440]) {
  test(`three-page typography and long vehicle content remain usable at ${width}`, async ({ page, request }) => {
    await page.setViewportSize({ width, height: 1000 });
    const { cars } = await fixture(page, request, { longNames: true });
    for (const path of ['/', '/stock', `/vehicle/${cars[0].id}`]) {
      await page.goto(path);
      await expect(page.locator('#main-content h1:visible')).toHaveCount(1);
      await expect(page.locator('#main-content h1:visible')).toBeVisible();
      await expect(page.locator('.premium-showroom')).toHaveCount(1);
      const font = await page.locator('#main-content h1:visible').evaluate(element => getComputedStyle(element).fontFamily);
      expect(font).toContain('Inter');
      // Verify the requested face is present, not merely a missing font name.
      await expect.poll(() => page.evaluate(async () => {
        await document.fonts.load('400 16px Inter');
        return document.fonts.check('400 16px Inter');
      })).toBe(true);
      await fits(page);
    }
    const mainImage = page.locator('.vehicle-gallery-frame');
    const imageBox = await mainImage.boundingBox();
    expect(imageBox!.width).toBeGreaterThan(width < 1100 ? width * .8 : width * .5);
    await expect(page.locator('#features-heading')).toBeVisible();
    await expect(page.locator('#vehicle-description-heading')).toBeVisible();
    await expect(page.getByTestId('mobile-conversion-bar')).toHaveCount(0);
    await page.locator('.vehicle-summary [data-vehicle-contact="call"]').scrollIntoViewIfNeeded();
    await expect(page.locator('.vehicle-summary [data-vehicle-contact="call"]')).toBeVisible();
    await fits(page);
  });
}

test('premium route styling stops when moving to other customer pages', async ({ page, request }) => {
  const { cars } = await fixture(page, request);
  for (const path of ['/saved', '/compare', '/contact', '/enquire?type=viewing&vehicleId=' + cars[0].id]) {
    await page.goto(path);
    await expect(page.locator('#main-content h1').first()).toBeVisible();
    await expect(page.locator('.premium-showroom')).toHaveCount(0);
    const font = await page.locator('.luxxy-shell').first().evaluate(element => getComputedStyle(element).fontFamily);
    expect(font).not.toContain('Inter');
  }
});

test('empty stock and zero-match searches give usable next steps', async ({ page, request }) => {
  await fixture(page, request);
  await page.goto('/stock?search=no-such-car');
  await expect(page.getByRole('heading', { name: 'No matches', exact: true })).toBeVisible();
  await page.getByTestId('button-clear-filters').click();
  await expect(page.locator('.browse-stock .vehicle-card')).toHaveCount(3);
  await fixture(page, request, { empty: true });
  await page.reload();
  await expect(page.getByTestId('empty-stock')).toContainText('No vehicles currently listed');
  await expect(page.getByRole('link', { name: 'Ask about upcoming stock' })).toHaveAttribute('href', '/enquire?type=general');
});

test('stock loading and network failure retain a clear, accessible page shell', async ({ page, request }) => {
  await fixture(page, request);
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/stock', async route => {
    await gate;
    await route.fulfill({ status: 503, json: { error: 'Feed unavailable' } });
  });
  await page.goto('/stock');
  await expect(page.locator('[aria-label="Loading stock"]')).toHaveAttribute('aria-busy', 'true');
  await expect(page.getByRole('status')).toContainText('Loading used cars');
  await fits(page);
  release();
  await expect(page.getByRole('alert')).toContainText('Stock is temporarily unavailable', { timeout: 20000 });
  await expect(page.getByRole('button', { name: 'Try again', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Contact the showroom', exact: true })).toHaveAttribute('href', '/contact');
});

test('mobile keyboard navigation never leaves focus under the open menu', async ({ page, request }) => {
  await page.setViewportSize({ width: 390, height: 900 });
  const { cars } = await fixture(page, request);
  for (const path of ['/', '/stock', `/vehicle/${cars[0].id}`]) {
    await page.goto(path);
    await expect(page.locator('#main-content h1:visible')).toBeVisible();
    const opener = page.getByRole('button', { name: 'Open navigation menu', exact: true });
    await opener.click();
    await expect(page.getByRole('navigation', { name: 'Mobile navigation', exact: true })).toBeVisible();
    for (let i = 0; i < 20; i++) {
      await page.keyboard.press('Tab');
      const open = await page.locator('#mobile-navigation').count();
      if (!open) break;
      expect(await page.locator('#mobile-navigation').evaluate(element => element.contains(document.activeElement))).toBe(true);
    }
    await expect(page.locator('#mobile-navigation')).toHaveCount(0);
    await opener.click();
    await page.keyboard.press('Escape');
    await expect(opener).toBeFocused();
  }
});

test('all three pages retain bespoke dealer surfaces and readable action colours', async ({ page, request }) => {
  const { cars } = await fixture(page, request);
  await page.route('**/api/dealer-settings', async route => {
    const response = await route.fetch();
    const settings = await response.json();
    await route.fulfill({ response, json: {
      ...settings,
      identity: { ...settings.identity, brandColors: { ...settings.identity.brandColors, accentHsl: '42 80% 75%' } },
      presentation: { ...settings.presentation, pageColour: '#edf6f4', panelColour: '#fff6e8', headingColour: '#5b2635' },
    } });
  });
  await page.goto('/');
  await expect(page.locator('.hero-search-field select').first()).toHaveCSS('background-color', 'rgb(255, 246, 232)');
  await expect(page.locator('.hero-search-submit')).toHaveCSS('color', 'rgb(20, 20, 20)');
  await page.goto('/stock');
  await expect(page.locator('.stock-toolbar')).toHaveCSS('background-color', 'rgb(255, 246, 232)');
  await expect(page.locator('.vehicle-card-details').first()).toHaveCSS('background-color', 'rgb(255, 246, 232)');
  await page.getByRole('button', { name: 'Advanced search', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCSS('background-color', 'rgb(255, 246, 232)');
  await expect(page.getByRole('dialog').locator('.stock-search-submit')).toHaveCSS('color', 'rgb(20, 20, 20)');
  await page.keyboard.press('Escape');
  await page.goto(`/vehicle/${cars[0].id}`);
  await expect(page.locator('.vehicle-summary')).toHaveCSS('background-color', 'rgb(255, 246, 232)');
  await expect(page.locator('.vehicle-summary h1')).toHaveCSS('color', 'rgb(91, 38, 53)');
  await expect(page.locator('.vehicle-booking-action')).toHaveCSS('color', 'rgb(20, 20, 20)');
});
