import { expect, test, type Page } from '@playwright/test';

const bodyKey = (value: string) => value.trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const publicCars = (cars: any[]) => cars.filter(car => !['sold', 'archived', 'hidden'].includes(String(car.inventoryStatus).toLowerCase()));

async function checkNoOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
}

for (const width of [320, 390, 820, 1440, 1920]) {
  test(`compact homepage browsing and body filters at ${width}px`, async ({ page, request }) => {
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.setViewportSize({ width, height: 1000 });
    await page.goto('/');
    const section = page.getByRole('region', { name: 'Browse cars', exact: true });
    await expect(section).toBeVisible();
    await section.scrollIntoViewIfNeeded();
    await expect(section.getByRole('heading', { level: 2 })).toHaveCount(1);
    await expect(section.getByRole('link', { name: 'View all stock', exact: true })).toHaveCount(1);
    await expect(section.getByText('A few good places to start.')).toHaveCount(0);
    await expect(section.getByRole('heading', { name: 'Browse cars', exact: true })).toHaveCount(0);
    const links = section.getByRole('navigation', { name: 'Browse by body type' }).getByRole('link');
    expect(await links.count()).toBeGreaterThan(0);
    const stock = await (await request.get('/api/stock')).json();
    for (const link of await links.all()) {
      const box = await link.boundingBox();
      expect(box!.height).toBeGreaterThanOrEqual(44);
      const href = await link.getAttribute('href');
      const bodyType = new URL(href!, 'http://localhost').searchParams.get('bodyType')!;
      const count = publicCars(stock.cars).filter(car => bodyKey(car.bodyType ?? '') === bodyKey(bodyType)).length;
      await expect(link).toHaveAccessibleName(`${bodyType} · ${count} ${count === 1 ? 'car' : 'cars'}`);
    }
    for (const link of await section.getByRole('navigation', { name: 'Shop by preference' }).getByRole('link').all()) {
      expect((await link.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    }
    await checkNoOverflow(page);
    await page.screenshot({ path: `../../output/home-body-types/home-${width}.png`, animations: 'disabled' });
    const href = await links.first().getAttribute('href');
    const selected = new URL(href!, 'http://localhost').searchParams.get('bodyType')!;
    const expected = publicCars(stock.cars).filter(car => bodyKey(car.bodyType ?? '') === bodyKey(selected));
    await links.first().click();
    await expect(page).toHaveURL(/\/stock\?bodyType=/);
    await expect(page.locator('[data-testid^="card-vehicle-"]')).toHaveCount(expected.length);
    await expect(page.getByRole('button', { name: `Remove ${selected} filter`, exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Advanced search', exact: true }).click();
    await expect(page.getByLabel('Body type', { exact: true })).toHaveValue(selected);
    await page.getByRole('button', { name: 'Reset filters', exact: true }).click();
    await expect(page.getByLabel('Body type', { exact: true })).toHaveValue('');
    expect(new URL(page.url()).searchParams.has('bodyType')).toBe(false);
    await checkNoOverflow(page);
    expect(errors).toEqual([]);
  });
}

test('featured stock supports keyboard, arrow browsing and opening a real car', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  const carousel = page.getByLabel('Featured vehicles; swipe or scroll to browse', { exact: true });
  await expect(carousel).toBeVisible();
  await carousel.scrollIntoViewIfNeeded();
  await expect.poll(() => carousel.evaluate(element => element.scrollWidth > element.clientWidth)).toBe(true);
  await carousel.focus();
  await page.keyboard.press('ArrowRight');
  await expect.poll(() => carousel.evaluate(element => element.scrollLeft)).toBeGreaterThan(0);
  // Native keyboard scrolling can continue briefly after keyup, including with
  // reduced motion. Let it settle before testing the separate arrow action.
  await expect.poll(async () => {
    const position = await carousel.evaluate(element => element.scrollLeft);
    await page.waitForTimeout(150);
    return position === await carousel.evaluate(element => element.scrollLeft);
  }).toBe(true);
  const previous = page.getByRole('button', { name: 'Previous featured cars', exact: true });
  const next = page.getByRole('button', { name: 'Next featured cars', exact: true });
  for (const button of [previous, next]) {
    const box = await button.boundingBox();
    expect(box!.width).toBeGreaterThanOrEqual(44);
    expect(box!.height).toBeGreaterThanOrEqual(44);
  }
  await previous.click();
  await expect.poll(() => carousel.evaluate(element => element.scrollLeft)).toBe(0);
  await next.click();
  await expect.poll(() => carousel.evaluate(element => element.scrollLeft)).toBeGreaterThan(0);
  await previous.click();
  await expect.poll(() => carousel.evaluate(element => element.scrollLeft)).toBe(0);
  const firstCar = carousel.getByRole('heading', { level: 3 }).first().getByRole('link');
  const destination = await firstCar.getAttribute('href');
  await firstCar.click();
  await expect(page).toHaveURL(new RegExp(destination!.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
});

test('one-car stock stays tidy without unnecessary carousel controls', async ({ page, request }) => {
  const stock = await (await request.get('/api/stock')).json();
  const cars = publicCars(stock.cars).slice(0, 1);
  await page.route('**/api/stock', route => route.fulfill({ json: { ...stock, count: cars.length, cars } }));
  await page.setViewportSize({ width: 390, height: 1000 });
  await page.goto('/');
  await expect(page.getByRole('region', { name: 'Browse cars', exact: true })).toBeVisible();
  await expect(page.locator('.rolling-stock [data-stock-link]')).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Next featured cars', exact: true })).toHaveCount(0);
  await checkNoOverflow(page);
});

test('empty stock remains useful and does not show empty filter groups', async ({ page, request }) => {
  const stock = await (await request.get('/api/stock')).json();
  await page.route('**/api/stock', route => route.fulfill({ json: { ...stock, count: 0, cars: [] } }));
  await page.setViewportSize({ width: 820, height: 1000 });
  await page.goto('/');
  await expect(page.getByText('We have no cars online at the moment. Ask us about our stock.', { exact: true })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Browse by body type' })).toHaveCount(0);
  await expect(page.locator('.rolling-stock-empty').getByRole('link', { name: 'Contact us', exact: true })).toHaveAttribute('href', '/contact');
  await checkNoOverflow(page);
});

test('disabling featured stock preserves working browse filters', async ({ page, request }) => {
  const settings = await (await request.get('/api/dealer-settings')).json();
  await page.route('**/api/dealer-settings', route => route.fulfill({ json: { ...settings, presentation: { ...settings.presentation, featuredEnabled: false } } }));
  await page.goto('/');
  await expect(page.getByRole('region', { name: 'Browse cars', exact: true })).toBeVisible();
  await expect(page.getByLabel('Featured vehicles; swipe or scroll to browse', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('navigation', { name: 'Browse by body type' }).getByRole('link').first()).toBeVisible();
});

test('the compact heading keeps dealer-written featured wording', async ({ page, request }) => {
  const settings = await (await request.get('/api/dealer-settings')).json();
  await page.route('**/api/dealer-settings', route => route.fulfill({ json: { ...settings, presentation: { ...settings.presentation, websiteCopy: { ...settings.presentation?.websiteCopy, featuredHeading: 'Cars ready to drive away' } } } }));
  await page.goto('/');
  const section = page.getByRole('region', { name: 'Browse cars', exact: true });
  await expect(section.getByRole('heading', { name: 'Cars ready to drive away', exact: true })).toBeVisible();
  await expect(section.getByRole('heading', { level: 2 })).toHaveCount(1);
  await expect(section.getByRole('link', { name: 'View all stock', exact: true })).toHaveCount(1);
});


test('stock without shortcut matches hides the empty quick-filter group', async ({ page, request }) => {
  const stock = await (await request.get('/api/stock')).json();
  const original = publicCars(stock.cars)[0];
  const car = { ...original, transmission: 'Manual', price: 25000, mileage: 90000, mileageText: '90,000 miles', emissionClass: null, fuel: null, sourceExtras: null, specifications: null, bodyType: 'Hatchback', inventoryStatus: 'available' };
  await page.route('**/api/stock', route => route.fulfill({ json: { ...stock, count: 1, cars: [car] } }));
  await page.setViewportSize({ width: 320, height: 1000 });
  await page.goto('/');
  await expect(page.getByRole('region', { name: 'Browse cars', exact: true })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Shop by preference' })).toHaveCount(0);
  await expect(page.getByRole('navigation', { name: 'Browse by body type' }).getByRole('link', { name: 'Hatchback · 1 car', exact: true })).toBeVisible();
  await expect(page.locator('.rolling-stock [data-stock-link]')).toHaveCount(1);
  await checkNoOverflow(page);
});
