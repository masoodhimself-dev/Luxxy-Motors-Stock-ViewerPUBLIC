import { mkdir } from 'node:fs/promises';
import { expect, test, type Locator } from '@playwright/test';

test.skip(process.env.LUXXY_LOCAL_PREVIEW !== '1', 'Fictional customer data and intercepted submissions only.');
test.use({ serviceWorkers: 'block', reducedMotion: 'reduce' });
test.beforeEach(async ({ page }) => {
  await page.route('**/api/**', route => ['GET', 'HEAD'].includes(route.request().method()) ? route.continue() : route.fulfill({ status: 403, json: { error: 'Visual audit blocked this write.' } }));
});

async function fits(element: Locator, width: number) {
  const box = await element.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(-1);
  expect(box!.x + box!.width).toBeLessThanOrEqual(width + 1);
  expect(await element.page().evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width + 1);
}

const purchase = {
  reference: 'SALE-FICTIONAL-CUSTOMER-REFERENCE-1234567890', customer: 'Alexandra Example-Smith',
  vehicle: '2018 BMW 320i M Sport Touring Automatic', registration: 'AB18 XYZ', status: 'reserved',
  totals: { price: 1200000, allowance: 100000, adjustments: 10000, totalDue: 1110000, deposit: 50000, confirmedPaid: 50000, pending: 0, balance: 1060000 },
  payments: [{ id: 'sample-payment', amountPence: 50000, signedAmountPence: 50000, method: 'bank-transfer', date: '2026-10-13', kind: 'deposit', status: 'received' }],
  documents: [{ id: 'sample-document', number: 'INVOICE-REFERENCE-VERY-LONG-1234567890', title: 'Sales invoice', type: 'invoice', issuedAt: '2026-10-13T10:00:00Z' }],
  fulfilment: { method: 'delivery', address: '14 Example Place\nSample Town\nAB12 CDE', scheduledDate: '2026-10-20', timeWindow: 'Between 10am and 12pm' },
  dealer: { identity: { name: 'Example Motors' }, contact: { phone: '02079460999', email: 'sales@very-long-example-dealership.test' } },
  expiresAt: '2026-11-13T10:00:00Z',
};

for (const width of [320, 390, 820, 1440]) {
  test(`private purchase typography and long supplied references fit at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.route('**/api/customer-sale/visual-audit', route => route.fulfill({ json: { sale: purchase } }));
    await page.goto('/my-purchase/visual-audit');
    await expect(page.getByRole('heading', { name: 'Your purchase, Alexandra Example-Smith' })).toBeVisible();
    const content = page.locator('.customer-purchase');
    await page.evaluate(() => document.fonts.ready);
    await fits(content, width);
    expect(await content.evaluate(el => getComputedStyle(el).fontFamily)).toContain('Inter');
    const escaping = await content.locator('h1,h2,p,dd,li,a').evaluateAll(elements => elements.filter(el => el.getBoundingClientRect().right > innerWidth + 1).map(el => el.textContent));
    expect(escaping).toEqual([]);
    await expect(page.locator('.customer-purchase-balance')).toHaveText('£10,600.00');
    await expect(page.getByRole('button', { name: 'Open document' })).toBeVisible();
    await mkdir('/tmp/customer-flow-visual-audit', { recursive: true });
    await page.screenshot({ path: `/tmp/customer-flow-visual-audit/purchase-${width}.png`, fullPage: true, animations: 'disabled' });
  });
}

for (const width of [320, 390, 820, 1440]) {
  test(`call and WhatsApp supporting text stays readable at ${width}px`, async ({ page, request }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.clock.install({ time: new Date('2026-10-13T21:00:00Z') });
    const stock = await (await request.get('/api/stock')).json();
    const settings = await (await request.get('/api/dealer-settings')).json();
    settings.hours = [{ days: 'Monday – Sunday', times: '09:00 – 18:00' }];
    await page.route('**/api/dealer-settings', route => route.fulfill({ json: settings }));
    const car = stock.cars.find((item: any) => !item.inventoryStatus || item.inventoryStatus === 'available');
    await page.goto(`/vehicle/${car.id}`);
    await page.locator('[data-vehicle-contact="call"]').first().click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByText('Closed now', { exact: true })).toBeVisible();
    await dialog.getByRole('button', { name: 'Request a callback', exact: true }).click();
    await expect(dialog.getByLabel('Your name')).toBeVisible();
    await fits(dialog, width);
    for (const selector of ['.vehicle-dialog-muted', '.vehicle-action-field', '.vehicle-action-privacy', '.vehicle-call-hours']) {
      expect(await dialog.locator(selector).first().evaluate(el => parseFloat(getComputedStyle(el).fontSize))).toBeGreaterThanOrEqual(13);
    }
    await expect(dialog.getByLabel('Your name')).toHaveCSS('font-size', '16px');
    await mkdir('/tmp/customer-flow-visual-audit', { recursive: true });
    await dialog.screenshot({ path: `/tmp/customer-flow-visual-audit/call-${width}.png`, animations: 'disabled' });
    await dialog.getByRole('button', { name: 'Close', exact: true }).click();
    await page.locator('[data-vehicle-contact="whatsapp"]').first().click();
    await expect(dialog.getByRole('heading', { name: 'Review your WhatsApp message' })).toBeVisible();
    await fits(dialog, width);
    await expect(dialog.getByLabel('Your message')).toHaveCSS('font-size', '16px');
    expect(await dialog.locator('.vehicle-message-hint').evaluate(el => parseFloat(getComputedStyle(el).fontSize))).toBeGreaterThanOrEqual(13);
    await expect(dialog.getByRole('link', { name: 'Continue to WhatsApp' })).toHaveAttribute('href', /^https:\/\/wa.me\//);
    await dialog.screenshot({ path: `/tmp/customer-flow-visual-audit/whatsapp-${width}.png`, animations: 'disabled' });
  });
}

for (const brand of [
  { name: 'light gold', accentHsl: '55 95% 70%', heading: '#dce7ef', panel: '#ffffff', page: '#f7f8fa' },
  { name: 'dark burgundy', accentHsl: '342 55% 28%', heading: '#342126', panel: '#ffffff', page: '#f9f5f6' },
  { name: 'dark configured surfaces', accentHsl: '175 80% 65%', heading: '#ffffff', panel: '#2d2935', page: '#18141e' },
]) {
  test(`customer call text and buttons remain legible with ${brand.name}`, async ({ page, request }) => {
    await page.setViewportSize({ width: 390, height: 900 });
    await page.clock.install({ time: new Date('2026-10-13T10:00:00Z') });
    const stock = await (await request.get('/api/stock')).json();
    const settings = await (await request.get('/api/dealer-settings')).json();
    settings.hours = [{ days: 'Monday – Sunday', times: '09:00 – 18:00' }];
    settings.identity.brandColors = { ...settings.identity.brandColors, accentHsl: brand.accentHsl };
    settings.presentation = { ...settings.presentation, headingColour: brand.heading, panelColour: brand.panel, pageColour: brand.page };
    await page.route('**/api/dealer-settings', route => route.fulfill({ json: settings }));
    await page.goto(`/vehicle/${stock.cars[0].id}`);
    await page.locator('[data-vehicle-contact="call"]').first().click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Request a callback', exact: true }).click();
    const results = await dialog.evaluate(element => {
      const light = (colour: string) => {
        const values = colour.match(/[\d.]+/g)!.slice(0, 3).map(Number).map(channel => channel / 255);
        return values.map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4).reduce((sum, value, index) => sum + value * [.2126, .7152, .0722][index], 0);
      };
      return [...element.querySelectorAll<HTMLElement>('h2,.vehicle-dialog-vehicle-title,.vehicle-dialog-muted,.vehicle-action-field,.vehicle-action-privacy,.vehicle-action-primary,.vehicle-phone-number')].filter(node => node.getBoundingClientRect().height).map(node => {
        let parent: HTMLElement | null = node;
        while (parent && ['rgba(0, 0, 0, 0)', 'transparent'].includes(getComputedStyle(parent).backgroundColor)) parent = parent.parentElement;
        const foreground = light(getComputedStyle(node).color), background = light(parent ? getComputedStyle(parent).backgroundColor : 'rgb(255, 255, 255)');
        return { text: node.textContent?.slice(0, 40), ratio: (Math.max(foreground, background) + .05) / (Math.min(foreground, background) + .05) };
      });
    });
    expect(results.filter(item => item.ratio < 4.5)).toEqual([]);
    await expect(dialog.getByLabel('Your name')).toHaveCSS('font-size', '16px');
    await fits(dialog, 390);
  });
}
