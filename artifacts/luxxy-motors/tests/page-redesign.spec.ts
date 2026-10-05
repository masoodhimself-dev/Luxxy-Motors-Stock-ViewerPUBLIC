import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import type { Car, StockData } from '../src/lib/stock-context';

test.skip(process.env.LUXXY_LOCAL_PREVIEW !== '1', 'Read-only local preview redesign checks.');

const description = 'A carefully maintained used car with a comfortable cabin and practical luggage space. The supplied service records are available to inspect before a test drive.';
const features = ['Air conditioning', 'Bluetooth connectivity', 'Cruise control', 'Rear parking sensors', 'Heated front seats', 'DAB radio', 'Electric windows', 'Alloy wheels', 'Split folding rear seats', 'USB connection'];

async function fixture(page: Page, request: APIRequestContext) {
  // Preserve the imported shape while making the content and image behaviour
  // independent of the stock feed and external photograph host.
  const response = await request.get('/api/stock');
  expect(response.ok()).toBeTruthy();
  const original = await response.json() as StockData;
  expect(original.cars.length).toBeGreaterThan(0);
  const origin = new URL(response.url()).origin;
  const images = ['Front exterior', 'Cabin interior', 'Alloy wheel'].map((caption, index) => ({
    url: `${origin}/__page-redesign/photo-${index}.svg`, caption,
  }));
  const cars: Car[] = Array.from({ length: 8 }, (_, index) => ({
    ...original.cars[index % original.cars.length],
    id: index === 0 ? original.cars[0].id : `redesign-car-${index}`,
    advertId: `redesign-advert-${index}`,
    title: `2018 Ford Focus ${index + 1}`,
    make: 'Ford', model: 'Focus', year: 2018, variant: '1.0 EcoBoost Titanium',
    inventoryStatus: 'available', currency: 'GBP',
    price: index < 3 ? 4250 + index * 250 : 6000 + index * 500,
    transmission: index < 3 ? 'Automatic' : 'Manual',
    fuel: 'Petrol', mileage: 24000 + index * 2000,
    owners: 2, writeOffCategory: null,
    heroImage: images[0].url, images, imageCount: images.length,
    description, features,
    sourceExtras: {
      runningCosts: { items: [{ label: 'Tax per year', value: '£20' }] },
      serviceHistory: 'Full service history',
    },
  }));
  const stock = { ...original, cars, count: cars.length };
  await page.route('**/api/**', route => ['GET', 'HEAD'].includes(route.request().method())
    ? route.continue()
    : route.fulfill({ status: 405, json: { error: 'Read-only redesign check.' } }));
  await page.route('**/api/stock', route => route.fulfill({ json: stock }));
  await page.route('**/api/dealer-settings', async route => {
    const response = await route.fetch();
    const settings = await response.json();
    await route.fulfill({ response, json: {
      ...settings,
      bookViewing: { ...settings.bookViewing, ctaLabel: 'Book a test drive' },
      presentation: { ...settings.presentation, comparisonEnabled: true },
    } });
  });
  await page.route('**/__page-redesign/photo-*.svg', route => {
    const index = Number(new URL(route.request().url()).pathname.match(/photo-(\d)/)?.[1] || 0);
    return route.fulfill({ contentType: 'image/svg+xml', body: `<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="750"><rect width="1000" height="750" fill="${['#bccbd5', '#c7d0c7', '#d6cbbc'][index]}"/><path d="M150 480V380l160-120h330l160 120v100Z" fill="#30404b"/><circle cx="300" cy="480" r="65" fill="#172129"/><circle cx="680" cy="480" r="65" fill="#172129"/><text x="500" y="150" text-anchor="middle" font-family="sans-serif" font-size="48">Photograph ${index + 1}</text></svg>` });
  });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  return stock;
}

async function noOverflow(page: Page) {
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
}

for (const width of [390, 820, 1440]) {
  test(`vehicle redesign keeps content, gallery and selected-car booking usable at ${width}`, async ({ page, request }) => {
    await page.setViewportSize({ width, height: 950 });
    const { cars } = await fixture(page, request);
    const car = cars[0];
    await page.goto(`/vehicle/${car.id}`);
    await expect(page.getByRole('heading', { level: 1, name: 'Ford Focus 1', exact: true })).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Vehicle information sections', exact: true })).toHaveCount(1);
    await expect(page.getByRole('navigation', { name: 'Vehicle information', exact: true })).toHaveCount(0);
    await expect(page.locator('.vehicle-summary').getByText('2 previous keepers', { exact: true })).toBeVisible();
    await expect(page.locator('.vehicle-summary').getByText('£20 annual tax', { exact: true })).toBeVisible();
    await expect(page.locator('section[aria-labelledby="vehicle-description-heading"]')).toContainText(description);
    await expect(page.locator('section[aria-labelledby="features-heading"]')).toContainText(features[0]);

    // Check for the previous regression where the summary/gallery painted over
    // readable information, not just whether the text existed in the DOM.
    for (const id of ['features-heading', 'vehicle-description-heading', 'vehicle-overview-heading', 'buyer-information-heading']) {
      const heading = page.locator(`#${id}`);
      await heading.evaluate(element => element.scrollIntoView({ block: 'center', behavior: 'instant' }));
      await expect.poll(() => heading.evaluate(element => {
        const rect = element.getBoundingClientRect();
        const hit = document.elementFromPoint(rect.left + Math.min(rect.width / 2, 40), rect.top + rect.height / 2);
        return hit === element || !!hit && element.contains(hit);
      })).toBe(true);
    }
    const geometry = await page.evaluate(() => {
      const gallery = document.querySelector('.vehicle-detail-gallery')!.getBoundingClientRect();
      const summary = document.querySelector('.vehicle-summary-column')!.getBoundingClientRect();
      const information = document.querySelector('.vehicle-details-content')!.getBoundingClientRect();
      const top = document.querySelector('.vehicle-detail-grid')!.getBoundingClientRect();
      return { informationTop: information.top, topBottom: Math.max(gallery.bottom, summary.bottom), informationWidth: information.width, topWidth: top.width, galleryWidth: gallery.width, summaryWidth: summary.width };
    });
    expect(geometry.informationTop).toBeGreaterThanOrEqual(geometry.topBottom - 1);
    expect(Math.abs(geometry.informationWidth - geometry.topWidth)).toBeLessThanOrEqual(2);
    if (width === 1440) expect(geometry.galleryWidth).toBeGreaterThan(geometry.summaryWidth * 1.35);
    await page.locator('.vehicle-equipment-more summary').click();
    await expect(page.locator('.vehicle-equipment-more').getByText(features[9], { exact: true })).toBeVisible();
    await expect(page.getByTestId('mobile-conversion-bar')).toHaveCount(0);
    await noOverflow(page);

    await page.getByRole('button', { name: 'View gallery fullscreen', exact: true }).click();
    const lightbox = page.getByRole('dialog');
    await expect(lightbox).toBeVisible();
    await page.keyboard.press('ArrowRight');
    await expect(lightbox).toContainText('2 / 3');
    await page.keyboard.press('Escape');
    await expect(lightbox).toBeHidden();
    const booking = page.locator('[data-vehicle-contact="booking"]');
    await expect(booking).toHaveCount(1);
    await expect(booking).toHaveAttribute('href', `/enquire?type=viewing&vehicleId=${encodeURIComponent(car.id)}`);
    await booking.click();
    await expect(page).toHaveURL(new RegExp(`/enquire\\?type=viewing&vehicleId=${car.id}$`));
    await expect(page.getByTestId('card-enquiry-vehicle')).toContainText('Ford Focus 1');
  });

  test(`browse redesign presents balanced cards and restores search at ${width}`, async ({ page, request }) => {
    await page.setViewportSize({ width, height: 950 });
    const { cars } = await fixture(page, request);
    await page.goto('/stock');
    await expect(page.locator('h1')).toHaveCount(1);
    const cards = page.locator('.browse-stock .vehicle-card');
    await expect(cards).toHaveCount(cars.length);
    const columns = await cards.evaluateAll(elements => {
      const firstTop = elements[0].getBoundingClientRect().top;
      return elements.filter(element => Math.abs(element.getBoundingClientRect().top - firstTop) < 2).length;
    });
    expect(columns).toBe(width === 1440 ? 3 : width === 820 ? 2 : 1);
    await expect(page.getByTestId('stock-search-toolbar')).toHaveCSS('position', 'static');
    const displayOptions = page.getByTestId('stock-secondary-actions');
    const displayTrigger = displayOptions.getByRole('button', { name: 'Display & sharing' });
    await expect(displayTrigger).toHaveAttribute('aria-expanded', 'false');
    await displayTrigger.click();
    await expect(displayOptions.getByRole('button', { name: 'List', exact: true })).toBeVisible();
    await displayTrigger.click();
    await noOverflow(page);

    const search = page.getByTestId('input-showroom-search');
    await search.fill('automatic under £5k');
    await search.press('Enter');
    await expect(page.getByRole('button', { name: 'Remove Automatic filter', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Remove Up to £5,000 filter', exact: true })).toBeVisible();
    await expect(cards).toHaveCount(3);
    await page.getByRole('combobox', { name: 'Sort results', exact: true }).selectOption('price-desc');
    await expect.poll(() => new URL(page.url()).searchParams.get('sort')).toBe('price-desc');
    const filteredUrl = page.url();
    expect(new URL(filteredUrl).searchParams.get('sort')).toBe('price-desc');
    const link = page.locator('[data-stock-link]').first();
    await link.scrollIntoViewIfNeeded();
    const scrollBefore = await page.evaluate(() => scrollY);
    await link.click();
    await expect(page.locator('.vehicle-summary')).toBeVisible();
    await page.getByRole('link', { name: 'Back to your results', exact: true }).click();
    await expect(page).toHaveURL(filteredUrl);
    await expect(cards).toHaveCount(3);
    await expect.poll(async () => Math.abs(await page.evaluate(() => scrollY) - scrollBefore)).toBeLessThan(120);
    await page.getByRole('button', { name: 'Reset all', exact: true }).click();
    await expect(cards).toHaveCount(cars.length);
    await expect(search).toHaveValue('');
    await noOverflow(page);
  });
}

test('missing content stays hidden and a reserved car has no test-drive action', async ({ page, request }) => {
  const stock = await fixture(page, request);
  const car = { ...stock.cars[0], inventoryStatus: 'reserved', description: null, features: [], sourceExtras: {}, specifications: {} };
  await page.route('**/api/stock', route => route.fulfill({ json: { ...stock, cars: [car], count: 1 } }));
  await page.goto(`/vehicle/${car.id}`);
  await expect(page.locator('.vehicle-summary')).toContainText('Reserved');
  await expect(page.locator('#vehicle-description-heading, #features-heading')).toHaveCount(0);
  await expect(page.locator('[data-vehicle-contact="booking"]')).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Choose a test-drive time', exact: true })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Enquire about this car', exact: true })).toBeVisible();
});
