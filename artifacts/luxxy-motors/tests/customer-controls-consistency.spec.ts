import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

test.skip(process.env.LUXXY_LOCAL_PREVIEW !== '1', 'Fictional customer stock only.');
test.use({ reducedMotion: 'reduce', serviceWorkers: 'block' });

async function stockFixture(page: Page, request: APIRequestContext, empty = false) {
  const baseline = await (await request.get('/api/stock')).json();
  const photo = new URL('/__controls-test/car.svg', 'http://127.0.0.1:4175').href;
  const car = {
    ...baseline.cars[0], id: 'fictional-customer-controls', advertId: 'fictional-customer-controls',
    title: 'Mercedes-Benz E Class Premium Plus Long Wheelbase Estate', make: 'Mercedes-Benz', model: 'E Class',
    year: 2019, price: null, mileage: 29500, fuel: 'Petrol Plug-in Hybrid',
    transmission: '7G-DCT-DualClutchAutomaticTransmission',
    variant: 'Premium Plus Estate with panoramic roof and leather upholstery',
    heroImage: photo, images: [{ url: photo, caption: 'Front exterior' }, { url: photo + '?rear', caption: 'Rear exterior' }],
    imageCount: 2, inventoryStatus: 'available', sourceMissingAt: null, sourceExtras: null,
  };
  const writes: string[] = [], errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/api/**', route => {
    if (!['GET', 'HEAD', 'OPTIONS'].includes(route.request().method())) {
      writes.push(route.request().url());
      return route.fulfill({ status: 405, json: { error: 'Read-only customer audit.' } });
    }
    if (new URL(route.request().url()).pathname === '/api/stock') return route.fulfill({ json: { ...baseline, count: empty ? 0 : 1, cars: empty ? [] : [car] } });
    return route.continue();
  });
  await page.route('**/__controls-test/car.svg*', route => route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600"><rect width="800" height="600" fill="#d9e1e6"/><text x="400" y="300" text-anchor="middle" font-size="24">Fictional layout photograph</text></svg>' }));
  return { car, writes, errors };
}

for (const width of [320, 820]) {
  test(`long imported facts and price labels remain within stock cards at ${width}px`, async ({ page, request }) => {
    await page.setViewportSize({ width, height: 950 });
    const { car, writes, errors } = await stockFixture(page, request);
    await page.goto('/stock');
    const card = page.getByTestId(`card-vehicle-${car.id}`);
    await expect(card).toBeVisible();
    await expect(card).toContainText('Price on application');
    await expect.poll(() => card.locator('.vehicle-specs').evaluate(element => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1);
    const gearbox = card.getByRole('button', { name: `Gearbox: ${car.transmission}` });
    await gearbox.click();
    const help = page.getByRole('tooltip');
    await expect(help).toBeVisible();
    const bounds = (await help.boundingBox())!;
    expect(bounds.x).toBeGreaterThanOrEqual(0);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(width);
    await page.keyboard.press('Escape');
    await expect(help).toBeHidden();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    await card.screenshot({ path: `/tmp/customer-controls-card-${width}.png` });
    await page.goto(`/vehicle/${car.id}`);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(car.title);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    await page.goto(`/saved?cars=${car.id}`);
    const saved = page.getByTestId(`row-vehicle-${car.id}`);
    await expect(saved).toBeVisible();
    expect(await saved.locator('.vehicle-specs').evaluate(element => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    expect(writes).toEqual([]); expect(errors).toEqual([]);
  });
}

test('keyboard photo navigation stays on the card and announces the current photograph', async ({ page, request }) => {
  const { car, writes, errors } = await stockFixture(page, request);
  await page.goto('/stock');
  const card = page.getByTestId(`card-vehicle-${car.id}`);
  const photo = card.getByRole('link', { name: `View full details for ${car.title}` });
  await photo.focus();
  await photo.press('ArrowRight');
  await expect(card.locator('[aria-live="polite"]')).toHaveText('Photograph 2 of 2');
  await expect(photo.locator('img')).toHaveAttribute('src', /\?rear$/);
  await photo.press('ArrowLeft');
  await expect(card.locator('[aria-live="polite"]')).toHaveText('Photograph 1 of 2');
  await expect(photo).toBeFocused();
  await expect(page).toHaveURL(/\/stock$/);
  expect(writes).toEqual([]); expect(errors).toEqual([]);
});

for (const width of [320, 820]) test.describe(`touch customer controls at ${width}px`, () => {
  test.use({ viewport: { width, height: 950 }, hasTouch: true, isMobile: true });
  test('swipes photos and opens fact explanations without navigating', async ({ page, request, context }) => {
    const { car, writes, errors } = await stockFixture(page, request);
    await page.goto('/stock');
    const card = page.getByTestId(`card-vehicle-${car.id}`);
    await expect(card).toBeVisible();
    await expect(card.getByRole('button', { name: `Next photo of ${car.title}` })).toBeHidden();
    const save = card.getByTestId(`button-save-${car.id}`);
    const saveBounds = (await save.boundingBox())!;
    expect(saveBounds.width).toBeGreaterThanOrEqual(44);
    expect(saveBounds.height).toBeGreaterThanOrEqual(44);
    const photo = card.getByRole('link', { name: `View full details for ${car.title}` });
    await photo.evaluate(element => element.scrollIntoView({ block: 'center', behavior: 'instant' }));
    const photoBounds = (await photo.boundingBox())!;
    const session = await context.newCDPSession(page);
    const touchPoint = (fraction: number) => ({ x: photoBounds.x + photoBounds.width * fraction, y: photoBounds.y + photoBounds.height / 2, id: 0, radiusX: 3, radiusY: 3, force: 1 });
    await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [touchPoint(.8)] });
    for (let step = 1; step <= 8; step++) {
      await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [touchPoint(.8 - .6 * step / 8)] });
      await page.waitForTimeout(20);
    }
    await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await session.detach();
    await expect(card.locator('[aria-live="polite"]')).toHaveText('Photograph 2 of 2');
    const gearbox = card.getByRole('button', { name: `Gearbox: ${car.transmission}` });
    await gearbox.tap();
    const help = page.getByRole('tooltip');
    await expect(help).toBeVisible();
    const bounds = (await help.boundingBox())!;
    expect(bounds.x).toBeGreaterThanOrEqual(0);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(width);
    await gearbox.tap();
    await expect(help).toBeHidden();
    await expect(page).toHaveURL(/\/stock$/);
    expect(writes).toEqual([]); expect(errors).toEqual([]);
  });
});

test('narrow stock empty state keeps readable text and recovery actions within its panel', async ({ page, request }) => {
  await page.setViewportSize({ width: 320, height: 850 });
  const { writes, errors } = await stockFixture(page, request, true);
  await page.goto('/stock');
  const empty = page.getByTestId('empty-stock');
  await expect(empty).toBeVisible();
  expect(await empty.evaluate(element => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
  expect(writes).toEqual([]); expect(errors).toEqual([]);
});

for (const width of [320, 390, 820]) test(`hero search text keeps contrast over a bright dealer photograph at ${width}px`, async ({ page, request }) => {
  await page.setViewportSize({ width, height: 950 });
  const { writes, errors } = await stockFixture(page, request);
  const settings = await (await request.get('/api/dealer-settings')).json();
  const whitePhoto = 'http://127.0.0.1:4175/__controls-test/white-hero.svg';
  await page.route('**/api/dealer-settings', route => route.fulfill({ json: { ...settings, presentation: { ...settings.presentation, heroImageUrl: whitePhoto } } }));
  await page.route(whitePhoto, route => route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="900"><rect width="1600" height="900" fill="white"/></svg>' }));
  await page.goto('/');
  await expect(page.getByTestId('showroom-hero-photo').locator('img')).toHaveAttribute('src', whitePhoto);
  const contrast = await page.locator('.hero-search-secondary a').evaluate(element => {
    const shade = document.querySelector('.stock-search-shade')!;
    const background = getComputedStyle(shade).backgroundImage;
    const shadeBounds = shade.getBoundingClientRect(), textBounds = element.getBoundingClientRect();
    // Draw the browser's actual horizontal gradient over the brightest possible photograph.
    const canvas = document.createElement('canvas'); canvas.width = Math.ceil(shadeBounds.width); canvas.height = 1;
    const context = canvas.getContext('2d')!;
    context.fillStyle = '#ffffff'; context.fillRect(0, 0, canvas.width, 1);
    const gradient = context.createLinearGradient(0, 0, canvas.width, 0);
    const stops = Array.from(background.matchAll(/rgba?\([^)]+\)/g));
    const resolvedStops: Array<{ position: string; offset: number }> = [];
    for (const [index, match] of stops.entries()) {
      const next = stops[index + 1];
      const position = background.slice(match.index! + match[0].length, next?.index ?? background.length - 1).trim().replace(/,$/, '').trim();
      const offset = position ? parseFloat(position) / 100 : index / (stops.length - 1);
      resolvedStops.push({ position, offset });
      gradient.addColorStop(Math.max(0, Math.min(1, offset)), match[0]);
    }
    context.fillStyle = gradient; context.fillRect(0, 0, canvas.width, 1);
    const foreground = getComputedStyle(element).color.match(/[\d.]+/g)!.slice(0, 3).map(Number);
    const luminance = (rgb: number[]) => rgb.map(value => { const channel = value / 255; return channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4; }).reduce((sum, value, index) => sum + value * [.2126, .7152, .0722][index], 0);
    const textLuminance = luminance(foreground);
    const pixel = Array.from(context.getImageData(Math.min(canvas.width - 1, Math.floor(textBounds.right - shadeBounds.left)), 0, 1, 1).data).slice(0, 3);
    const backgroundLuminance = luminance(pixel);
    return { ratio: (Math.max(textLuminance, backgroundLuminance) + .05) / (Math.min(textLuminance, backgroundLuminance) + .05), background, resolvedStops, right: textBounds.right, shadeWidth: shadeBounds.width };
  });
  expect(contrast.ratio, `See all cars must stay legible over a bright custom hero photograph: ${JSON.stringify(contrast)}`).toBeGreaterThanOrEqual(4.5);
  await page.locator('.stock-search-hero').screenshot({ path: `/tmp/customer-bright-hero-${width}.png` });
  expect(writes).toEqual([]); expect(errors).toEqual([]);
});
