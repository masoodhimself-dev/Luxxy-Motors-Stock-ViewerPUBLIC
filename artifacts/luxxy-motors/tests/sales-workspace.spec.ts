import { test, expect, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { createSaleWorkspace, type SaleWorkspaceContext } from '@workspace/vehicle-meta';
import {
  archivedPdf, attachGuidedSale, confirmInvoiceVehicle, chooseGuidedCar, finishGuidedSetup, openedPdf,
  openInvoiceCompose, pdfText, saveGuidedCustomer, startGuidedSale,
} from './sales-pdf-fixture';

test.skip(process.env.LUXXY_LOCAL_PREVIEW !== '1', 'Isolated local UI checks');

for (const width of [390, 1194]) {
  test(`guided sale rejects missing stock and shows the agreed part exchange and fee at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    const state = await attachGuidedSale(page);
    await startGuidedSale(page);
    const popups: string[] = [];
    page.on('popup', popup => popups.push(popup.url()));
    await page.getByRole('button', { name: 'Choose customer', exact: true }).click();
    await expect(page.getByRole('alert').filter({ hasText: 'Select a vehicle.' })).toBeInViewport();
    expect(popups).toEqual([]);
    expect(state.sale).toBeUndefined();
    expect(state.pdfRequests).toBe(0);

    await chooseGuidedCar(page, '15000');
    await saveGuidedCustomer(page, 'Sample Buyer');
    await page.getByRole('button', { name: 'Extras or part exchange', exact: true }).click();
    await page.getByRole('button', { name: 'Add part exchange', exact: true }).click();
    await page.getByLabel('Part-exchange registration', { exact: true }).fill('AB12 CDE');
    await page.getByLabel('Allowance (£)', { exact: true }).fill('3000');
    await page.getByRole('button', { name: 'Add fee or discount', exact: true }).click();
    await page.getByLabel('Description', { exact: true }).fill('Agreed service');
    await page.getByLabel('Amount (£)', { exact: true }).fill('100');
    await finishGuidedSetup(page);
    await openInvoiceCompose(page);
    await page.getByText('Review customer, vehicle and amounts', { exact: true }).click();
    await expect(page.locator('.invoice-review')).toContainText('£12,100.00');
    const create = page.getByRole('button', { name: 'Create & save invoice', exact: true });
    await expect(create).toBeDisabled();
    expect(state.sale?.documents).toEqual([]);
    await confirmInvoiceVehicle(page);
    await page.getByRole('checkbox', { name: /checked the customer, vehicle, agreed price/ }).check();
    await create.click();
    await expect(page.getByRole('heading', { name: 'Sales invoice', exact: true })).toBeVisible();
    const document = state.sale!.documents[0];
    expect(document.snapshot.totals.totalDue).toBe(1210000);
    const pdf = await openedPdf(page);
    expect(pdf).toEqual(archivedPdf(document));
    expect(await pdfText(pdf)).toContain('12,100.00');
    expect(state.blockedWrites).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  });
}

test('copies recent enquiry and sale contacts after review, and caps part exchanges at three', async ({ page }) => {
  const context: SaleWorkspaceContext = {
    now: new Date().toISOString(), actor: 'Fictional staff', nextId: randomUUID, nextNumber: kind => `TEST-${kind}`,
    branding: {
      identity: { name: 'Fictional Motors', logoText: 'Fictional Motors', logoAsset: '' },
      contact: { phone: '', email: '' }, address: { street: '', city: '', region: '', postcode: '' },
      legal: { companyName: '', companyNumber: '', vatNumber: '' },
    },
  };
  const previous = createSaleWorkspace({
    requestId: 'previous-customer-fixture',
    draft: {
      customer: 'Previous Sale Customer', email: 'previous@example.test', phone: '07700900002',
      address: 'Previous billing address', vehicleId: randomUUID(), vehicle: 'Previous fixture car', price: '9000',
    },
  }, context, 'PREVIOUS-SALE').sale;
  const state = await attachGuidedSale(page, previous);
  await page.route('**/api/enquiries*', route => route.fulfill({
    json: [{
      id: randomUUID(), reference: 'ENQ-1', vehicleId: randomUUID(), customerName: 'Enquiry Customer',
      email: 'enquiry@example.test', phone: '07700900001', createdAt: new Date().toISOString(),
    }],
  }));
  await startGuidedSale(page);
  await chooseGuidedCar(page);
  const name = page.getByLabel('Customer’s full name', { exact: true });
  const address = page.getByLabel('Customer address', { exact: true });
  await address.fill('Old billing address');
  await name.fill('Enquiry Cus');
  await page.getByRole('option', { name: /Enquiry Customer/ }).click();
  await expect(name).toHaveValue('Enquiry Customer');
  await expect(page.getByLabel('Telephone', { exact: true })).toHaveValue('07700900001');
  await expect(page.getByLabel('Email for the invoice', { exact: true })).toHaveValue('enquiry@example.test');
  await expect(address).toHaveValue('');
  await name.fill('Previous Sale');
  await page.getByRole('option', { name: /Previous Sale Customer/ }).click();
  await expect(page.getByText('Replace the details already entered?')).toBeVisible();
  await page.getByRole('button', { name: 'Use these details', exact: true }).click();
  await expect(name).toHaveValue('Previous Sale Customer');
  await expect(page.getByLabel('Telephone', { exact: true })).toHaveValue('07700900002');
  await expect(page.getByLabel('Email for the invoice', { exact: true })).toHaveValue('previous@example.test');
  await expect(address).toHaveValue('');
  await address.fill('New agreed billing address');
  await finishGuidedSetup(page);
  expect(state.sale?.draft).toMatchObject({ customer: 'Previous Sale Customer', address: 'New agreed billing address', email: 'previous@example.test' });
  expect(state.sale?.draft.sourceEnquiryId).toBeFalsy();

  await page.getByRole('button', { name: 'Extras or part exchange', exact: true }).click();
  const add = page.getByRole('button', { name: 'Add part exchange', exact: true });
  for (let i = 0; i < 3; i++) await add.click();
  await expect(add).toBeDisabled();
  const exchanges = page.locator('.invoice-adjustment-row').filter({ has: page.getByLabel('Part-exchange registration', { exact: true }) });
  await expect(exchanges).toHaveCount(3);
  await exchanges.nth(1).getByRole('button', { name: 'Remove', exact: true }).click();
  await expect(add).toBeEnabled();
  await expect(exchanges).toHaveCount(2);
  expect(state.sale?.payments).toEqual([]);
  expect(state.sale?.documents).toEqual([]);
  expect(state.blockedWrites).toEqual([]);
});

async function chooseStartSaleAction(page: Page, accept: boolean) {
  await page.getByRole('button', { name: 'Quick actions', exact: true }).click();
  const dialog = page.waitForEvent('dialog').then(async prompt => {
    expect(prompt.message()).toContain('Leave your unsaved invoice details?');
    if (accept) await prompt.accept();
    else await prompt.dismiss();
  });
  await Promise.all([dialog, page.getByRole('menuitem', { name: 'Start sale', exact: true }).click()]);
}

test('portal preserves an unsaved sale across tabs and asks before replacing edits', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 900 });
  const state = await attachGuidedSale(page);
  await startGuidedSale(page);
  const workspace = page.locator('.invoice-builder.is-editing');
  const heading = workspace.getByRole('heading', { name: 'Choose a car', exact: true });
  await expect(heading).toBeInViewport();
  expect(await workspace.evaluate(element => getComputedStyle(element).position)).toBe('fixed');
  await chooseGuidedCar(page);
  const name = workspace.getByLabel('Customer’s full name', { exact: true });
  await name.fill('Sample portal buyer');
  await page.getByRole('button', { name: 'Quick actions', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Calendar', exact: true }).click();
  await expect(page).toHaveURL(/workView=test-drives.*deskView=calendar/);
  await page.getByTestId('tab-sales').click();
  await expect(name).toHaveValue('Sample portal buyer');

  await chooseStartSaleAction(page, false);
  await expect(name).toHaveValue('Sample portal buyer');
  await chooseStartSaleAction(page, true);
  await expect(heading).toBeInViewport();
  await chooseGuidedCar(page);
  await expect(name).toHaveValue('');
  await page.locator('.sales-flow-mobile-action').getByRole('button', { name: 'Choose what to do', exact: true }).click();
  await expect(workspace.getByRole('alert').filter({ hasText: 'Enter the customer name.' })).toBeInViewport();
  await expect(workspace.getByRole('navigation', { name: 'Sale steps' })).toBeInViewport({ ratio: 1 });
  await expect(page.locator('body > .sales-print-copy')).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  expect(state.sale).toBeUndefined();
  expect(state.pdfRequests).toBe(0);
  expect(state.blockedWrites).toEqual([]);
});
