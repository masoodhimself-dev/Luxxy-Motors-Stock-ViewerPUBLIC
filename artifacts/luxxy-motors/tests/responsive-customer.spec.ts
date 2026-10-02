import { mkdir } from 'node:fs/promises';
import { expect, test, type APIRequestContext, type Locator, type Page } from '@playwright/test';

test.skip(process.env.LUXXY_LOCAL_PREVIEW !== '1', 'Responsive checks run against the isolated local preview.');
test.use({ hasTouch: true, reducedMotion: 'reduce' });

const viewports = [
  { width: 320, height: 740 },
  { width: 375, height: 812 },
  { width: 820, height: 1180 },
  { width: 1024, height: 768 },
  { width: 1180, height: 820 },
];

type StockCar = { id: string; make: string; inventoryStatus?: string };

async function currentCars(request: APIRequestContext): Promise<StockCar[]> {
  const response = await request.get('/api/stock');
  expect(response.ok()).toBe(true);
  const stock = await response.json();
  const cars = stock.cars.filter((car: StockCar) => !['sold', 'archived', 'hidden'].includes(car.inventoryStatus?.toLowerCase() ?? ''));
  expect(cars.length).toBeGreaterThan(0);
  return cars;
}

async function settleContent(page: Page) {
  await expect(page.locator('#main-content h1').first()).toBeVisible();
  await expect(page.locator('[aria-busy="true"], [data-testid="loading-enquiry-vehicle"], [data-testid="loading-availability"]')).toHaveCount(0);
  await page.evaluate(async () => {
    await document.fonts.ready;
    const visibleImages = Array.from(document.images).filter(image => {
      const box = image.getBoundingClientRect();
      return box.width > 0 && box.height > 0 && box.top < innerHeight && box.bottom > 0;
    });
    await Promise.race([
      Promise.all(visibleImages.map(image => image.decode().catch(() => undefined))),
      new Promise(resolve => setTimeout(resolve, 2000)),
    ]);
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });
}

async function expectNoHorizontalOverflow(page: Page) {
  const dimensions = await page.evaluate(() => ({
    viewport: innerWidth,
    page: document.documentElement.scrollWidth,
    body: document.body.scrollWidth,
  }));
  expect(dimensions.page, JSON.stringify(dimensions)).toBeLessThanOrEqual(dimensions.viewport + 1);
  expect(dimensions.body, JSON.stringify(dimensions)).toBeLessThanOrEqual(dimensions.viewport + 1);
}

async function expectInsideViewport(page: Page, locator: Locator) {
  await expect(locator).toBeVisible();
  await expect.poll(async () => {
    const box = await locator.boundingBox();
    const viewport = page.viewportSize()!;
    return !!box && box.x >= -1 && box.y >= -1 && box.x + box.width <= viewport.width + 1 && box.y + box.height <= viewport.height + 1;
  }).toBe(true);
}

async function expectReachable(locator: Locator) {
  await locator.scrollIntoViewIfNeeded();
  await expect(locator).toBeInViewport();
  await expect.poll(() => locator.evaluate(element => {
    const box = element.getBoundingClientRect();
    const target = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
    return target === element || element.contains(target);
  })).toBe(true);
}

async function capture(page: Page, name: string) {
  if (process.env.LUXXY_CAPTURE_RESPONSIVE !== '1') return;
  await mkdir('/tmp/luxxy-responsive', { recursive: true });
  await page.screenshot({ path: `/tmp/luxxy-responsive/final-${name}-${page.viewportSize()!.width}.jpg`, type: 'jpeg', quality: 78, animations: 'disabled' });
}

async function scrollWithReadableTop(page: Page, locator: Locator) {
  await expect(locator).toBeVisible();
  await locator.evaluate(element => {
    const header = document.querySelector('[data-site-header]')?.getBoundingClientRect();
    window.scrollTo({ top: scrollY + element.getBoundingClientRect().top - (header?.height ?? 0) - 16, behavior: 'instant' });
  });
  await settleContent(page);
}

async function expectFooterTextUnclipped(footer: Locator) {
  const clippedText = await footer.evaluate(element => {
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    const clipped: string[] = [];
    while (walker.nextNode()) {
      const node = walker.currentNode;
      if (!node.textContent?.trim()) continue;
      const range = document.createRange();
      range.selectNodeContents(node);
      for (const rect of range.getClientRects()) {
        if (!rect.width || !rect.height) continue;
        let isClipped = rect.left < -1 || rect.right > innerWidth + 1;
        for (let parent = node.parentElement; parent && element.contains(parent); parent = parent.parentElement) {
          const style = getComputedStyle(parent);
          const box = parent.getBoundingClientRect();
          if (['hidden', 'clip'].includes(style.overflowX) && (rect.left < box.left - 1 || rect.right > box.right + 1)) isClipped = true;
          if (['hidden', 'clip'].includes(style.overflowY) && (rect.top < box.top - 1 || rect.bottom > box.bottom + 1)) isClipped = true;
        }
        if (isClipped) clipped.push(node.textContent.trim());
      }
    }
    return clipped;
  });
  expect(clippedText).toEqual([]);
}

test.beforeEach(async ({ page }) => {
  // No customer, dealership, or analytics writes leave this read-only browser check.
  await page.route('**/api/**', route => ['GET', 'HEAD'].includes(route.request().method()) ? route.continue() : route.abort('blockedbyclient'));
});

for (const viewport of viewports) {
  test.describe(`${viewport.width}x${viewport.height}`, () => {
    test.use({ viewport });

    test('public pages fit after content settles and after scrolling', async ({ page, request }) => {
      test.setTimeout(90_000);
      const [car] = await currentCars(request);
      const pages = [
        ['home', '/'],
        ['stock', '/stock'],
        ['vehicle', `/vehicle/${car.id}`],
        ['booking', `/enquire?type=viewing&vehicleId=${car.id}`],
        ['part-exchange', '/enquire?type=part_exchange'],
        ['contact', '/contact'],
        ['warranty', '/warranty'],
        ['saved', `/saved?cars=${car.id}`],
        ['compare', '/compare'],
      ];
      for (const [name, path] of pages) {
        await test.step(name, async () => {
          await page.goto(path);
          await settleContent(page);
          if (name === 'saved') await expect(page.getByTestId('text-saved-count')).toHaveText('1 car in this shortlist');
          if (name === 'part-exchange') {
            const plate = page.getByTestId('input-part-exchange-registration');
            // Touch-specific type rules must not shrink the intentionally large number plate.
            expect(await plate.evaluate(element => parseFloat(getComputedStyle(element).fontSize))).toBeGreaterThanOrEqual(20);
          }
          await expectNoHorizontalOverflow(page);
          await capture(page, name);
          if ([375, 820, 1180].includes(viewport.width)) {
            if (name === 'home') {
              await scrollWithReadableTop(page, page.locator('#visit'));
              await capture(page, 'home-visit');
              await expectNoHorizontalOverflow(page);
            }
            if (name === 'vehicle') {
              for (const [section, headingId] of [['description', 'vehicle-description-heading'], ['features', 'features-heading']]) {
                const heading = page.locator(`#${headingId}`);
                if (await heading.count()) {
                  await scrollWithReadableTop(page, heading);
                  await expectReachable(heading);
                  await capture(page, `vehicle-${section}`);
                  await expectNoHorizontalOverflow(page);
                }
              }
            }
          }
          // Recheck after lazy content and the footer have entered the viewport.
          const footer = page.locator('footer').filter({ visible: true });
          await scrollWithReadableTop(page, footer);
          await expectFooterTextUnclipped(footer);
          await expectNoHorizontalOverflow(page);
          await capture(page, `footer-${name}`);
          await page.evaluate(() => window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' }));
          await expectFooterTextUnclipped(footer);
          await capture(page, `footer-end-${name}`);
        });
      }
    });

    test('navigation and stock filters remain reachable by touch', async ({ page, request }) => {
      const cars = await currentCars(request);
      const car = cars.find(car => Boolean(car.make))!;
      await page.goto('/');
      await settleContent(page);
      const menu = page.getByRole('button', { name: 'Open navigation menu' });
      if (viewport.width < 1024) {
        await expectReachable(menu);
        await menu.tap();
        const navigation = page.getByRole('navigation', { name: 'Mobile navigation' });
        await expectInsideViewport(page, navigation);
        const contact = navigation.getByRole('link', { name: 'Contact us', exact: true });
        await expectReachable(contact);
        await capture(page, 'navigation');
        await contact.tap();
        await expect(page).toHaveURL(/\/contact$/);
        await expect(navigation).toHaveCount(0);
        await expect(menu).toHaveAttribute('aria-expanded', 'false');
      } else {
        const navigation = page.getByRole('navigation', { name: 'Primary navigation' }).filter({ visible: true });
        for (const control of await navigation.locator('a, button').all()) {
          await expectInsideViewport(page, control);
          await expectReachable(control);
          const box = (await control.boundingBox())!;
          expect(box.height).toBeGreaterThanOrEqual(44);
          expect(box.width).toBeGreaterThanOrEqual(44);
        }
        const contact = navigation.getByRole('link', { name: 'Contact us', exact: true });
        await expectReachable(contact);
        await contact.tap();
        await expect(page).toHaveURL(/\/contact$/);
      }

      await page.goto('/stock');
      await settleContent(page);
      const filters = page.getByRole('button', { name: 'Advanced search' });
      await expectReachable(filters);
      await filters.tap();
      const dialog = page.getByRole('dialog', { name: 'Filter used cars' });
      await expectInsideViewport(page, dialog);
      const make = dialog.getByRole('combobox', { name: 'Make', exact: true });
      await expectReachable(make);
      await make.selectOption(car.make);
      const expectedCount = cars.filter(candidate => candidate.make === car.make).length;
      const showCars = dialog.getByRole('button', { name: `Show ${expectedCount} ${expectedCount === 1 ? 'car' : 'cars'}`, exact: true });
      await expectReachable(showCars);
      await expectInsideViewport(page, showCars);
      await capture(page, 'filters');
      await showCars.tap();
      await expect(dialog).toHaveCount(0);
      await expect(page.getByTestId('text-filtered-stock-count')).toContainText(`${expectedCount} ${expectedCount === 1 ? 'car matches' : 'cars match'} your search`);
      await expect(page.getByRole('button', { name: `Remove ${car.make} filter`, exact: true })).toBeVisible();
      const sort = page.getByRole('combobox', { name: 'Sort results' });
      await expectReachable(sort);
      expect(await sort.evaluate(element => parseFloat(getComputedStyle(element).fontSize))).toBeGreaterThanOrEqual(16);
      await sort.selectOption('price-asc');
      await expect(sort).toHaveValue('price-asc');
      const reset = page.getByRole('button', { name: 'Reset all', exact: true });
      await expectReachable(reset);
      await reset.tap();
      await expect(page.getByTestId('text-filtered-stock-count')).toContainText(`${cars.length} vehicles available`);
      await expect(sort).toHaveValue('');
      await expectNoHorizontalOverflow(page);
    });

    test('booking date, time and contact steps fit without submitting', async ({ page, request }) => {
      const [car] = await currentCars(request);
      await page.goto(`/enquire?type=viewing&vehicleId=${car.id}`);
      await settleContent(page);
      const continueButton = page.getByTestId('button-continue-to-details');
      await expect(continueButton).toBeDisabled();
      const date = page.getByTestId('group-viewing-dates').getByRole('button').nth(1);
      await expectReachable(date);
      await date.tap();
      await expect(date).toHaveAttribute('aria-pressed', 'true');
      const slot = page.getByTestId('group-viewing-slots').locator('button:not([disabled])').first();
      await expect(slot).toBeVisible();
      await expectReachable(slot);
      const selectedStart = (await slot.getAttribute('data-testid'))!.replace('button-viewing-slot-', '');
      const selectedTime = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', hour: '2-digit', minute: '2-digit' }).format(new Date(selectedStart));
      await slot.tap();
      await expect(slot).toHaveAttribute('aria-pressed', 'true');
      await expectReachable(continueButton);
      await continueButton.tap();
      await expect(page.getByTestId('input-customer-name')).toBeFocused();
      await expect(page.getByTestId('card-selected-viewing')).toContainText(selectedTime!);
      await expectReachable(page.getByTestId('input-customer-name'));
      await page.getByTestId('input-customer-name').fill('Responsive Preview');
      await page.getByTestId('input-customer-email').fill('responsive@example.test');
      await page.getByTestId('input-customer-phone').fill('07700 900123');
      await expect(page.getByTestId('select-preferred-contact')).toHaveCount(0);
      await expectReachable(page.getByTestId('button-review-booking'));
      await page.getByTestId('button-review-booking').tap();
      await expect(page.getByTestId('button-submit-enquiry')).toHaveText('Confirm test drive');
      await expect(page.getByRole('button', { name: 'Reserve car online', exact: true })).toHaveCount(0);
      await expectReachable(page.getByTestId('button-submit-enquiry'));
      await expectNoHorizontalOverflow(page);
      await capture(page, 'booking-details');
      await expect(page.getByTestId('status-enquiry-success')).toHaveCount(0);
    });

    test('shared saved details and gallery controls stay usable', async ({ page, request }) => {
      const [car] = await currentCars(request);
      await page.goto(`/saved?cars=${car.id}`);
      await settleContent(page);
      const details = page.locator('summary').filter({ hasText: 'More details' });
      await expectReachable(details);
      await details.tap();
      await expect(details.locator('..')).toHaveAttribute('open', '');
      const booking = page.getByRole('link', { name: 'Book a test drive', exact: true });
      await expectReachable(booking);
      await expect(booking).toHaveAttribute('href', new RegExp(`vehicleId=${car.id}`));
      await expectNoHorizontalOverflow(page);
      await capture(page, 'saved-details');

      await page.goto(`/vehicle/${car.id}`);
      await settleContent(page);
      const opener = page.getByRole('button', { name: 'View gallery fullscreen' });
      await opener.tap();
      const gallery = page.getByRole('dialog', { name: 'Vehicle image gallery' });
      await expectInsideViewport(page, gallery);
      const next = gallery.getByRole('button', { name: 'Next photograph' });
      const previous = gallery.getByRole('button', { name: 'Previous photograph' });
      const close = gallery.getByRole('button', { name: 'Close', exact: true });
      for (const control of [next, previous, close]) {
        await expectInsideViewport(page, control);
        await expectReachable(control);
      }
      await next.tap();
      await expect(gallery).toContainText('2 /');
      await previous.tap();
      await expect(gallery).toContainText('1 /');
      await capture(page, 'gallery');
      await close.tap();
      await expect(gallery).toHaveCount(0);
      await expect(opener).toBeFocused();
      await expectNoHorizontalOverflow(page);
    });
  });
}
