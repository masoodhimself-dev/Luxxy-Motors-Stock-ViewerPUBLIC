import { test, expect, type Page } from '@playwright/test';

test.skip(process.env.LUXXY_LOCAL_PREVIEW !== '1', 'Local website with every submission intercepted.');
const openAt = new Date('2026-10-01T10:00:00Z');
const closedAt = new Date('2026-10-01T21:00:00Z');

async function audit(page: Page, closed = false, unknown = false) {
  const stock = await (await page.request.get('/api/stock')).json();
  const settings = await (await page.request.get('/api/dealer-settings')).json();
  const car = stock.cars.find((item: any) => !item.inventoryStatus || item.inventoryStatus === 'available');
  const submissions: any[] = [];
  const blocked: string[] = [];
  await page.clock.install({ time: closed ? closedAt : openAt });
  await page.route('**/api/**', async route => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (request.method() === 'GET' && path === '/api/dealer-settings') return route.fulfill({ json: {
      ...settings, contact: { ...settings.contact, phone: '02079460999' },
      hours: [{ days: 'Monday – Sunday', times: unknown ? 'By appointment' : '09:00 – 18:00' }],
    } });
    if (['GET', 'HEAD'].includes(request.method())) return route.continue();
    if (request.method() === 'POST' && path === '/api/contact-intents') return route.fulfill({ json: { ok: true } });
    if (request.method() === 'POST' && path === '/api/enquiries') {
      const input = request.postDataJSON();
      submissions.push(input);
      return route.fulfill({ json: {
        ...input, id: 'mock-callback', reference: 'CALL-1234', source: 'website_callback',
        callOutcome: 'callback_requested', assignedToId: null, assignedToName: null,
        followUpAt: unknown ? null : closed ? '2026-10-02T08:00:00Z' : openAt.toISOString(),
        customerNotificationStatus: input.email ? 'sent' : 'not_sent',
      } });
    }
    blocked.push(`${request.method()} ${path}`);
    return route.fulfill({ status: 403, json: { error: 'The audit blocked this write.' } });
  });
  await page.addInitScript(() => {
    document.addEventListener('click', event => {
      const link = (event.target as Element).closest<HTMLAnchorElement>('a[href^="tel:"]');
      if (link) event.preventDefault();
    }, true);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined });
    document.execCommand = command => {
      if (command !== 'copy') return false;
      (window as any).copiedShowroomNumber = (document.activeElement as HTMLTextAreaElement)?.value;
      return true;
    };
  });
  await page.goto(`/vehicle/${car.id}`);
  await page.getByRole('heading', { level: 1 }).waitFor();
  await page.locator('[data-vehicle-contact="call"]').first().click();
  return { car, submissions, blocked, dialog: page.getByRole('dialog') };
}

for (const width of [390, 820, 1440]) {
  test(`customers can request a callback while open without an email at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    const { car, submissions, blocked, dialog } = await audit(page);
    await expect(dialog).toContainText('Open until 18:00 (UK time)');
    await dialog.getByRole('button', { name: 'Copy number', exact: true }).click();
    await expect(dialog.getByRole('status')).toHaveText('Phone number copied');
    expect(await page.evaluate(() => (window as any).copiedShowroomNumber)).toBe('020 7946 0999');
    await dialog.getByRole('button', { name: 'Request a callback', exact: true }).click();
    await expect(dialog.getByRole('heading', { name: 'Request a callback', exact: true })).toBeVisible();
    await expect(dialog.getByLabel('Email', { exact: true })).toBeHidden();
    await dialog.getByLabel('Your name', { exact: true }).fill('Callback Customer');
    await dialog.getByLabel('Telephone', { exact: true }).fill('not-a-phone');
    await dialog.getByRole('button', { name: 'Request a callback', exact: true }).click();
    await expect(dialog.getByRole('alert')).toContainText('valid phone number');
    expect(submissions).toEqual([]);
    await dialog.getByLabel('Telephone', { exact: true }).fill('07700 900123');
    await dialog.getByRole('button', { name: 'Request a callback', exact: true }).click();
    await expect(dialog.getByRole('status')).toContainText('Callback request received');
    await expect(dialog).toContainText('CALL-1234');
    expect(submissions).toHaveLength(1);
    expect(submissions[0]).toMatchObject({ requestCallback: true, vehicleId: car.id, type: 'general', appointmentAt: null, preferredContact: 'phone', email: null, phone: '07700900123' });
    await dialog.getByRole('button', { name: 'Done', exact: true }).click();
    await expect(dialog).toBeHidden();
    await expect(page.locator('[data-vehicle-contact="call"]').first()).toBeFocused();
    expect(blocked).toEqual([]);
  });
}

test('after-hours callbacks show the reopening time and accept optional confirmation email', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const { submissions, blocked, dialog } = await audit(page, true);
  await expect(dialog).toContainText('We next open tomorrow at 09:00 (UK time)');
  await dialog.getByLabel('Your name').fill('Evening Caller');
  await dialog.getByLabel('Telephone').fill('07700 900123');
  await dialog.getByText('Add an email for confirmation (optional)', { exact: true }).click();
  await expect(dialog.getByLabel('Email', { exact: true })).not.toHaveAttribute('required');
  await dialog.getByLabel('Email', { exact: true }).fill('caller@example.test');
  await dialog.getByRole('button', { name: 'Request a callback', exact: true }).click();
  await expect(dialog.getByRole('status')).toContainText('aim to call you tomorrow at 09:00');
  expect(submissions[0].email).toBe('caller@example.test');
  expect(blocked).toEqual([]);
});

test('unknown hours allow a callback without inventing its due time', async ({ page }) => {
  const { submissions, blocked, dialog } = await audit(page, false, true);
  await expect(dialog).not.toContainText('Open until');
  await expect(dialog).not.toContainText('We next open');
  await dialog.getByRole('button', { name: 'Request a callback', exact: true }).click();
  await dialog.getByLabel('Your name').fill('Appointment Caller');
  await dialog.getByLabel('Telephone').fill('07700 900123');
  await dialog.getByRole('button', { name: 'Request a callback', exact: true }).click();
  await expect(dialog.getByRole('status')).toContainText('during opening hours');
  await expect(dialog).not.toContainText('tomorrow');
  expect(submissions).toHaveLength(1);
  expect(blocked).toEqual([]);
});

test('phone dialler and reservation alternative remain available before requesting a callback', async ({ browser }) => {
  const context = await browser.newContext({ baseURL: 'http://127.0.0.1:4175', viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1' });
  try {
    const page = await context.newPage();
    const { dialog, blocked } = await audit(page);
    await expect(dialog.getByRole('heading', { name: 'Did you get through?', exact: true })).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Copy number', exact: true })).toHaveCount(0);
    await expect(dialog.getByRole('button', { name: 'Request a callback', exact: true })).toBeVisible();
    await dialog.getByRole('button', { name: 'Request a callback', exact: true }).click();
    await expect(dialog.getByLabel('Your name')).toBeVisible();
    expect(blocked).toEqual([]);
  } finally { await context.close(); }
});
