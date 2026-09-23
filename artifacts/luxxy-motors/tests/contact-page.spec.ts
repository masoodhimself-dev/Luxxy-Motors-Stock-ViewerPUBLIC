import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';

test.skip(process.env.LUXXY_LOCAL_PREVIEW !== '1', 'Local preview only.');
for (const width of [320, 390, 1440]) {
  test(`contact page and enquiry work at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    let payload: any;
    await page.route('**/api/enquiries', async route => {
      payload = route.request().postDataJSON();
      await route.fulfill({ json: { reference: 'CONTACT-TEST', customerNotificationStatus: 'sent' } });
    });
    await page.goto('/contact');
    await expect(page.getByRole('heading', { name: 'Contact us.', exact: true })).toBeVisible();
    await expect(page.getByTestId('contact-address')).toContainText('sample address');
    await expect(page.getByTestId('contact-directions')).toHaveCount(0);
    await expect(page.getByTestId('contact-phone')).toHaveAttribute('href', /^tel:/);
    await expect(page.getByTestId('contact-whatsapp')).toHaveAttribute('href', /^https:\/\/wa.me\//);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    if (width < 1024) {
      await page.getByRole('link', { name: 'How to find us', exact: true }).click();
      await expect(page.locator('#find-us-heading')).toBeFocused();
      await page.evaluate(() => window.scrollTo(0, 0));
    }
    if (width !== 320) {
      const directory = resolve('../../docs/screenshots/contact-page');
      await mkdir(directory, { recursive: true });
      await page.screenshot({ path: resolve(directory, `contact-${width}.png`), fullPage: true });
      await page.screenshot({ path: resolve(directory, `contact-${width}-viewport.png`) });
    }
    await page.getByRole('link', { name: 'Send an enquiry online' }).click();
    await expect(page.locator('#contact-message-heading')).toBeFocused();
    await page.getByTestId('input-customer-name').fill('Test Customer');
    await page.getByTestId('input-customer-email').fill('customer@example.com');
    await page.getByTestId('textarea-enquiry-message').fill('Can I visit on Saturday?');
    await page.getByTestId('button-submit-enquiry').click();
    await expect(page.getByTestId('status-enquiry-success')).toBeVisible();
    expect(payload).toMatchObject({ type: 'general', customerName: 'Test Customer', email: 'customer@example.com', message: 'Can I visit on Saturday?', vehicleId: null });
  });
}

test('directions, copied address and visit details follow the saved dealership settings', async ({ page, request }) => {
  const settings = await (await request.get('/api/dealer-settings')).json();
  settings.address = { street: '20 Station Road', city: 'Harrow', region: 'London', postcode: 'HA1 1AA', mapsUrl: 'https://www.google.com/maps?query=Harrow' };
  settings.contact.email = 'showroom@example.com';
  settings.presentation.parkingInstructions = 'Use the marked visitor spaces beside the entrance.';
  await page.route('**/api/dealer-settings', route => route.fulfill({ json: settings }));
  await page.addInitScript(() => { Object.defineProperty(navigator.clipboard, 'writeText', { value: async (text: string) => { (window as any).copiedAddress = text; } }); });
  await page.goto('/contact');
  await expect(page.getByTestId('contact-directions')).toHaveAttribute('href', settings.address.mapsUrl);
  await expect(page.getByTestId('contact-email')).toHaveAttribute('href', 'mailto:showroom@example.com');
  await expect(page.getByText(settings.presentation.parkingInstructions)).toBeVisible();
  await page.getByRole('button', { name: 'Copy address' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Address copied' })).toBeVisible();
  expect(await page.evaluate(() => (window as any).copiedAddress)).toBe('20 Station Road, Harrow, London, HA1 1AA');
});

test('desktop, mobile and homepage links open the contact page', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await page.getByRole('navigation', { name: 'Primary navigation' }).getByRole('link', { name: 'Contact us' }).click();
  await expect(page).toHaveURL(/\/contact$/);
  await page.setViewportSize({ width: 390, height: 900 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Open navigation menu' }).click();
  await page.getByRole('link', { name: 'Contact us', exact: true }).filter({ visible: true }).click();
  await expect(page).toHaveURL(/\/contact$/);
  await page.goto('/');
  await page.locator('#visit').getByRole('link', { name: 'Contact & directions' }).click();
  await expect(page).toHaveURL(/\/contact$/);
});
