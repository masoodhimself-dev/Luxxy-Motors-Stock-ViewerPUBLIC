import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { expect, test, type Locator, type Page } from '@playwright/test';

test.skip(process.env.LUXXY_LOCAL_PREVIEW !== '1', 'Local preview only.');

const caption = 'Illustrative showroom imagery · Template preview';
const bundledPhoto = 'img[src*="luxxy-showroom"], img[src*="luxxy-forecourt"], img[src*="luxxy-exterior"], img[src*="luxxy-reception"]';
const screenshotDirectory = resolve('../../docs/screenshots/dealership-photography');

async function expectLoaded(image: Locator) {
  await expect(image).toBeVisible();
  await image.scrollIntoViewIfNeeded();
  await expect.poll(() => image.evaluate(element => {
    const photo = element as HTMLImageElement;
    return photo.complete && photo.naturalWidth > 0 && photo.naturalHeight > 0;
  })).toBe(true);
}

async function expectNoOverflow(page: Page, width: number) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
}

for (const width of [390, 1440]) {
  test(`supplied dealership photos load in their intended sections at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    await mkdir(screenshotDirectory, { recursive: true });
    await page.goto('/');
    const hero = page.getByTestId('showroom-hero-photo');
    await expect(hero).toHaveAttribute('href', '/#stock');
    await expect(hero.locator('img')).toHaveAttribute('src', /luxxy-hero/);
    await expect(hero.locator('img')).toHaveAttribute('alt', /dark blue Mercedes-Benz overlooking a lake/);
    await expectLoaded(hero.locator('img'));

    const about = page.locator('#about');
    const visit = page.locator('#visit');
    await expectLoaded(about.locator('img[src*="luxxy-showroom"]'));
    await expectLoaded(visit.locator('img[src*="luxxy-forecourt"]'));
    await expect(about.getByText(caption, { exact: true })).toBeVisible();
    await expect(visit.getByText(caption, { exact: true })).toBeVisible();
    await expect(page.locator(bundledPhoto)).toHaveCount(2);
    await expectNoOverflow(page, width);
    await page.evaluate(() => document.fonts.ready);
    await about.screenshot({ path: resolve(screenshotDirectory, `home-about-${width}.png`) });
    await visit.screenshot({ path: resolve(screenshotDirectory, `home-visit-${width}.png`) });

    await page.goto('/contact');
    await expect(page.getByRole('heading', { name: 'Contact us.', exact: true })).toBeVisible();
    await expectLoaded(page.getByTestId('contact-location').locator('img[src*="luxxy-exterior"]'));
    await expectLoaded(page.locator('#contact-message img[src*="luxxy-reception"]'));
    await expect(page.getByText(caption, { exact: true })).toHaveCount(2);
    await expect(page.locator(bundledPhoto)).toHaveCount(2);
    await expect(page.getByTestId('contact-address')).toContainText('sample address');
    await expect(page.getByTestId('contact-directions')).toHaveCount(0);
    await expectNoOverflow(page, width);
    await page.evaluate(async () => { await document.fonts.ready; window.scrollTo({ top: 0, behavior: 'instant' }); });
    await page.screenshot({ path: resolve(screenshotDirectory, `contact-${width}.png`), fullPage: true });
    await page.screenshot({ path: resolve(screenshotDirectory, `contact-${width}-viewport.png`) });
  });
}

test('configured showroom and team photographs take priority over template artwork', async ({ page, request }) => {
  const settings = await (await request.get('/api/dealer-settings')).json();
  settings.presentation = {
    ...settings.presentation,
    showroomImageUrl: '/test-dealer-showroom.svg',
    showroomImageAlt: 'Our own showroom exterior',
    teamImageUrl: '/test-dealer-team.svg',
    teamImageAlt: 'Our own dealership team',
  };
  await page.route('**/api/dealer-settings', route => route.fulfill({ json: settings }));
  await page.route('**/test-dealer-*.svg', route => route.fulfill({
    contentType: 'image/svg+xml',
    body: '<svg xmlns="http://www.w3.org/2000/svg" width="160" height="90"><rect width="160" height="90" fill="#263a35"/></svg>',
  }));
  await page.goto('/');
  await expectLoaded(page.locator('#about').getByRole('img', { name: 'Our own showroom exterior', exact: true }));
  await expectLoaded(page.locator('#visit').getByRole('img', { name: 'Our own dealership team', exact: true }));
  await expect(page.locator(bundledPhoto)).toHaveCount(0);
  await expect(page.getByText(caption, { exact: true })).toHaveCount(0);
  await expect(page.getByTestId('showroom-hero-photo').locator('img')).toHaveAttribute('src', /luxxy-hero/);

  await page.goto('/contact');
  await expectLoaded(page.getByTestId('contact-location').getByRole('img', { name: 'Our own showroom exterior', exact: true }));
  await expectLoaded(page.locator('#contact-message').getByRole('img', { name: 'Our own dealership team', exact: true }));
  await expect(page.locator(bundledPhoto)).toHaveCount(0);
  await expect(page.getByText(caption, { exact: true })).toHaveCount(0);
});

test('another dealership receives no bundled Luxxy imagery', async ({ page, request }) => {
  const settings = await (await request.get('/api/dealer-settings')).json();
  settings.identity = { ...settings.identity, name: 'Harrow Independent Motors', logoText: 'HARROW INDEPENDENT MOTORS' };
  settings.presentation = { ...settings.presentation, showroomImageUrl: '', teamImageUrl: '' };
  await page.route('**/api/dealer-settings', route => route.fulfill({ json: settings }));
  await page.goto('/');
  await expect(page.getByTestId('showroom-hero-photo')).toHaveAttribute('href', /^\/vehicle\//);
  await expect(page.getByTestId('showroom-hero-photo').locator('img')).not.toHaveAttribute('src', /luxxy-hero/);
  await expect(page.locator(bundledPhoto)).toHaveCount(0);
  await expect(page.getByText(caption, { exact: true })).toHaveCount(0);

  await page.goto('/contact');
  await expect(page.getByRole('heading', { name: 'Contact us.', exact: true })).toBeVisible();
  await expect(page.getByTestId('contact-location')).toContainText('Harrow Independent Motors');
  await expect(page.locator(bundledPhoto)).toHaveCount(0);
  await expect(page.getByText(caption, { exact: true })).toHaveCount(0);
  await expect(page.locator('img[src*="luxxy-hero"]')).toHaveCount(0);
});
