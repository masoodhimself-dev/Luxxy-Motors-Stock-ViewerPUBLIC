import { expect, test, type APIRequestContext, type Locator, type Page } from '@playwright/test';
import type { StockData } from '../src/lib/stock-context';

test.skip(process.env.LUXXY_LOCAL_PREVIEW !== '1', 'Mocked dealer presentation audit; API writes are blocked.');

async function fixture(page: Page, request: APIRequestContext, presentation: Record<string, string>) {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const response = await request.get('/api/stock');
  const stock = await response.json() as StockData;
  const cars = stock.cars.slice(0, 2).map(car => ({ ...car, inventoryStatus: 'available', sourceMissingAt: null }));
  await page.addInitScript(ids => localStorage.setItem('luxxy.saved-cars.v1', JSON.stringify(ids)), cars.map(car => car.id));
  await page.route('**/api/**', route => ['GET', 'HEAD'].includes(route.request().method()) ? route.continue() : route.fulfill({ status: 405, json: { error: 'Read-only theme audit.' } }));
  await page.route('**/api/stock', route => route.fulfill({ json: { ...stock, cars, count: cars.length } }));
  await page.route('**/api/dealer-settings', async route => {
    const response = await route.fetch();
    const settings = await response.json();
    await route.fulfill({ response, json: {
      ...settings,
      identity: { ...settings.identity, brandColors: { primaryHsl: '45 80% 85%', accentHsl: '42 80% 75%' } },
      contact: { ...settings.contact, email: 'sales@theme-fixture.example' },
      presentation: { ...settings.presentation, ...presentation },
      warranty: { ...settings.warranty, enabled: true },
    } });
  });
  return cars;
}

async function readable(element: Locator, minimum = 4.5, property: 'color' | 'borderTopColor' = 'color') {
  const result = await element.evaluate((node, property) => {
    const rgb = (colour: string) => colour.match(/[\d.]+/g)?.map(Number) ?? [];
    const mix = (foreground: number[], background: number[]) => {
      const alpha = foreground.length > 3 ? foreground[3] : 1;
      return foreground.slice(0, 3).map((value, index) => value * alpha + background[index] * (1 - alpha));
    };
    const parents: HTMLElement[] = [];
    for (let parent = node as HTMLElement | null; parent; parent = parent.parentElement) parents.unshift(parent);
    const surface = parents.reduce((background, parent) => mix(rgb(getComputedStyle(parent).backgroundColor), background), [255, 255, 255]);
    const luminance = (channels: number[]) => channels.map(value => {
      const unit = value / 255;
      return unit <= .04045 ? unit / 12.92 : ((unit + .055) / 1.055) ** 2.4;
    }).reduce((sum, value, index) => sum + value * [.2126, .7152, .0722][index], 0);
    const foreground = mix(rgb(getComputedStyle(node)[property]), surface);
    const first = luminance(foreground), second = luminance(surface);
    return { ratio: (Math.max(first, second) + .05) / (Math.min(first, second) + .05), colour: getComputedStyle(node).color, background: surface, text: node.textContent?.slice(0, 70) };
  }, property);
  expect(result.ratio, JSON.stringify(result)).toBeGreaterThanOrEqual(minimum);
}

for (const palette of [
  { name: 'pale supplied headings and links', pageColour: '#edf6f4', panelColour: '#fff6e8', headingColour: '#ffffdf', linkColour: '#ffffdf' },
  { name: 'light canvas with dark panels', pageColour: '#f5f6f7', panelColour: '#192a36', headingColour: '#192a36', linkColour: '#215a7e' },
  { name: 'dark canvas with light panels', pageColour: '#192a36', panelColour: '#ffffff', headingColour: '#5b2635', linkColour: '#215a7e' },
]) {
  test(`dealer theme stays legible through pages, navigation and portalled filters: ${palette.name}`, async ({ page, request }) => {
    const { name, ...presentation } = palette;
    const cars = await fixture(page, request, presentation);
    for (const path of ['/stock', `/vehicle/${cars[0].id}`, '/contact', '/warranty', '/saved', '/enquire?type=general']) {
      await page.goto(path);
      await expect(page.locator('.customer-site')).toHaveCount(1);
      await expect.poll(() => page.evaluate(() => document.body.style.getPropertyValue('--dealer-page'))).toBe(presentation.pageColour);
      await readable(page.locator('#main-content h1').first());
      await readable(page.locator('[data-site-header] nav[aria-label="Primary navigation"]:visible a[href="/contact"]'));
      await expect(page.locator('[data-site-header] nav[aria-label="Primary navigation"]:visible a[href="/contact"]')).toHaveCSS('font-weight', '500');
      await expect(page.locator('#contact h3').first()).toHaveCSS('font-size', '14px');
      const headerBooking = page.locator('[data-site-header] nav[aria-label="Primary navigation"]:visible button[class*="bg-primary"]');
      await readable(headerBooking);
      await headerBooking.hover();
      await readable(headerBooking);
      await readable(page.locator('#contact h3').first());
      await readable(page.locator('#contact p').first());
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
      if (path === '/stock') {
        await readable(page.locator('.vehicle-card-details h3').first());
        await readable(page.locator('.vehicle-card-view').first());
        await readable(page.locator('.stock-toolbar input').first(), 3, 'borderTopColor');
        await page.getByRole('button', { name: 'Advanced search', exact: true }).click();
        const dialog = page.getByRole('dialog');
        await expect(dialog).toHaveCSS('background-color', presentation.panelColour === '#192a36' ? 'rgb(25, 42, 54)' : presentation.panelColour === '#fff6e8' ? 'rgb(255, 246, 232)' : 'rgb(255, 255, 255)');
        await readable(dialog.locator('h2'));
        await readable(dialog.locator('.stock-search-submit'));
        await readable(dialog.locator('.stock-filter-select').first(), 3, 'borderTopColor');
        await page.keyboard.press('Escape');
      }
      if (path === '/contact') await readable(page.getByTestId('contact-email').locator('.text-muted-foreground'));
      if (path === '/saved') {
        await page.getByTestId('button-clear-saved').click();
        const confirmation = page.getByRole('alertdialog');
        await readable(confirmation.locator('h2'));
        await readable(confirmation.locator('p'));
        await readable(confirmation.getByRole('button', { name: 'Keep my cars' }));
        await confirmation.getByRole('button', { name: 'Keep my cars' }).click();
      }
      if (path.startsWith('/vehicle/')) {
        const booking = page.locator('.vehicle-booking-action');
        await readable(booking);
        await booking.hover();
        await readable(booking);
      }
      if (path.includes('/enquire')) await readable(page.locator('form label').first());
    }
  });
}

test('mobile navigation uses the panel palette and restores customer variables on leaving the site', async ({ page, request }) => {
  await page.setViewportSize({ width: 390, height: 900 });
  await fixture(page, request, { pageColour: '#edf6f4', panelColour: '#192a36', headingColour: '#192a36', linkColour: '#215a7e' });
  await page.goto('/contact');
  await page.getByRole('button', { name: 'Open navigation menu', exact: true }).click();
  const menu = page.getByRole('navigation', { name: 'Mobile navigation' });
  await expect(menu).toHaveCSS('background-color', 'rgb(25, 42, 54)');
  await readable(menu.getByRole('button', { name: 'Browse Stock', exact: false }).first());
  for (let index = 0; index < 24 && await menu.count(); index++) {
    await page.keyboard.press('Tab');
    if (await menu.count()) expect(await menu.evaluate(element => element.contains(document.activeElement))).toBe(true);
  }
  await expect(menu).toHaveCount(0);
  await page.getByRole('button', { name: 'Open navigation menu', exact: true }).click();
  await page.keyboard.press('Escape');
  expect(await page.evaluate(() => document.body.style.getPropertyValue('--dealer-page'))).toBe('#edf6f4');
  await page.evaluate(() => {
    history.pushState({}, '', '/portal');
    window.dispatchEvent(new PopStateEvent('popstate'));
  });
  await expect.poll(() => page.evaluate(() => document.body.style.getPropertyValue('--dealer-page'))).toBe('');
});

test('dark-panel enquiry validation and rejected submission errors remain readable without forwarding writes', async ({ page, request }) => {
  await fixture(page, request, { pageColour: '#f5f6f7', panelColour: '#192a36', headingColour: '#192a36', linkColour: '#215a7e' });
  let rejectedSubmissions = 0;
  await page.route('**/api/enquiries', route => {
    if (route.request().method() === 'POST') {
      rejectedSubmissions++;
      return route.fulfill({ status: 503, json: { error: 'Read-only test: enquiry was not submitted.' } });
    }
    return route.continue();
  });
  await page.goto('/enquire?type=general');
  await expect.poll(() => page.evaluate(() => document.body.style.getPropertyValue('--dealer-panel'))).toBe('#192a36');
  await page.getByTestId('select-preferred-contact').selectOption('phone');
  await page.getByTestId('button-submit-enquiry').click();
  const nameError = page.locator('#customer-name-help');
  await expect(nameError).toBeVisible();
  await readable(nameError);
  await page.getByTestId('input-customer-name').fill('Theme Test Customer');
  await page.getByTestId('input-customer-phone').fill('abc');
  await page.getByTestId('textarea-enquiry-message').fill('Please send further details about this car.');
  await page.getByTestId('button-submit-enquiry').click();
  const phoneError = page.locator('#customer-phone-help');
  await expect(phoneError).toBeVisible();
  await readable(phoneError);
  expect(rejectedSubmissions).toBe(0);
  await page.getByTestId('input-customer-phone').fill('07123456789');
  await page.getByTestId('button-submit-enquiry').click();
  const serverError = page.getByTestId('status-enquiry-error');
  await expect(serverError).toBeVisible();
  await expect(serverError).toHaveCSS('background-color', 'rgb(25, 42, 54)');
  await readable(serverError);
  expect(rejectedSubmissions).toBe(1);
});
