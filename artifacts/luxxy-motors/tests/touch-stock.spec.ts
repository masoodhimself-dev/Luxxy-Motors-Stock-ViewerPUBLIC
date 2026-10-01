import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { expect, test, type CDPSession, type Locator, type Page } from '@playwright/test';

test.skip(process.env.LUXXY_LOCAL_PREVIEW !== '1', 'Local fixture preview only.');

// Run with LUXXY_TOUCH_SCREENSHOTS=1 to save review images in /tmp/luxxy-touch-stock.
// For original photographs, also set LUXXY_TOUCH_REAL_PHOTOS=1 and run only
// --grep 'archived photography'; the interaction suite uses deterministic photos.
// The archived stock remains dynamic; only its photographs are replaced so a
// delayed or unavailable external image cannot masquerade as a swipe failure.
test.beforeEach(async ({ page }) => {
  await page.route('**/api/**', async (route) => {
    if (!['GET', 'HEAD'].includes(route.request().method())) {
      await route.fulfill({ status: 405, json: { error: 'Read-only touch regression test.' } });
      return;
    }
    if (process.env.LUXXY_TOUCH_REAL_PHOTOS === '1' || new URL(route.request().url()).pathname !== '/api/stock') {
      await route.continue();
      return;
    }
    const response = await route.fetch();
    const stock = await response.json();
    const origin = new URL(route.request().url()).origin;
    stock.cars = stock.cars.map((car: Record<string, unknown>, index: number) => {
      const images = Array.from({ length: 3 }, (_, photo) => ({
        url: `${origin}/__touch-stock-photo/${index}/${photo}.svg`,
        caption: `Test photograph ${photo + 1}`,
      }));
      return { ...car, heroImage: images[0].url, thumbnail: images[0].url, images, imageCount: images.length };
    });
    await route.fulfill({ response, json: stock });
  });
  await page.route('**/__touch-stock-photo/**', async (route) => {
    const photo = Number(new URL(route.request().url()).pathname.match(/\/(\d+)\.svg$/)?.[1] ?? 0);
    await route.fulfill({
      contentType: 'image/svg+xml',
      body: `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600" viewBox="0 0 800 600"><rect width="800" height="600" fill="${['#b5ccdc', '#d1bb96', '#a8c9b2'][photo]}"/><path d="M120 390V305l115-95h295l135 95v85z" fill="#20364a"/><circle cx="240" cy="395" r="55" fill="#18212a"/><circle cx="560" cy="395" r="55" fill="#18212a"/><text x="400" y="110" text-anchor="middle" font-family="sans-serif" font-size="42" fill="#20364a">Photograph ${photo + 1}</text></svg>`,
    });
  });
});

type Point = { x: number; y: number };
const touchPoint = (point: Point, id = 0) => ({ ...point, id, radiusX: 3, radiusY: 3, force: 1 });

// CDP performs Chromium's real gesture recognition, including native scrolling
// and pointercancel. Synthetic DOM pointer events cannot verify those behaviours.
async function touchDrag(session: CDPSession, page: Page, from: Point, to: Point, cancel = false) {
  await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [touchPoint(from)] });
  for (let step = 1; step <= 8; step++) {
    await session.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [touchPoint({ x: from.x + (to.x - from.x) * step / 8, y: from.y + (to.y - from.y) * step / 8 })],
    });
    await page.waitForTimeout(20);
  }
  await session.send('Input.dispatchTouchEvent', { type: cancel ? 'touchCancel' : 'touchEnd', touchPoints: [] });
}

async function centrePhoto(link: Locator) {
  await expect(link.locator('img')).toBeVisible();
  await link.evaluate((element) => element.scrollIntoView({ block: 'center', behavior: 'instant' }));
  const box = await link.boundingBox();
  expect(box).not.toBeNull();
  return box!;
}

async function noPageOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
}

async function capture(page: Page, name: string) {
  const setting = process.env.LUXXY_TOUCH_SCREENSHOTS;
  if (!setting) return;
  const directory = setting === '1' ? '/tmp/luxxy-touch-stock' : resolve(setting);
  await mkdir(directory, { recursive: true });
  await page.screenshot({ path: resolve(directory, `${name}.png`), animations: 'disabled' });
}

const touchDevices = [
  { name: 'phone', width: 390, height: 844, columns: 1, featured: 1 / 0.85 },
  { name: 'ipad-portrait', width: 820, height: 1180, columns: 2, featured: 2 },
  { name: 'ipad-landscape', width: 1180, height: 820, columns: 3, featured: 3 },
];

for (const device of touchDevices) {
  test.describe(device.name, () => {
    test.use({ viewport: { width: device.width, height: device.height }, hasTouch: true, isMobile: true });

    test('stock swipes change the photograph, preserve the page, and allow the next tap', async ({ page, context }) => {
      await page.goto('/stock');
      const card = page.locator('.browse-stock .vehicle-card-grid').first();
      const link = card.locator('[data-stock-link]');
      const box = await centrePhoto(link);
      const photo = link.locator('img');
      const original = await photo.getAttribute('src');
      const href = await link.getAttribute('href');
      await expect(card.locator('.stock-photo-controls')).toBeHidden();
      expect(await page.evaluate(() => matchMedia('(pointer: coarse)').matches)).toBe(true);
      const session = await context.newCDPSession(page);
      const right = { x: box.x + box.width * 0.78, y: box.y + box.height * 0.5 };
      const left = { x: box.x + box.width * 0.22, y: right.y + 5 };
      await touchDrag(session, page, right, left);
      await expect(photo).not.toHaveAttribute('src', original!);
      await expect(page).toHaveURL(/\/stock$/);
      await touchDrag(session, page, left, right);
      await expect(photo).toHaveAttribute('src', original!);
      await expect(page).toHaveURL(/\/stock$/);
      await noPageOverflow(page);
      await capture(page, `${device.name}-stock`);
      // A real tap immediately after a drag must not inherit click suppression.
      await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
      await expect(page).toHaveURL(new RegExp(`${href!}$`));
      await session.detach();
    });

    test('stock columns fit the screen and vertical photo gestures scroll the page', async ({ page, context }) => {
      await page.goto('/stock');
      const cards = page.locator('.browse-stock .vehicle-card-grid');
      await expect(cards.first()).toBeVisible();
      const geometry = await cards.evaluateAll((elements) => elements.slice(0, 4).map((element) => {
        const { x, y, width } = element.getBoundingClientRect();
        return { x, y, width };
      }));
      expect(geometry.length).toBeGreaterThan(device.columns);
      expect(geometry.filter((box) => Math.abs(box.y - geometry[0].y) < 2)).toHaveLength(device.columns);
      expect(geometry[device.columns].y).toBeGreaterThan(geometry[0].y + 100);
      const link = cards.first().locator('[data-stock-link]');
      const box = await centrePhoto(link);
      const original = await link.locator('img').getAttribute('src');
      const before = await page.evaluate(() => scrollY);
      const session = await context.newCDPSession(page);
      await touchDrag(session, page,
        { x: box.x + box.width * 0.5, y: box.y + box.height * 0.8 },
        { x: box.x + box.width * 0.5 + 6, y: box.y + box.height * 0.2 });
      await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(before + 40);
      await expect(link.locator('img')).toHaveAttribute('src', original!);
      await expect(page).toHaveURL(/\/stock$/);
      await noPageOverflow(page);
      await session.detach();
    });

    test('featured cars scroll natively, pause until resumed, and remain tappable', async ({ page, context }) => {
      await page.goto('/');
      const carousel = page.locator('.rolling-stock-window');
      const first = carousel.locator('.rolling-stock-group').first().locator('.vehicle-card').first();
      await expect(first).toBeVisible();
      await carousel.evaluate((element) => element.scrollIntoView({ block: 'center', behavior: 'instant' }));
      const cardWidth = await first.evaluate((element) => element.getBoundingClientRect().width);
      expect(Math.abs(cardWidth - device.width / device.featured)).toBeLessThan(3);
      await expect(carousel.locator('.stock-photo-controls')).toHaveCount(0);
      const photo = first.locator('[data-stock-link] img');
      const original = await photo.getAttribute('src');
      const session = await context.newCDPSession(page);
      const verticalBox = await photo.boundingBox();
      const pageTop = await page.evaluate(() => scrollY);
      await touchDrag(session, page,
        { x: verticalBox!.x + verticalBox!.width / 2, y: verticalBox!.y + verticalBox!.height * 0.8 },
        { x: verticalBox!.x + verticalBox!.width / 2 + 5, y: verticalBox!.y + verticalBox!.height * 0.2 });
      await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(pageTop + 40);
      await expect(page).toHaveURL(/\/$/);
      await carousel.evaluate((element) => element.scrollIntoView({ block: 'center', behavior: 'instant' }));
      const box = await carousel.boundingBox();
      const photoBox = await photo.boundingBox();
      const from = { x: Math.min(box!.x + box!.width * 0.78, photoBox!.x + photoBox!.width * 0.85), y: photoBox!.y + photoBox!.height * 0.5 };
      await touchDrag(session, page, from, { x: Math.max(box!.x + 20, from.x - device.width * 0.42), y: from.y + 4 });
      await expect.poll(() => carousel.evaluate((element) => element.scrollLeft)).toBeGreaterThan(40);
      await expect(carousel).toHaveAttribute('data-paused', 'true');
      await expect(page.getByRole('button', { name: 'Resume cars' })).toHaveAttribute('aria-pressed', 'true');
      await expect(photo).toHaveAttribute('src', original!);
      await expect(page).toHaveURL(/\/$/);
      // Wait for kinetic scrolling to finish, then span an entire autoplay tick.
      await page.waitForTimeout(800);
      const pausedAt = await carousel.evaluate((element) => element.scrollLeft);
      await page.waitForTimeout(4200);
      expect(Math.abs(await carousel.evaluate((element) => element.scrollLeft) - pausedAt)).toBeLessThan(2);
      await noPageOverflow(page);
      await capture(page, `${device.name}-featured`);
      await page.getByRole('button', { name: 'Resume cars' }).tap();
      await expect(carousel).toHaveAttribute('data-paused', 'false');
      await expect(page.getByRole('button', { name: 'Pause cars' })).toHaveAttribute('aria-pressed', 'false');
      // Tap the visible portion of a photo after the native drag. A phone may
      // legitimately show portions of two cards without either card fitting fully.
      const link = carousel.locator('.rolling-stock-group').first().locator('[data-stock-link]');
      const visibleIndex = await link.evaluateAll((elements) => elements.findIndex((element) => {
        const bounds = element.getBoundingClientRect();
        return bounds.left + bounds.width / 2 > 20 && bounds.left + bounds.width / 2 < innerWidth - 20;
      }));
      expect(visibleIndex).toBeGreaterThanOrEqual(0);
      const target = link.nth(visibleIndex);
      const href = await target.getAttribute('href');
      const targetBox = await target.boundingBox();
      await page.touchscreen.tap(targetBox!.x + targetBox!.width / 2, targetBox!.y + targetBox!.height / 2);
      await expect(page).toHaveURL(new RegExp(`${href!}$`));
      await session.detach();
    });
  });
}

test.describe('gesture edge cases', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test('a filtered stock result swipes without losing its search and opens the right car on the next tap', async ({ page, context }) => {
    await page.goto('/stock');
    const cards = page.locator('.browse-stock .vehicle-card-grid');
    await expect(cards.first()).toBeVisible();
    const query = (await cards.first().locator('h3').innerText()).trim().split(/\s+/)[0];
    const search = page.getByRole('textbox', { name: 'Search the showroom' });
    await search.fill(query);
    await search.press('Enter');
    await expect(page).toHaveURL(/\/stock\?/);
    await expect(cards.first()).toContainText(query);
    const filteredUrl = page.url();
    const link = cards.first().locator('[data-stock-link]');
    const box = await centrePhoto(link);
    const original = await link.locator('img').getAttribute('src');
    const href = await link.getAttribute('href');
    const session = await context.newCDPSession(page);
    await touchDrag(session, page,
      { x: box.x + box.width * 0.8, y: box.y + box.height * 0.5 },
      { x: box.x + box.width * 0.2, y: box.y + box.height * 0.5 });
    await expect(link.locator('img')).not.toHaveAttribute('src', original!);
    await expect(page).toHaveURL(filteredUrl);
    await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
    await expect(page).toHaveURL(new RegExp(`${href!}$`));
    await session.detach();
  });

  test('cancelled and multi-touch drags leave the photo unchanged; pen swipe still works', async ({ page, context }) => {
    await page.goto('/stock');
    const link = page.locator('.browse-stock [data-stock-link]').first();
    const box = await centrePhoto(link);
    const photo = link.locator('img');
    const original = await photo.getAttribute('src');
    const session = await context.newCDPSession(page);
    const from = { x: box.x + box.width * 0.75, y: box.y + box.height * 0.5 };
    const to = { x: box.x + box.width * 0.25, y: from.y };
    await touchDrag(session, page, from, to, true);
    await expect(photo).toHaveAttribute('src', original!);
    await expect(page).toHaveURL(/\/stock$/);

    const second = { x: from.x, y: from.y + 35 };
    await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [touchPoint(from)] });
    await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [touchPoint(from), touchPoint(second, 1)] });
    await session.send('Input.dispatchTouchEvent', {
      type: 'touchMove', touchPoints: [touchPoint(to), touchPoint({ x: to.x, y: second.y }, 1)],
    });
    await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await expect(photo).toHaveAttribute('src', original!);
    await expect(page).toHaveURL(/\/stock$/);

    const penBox = await centrePhoto(link);
    const penFrom = { x: penBox.x + penBox.width * 0.75, y: penBox.y + penBox.height * 0.5 };
    const penTo = { x: penBox.x + penBox.width * 0.25, y: penFrom.y };
    await session.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...penFrom, pointerType: 'pen' });
    await session.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...penFrom, button: 'left', buttons: 1, clickCount: 1, pointerType: 'pen' });
    await session.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...penTo, button: 'left', buttons: 1, pointerType: 'pen' });
    await session.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...penTo, button: 'left', buttons: 0, clickCount: 1, pointerType: 'pen' });
    await expect(photo).not.toHaveAttribute('src', original!);
    await expect(page).toHaveURL(/\/stock$/);
    await session.detach();
  });

  test('reduced motion keeps featured cars still and preserves manual scrolling', async ({ page, context }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/');
    const carousel = page.locator('.rolling-stock-window');
    const link = carousel.locator('.rolling-stock-group').first().locator('[data-stock-link]').first();
    const box = await centrePhoto(link);
    expect(await carousel.locator('.rolling-stock-track').evaluate((element) => getComputedStyle(element).animationName)).toBe('none');
    const before = await carousel.evaluate((element) => element.scrollLeft);
    await page.waitForTimeout(4200);
    expect(await carousel.evaluate((element) => element.scrollLeft)).toBe(before);
    const session = await context.newCDPSession(page);
    await touchDrag(session, page,
      { x: box.x + box.width * 0.8, y: box.y + box.height * 0.5 },
      { x: box.x + box.width * 0.2, y: box.y + box.height * 0.5 });
    await expect.poll(() => carousel.evaluate((element) => element.scrollLeft)).toBeGreaterThan(before + 40);
    await expect(page).toHaveURL(/\/$/);
    await noPageOverflow(page);
    await capture(page, 'phone-featured-reduced-motion');
    await page.goto('/stock');
    const stockLink = page.locator('.browse-stock [data-stock-link]').first();
    const stockBox = await centrePhoto(stockLink);
    const original = await stockLink.locator('img').getAttribute('src');
    await touchDrag(session, page,
      { x: stockBox.x + stockBox.width * 0.8, y: stockBox.y + stockBox.height * 0.5 },
      { x: stockBox.x + stockBox.width * 0.2, y: stockBox.y + stockBox.height * 0.5 });
    await expect(stockLink.locator('img')).not.toHaveAttribute('src', original!);
    expect(await stockLink.locator('img').evaluate((element) => getComputedStyle(element).animationName)).toBe('none');
    expect(await stockLink.locator('img').evaluate((element) => getComputedStyle(element).transitionProperty)).toBe('none');
    await session.detach();
  });
});

test.describe('desktop pointer', () => {
  test.use({ viewport: { width: 1280, height: 900 }, hasTouch: false, isMobile: false });

  test('keyboard arrows browse photographs and Enter opens the focused car', async ({ page }) => {
    await page.goto('/stock');
    const link = page.locator('.browse-stock [data-stock-link]').first();
    await centrePhoto(link);
    const original = await link.locator('img').getAttribute('src');
    const href = await link.getAttribute('href');
    await link.focus();
    await link.press('ArrowRight');
    await expect(link.locator('img')).not.toHaveAttribute('src', original!);
    await expect(link).toBeFocused();
    await expect(page).toHaveURL(/\/stock$/);
    await link.press('ArrowLeft');
    await expect(link.locator('img')).toHaveAttribute('src', original!);
    await link.press('Enter');
    await expect(page).toHaveURL(new RegExp(`${href!}$`));
  });

  test('hover exposes photo arrows and mouse clicks change photos without navigating', async ({ page }) => {
    await page.goto('/stock');
    const card = page.locator('.browse-stock .vehicle-card-grid').first();
    const link = card.locator('[data-stock-link]');
    await centrePhoto(link);
    await card.hover();
    const controls = card.locator('.stock-photo-controls');
    const photo = link.locator('img');
    const original = await photo.getAttribute('src');
    expect(await page.evaluate(() => matchMedia('(hover: hover) and (pointer: fine)').matches)).toBe(true);
    await expect(controls).toHaveCSS('opacity', '1');
    await expect(card.getByRole('button', { name: /^Next photo of/ })).toBeVisible();
    await expect(card.getByRole('button', { name: /^Previous photo of/ })).toBeVisible();
    await card.getByRole('button', { name: /^Next photo of/ }).click();
    await expect(photo).not.toHaveAttribute('src', original!);
    await expect(page).toHaveURL(/\/stock$/);
    await card.getByRole('button', { name: /^Previous photo of/ }).click();
    await expect(photo).toHaveAttribute('src', original!);
    await noPageOverflow(page);
    await capture(page, 'desktop-stock');
    const href = await link.getAttribute('href');
    await link.click();
    await expect(page).toHaveURL(new RegExp(`${href!}$`));
  });
});

if (process.env.LUXXY_TOUCH_REAL_PHOTOS === '1') {
  for (const device of touchDevices) {
    test.describe(`archived photography ${device.name}`, () => {
      test.use({ viewport: { width: device.width, height: device.height }, hasTouch: true, isMobile: true });

      test('captures stock and featured cars with their original photos', async ({ page }) => {
        const waitForVisiblePhotos = async () => {
          await expect.poll(() => page.locator('.vehicle-card img').evaluateAll((elements) => {
            const visible = elements.filter((element) => {
              const box = element.getBoundingClientRect();
              return box.top < innerHeight && box.bottom > 0 && box.left < innerWidth && box.right > 0;
            });
            return visible.length > 0 && visible.every((element) => (element as HTMLImageElement).complete && (element as HTMLImageElement).naturalWidth > 0);
          }), { timeout: 15000 }).toBe(true);
        };
        await page.goto('/stock');
        await centrePhoto(page.locator('.browse-stock [data-stock-link]').first());
        await waitForVisiblePhotos();
        await noPageOverflow(page);
        await capture(page, `${device.name}-stock`);
        await page.goto('/');
        const carousel = page.locator('.rolling-stock-window');
        await expect(carousel).toBeVisible();
        await page.getByRole('button', { name: 'Pause cars' }).tap();
        await carousel.evaluate((element) => element.scrollIntoView({ block: 'center', behavior: 'instant' }));
        await waitForVisiblePhotos();
        await noPageOverflow(page);
        await capture(page, `${device.name}-featured`);
      });
    });
  }
}
