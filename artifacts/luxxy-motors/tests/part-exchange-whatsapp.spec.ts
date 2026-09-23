import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';

test.skip(process.env.LUXXY_LOCAL_PREVIEW !== '1', 'Local stock preview only.');
for (const width of [390, 1440]) {
  test(`part exchange validates, reviews and prepares WhatsApp at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    // Capture the external handoff without opening WhatsApp or sending anything.
    await page.addInitScript(() => {
      window.open = (url) => { (window as unknown as { capturedWhatsApp: string }).capturedWhatsApp = String(url); return null; };
    });
    const enquiryPosts: string[] = [];
    page.on('request', request => { if (request.method() === 'POST' && request.url().includes('/api/enquiries')) enquiryPosts.push(request.url()); });
    await page.goto('/enquire?type=part_exchange');
    const next = page.getByTestId('button-part-exchange-continue');
    await next.click();
    await expect(page.getByTestId('input-part-exchange-registration')).toBeVisible();
    await page.getByTestId('input-part-exchange-registration').fill('AB12 CDE');
    await page.getByTestId('input-part-exchange-model').fill('Volkswagen Golf');
    await page.getByTestId('input-part-exchange-mileage').fill('45000');
    await next.click();
    await expect(page.locator('#enquiry-form-heading')).toBeFocused();
    await next.click();
    await expect(page.getByTestId('select-part-exchange-condition')).toBeVisible();
    await page.getByTestId('select-part-exchange-condition').selectOption({ label: 'Good — normal wear for its age' });
    await page.getByTestId('select-part-exchange-keys').selectOption('2 keys');
    await page.getByTestId('select-part-exchange-v5').selectOption('Yes');
    await page.getByTestId('select-part-exchange-history').selectOption('Full history');
    await page.getByTestId('input-part-exchange-notes').fill('Small scratch on rear bumper.');
    await expect(page.getByTestId('part-exchange-photo-guide')).toContainText('Photos are not uploaded on this website');
    const directory = resolve('../../docs/screenshots/part-exchange-whatsapp');
    await mkdir(directory, { recursive: true });
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
    await page.screenshot({ path: resolve(directory, `condition-${width}.png`), fullPage: true });
    await next.click();
    await expect(next).toBeDisabled();
    await page.getByTestId('select-part-exchange-target-vehicle').selectOption('preview-1');
    await expect(page.getByTestId('card-part-exchange-target-vehicle')).toBeVisible();
    await next.click();
    await page.getByTestId('input-customer-name').fill('Test Buyer');
    await page.getByTestId('input-customer-phone').fill('07700 900123');
    await page.getByTestId('input-customer-email').fill('buyer@example.com');
    await expect(page.getByTestId('part-exchange-message-preview')).toContainText('V5C logbook: Yes');
    await expect(page.getByTestId('part-exchange-message-preview')).toContainText('Stock reference: preview-1');
    await next.click();
    expect(await page.evaluate(() => (window as unknown as { capturedWhatsApp?: string }).capturedWhatsApp)).toBeUndefined();
    await page.getByRole('checkbox').check();
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
    await page.screenshot({ path: resolve(directory, `review-${width}.png`), fullPage: true });
    await next.click();
    const url = await page.evaluate(() => (window as unknown as { capturedWhatsApp: string }).capturedWhatsApp);
    expect(new URL(url).hostname).toBe('wa.me');
    const message = new URL(url).searchParams.get('text')!;
    for (const detail of ['AB12 CDE', 'Volkswagen Golf', '45,000 miles', '2 keys', 'V5C logbook: Yes', 'Full history', 'Small scratch', 'preview-1', 'Test Buyer', '07700 900123', 'buyer@example.com']) expect(message).toContain(detail);
    await expect(page.getByRole('status').filter({ hasText: 'WhatsApp was requested' })).toBeVisible();
    expect(enquiryPosts).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    await page.getByRole('button', { name: '01 Your car' }).click();
    await expect(page.getByTestId('input-part-exchange-registration')).toHaveValue('AB12 CDE');
  });
}

test('stock vehicle link preselects a current car', async ({ page }) => {
  await page.goto('/enquire?type=part_exchange&vehicleId=preview-1');
  await page.getByTestId('input-part-exchange-registration').fill('AB12 CDE');
  await page.getByTestId('input-part-exchange-model').fill('Ford Focus');
  await page.getByTestId('input-part-exchange-mileage').fill('0');
  await page.getByTestId('button-part-exchange-continue').click();
  await page.getByTestId('select-part-exchange-condition').selectOption({ index: 1 });
  await page.getByTestId('select-part-exchange-keys').selectOption('1 key');
  await page.getByTestId('select-part-exchange-v5').selectOption('Replacement requested');
  await page.getByTestId('select-part-exchange-history').selectOption('Not sure');
  await page.getByTestId('button-part-exchange-continue').click();
  await expect(page.getByTestId('select-part-exchange-target-vehicle')).toHaveValue('preview-1');
});
