import { mkdir } from 'node:fs/promises';
import { expect, test, type APIRequestContext, type Locator, type Page } from '@playwright/test';

test.skip(process.env.LUXXY_LOCAL_PREVIEW !== '1', 'Read-only local preview with intercepted submissions.');

type PreviewCar = { id: string; price: number; currency?: string | null; inventoryStatus?: string | null; title?: string };
type Submission = { path: string; data: Record<string, unknown> };
const terms = 'The dealership will contact you to confirm the hold. Contact the team to cancel. This preview simulates payment; no money is received.';
const openTime = new Date('2026-10-01T10:00:00Z');
const closedTime = new Date('2026-10-01T21:00:00Z');

async function fixture(request: APIRequestContext) {
  const [stockResponse, settingsResponse] = await Promise.all([request.get('/api/stock'), request.get('/api/dealer-settings')]);
  expect(stockResponse.ok()).toBeTruthy();
  expect(settingsResponse.ok()).toBeTruthy();
  const stock = await stockResponse.json() as { cars: PreviewCar[] };
  const eligible = (car: PreviewCar) => (!car.inventoryStatus || car.inventoryStatus === 'available') && car.price >= 150 && (!car.currency || car.currency.toUpperCase() === 'GBP');
  const car = stock.cars.find(item => item.id === '27be77df-87ce-4557-8b61-0a24d9092b76' && eligible(item)) ?? stock.cars.find(eligible);
  expect(car, 'An available GBP vehicle is required in the preview').toBeTruthy();
  return { car: car!, settings: await settingsResponse.json() };
}

async function guard(page: Page, settings: any, options: {
  closed?: boolean;
  reservationEnabled?: boolean;
  hours?: { days: string; times: string }[];
  reservation?: (data: Record<string, unknown>) => Promise<{ status?: number; json: unknown }>;
} = {}) {
  const submissions: Submission[] = [];
  const intents: Record<string, unknown>[] = [];
  const blocked: string[] = [];
  await page.clock.install({ time: options.closed ? closedTime : openTime });
  await page.route('**/api/**', async route => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (['GET', 'HEAD'].includes(request.method())) {
      if (path === '/api/dealer-settings') return route.fulfill({ json: {
        ...settings,
        contact: { ...settings.contact, phone: '02079460999', whatsapp: '447700900123' },
        hours: options.hours ?? [{ days: 'Monday – Sunday', times: '09:00 – 18:00' }],
        onlineReservation: { ...settings.onlineReservation, enabled: options.reservationEnabled !== false, depositPence: 15000, terms },
      } });
      return route.continue();
    }
    if (request.method() === 'POST' && path === '/api/contact-intents') {
      intents.push(request.postDataJSON() as Record<string, unknown>);
      return route.fulfill({ json: { ok: true } });
    }
    if (request.method() === 'POST' && (path === '/api/enquiries' || (path === '/api/reservations' && options.reservation))) {
      const data = request.postDataJSON() as Record<string, unknown>;
      submissions.push({ path, data });
      if (path === '/api/reservations') return route.fulfill(await options.reservation!(data));
      return route.fulfill({ json: { id: 'intercepted-callback', reference: 'PREVIEW-CALLBACK', customerNotificationStatus: 'sent' } });
    }
    blocked.push(`${request.method()} ${path}`);
    return route.fulfill({ status: 403, json: { error: 'The action-dialog audit blocked this write.' } });
  });
  await page.addInitScript(() => {
    window.open = url => { (window as any).actionDialogHandoff = String(url); return null; };
    // Let React handle the link while preventing a dialler or external chat from opening.
    document.addEventListener('click', event => {
      const link = (event.target as Element).closest<HTMLAnchorElement>('a[href^="tel:"], a[href^="https://wa.me/"]');
      if (!link) return;
      (window as any).actionDialogHandoff = link.href;
      event.preventDefault();
    }, true);
  });
  return { submissions, intents, blocked };
}

async function openVehicle(page: Page, car: PreviewCar) {
  await page.goto(`/vehicle/${encodeURIComponent(car.id)}`);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(page.getByLabel('Photograph sections', { exact: true })).toHaveCount(0);
}

async function reserveTrigger(page: Page) {
  const actions = page.getByTestId('vehicle-secondary-actions');
  const more = actions.getByRole('button', { name: 'More options', exact: true });
  if (await more.isVisible() && await more.getAttribute('aria-expanded') === 'false') await more.click();
  return actions.getByRole('button', { name: 'Reserve car online', exact: true });
}

async function fits(page: Page, dialog: Locator) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  // Geometry must describe the settled modal, rather than its entrance animation.
  await expect.poll(() => dialog.evaluate(element => {
    const rect = element.getBoundingClientRect();
    return rect.left >= 0 && rect.top >= 0 && rect.right <= innerWidth + 1 && rect.bottom <= innerHeight + 1;
  })).toBe(true);
  const dimensions = await dialog.evaluate(element => {
    const rect = element.getBoundingClientRect();
    return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, viewportWidth: innerWidth, viewportHeight: innerHeight, scrollWidth: element.scrollWidth, width: element.clientWidth };
  });
  expect(dimensions.left).toBeGreaterThanOrEqual(0);
  expect(dimensions.right).toBeLessThanOrEqual(dimensions.viewportWidth + 1);
  expect(dimensions.top).toBeGreaterThanOrEqual(0);
  expect(dimensions.bottom).toBeLessThanOrEqual(dimensions.viewportHeight + 1);
  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.width + 1);
}

async function keyboardContained(page: Page, dialog: Locator) {
  for (let step = 0; step < 12; step += 1) {
    await page.keyboard.press('Tab');
    expect(await dialog.evaluate(element => element.contains(document.activeElement))).toBe(true);
  }
  await page.keyboard.press('Shift+Tab');
  expect(await dialog.evaluate(element => element.contains(document.activeElement))).toBe(true);
}

async function closeAndReturn(page: Page, dialog: Locator, trigger: Locator) {
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();
}

async function capture(dialog: Locator, name: string) {
  if (process.env.LUXXY_CAPTURE_ACTION_DIALOGS !== '1') return;
  const output = 'output/ui-premium/action-dialogs';
  await mkdir(output, { recursive: true });
  await dialog.evaluate(element => element.scrollTo({ top: 0, behavior: 'instant' }));
  await dialog.screenshot({ path: `${output}/${name}.png`, animations: 'disabled' });
  if (await dialog.evaluate(element => element.scrollHeight > element.clientHeight + 2)) {
    await dialog.evaluate(element => element.scrollTo({ top: element.scrollHeight, behavior: 'instant' }));
    await dialog.screenshot({ path: `${output}/${name}-bottom.png`, animations: 'disabled' });
    await dialog.evaluate(element => element.scrollTo({ top: 0, behavior: 'instant' }));
  }
}

function reserved(car: PreviewCar) {
  return { id: 'a93b1e7a-74af-4f0a-aa61-0132f5f72b11', reference: 'PREVIEW-RESERVATION', vehicleId: car.id, vehicleTitle: car.title ?? 'Preview vehicle', status: 'reserved', depositPence: 15000, amountReceivedPence: 0, paymentStatus: 'simulated', createdAt: '2026-10-01T10:00:00Z' };
}

for (const width of [390, 820, 1440]) {
  test(`reservation details, review, terms and confirmation at ${width}px`, async ({ page, request }) => {
    await page.setViewportSize({ width, height: 900 });
    const { car, settings } = await fixture(request);
    const audit = await guard(page, settings, { reservation: async () => ({ json: reserved(car) }) });
    await openVehicle(page, car);
    const trigger = await reserveTrigger(page);
    await trigger.click();
    const dialog = page.getByTestId('reserve-car-dialog');
    await expect(dialog.getByRole('heading', { name: 'Reserve this car', exact: true })).toBeVisible();
    const name = dialog.getByLabel('Your name', { exact: true });
    const email = dialog.getByLabel('Email address', { exact: true });
    const phone = dialog.getByLabel('Phone number', { exact: true });
    await expect(phone).toHaveAttribute('type', 'tel');
    await expect(email).toHaveAttribute('type', 'email');
    await fits(page, dialog);
    await capture(dialog, `reserve-details-${width}`);
    const continueButton = dialog.getByRole('button', { name: 'Continue · £150 deposit', exact: true });
    await continueButton.click();
    await expect(name).toBeFocused();
    expect(audit.submissions).toHaveLength(0);
    await name.fill('Preview Buyer');
    await email.fill('buyer@example.test');
    await phone.fill('invalid-number');
    await continueButton.click();
    await expect(dialog.getByRole('alert')).toContainText('valid contact number');
    await phone.fill('07700 900123');
    await fits(page, dialog);
    await keyboardContained(page, dialog);
    await continueButton.click();
    const heading = dialog.getByRole('heading', { name: 'Review your reservation', exact: true });
    await expect(heading).toBeFocused();
    await expect(dialog.getByText('buyer@example.test', { exact: true })).toBeVisible();
    await expect(dialog.getByText('07700900123', { exact: true })).toBeVisible();
    await expect(dialog.getByText(terms, { exact: true })).toBeVisible();
    const confirm = dialog.getByRole('button', { name: 'Confirm reservation · simulate payment', exact: true });
    await expect(confirm).toBeDisabled();
    expect(audit.submissions).toHaveLength(0);
    await dialog.getByRole('button', { name: 'Back to your details', exact: true }).click();
    await expect(name).toHaveValue('Preview Buyer');
    await expect(email).toHaveValue('buyer@example.test');
    await expect(phone).toHaveValue('07700900123');
    await continueButton.click();
    await expect(confirm).toBeDisabled();
    await fits(page, dialog);
    await capture(dialog, `reserve-review-${width}`);
    await dialog.getByRole('checkbox').check();
    await confirm.click();
    await expect(dialog.getByRole('heading', { name: 'Your car is reserved', exact: true })).toBeFocused();
    await expect(dialog.getByTestId('reservation-success')).toContainText('PREVIEW-RESERVATION');
    await expect(dialog.getByTestId('reservation-success')).toContainText('£0');
    await fits(page, dialog);
    await capture(dialog, `reserve-success-${width}`);
    expect(audit.submissions).toHaveLength(1);
    expect(audit.submissions[0]).toMatchObject({ path: '/api/reservations', data: { vehicleId: car.id, customerName: 'Preview Buyer', email: 'buyer@example.test', phone: '07700900123', expectedPricePence: Math.round(car.price * 100), expectedDepositPence: 15000, termsAccepted: true, terms } });
    expect(audit.submissions[0].data.idempotencyKey).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    await dialog.getByRole('button', { name: 'Done', exact: true }).click();
    await expect(dialog).toBeHidden();
    const view = page.getByTestId('vehicle-secondary-actions').getByRole('button', { name: 'View reservation', exact: true });
    await expect(view).toBeFocused();
    await view.click();
    await expect(dialog.getByText('PREVIEW-RESERVATION', { exact: true })).toBeVisible();
    await closeAndReturn(page, dialog, view);
    expect(audit.blocked).toEqual([]);
  });

  test(`open call, closed callback and editable WhatsApp at ${width}px`, async ({ page, request }) => {
    await page.setViewportSize({ width, height: 900 });
    const { car, settings } = await fixture(request);
    const audit = await guard(page, settings);
    await openVehicle(page, car);
    const call = page.getByTestId('desktop-purchase-panel').locator('[data-vehicle-contact="call"]');
    await call.click();
    let dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('heading', { name: 'Call the showroom', exact: true })).toBeVisible();
    await expect(dialog.locator('a[href^="tel:"]')).toHaveAttribute('href', 'tel:02079460999');
    await fits(page, dialog);
    await keyboardContained(page, dialog);
    await capture(dialog, `call-open-${width}`);
    await closeAndReturn(page, dialog, call);
    await page.clock.setSystemTime(closedTime);
    await call.click();
    dialog = page.getByRole('dialog');
    await expect(dialog).toContainText('tomorrow at 09:00');
    const callbackPhone = dialog.getByLabel('Telephone', { exact: true });
    await expect(callbackPhone).toHaveAttribute('type', 'tel');
    await dialog.getByLabel('Your name', { exact: true }).fill('Preview Callback');
    await callbackPhone.fill('07700 900123');
    await dialog.getByText('Add an email for confirmation (optional)', { exact: true }).click();
    await dialog.getByLabel('Email', { exact: true }).fill('callback@example.test');
    await fits(page, dialog);
    await capture(dialog, `call-closed-${width}`);
    await dialog.getByRole('button', { name: 'Request a callback', exact: true }).click();
    await expect(dialog.getByRole('status')).toContainText('Callback request received');
    expect(audit.submissions).toHaveLength(1);
    expect(audit.submissions[0]).toMatchObject({ path: '/api/enquiries', data: { vehicleId: car.id, type: 'general', preferredContact: 'phone', customerName: 'Preview Callback', email: 'callback@example.test' } });
    expect(audit.submissions[0].data.message).toContain('Callback requested at next opening');
    await capture(dialog, `call-confirmation-${width}`);
    await closeAndReturn(page, dialog, call);

    const whatsapp = page.getByTestId('desktop-purchase-panel').getByRole('button', { name: /^WhatsApp about / });
    await whatsapp.click();
    dialog = page.getByRole('dialog');
    const message = dialog.getByRole('textbox', { name: 'Your message', exact: true });
    await expect(message).toHaveValue(/Please reply when you reopen/);
    await expect(dialog).toContainText('tomorrow at 09:00');
    await message.fill('  Could I view this car on Saturday?  ');
    const handoff = dialog.getByRole('link', { name: 'Continue to WhatsApp', exact: true });
    const href = await handoff.getAttribute('href');
    expect(new URL(href!).hostname).toBe('wa.me');
    expect(new URL(href!).pathname).toBe('/447700900123');
    expect(new URL(href!).searchParams.get('text')).toBe('Could I view this car on Saturday?');
    await expect(handoff).toHaveAttribute('target', '_blank');
    await message.fill(' ');
    await expect(handoff).toHaveCount(0);
    await expect(dialog.getByRole('status')).toContainText('Enter a message');
    await message.fill('Could I view this car on Saturday?');
    await fits(page, dialog);
    await keyboardContained(page, dialog);
    await capture(dialog, `whatsapp-review-${width}`);
    await handoff.click();
    expect(await page.evaluate(() => (window as any).actionDialogHandoff)).toBe(await handoff.getAttribute('href'));
    await expect(page).toHaveURL(new RegExp(`/vehicle/${car.id}$`));
    await closeAndReturn(page, dialog, whatsapp);
    const walkaround = page.getByRole('button', { name: 'Request a walkaround video', exact: true });
    await walkaround.click();
    dialog = page.getByRole('dialog');
    await expect(dialog.getByLabel('Your message')).toHaveValue(/walkaround video/);
    await closeAndReturn(page, dialog, walkaround);
    expect(audit.submissions).toHaveLength(1);
    expect(audit.blocked).toEqual([]);
  });
}

test('phone call uses a dialler handoff and disabled reservations offer an enquiry', async ({ browser, request }) => {
  const context = await browser.newContext({ baseURL: 'http://127.0.0.1:4175', viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1' });
  const page = await context.newPage();
  try {
    const { car, settings } = await fixture(request);
    const audit = await guard(page, settings, { reservationEnabled: false });
    await openVehicle(page, car);
    const call = page.getByTestId('desktop-purchase-panel').locator('[data-vehicle-contact="call"]');
    await call.click();
    let dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('heading', { name: 'Did you get through?', exact: true })).toBeVisible();
    expect(await page.evaluate(() => (window as any).actionDialogHandoff)).toBe('tel:02079460999');
    await expect(dialog.getByRole('link', { name: 'Ask about this car', exact: true })).toHaveAttribute('href', `/enquire?type=general&vehicleId=${car.id}`);
    await expect(dialog.getByRole('button', { name: 'Reserve car online', exact: true })).toHaveCount(0);
    await fits(page, dialog);
    await capture(dialog, 'call-phone-390');
    await closeAndReturn(page, dialog, call);
    await page.clock.setSystemTime(closedTime);
    const whatsapp = page.getByTestId('desktop-purchase-panel').getByRole('button', { name: /^WhatsApp about / });
    await whatsapp.click();
    dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('link', { name: 'Ask about this car', exact: true })).toHaveAttribute('href', `/enquire?type=general&vehicleId=${car.id}`);
    await expect(dialog.getByRole('button', { name: 'Reserve car online', exact: true })).toHaveCount(0);
    await closeAndReturn(page, dialog, whatsapp);
    const more = page.getByTestId('vehicle-secondary-actions').getByRole('button', { name: 'More options', exact: true });
    await more.click();
    await expect(page.getByRole('button', { name: 'Reserve car online', exact: true })).toHaveCount(0);
    expect(audit.submissions).toEqual([]);
    expect(audit.blocked).toEqual([]);
  } finally { await context.close(); }
});

test('reservation retries retain their key and pending confirmation cannot be dismissed or repeated', async ({ page, request }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const { car, settings } = await fixture(request);
  let attempts = 0;
  let finish!: () => void;
  const pending = new Promise<void>(resolve => { finish = resolve; });
  const audit = await guard(page, settings, { reservation: async () => {
    attempts += 1;
    if (attempts === 1) return { status: 503, json: { error: 'Please try again.' } };
    await pending;
    return { json: reserved(car) };
  } });
  await openVehicle(page, car);
  await (await reserveTrigger(page)).click();
  const dialog = page.getByTestId('reserve-car-dialog');
  await dialog.getByLabel('Your name', { exact: true }).fill('Preview Retry');
  await dialog.getByLabel('Email address', { exact: true }).fill('retry@example.test');
  await dialog.getByLabel('Phone number', { exact: true }).fill('07700900123');
  await dialog.getByRole('button', { name: 'Continue · £150 deposit', exact: true }).click();
  await dialog.getByRole('checkbox').check();
  const confirm = dialog.getByRole('button', { name: 'Confirm reservation · simulate payment', exact: true });
  await confirm.click();
  await expect(dialog.getByRole('alert')).toContainText('Please try again');
  await confirm.click();
  const reserving = dialog.getByRole('button', { name: 'Preparing your reservation…', exact: true });
  await expect(reserving).toBeDisabled();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(dialog).toBeVisible();
  expect(audit.submissions).toHaveLength(2);
  expect(audit.submissions[1].data.idempotencyKey).toBe(audit.submissions[0].data.idempotencyKey);
  finish();
  await expect(dialog.getByRole('heading', { name: 'Your car is reserved', exact: true })).toBeVisible();
  expect(audit.submissions).toHaveLength(2);
  expect(audit.blocked).toEqual([]);
});

test('unknown opening hours do not invent availability or a reopening time', async ({ page, request }) => {
  await page.setViewportSize({ width: 820, height: 900 });
  const { car, settings } = await fixture(request);
  const audit = await guard(page, settings, { hours: [{ days: 'Monday – Sunday', times: 'By appointment' }] });
  await openVehicle(page, car);
  const purchase = page.getByTestId('desktop-purchase-panel');
  const call = purchase.locator('[data-vehicle-contact="call"]');
  await call.click();
  let dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('heading', { name: 'Call the showroom', exact: true })).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Request a callback', exact: true })).toBeVisible();
    await expect(dialog.getByRole('form', { name: 'Request a callback', exact: true })).toHaveCount(0);
  await expect(dialog).not.toContainText('We next open');
  await closeAndReturn(page, dialog, call);
  const whatsapp = purchase.getByRole('button', { name: /^WhatsApp about / });
  await whatsapp.click();
  dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('The team will reply during opening hours');
  await expect(dialog.getByLabel('Your message')).not.toHaveValue(/Please reply when you reopen/);
  await expect(dialog).not.toContainText('We next open');
  await closeAndReturn(page, dialog, whatsapp);
  expect(audit.submissions).toEqual([]);
  expect(audit.blocked).toEqual([]);
});

test('customer photography keeps every thumbnail and keyboard navigation without category tabs', async ({ page, request }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const { car, settings } = await fixture(request);
  const audit = await guard(page, settings);
  await openVehicle(page, car);
  const strip = page.getByLabel('Choose photograph', { exact: true });
  const thumbnails = strip.getByRole('button');
  const count = await thumbnails.count();
  expect(count).toBeGreaterThan(1);
  await thumbnails.first().focus();
  await page.keyboard.press('End');
  await expect(thumbnails.last()).toBeFocused();
  await expect(thumbnails.last()).toHaveAttribute('aria-current', 'true');
  await page.keyboard.press('Home');
  await expect(thumbnails.first()).toBeFocused();
  const trigger = page.getByRole('button', { name: 'View gallery fullscreen', exact: true });
  await trigger.click();
  const dialog = page.getByRole('dialog', { name: 'Vehicle image gallery', exact: true });
  await expect(dialog.getByLabel('Photograph sections', { exact: true })).toHaveCount(0);
  await expect(dialog.locator('.vehicle-lightbox-navigation p')).toContainText(`1 / ${count}`);
  await page.keyboard.press('ArrowRight');
  await expect(dialog.locator('.vehicle-lightbox-navigation p')).toContainText(`2 / ${count}`);
  await page.keyboard.press('ArrowLeft');
  await expect(dialog.locator('.vehicle-lightbox-navigation p')).toContainText(`1 / ${count}`);
  await closeAndReturn(page, dialog, trigger);
  await expect(thumbnails).toHaveCount(count);
  expect(audit.submissions).toEqual([]);
  expect(audit.blocked).toEqual([]);
});
