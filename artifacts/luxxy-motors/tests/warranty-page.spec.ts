import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';

test.skip(process.env.LUXXY_LOCAL_PREVIEW !== '1', 'Local preview only.');

for (const width of [320, 390, 1440]) {
  test(`warranty page, questions and vehicle enquiry work at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    let payload: unknown;
    await page.route('**/api/enquiries', route => {
      payload = route.request().postDataJSON();
      return route.fulfill({ json: { reference: 'WARRANTY-TEST', customerNotificationStatus: 'sent' } });
    });
    await page.goto('/warranty');
    await expect(page.getByRole('heading', { name: 'Warranty, clearly explained.' })).toBeVisible();
    await expect(page).toHaveTitle('Warranty information | Luxxy Motors');
    const photo = page.getByRole('img', { name: /Illustrative Luxxy Motors showroom/ });
    await photo.scrollIntoViewIfNeeded();
    await expect.poll(() => photo.evaluate(element => (element as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    if (width !== 320) {
      const directory = resolve('../../docs/screenshots/warranty-page');
      await mkdir(directory, { recursive: true });
      await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
      await page.screenshot({ path: resolve(directory, `warranty-${width}.png`), fullPage: true });
      await page.screenshot({ path: resolve(directory, `warranty-${width}-viewport.png`) });
    }
    const question = page.getByRole('button', { name: 'Is a warranty included with every car?' });
    await question.focus();
    await question.press('Enter');
    await expect(question).toHaveAttribute('aria-expanded', 'true');
    await expect(page.getByText(/whether a warranty is included, offered at an additional cost or unavailable/)).toBeVisible();
    await question.press('Enter');
    await expect(question).toHaveAttribute('aria-expanded', 'false');
    await page.getByRole('link', { name: 'Ask about warranty', exact: true }).click();
    await expect(page.locator('#warranty-enquiry-heading')).toBeFocused();
    await page.getByLabel(/Which car are you asking about/).selectOption('preview-1');
    await expect(page.getByTestId('warranty-enquiry-link')).toHaveAttribute('href', '/enquire?type=warranty&vehicleId=preview-1');
    const chat = new URL((await page.getByTestId('warranty-whatsapp').getAttribute('href'))!);
    expect(chat.searchParams.get('text')).toContain('Mercedes-Benz');
    expect(chat.searchParams.get('text')).toContain('ask about the warranty options');
    await page.getByTestId('warranty-enquiry-link').click();
    await expect(page).toHaveURL(/enquire\?type=warranty&vehicleId=preview-1/);
    await page.getByTestId('input-customer-name').fill('Warranty Test');
    await page.getByTestId('input-customer-email').fill('warranty@example.com');
    await page.getByTestId('textarea-enquiry-message').fill('Please send the warranty terms for this car.');
    await page.getByTestId('button-submit-enquiry').click();
    await expect(page.getByTestId('status-enquiry-success')).toBeVisible();
    expect(payload).toMatchObject({ type: 'warranty', vehicleId: 'preview-1', customerName: 'Warranty Test', message: 'Please send the warranty terms for this car.' });
  });
}

test('custom settings control warranty copy without inventing contact channels', async ({ page, request }) => {
  const settings = await (await request.get('/api/dealer-settings')).json();
  settings.warranty = { ...settings.warranty, title: 'Warranty at Example Motors', description: 'Ask us about the options for your chosen vehicle.' };
  settings.contact = { phone: '', whatsapp: '', email: '' };
  await page.route('**/api/dealer-settings', route => route.fulfill({ json: settings }));
  await page.goto('/warranty');
  await expect(page.getByRole('heading', { name: settings.warranty.title })).toBeVisible();
  await expect(page.getByText(settings.warranty.description, { exact: true })).toBeVisible();
  await expect(page.locator('main a[href^="tel:"]')).toHaveCount(0);
  await expect(page.getByTestId('warranty-whatsapp')).toHaveCount(0);
  await expect(page.getByTestId('warranty-enquiry-link')).toHaveAttribute('href', '/enquire?type=warranty');
});

test('disabled warranty keeps an existing-customer contact route without advertising cover', async ({ page, request }) => {
  const settings = await (await request.get('/api/dealer-settings')).json();
  settings.warranty.enabled = false;
  await page.route('**/api/dealer-settings', route => route.fulfill({ json: settings }));
  await page.goto('/warranty');
  await expect(page.getByRole('heading', { name: 'Warranty information' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Contact the showroom' })).toHaveAttribute('href', '/contact');
  await expect(page.getByTestId('warranty-enquiry-link')).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Warranty', exact: true })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'The details worth checking.' })).toHaveCount(0);
});

test('a settings failure does not advertise fallback warranty terms', async ({ page }) => {
  await page.route('**/api/dealer-settings', route => route.fulfill({ status: 503, json: { error: 'Unavailable' } }));
  await page.goto('/warranty');
  await expect(page.getByRole('alert')).toContainText('We couldn’t load the latest warranty information.');
  await expect(page.getByTestId('warranty-enquiry-link')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible();
});

for (const fails of [false, true]) {
  test(`${fails ? 'unavailable' : 'empty'} stock retains the general warranty enquiry`, async ({ page }) => {
    await page.route('**/api/stock', route => route.fulfill(fails ? { status: 503, json: { error: 'Unavailable' } } : { json: { schemaVersion: 1, count: 0, cars: [] } }));
    await page.goto('/warranty');
    await expect(page.locator('#warranty-vehicle-help')).toContainText(fails ? 'We couldn’t load the vehicle list.' : 'There are no cars listed');
    await expect(page.getByTestId('warranty-enquiry-link')).toHaveAttribute('href', '/enquire?type=warranty');
    if (fails) await expect(page.getByLabel(/Which car are you asking about/)).toBeDisabled();
  });
}

test('preselected and unavailable cars retain truthful enquiry context', async ({ page }) => {
  await page.goto('/warranty?vehicleId=preview-2');
  await expect(page.getByLabel(/Which car are you asking about/)).toHaveValue('preview-2');
  await expect(page.getByTestId('warranty-enquiry-link')).toHaveAttribute('href', '/enquire?type=warranty&vehicleId=preview-2');
  await page.goto('/warranty?vehicleId=removed-car');
  await expect(page.getByRole('alert')).toContainText('That vehicle is no longer in the current list.');
  await expect(page.getByTestId('warranty-enquiry-link')).toHaveAttribute('href', '/enquire?type=warranty');
});

for (const width of [1024, 1440, 1536]) {
  test(`desktop navigation and homepage warranty link fit at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/');
    await expect(page.getByTestId('link-warranty-enquiry')).toHaveAttribute('href', '/warranty');
    await page.getByRole('navigation', { name: 'Primary navigation', exact: true }).filter({ visible: true }).getByRole('link', { name: 'Warranty', exact: true }).click();
    await expect(page).toHaveURL(/\/warranty$/);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    await expect(page.getByRole('navigation', { name: 'Primary navigation', exact: true }).filter({ visible: true }).getByRole('link', { name: 'Warranty', exact: true })).toHaveAttribute('aria-current', 'page');
  });
}
