import { mkdir } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';

test.skip(process.env.LUXXY_LOCAL_PREVIEW !== '1', 'Run against the isolated local preview.');

test.beforeEach(async ({ page }) => {
  await page.route('**/api/**', route => ['GET', 'HEAD'].includes(route.request().method()) ? route.continue() : route.abort());
});

async function checkAndCapture(page: Page, name: string) {
  await expect(page.locator('#main-content h1').first()).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(page.viewportSize()!.width + 1);
  if (process.env.LUXXY_SITE_AUDIT_CAPTURE !== '1') return;
  await page.evaluate(async () => {
    await Promise.race([
      Promise.all(Array.from(document.images).filter(image => {
        const box = image.getBoundingClientRect();
        return box.top < innerHeight && box.bottom > 0;
      }).map(image => image.decode().catch(() => undefined))),
      new Promise(resolve => setTimeout(resolve, 2000)),
    ]);
  });
  await mkdir('/tmp/luxxy-site-audit', { recursive: true });
  await page.screenshot({ path: `/tmp/luxxy-site-audit/${name}-${page.viewportSize()!.width}.jpg`, type: 'jpeg', quality: 80, animations: 'disabled' });
}

for (const width of [390, 820, 1440]) {
  test.describe(`${width}px showroom audit`, () => {
    test.use({ viewport: { width, height: width === 820 ? 1180 : 900 }, hasTouch: width < 1000, reducedMotion: 'reduce' });

    test('home search, saved details, vehicle gallery and specific booking link', async ({ page, request }) => {
      const stock = await (await request.get('/api/stock')).json();
      const car = stock.cars.find((candidate: { make?: string; inventoryStatus?: string }) => candidate.make && !['sold', 'archived', 'hidden'].includes(candidate.inventoryStatus ?? ''));
      await page.goto('/');
      await checkAndCapture(page, 'home');
      await page.getByRole('combobox', { name: 'Search make', exact: true }).selectOption(car.make);
      await page.getByRole('button', { name: /^Browse cars/ }).click();
      await expect(page).toHaveURL(/\/stock\?/);
      await expect(page.getByRole('button', { name: `Remove ${car.make} filter`, exact: true })).toBeVisible();
      const matchCount = stock.cars.filter((item: { make: string; inventoryStatus?: string }) => item.make === car.make && !['sold', 'archived', 'hidden'].includes(item.inventoryStatus ?? '')).length;
      await expect(page.getByTestId('text-filtered-stock-count')).toHaveText(`${matchCount} ${matchCount === 1 ? 'car matches' : 'cars match'} your search`);
      await checkAndCapture(page, 'filtered-stock');
      const card = page.locator('#vehicle-results .vehicle-card').first();
      const vehicleHref = (await card.locator('[data-stock-link]').getAttribute('href'))!;
      await card.getByRole('button', { name: /^Save .* to your saved cars$/ }).click();
      await page.getByRole('button', { name: /^Saved cars(?:,|$)/ }).filter({ visible: true }).click();
      await expect(page).toHaveTitle(/^Saved cars \|/);
      await page.locator('summary').filter({ hasText: 'More details' }).click();
      await expect(page.getByRole('heading', { name: 'About this car' })).toBeVisible();
      await checkAndCapture(page, 'saved');
      await page.getByRole('link', { name: 'View vehicle', exact: true }).click();
      await expect(page).toHaveURL(new RegExp(`${vehicleHref}$`));
      const selectedCar = stock.cars.find((item: { id: string }) => vehicleHref.endsWith(`/${item.id}`));
      if (selectedCar.year) await expect(page.getByTestId('text-registration-year')).toContainText(String(selectedCar.year));
      await checkAndCapture(page, 'vehicle');
      const gallery = page.locator('.vehicle-detail-gallery');
      await expect(gallery.locator('.vehicle-gallery-frame > div')).toHaveCSS('touch-action', 'pan-y pinch-zoom');
      await gallery.getByRole('button', { name: /Next photo/ }).first().click();
      const expand = gallery.getByRole('button', { name: /full.?screen|Enlarge|Open.*photo/i }).first();
      if (await expand.count()) {
        await expand.click();
        await expect(page.getByRole('dialog')).toBeVisible();
        await expect(page.locator('.vehicle-lightbox-photo')).toHaveCSS('touch-action', 'pan-y pinch-zoom');
        await page.keyboard.press('Escape');
        await expect(page.getByRole('dialog')).toHaveCount(0);
      }
      for (const id of ['vehicle-description-heading', 'features-heading']) {
        const heading = page.locator(`#${id}`);
        if (!await heading.count()) continue;
        await page.locator(`a[href="#${id}"]`).click();
        await expect.poll(() => heading.evaluate(element => {
          const rect = element.getBoundingClientRect();
          const top = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
          return top === element || element.contains(top);
        })).toBe(true);
      }
      const book = page.getByRole('link', { name: 'Book a test drive', exact: true }).filter({ visible: true }).first();
      await book.click();
      await expect(page).toHaveURL(new RegExp(`vehicleId=${vehicleHref.split('/').pop()}`));
      await expect(page.getByTestId('group-viewing-slots')).toBeVisible();
      await checkAndCapture(page, 'booking');
    });

    test('empty and unavailable routes have useful titles and recovery links', async ({ page }) => {
      await page.goto('/saved');
      await expect(page).toHaveTitle(/^Saved cars \|/);
      await expect(page.getByRole('heading', { name: 'No saved cars yet' })).toBeVisible();
      await checkAndCapture(page, 'saved-empty');
      await page.goto('/saved?cars=missing-audit-car');
      await expect(page).toHaveTitle(/^Shared shortlist \|/);
      await expect(page.getByRole('heading', { name: 'No cars available in this shortlist' })).toBeVisible();
      await page.goto('/compare');
      await expect(page).toHaveTitle(/^(Compare cars|Choose your next car) \|/);
      await checkAndCapture(page, 'compare');
      await page.goto('/vehicle/missing-audit-car');
      await expect(page).toHaveTitle(/^Vehicle not in stock \|/);
      await expect(page.getByRole('heading', { name: 'This car isn’t in our current stock' })).toBeVisible();
      await checkAndCapture(page, 'vehicle-unavailable');
      await page.goto('/missing-audit-page');
      await expect(page).toHaveTitle(/^Page not found \|/);
      await checkAndCapture(page, 'not-found');
      await page.locator('#main-content').getByRole('link', { name: 'Browse Stock', exact: true }).click();
      await expect(page).toHaveURL(/\/stock$/);
      await expect(page).toHaveTitle(/^Browse Stock \|/);
    });
  });
}
