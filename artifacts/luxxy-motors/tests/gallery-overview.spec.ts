import { expect, test, type APIRequestContext, type Locator, type Page } from '@playwright/test';

test.skip(process.env.LUXXY_LOCAL_PREVIEW !== '1', 'Read-only local preview; every API submission is intercepted.');

type Photo = string | { url: string; caption: string | null };
type PreviewCar = { id: string; images: Photo[]; heroImage: string | null; imageCount: number | null };
const urlOf = (photo: Photo) => typeof photo === 'string' ? photo : photo.url;

async function fixture(request: APIRequestContext) {
  const response = await request.get('/api/stock');
  expect(response.ok()).toBeTruthy();
  const stock = await response.json() as { cars: PreviewCar[]; count: number };
  const car = stock.cars.find(item => item.images.length >= 54) ?? stock.cars.find(item => item.images.length > 4);
  expect(car, 'A photographed preview vehicle is required').toBeTruthy();
  return { stock, car: car! };
}

async function guard(page: Page, stock?: unknown) {
  const writes: string[] = [];
  await page.route('**/api/**', async route => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (['GET', 'HEAD'].includes(request.method())) {
      if (stock && path === '/api/stock') return route.fulfill({ json: stock });
      return route.continue();
    }
    writes.push(`${request.method()} ${path}`);
    return route.fulfill({ status: 403, json: { error: 'Gallery audit intercepted this submission.' } });
  });
  await page.addInitScript(() => {
    window.open = () => null;
    document.addEventListener('click', event => {
      if ((event.target as Element).closest('a[href^="tel:"], a[href^="https://wa.me/"]')) event.preventDefault();
    }, true);
  });
  return writes;
}

async function fits(page: Page, dialog: Locator) {
  await expect.poll(() => dialog.evaluate(element => {
    const bounds = element.getBoundingClientRect();
    return bounds.left >= 0 && bounds.top >= 0 && bounds.right <= innerWidth + 1 && bounds.bottom <= innerHeight + 1 && element.scrollWidth <= element.clientWidth + 1;
  })).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
}

for (const width of [390, 820, 1440]) {
  test.describe(`Gallery at ${width}px`, () => {
  test.use({ hasTouch: width <= 820 });
  test(`all photos overview and direct browsing at ${width}px`, async ({ page, request }) => {
    test.setTimeout(60_000);
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const { car } = await fixture(request);
    const writes = await guard(page);
    const fullSizeRequests = new Set<string>();
    const sourceUrls = new Set(car.images.map(urlOf));
    if (car.heroImage) sourceUrls.add(car.heroImage);
    page.on('request', request => {
      if (request.resourceType() === 'image' && sourceUrls.has(request.url())) fullSizeRequests.add(request.url());
    });
    await page.goto(`/vehicle/${encodeURIComponent(car.id)}`);
    const thumbnails = page.getByLabel('Choose photograph', { exact: true }).getByRole('button');
    await expect(thumbnails.first()).toBeVisible();
    const count = await thumbnails.count();
    expect(count).toBeGreaterThan(4);
    await expect(page.locator('.vehicle-gallery-overview-grid')).toHaveCount(0);
    // The hero, its neighbours and other existing vehicle contexts may load.
    // The overview must not fetch this entire full-size gallery before it is opened.
    expect(fullSizeRequests.size).toBeLessThan(Math.ceil(count / 2));
    await thumbnails.first().focus();
    await page.keyboard.press('End');
    await expect(thumbnails.last()).toBeFocused();
    await page.keyboard.press('Home');
    const trigger = page.getByRole('button', { name: 'View gallery fullscreen', exact: true });
    await trigger.click();
    const dialog = page.getByRole('dialog', { name: 'Vehicle image gallery', exact: true });
    const counter = dialog.locator('.vehicle-lightbox-navigation p');
    await expect(counter).toContainText(`1 / ${count}`);
    await expect(dialog.locator('.vehicle-gallery-overview-grid')).toHaveCount(0);
    await dialog.getByRole('button', { name: 'All photos', exact: true }).click();
    const overview = dialog.getByRole('region', { name: `All ${count} photographs`, exact: true });
    const tiles = overview.getByRole('button');
    await expect(tiles).toHaveCount(count);
    await expect(dialog.getByLabel('Photograph sections', { exact: true })).toHaveCount(0);
    await expect(dialog.locator('.vehicle-lightbox-navigation')).toHaveCount(0);
    await expect(dialog.locator('[data-vehicle-contact="call"]')).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Message', exact: true })).toBeVisible();
    await fits(page, dialog);
    expect(await overview.locator('img').evaluateAll(images => images.every(image => image.getAttribute('loading') === 'lazy'))).toBe(true);
    const columns = await overview.locator('.vehicle-gallery-overview-grid').evaluate(element => getComputedStyle(element).gridTemplateColumns.split(' ').length);
    expect(columns).toBe(width === 390 ? 2 : width === 820 ? 4 : 6);
    await expect(tiles.first()).toBeFocused();
    await page.keyboard.press('End');
    await expect(tiles.last()).toBeFocused();
    await page.keyboard.press('Home');
    await expect(tiles.first()).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(tiles.nth(columns)).toBeFocused();
    const target = Math.min(12, count - 2);
    const selectedUrl = await tiles.nth(target).locator('img').getAttribute('src');
    await tiles.nth(target).click();
    await expect(overview).toHaveCount(0);
    await expect(counter).toContainText(`${target + 1} / ${count}`);
    await expect(dialog.locator('.vehicle-lightbox-photo img')).toHaveAttribute('src', selectedUrl!);
    await expect(dialog.getByRole('button', { name: 'All photos', exact: true })).toBeFocused();
    await page.keyboard.press('ArrowRight');
    await expect(counter).toContainText(`${target + 2} / ${count}`);
    await page.keyboard.press('ArrowLeft');
    await expect(counter).toContainText(`${target + 1} / ${count}`);
    if (width <= 820) {
      await expect(dialog.getByRole('button', { name: 'Next photograph', exact: true })).toBeHidden();
      const photo = dialog.locator('.vehicle-lightbox-photo');
      await photo.evaluate(element => {
        const start = new Touch({ identifier: 1, target: element, clientX: 250, clientY: 200 });
        element.dispatchEvent(new TouchEvent('touchstart', { bubbles: true, touches: [start], changedTouches: [start] }));
        const end = new Touch({ identifier: 1, target: element, clientX: 80, clientY: 205 });
        element.dispatchEvent(new TouchEvent('touchend', { bubbles: true, touches: [], changedTouches: [end] }));
      });
      await expect(counter).toContainText(`${target + 2} / ${count}`);
    }
    await dialog.getByRole('button', { name: 'All photos', exact: true }).click();
    await dialog.getByRole('button', { name: 'Back to photo', exact: true }).click();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(trigger).toBeFocused();
    await trigger.click();
    await dialog.getByRole('button', { name: 'All photos', exact: true }).click();
    await dialog.locator('.vehicle-gallery-overview').evaluate(element => element.scrollTo({ top: 0, behavior: 'instant' }));
    await expect.poll(() => dialog.locator('.vehicle-gallery-overview').evaluate(element => {
      const viewport = element.getBoundingClientRect();
      return Array.from(element.querySelectorAll('img')).filter(image => {
        const bounds = image.getBoundingClientRect();
        return bounds.bottom > viewport.top && bounds.top < viewport.bottom;
      }).every(image => image.complete && image.naturalWidth > 0);
    }), { timeout: 20_000 }).toBe(true);
    await dialog.screenshot({ path: `/tmp/gallery-overview-${width}.png`, animations: 'disabled' });
    await dialog.getByRole('button', { name: 'Message', exact: true }).click();
    await expect(dialog).toBeHidden();
    await expect(page.locator('#vehicle-enquiry-heading')).toBeFocused();
    await expect(page.locator('#vehicle-enquiry-heading')).toBeInViewport();
    expect(writes).toEqual([]);
  });
  });
}

test('duplicate and unavailable photos leave an accurately counted grid without gaps', async ({ page, request }) => {
  await page.setViewportSize({ width: 390, height: 900 });
  const { stock, car } = await fixture(request);
  const available = [...new Set(car.images.map(urlOf))].slice(0, 4);
  const missing = 'https://gallery-photos.example.test/unavailable.jpg';
  const replacement = { ...car, heroImage: available[0], images: [...available, available[1], missing], imageCount: 99 };
  const writes = await guard(page, { ...stock, cars: [replacement], count: 1 });
  await page.route(missing, route => route.fulfill({ status: 404, body: '' }));
  await page.goto(`/vehicle/${encodeURIComponent(car.id)}`);
  const thumbnails = page.getByLabel('Choose photograph', { exact: true }).getByRole('button');
  await expect(thumbnails).toHaveCount(4);
  await expect(page.getByText('View all 4 photos', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'View gallery fullscreen', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Vehicle image gallery', exact: true });
  await dialog.getByRole('button', { name: 'All photos', exact: true }).click();
  const overview = dialog.getByRole('region', { name: 'All 4 photographs', exact: true });
  const tiles = overview.getByRole('button');
  await expect(tiles).toHaveCount(4);
  for (let i = 0; i < 4; i += 1) await expect(tiles.nth(i)).toHaveAttribute('aria-label', `View photograph ${i + 1} of 4`);
  expect(await tiles.locator('img').evaluateAll(images => images.map(image => image.getAttribute('src')))).toEqual(available);
  await expect(page.getByText('Photograph unavailable', { exact: true })).toHaveCount(0);
  await fits(page, dialog);
  expect(writes).toEqual([]);
});
