import { expect, test, type Page } from '@playwright/test';
import {
  archivedPdf, attachGuidedSale, confirmInvoiceVehicle, chooseGuidedCar, expectA4, openedPdf,
  openInvoiceCompose, pdfText, saveGuidedCustomer, startGuidedSale,
} from './sales-pdf-fixture';

test.skip(process.env.LUXXY_LOCAL_PREVIEW !== '1', 'Isolated local invoice layout checks only');

async function expectFocusChrome(page: Page) {
  const workspace = page.locator('.invoice-builder.is-editing');
  await expect(workspace).toBeInViewport({ ratio: 1 });
  await expect(workspace.locator('.sale-desk-header').getByRole('button', { name: 'Back to sales', exact: true })).toBeInViewport({ ratio: 1 });
  await expect(workspace.getByRole('navigation', { name: 'Sale steps' })).toBeInViewport({ ratio: 1 });
  await expect(workspace.getByRole('button', { name: 'Quick actions', exact: true })).toBeInViewport({ ratio: 1 });
  expect(await page.evaluate(() => ({
    horizontal: document.documentElement.scrollWidth > innerWidth + 1,
    vertical: document.scrollingElement!.scrollHeight > innerHeight + 1,
    scrolled: Math.abs(scrollY) > 1,
  }))).toEqual({ horizontal: false, vertical: false, scrolled: false });
}

async function createInvoice(page: Page) {
  await startGuidedSale(page);
  await chooseGuidedCar(page, '12500');
  await saveGuidedCustomer(page, 'Focused Invoice Buyer');
  await openInvoiceCompose(page);
  const create = page.getByRole('button', { name: 'Create & save invoice', exact: true });
  await expect(create).toBeDisabled();
  await confirmInvoiceVehicle(page);
  await page.getByRole('checkbox', { name: /checked the customer, vehicle, agreed price/ }).check();
  await create.click();
  await expect(page.getByRole('heading', { name: 'Sales invoice', exact: true })).toBeVisible();
}

for (const size of [
  { width: 390, height: 700 }, { width: 820, height: 900 },
  { width: 1194, height: 700 }, { width: 1366, height: 650 },
  { width: 1440, height: 900 },
]) {
  test(`the guided invoice and saved PDF stay usable without page scrolling at ${size.width}×${size.height}`, async ({ page }) => {
    await page.setViewportSize(size);
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    const state = await attachGuidedSale(page);
    await createInvoice(page);
    await expectFocusChrome(page);
    expect(state.pdfRequests).toBe(0);
    const document = state.sale!.documents[0];
    const pdf = await openedPdf(page);
    expect(pdf).toEqual(archivedPdf(document));
    const text = await pdfText(pdf);
    expect(text).toContain('Focused Invoice Buyer');
    expect(text).toContain('12,500.00');
    expect(text).not.toContain('DRAFT - not issued');
    expectA4(pdf);
    await expectFocusChrome(page);
    expect(state.commands.map(command => command.action)).toEqual(['issue-invoice']);
    expect(state.blockedWrites).toEqual([]);
    expect(errors).toEqual([]);
  });
}

test('using the Calendar quick action keeps unsaved edits when staff return to Sales', async ({ page }) => {
  await page.setViewportSize({ width: 1194, height: 900 });
  const state = await attachGuidedSale(page);
  await startGuidedSale(page);
  await chooseGuidedCar(page);
  await page.getByLabel('Customer’s full name', { exact: true }).fill('Unsaved calendar buyer');
  await page.getByRole('button', { name: 'Quick actions', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Calendar', exact: true }).click();
  await expect(page.getByTestId('tab-calendar')).toHaveAttribute('aria-current', 'page');
  await page.getByTestId('tab-sales').click();
  await expect(page.getByLabel('Customer’s full name', { exact: true })).toHaveValue('Unsaved calendar buyer');
  await expectFocusChrome(page);
  expect(state.sale).toBeUndefined();
  expect(state.blockedWrites).toEqual([]);
});

test('reopening the same saved PDF after resizing keeps the exact archived bytes', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const state = await attachGuidedSale(page);
  await createInvoice(page);
  const first = await openedPdf(page);
  await page.setViewportSize({ width: 390, height: 700 });
  await expectFocusChrome(page);
  const resized = await openedPdf(page);
  expect(resized).toEqual(first);
  expectA4(resized);
  expect(state.sale?.documents).toHaveLength(1);
  expect(state.pdfRequests).toBe(2);
  expect(state.blockedWrites).toEqual([]);
});

for (const width of [390, 1366]) {
  test(`invalid price is explained in the guided sale before invoicing at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 720 });
    const state = await attachGuidedSale(page);
    await startGuidedSale(page);
    await page.getByRole('region', { name: 'Vehicle selection' }).getByRole('button', { name: /^Choose / }).first().click();
    await page.getByLabel('Agreed vehicle price (£)', { exact: true }).fill('0');
    const popups: string[] = [];
    page.on('popup', popup => popups.push(popup.url()));
    await page.getByRole('button', { name: 'Choose customer', exact: true }).click();
    const alert = page.getByRole('alert').filter({ hasText: 'Enter a valid vehicle price greater than zero.' });
    await expect(alert).toBeVisible();
    await expect(alert).toBeInViewport({ ratio: 1 });
    await expectFocusChrome(page);
    expect(popups).toEqual([]);
    expect(state.sale).toBeUndefined();
    expect(state.pdfRequests).toBe(0);
    expect(state.blockedWrites).toEqual([]);
  });
}
