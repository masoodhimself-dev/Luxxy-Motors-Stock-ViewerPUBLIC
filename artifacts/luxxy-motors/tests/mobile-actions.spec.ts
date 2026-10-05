import { mkdir } from 'node:fs/promises';
import { expect, test, type APIRequestContext, type Locator, type Page } from '@playwright/test';

test.skip(process.env.LUXXY_LOCAL_PREVIEW !== '1', 'Dedicated local fixture preview only.');

type PreviewCar = {
  id: string;
  price: number | null;
  currency?: string | null;
  inventoryStatus?: string | null;
};

async function availableCar(request: APIRequestContext): Promise<PreviewCar> {
  const response = await request.get('/api/stock');
  expect(response.ok()).toBeTruthy();
  const stock = await response.json() as { cars: PreviewCar[] };
  const car = stock.cars.find(item =>
    (!item.inventoryStatus || item.inventoryStatus === 'available') &&
    (item.price ?? 0) >= 100 &&
    (!item.currency || item.currency.toUpperCase() === 'GBP'),
  );
  expect(car, 'The local preview needs an available vehicle with a GBP price').toBeTruthy();
  return car!;
}

async function protectPreview(page: Page) {
  const blockedWrites: string[] = [];
  await page.clock.install({ time: new Date('2026-10-01T10:00:00Z') });
  await page.route('**/api/**', async route => {
    const request = route.request();
    if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method())) {
      blockedWrites.push(new URL(request.url()).pathname);
      await route.fulfill({ status: 200, json: { ok: true } });
      return;
    }
    if (new URL(request.url()).pathname === '/api/dealer-settings') {
      const response = await route.fetch();
      const settings = await response.json();
      await route.fulfill({ response, json: {
        ...settings,
        contact: { ...settings.contact, phone: '02079460999', whatsapp: '447700900123' },
        hours: [{ days: 'Monday – Sunday', times: '09:00 – 18:00' }],
        partExchange: { ...settings.partExchange, enabled: true },
        onlineReservation: {
          ...settings.onlineReservation,
          enabled: true,
          depositPence: 10000,
          terms: 'Local preview reservation terms. Contact the dealership to cancel. Payment is simulated.',
        },
      } });
      return;
    }
    await route.continue();
  });
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'share', { configurable: true, value: undefined });
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
      writeText: async (value: string) => {
        (window as Window & { mobileActionsCopiedText?: string }).mobileActionsCopiedText = value;
      },
    } });
    // Preserve the call-dialog handler without launching the device's dialler.
    document.addEventListener('click', event => {
      if ((event.target as Element).closest('a[href^="tel:"], a[href^="https://wa.me/"]')) {
        event.preventDefault();
      }
    }, true);
  });
  return blockedWrites;
}

async function copiedText(page: Page) {
  return page.evaluate(() => (window as Window & { mobileActionsCopiedText?: string }).mobileActionsCopiedText);
}

async function closeDialog(page: Page, trigger: Locator) {
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();
}

async function screenshot(page: Page, name: string) {
  if (process.env.LUXXY_CAPTURE_MOBILE_ACTIONS !== '1') return;
  await mkdir('/tmp/luxxy-mobile-actions', { recursive: true });
  await page.screenshot({ path: `/tmp/luxxy-mobile-actions/${name}.png`, animations: 'disabled' });
}

for (const width of [375, 820, 1280]) {
  test(`vehicle actions remain available with a clear hierarchy at ${width}px`, async ({ page, request }) => {
    await page.setViewportSize({ width, height: 900 });
    const blockedWrites = await protectPreview(page);
    const car = await availableCar(request);
    await page.goto(`/vehicle/${encodeURIComponent(car.id)}`);
    const purchase = page.getByTestId('desktop-purchase-panel');
    await expect(purchase.getByRole('link', { name: 'Enquire about this car', exact: true })).toBeVisible();
    await expect(purchase.locator('[data-vehicle-contact="booking"]')).toHaveAttribute(
      'href', `/enquire?type=viewing&vehicleId=${encodeURIComponent(car.id)}`,
    );
    const secondary = page.getByTestId('vehicle-secondary-actions');
    const more = secondary.getByRole('button', { name: 'More options', exact: true });
    const call = purchase.locator('[data-vehicle-contact="call"]');
    const whatsapp = purchase.getByRole('button', { name: /^WhatsApp about / });
    const reserve = secondary.getByRole('button', { name: 'Reserve car online', exact: true });
    if (width < 768) {
      await expect(more).toHaveAttribute('aria-expanded', 'false');
      await expect(call).toBeVisible();
      await expect(whatsapp).toBeVisible();
      await expect(reserve).toBeHidden();
      await more.click();
      await expect(more).toHaveAttribute('aria-expanded', 'true');
      await expect(page.getByTestId('mobile-conversion-bar')).toBeHidden();
    } else {
      await expect(more).toBeHidden();
    }
    await expect(call).toBeVisible();
    await expect(whatsapp).toBeVisible();
    await expect(reserve).toBeVisible();
    await expect(secondary.getByRole('link', { name: 'Value my car' })).toHaveAttribute(
      'href', `/enquire?type=part_exchange&vehicleId=${encodeURIComponent(car.id)}`,
    );
    await expect(secondary.getByTestId('button-print-vehicle')).toBeVisible();

    await call.click();
    await expect(page.getByRole('dialog').locator('a[href^="tel:"]')).toHaveAttribute('href', 'tel:02079460999');
    await closeDialog(page, call);
    await whatsapp.click();
    const message = page.getByRole('dialog').getByLabel('Your message');
    await expect(message).toHaveValue(/is this car still available/);
    await message.fill('Could I arrange a test drive?');
    const whatsappHref = await page.getByRole('dialog').getByRole('link', { name: 'Continue to WhatsApp' }).getAttribute('href');
    expect(new URL(whatsappHref!).searchParams.get('text')).toBe('Could I arrange a test drive?');
    await closeDialog(page, whatsapp);

    const walkaround = page.getByRole('button', { name: 'Request a walkaround video', exact: true });
    await walkaround.click();
    await expect(page.getByRole('dialog').getByLabel('Your message')).toHaveValue(/walkaround video/);
    await closeDialog(page, walkaround);
    await reserve.click();
    await expect(page.getByTestId('reserve-car-dialog').getByLabel('Your name', { exact: true })).toBeVisible();
    await closeDialog(page, reserve);
    await secondary.getByRole('button', { name: 'Share this vehicle', exact: true }).click();
    await expect.poll(() => copiedText(page)).toContain(`/vehicle/${encodeURIComponent(car.id)}`);
    await expect(page).toHaveURL(new RegExp(`/vehicle/${encodeURIComponent(car.id)}$`));
    await screenshot(page, `vehicle-options-${width}`);

    if (width < 768) {
      await more.click();
      await expect(more).toHaveAttribute('aria-expanded', 'false');
      await expect(call).toBeVisible();
      await purchase.scrollIntoViewIfNeeded();
      await expect(page.getByTestId('mobile-conversion-bar')).toBeHidden();
      await screenshot(page, `vehicle-primary-${width}`);
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await expect(page.getByTestId('mobile-conversion-bar')).toHaveCount(0);
    }
    await expect(page.getByTestId('mobile-conversion-bar')).toHaveCount(0);
    await expect(page.locator('.vehicle-page')).toHaveCSS('padding-bottom', '0px');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(blockedWrites.filter(path => /^\/api\/(enquiries|reservations)$/.test(path))).toEqual([]);
  });

  test(`stock display and sharing controls work at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await protectPreview(page);
    await page.goto('/stock?all=1');
    await expect(page.locator('.browse-stock .vehicle-card').first()).toBeVisible();
    const secondary = page.getByTestId('stock-secondary-actions');
    const trigger = secondary.getByRole('button', { name: 'Display & sharing', exact: true });
    const viewControls = secondary;
    const list = viewControls.getByRole('button', { name: 'List', exact: true });
    const copy = secondary.getByRole('button', { name: 'Copy search link', exact: true });
    await expect(trigger).toHaveAttribute('aria-expanded', 'false');
    await expect(list).toBeHidden();
    await expect(copy).toBeHidden();
    await trigger.click();
    await expect(secondary.getByRole('link', { name: /^Saved cars/ })).toHaveAttribute('href', '/saved');
    await list.click();
    await expect(list).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('.browse-stock [data-testid^="compact-vehicle-"]').first()).toBeVisible();
    await copy.click();
    await expect.poll(() => copiedText(page)).toBe(page.url());
    await expect(page.getByRole('status').filter({ hasText: 'Search link copied' })).toBeVisible();
    await screenshot(page, `stock-options-${width}`);
    await page.reload();
    await trigger.click();
    await expect(list).toHaveAttribute('aria-pressed', 'true');
    await viewControls.getByRole('button', { name: 'Grid', exact: true }).click();
    await expect(page.locator('.browse-stock [data-testid^="card-vehicle-"]').first()).toBeVisible();
    await trigger.click();
    await expect(copy).toBeHidden();
    await expect(trigger).toBeFocused();
    const toolbar = page.getByTestId('stock-search-toolbar');
    await expect(toolbar).toHaveCSS('position', 'static');
    await toolbar.evaluate(element => window.scrollTo(0, window.scrollY + element.getBoundingClientRect().bottom + 100));
    await expect.poll(() => toolbar.evaluate(element => element.getBoundingClientRect().bottom)).toBeLessThan(0);
    await screenshot(page, `stock-scrolled-${width}`);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });

  test(`homepage reset keeps its responsive visibility at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await protectPreview(page);
    await page.goto('/');
    const search = page.getByRole('form', { name: 'Search used cars' });
    const reset = search.getByRole('button', { name: 'Reset', exact: true });
    await expect(search).toBeVisible();
    if (width < 768) await expect(reset).toBeHidden();
    else await expect(reset).toBeVisible();
    await search.getByLabel('Search maximum price', { exact: true }).selectOption('5000');
    await expect(reset).toBeVisible();
    await reset.click();
    await expect(search.getByLabel('Search maximum price', { exact: true })).toHaveValue('');
    if (width < 768) await expect(reset).toBeHidden();
    else await expect(reset).toBeVisible();
    await expect(search.getByRole('link', { name: 'See all cars' })).toBeVisible();
    await screenshot(page, `home-${width}`);
  });
}

test('phone booking gives the final review a single primary action', async ({ page, request }) => {
  await page.setViewportSize({ width: 375, height: 900 });
  const blockedWrites = await protectPreview(page);
  await page.route('**/api/enquiries/availability?*', route => {
    const date = new URL(route.request().url()).searchParams.get('date');
    return route.fulfill({ json: { date, timezone: 'Europe/London', slots: [{ label: '10:00 am', startAt: `${date}T09:00:00.000Z`, available: true }] } });
  });
  const car = await availableCar(request);
  await page.goto(`/enquire?type=viewing&vehicleId=${encodeURIComponent(car.id)}`);
  await page.getByTestId('group-viewing-slots').getByRole('button').and(page.locator(':enabled')).first().click();
  await page.getByTestId('button-continue-to-details').click();
  await page.getByTestId('input-customer-name').fill('Local Mobile Review');
  await page.getByTestId('input-customer-email').fill('mobile-review@example.test');
  await page.getByTestId('input-customer-phone').fill('07700900123');
  await page.getByTestId('button-review-booking').click();
  const submit = page.getByTestId('button-submit-enquiry');
  await expect(submit).toHaveText('Confirm test drive');
  await expect(page.getByText('Local Mobile Review', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Or reserve this car', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Reserve car online', exact: true })).toHaveCount(0);
  expect(blockedWrites.filter(path => /^\/api\/(enquiries|reservations)$/.test(path))).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await screenshot(page, 'booking-review-375');
});
