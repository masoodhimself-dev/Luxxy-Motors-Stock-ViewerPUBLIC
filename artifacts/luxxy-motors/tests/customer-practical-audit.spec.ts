import { mkdir } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';

test.skip(process.env.LUXXY_LOCAL_PREVIEW !== '1', 'Isolated local preview with intercepted writes only.');
test.use({ serviceWorkers: 'block', reducedMotion: 'reduce' });
test.beforeEach(async ({ page }) => {
  await page.route('**/api/**', route => ['GET', 'HEAD'].includes(route.request().method()) ? route.continue() : route.abort('blockedbyclient'));
});

async function fits(page: Page) {
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(page.viewportSize()!.width + 1);
  const overlapping = await page.locator('[data-testid="form-enquiry"]').evaluateAll(forms => forms.flatMap(form => {
    const fields = [...form.querySelectorAll<HTMLInputElement>('input:not([type="radio"]), textarea, select')]
      .map(field => ({ field, box: field.getBoundingClientRect() }))
      .filter(({ box }) => box.width && box.height);
    return fields.flatMap((first, i) => fields.slice(i + 1).flatMap(second => {
      const width = Math.min(first.box.right, second.box.right) - Math.max(first.box.left, second.box.left);
      const height = Math.min(first.box.bottom, second.box.bottom) - Math.max(first.box.top, second.box.top);
      return width > 1 && height > 1 ? [`${first.field.dataset.testid} overlaps ${second.field.dataset.testid}`] : [];
    }));
  }));
  expect(overlapping).toEqual([]);
}

async function capture(page: Page, name: string) {
  await mkdir('/tmp/customer-practical-audit', { recursive: true });
  const previousY = await page.evaluate(() => scrollY);
  await page.evaluate(async () => {
    window.scrollTo({ top: 0, behavior: 'instant' });
    await document.fonts.ready;
    const images = Array.from(document.images);
    images.forEach(image => { image.loading = 'eager'; });
    await Promise.race([Promise.all(images.map(image => image.decode().catch(() => undefined))), new Promise(resolve => setTimeout(resolve, 2000))]);
  });
  await page.screenshot({ path: `/tmp/customer-practical-audit/${name}-${page.viewportSize()!.width}.png`, fullPage: true, animations: 'disabled' });
  await page.evaluate(y => window.scrollTo({ top: y, behavior: 'instant' }), previousY);
}

for (const width of [320, 820, 1440]) {
  for (const method of ['email', 'phone', 'whatsapp']) {
    test(`enquiry needs only the chosen reply details: ${method}, ${width}px`, async ({ page, request }) => {
      await page.setViewportSize({ width, height: 900 });
      const stock = await (await request.get('/api/stock')).json();
      const car = stock.cars[0];
      let payload: Record<string, unknown> | undefined;
      await page.route('**/api/enquiries', route => {
        payload = route.request().postDataJSON();
        return route.fulfill({ status: 201, json: { reference: 'FICTIONAL-ENQ', customerNotificationStatus: 'not_sent' } });
      });
      await page.goto(`/enquire?type=general&vehicleId=${encodeURIComponent(car.id)}`);
      await expect(page.getByTestId('input-customer-phone')).toHaveCount(0);
      await page.getByTestId('select-preferred-contact').selectOption(method);
      await page.getByTestId('input-customer-name').fill('Fictional Test Customer');
      if (method === 'email') {
        await page.getByTestId('input-customer-email').fill('fictional@example.test');
        await expect(page.getByTestId('input-customer-phone')).toHaveCount(0);
      } else {
        await expect(page.getByTestId('input-customer-email')).toHaveCount(0);
        await page.getByTestId('input-customer-phone').fill('07700 900123');
      }
      await page.getByTestId('textarea-enquiry-message').fill('Please tell me about the service records for this car.');
      await expect(page.getByTestId('enquiry-draft-notice')).toHaveCount(0);
      await fits(page);
      if (method === 'email') await capture(page, 'enquiry');
      await page.getByTestId('button-submit-enquiry').click();
      await expect(page.getByTestId('text-enquiry-reference')).toHaveText('FICTIONAL-ENQ');
      expect(payload).toMatchObject({ vehicleId: car.id, preferredContact: method, customerName: 'Fictional Test Customer', phone: method === 'email' ? null : '07700900123', email: method === 'email' ? 'fictional@example.test' : null });
    });
  }

  test(`public pages, plain card facts and safe shortlist clearing: ${width}px`, async ({ page, request }) => {
    await page.setViewportSize({ width, height: 900 });
    const stock = await (await request.get('/api/stock')).json();
    const car = stock.cars[0];
    for (const [name, path] of [['home', '/'], ['stock', '/stock'], ['vehicle', `/vehicle/${car.id}`], ['contact', '/contact'], ['booking', `/enquire?type=viewing&vehicleId=${car.id}`], ['part-exchange', `/enquire?type=part_exchange&vehicleId=${car.id}`], ['warranty', '/warranty']]) {
      await page.goto(path);
      await expect(page.locator('main h1').first()).toBeVisible();
      await fits(page);
      if (name === 'stock') {
        const card = page.locator('[data-testid^="card-vehicle-"]').first();
        await expect(card).toBeVisible();
        await expect(card.locator('.vehicle-specs svg')).toHaveCount(0);
        await expect(card.locator('.vehicle-specs')).not.toBeEmpty();
        await page.getByRole('button', { name: 'Advanced search', exact: true }).click();
        await expect(page.getByRole('dialog', { name: 'Filter used cars' })).toBeVisible();
        await fits(page);
        await page.keyboard.press('Escape');
        await expect(page.getByRole('button', { name: 'Advanced search', exact: true })).toBeFocused();
      }
      if (name === 'booking') {
        const quickChoices = page.getByTestId('group-viewing-dates').getByRole('button');
        expect(await quickChoices.count()).toBeLessThanOrEqual(7);
        await page.locator('summary').filter({ hasText: 'Choose another date' }).click();
        const date = page.getByTestId('select-viewing-date');
        const lastDate = await date.locator('option').last().getAttribute('value');
        expect(lastDate).toBeTruthy();
        await date.selectOption(lastDate!);
        await expect(page.getByTestId(`button-viewing-date-${lastDate}`)).toHaveAttribute('aria-pressed', 'true');
        await fits(page);
      }
      if (['home', 'stock', 'vehicle', 'contact', 'booking'].includes(name)) await capture(page, name);
    }
    await page.goto(`/vehicle/${car.id}`);
    await page.getByRole('button', { name: /Save .* to your saved cars/ }).click();
    await page.goto('/saved');
    await expect(page.getByTestId('text-saved-count')).toContainText('1 car saved');
    await page.getByTestId('button-clear-saved').click();
    await expect(page.getByRole('alertdialog')).toContainText('Clear your saved cars?');
    await page.getByRole('button', { name: 'Keep my cars', exact: true }).click();
    await expect(page.getByTestId('text-saved-count')).toContainText('1 car saved');
    await page.locator('summary').filter({ hasText: 'More details' }).click();
    await fits(page);
    await capture(page, 'saved-expanded');
    await page.getByTestId('button-clear-saved').click();
    await page.getByRole('button', { name: 'Clear saved cars', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'No saved cars yet', exact: true })).toBeVisible();
  });
}

test('optional contact and part exchange remain recoverable without losing an enquiry draft', async ({ page, request }) => {
  const stock = await (await request.get('/api/stock')).json();
  const car = stock.cars[0];
  let payload: any;
  let attempts = 0;
  await page.route('**/api/enquiries', route => {
    attempts++;
    payload = route.request().postDataJSON();
    return route.fulfill(attempts === 1 ? { status: 503, json: { error: 'Fictional retry test.' } } : { status: 201, json: { reference: 'FICTIONAL-RETRY', customerNotificationStatus: 'not_sent' } });
  });
  await page.goto(`/enquire?type=general&vehicleId=${car.id}`);
  await page.getByTestId('input-customer-name').fill('Fictional Test Customer');
  await page.getByTestId('input-customer-email').fill('fictional@example.test');
  await page.getByRole('button', { name: 'Add a phone number (optional)', exact: true }).click();
  await page.getByTestId('input-customer-phone').fill('07700 900123');
  await page.locator('summary').filter({ hasText: 'Add a part exchange (optional)' }).click();
  await page.getByRole('radio', { name: 'Yes', exact: true }).check();
  await page.getByTestId('enquiry-part-exchange-details').getByLabel('Your car’s UK registration number', { exact: true }).fill('AB12 CDE');
  await page.getByLabel('Current mileage (miles)', { exact: true }).fill('42000');
  await page.locator('summary').filter({ hasText: 'Add a message (optional)' }).click();
  await page.getByTestId('textarea-enquiry-message').fill('Please call about this car and my part exchange.');
  await page.reload();
  await expect(page.getByTestId('enquiry-draft-notice')).toContainText('Your unfinished enquiry was restored.');
  await expect(page.getByTestId('input-customer-phone')).toHaveValue('07700 900123');
  await expect(page.getByTestId('enquiry-part-exchange-details')).toBeVisible();
  await page.getByTestId('button-submit-enquiry').click();
  await expect(page.getByTestId('status-enquiry-error')).toBeFocused();
  await expect(page.getByTestId('textarea-enquiry-message')).toHaveValue('Please call about this car and my part exchange.');
  await page.getByTestId('button-submit-enquiry').click();
  await expect(page.getByTestId('text-enquiry-reference')).toHaveText('FICTIONAL-RETRY');
  expect(payload.partExchange).toEqual({ registration: 'AB12 CDE', mileage: 42000, condition: null });
  expect(payload).toMatchObject({ phone: '07700900123', email: 'fictional@example.test' });
});
