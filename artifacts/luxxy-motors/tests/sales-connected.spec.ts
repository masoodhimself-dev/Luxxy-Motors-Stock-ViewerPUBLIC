import { test, expect, type BrowserContext } from '@playwright/test';
import { createSaleWorkspace, changeSaleWorkspace, publicSaleWorkspace, type SaleWorkspaceContext, type SaleWorkspaceRecord } from '../../../lib/vehicle-meta/src/sale-workspace';
import { customerSaleView, customerSaleDocument } from '../../../lib/vehicle-meta/src/customer-sale';

test.skip(process.env.LUXXY_LOCAL_PREVIEW !== '1', 'All sales writes intercepted in local preview.');
const sourceId = '00000000-0000-4000-8000-000000000010';
const vehicleId = '00000000-0000-4000-8000-000000000011';
const now = new Date().toISOString();
const branding = { identity: { name: 'Journey Motors', logoText: 'JOURNEY', logoAsset: '' }, contact: { phone: '02000000000', email: 'dealer@test.invalid' }, address: { street: '', city: 'London', region: '', postcode: '' }, legal: { companyName: '', companyNumber: '', vatNumber: '' } };
const context = (): SaleWorkspaceContext => ({ now: new Date().toISOString(), actor: 'Fixture staff', branding, nextId: () => crypto.randomUUID(), nextNumber: type => type.toUpperCase() + '-TEST-' + Math.random().toString().slice(2, 7) });
async function intercept(browser: BrowserContext) {
  let saved: SaleWorkspaceRecord | undefined;
  const commands: string[] = [];
  let createdCount = 0;
  await browser.route('**/api/stock', route => route.fulfill({ json: { schemaVersion: 1, dealerName: 'Journey Motors', scrapedAt: now, count: 1, cars: [{ id: vehicleId, title: 'Fixture car', year: 2020, price: 12000, currency: 'GBP', registration: 'AB20 XYZ', images: [], inventoryStatus: saved?.lifecycle?.status === 'sold' ? 'sold' : 'available' }] } }));
  await browser.route('**/api/enquiries*', route => route.fulfill({ json: [{ id: sourceId, reference: 'ENQ-JOURNEY', customerName: 'Alex Journey', email: 'alex@test.invalid', phone: '07000000000', vehicleId, vehicleTitle: 'Fixture car', vehicleRegistration: 'AB20 XYZ', vehiclePrice: 12000, createdAt: now, type: 'general', status: 'new', message: 'Fixture enquiry' }] }));
  await browser.route('**/api/reservations', route => route.fulfill({ json: { reservations: [] } }));
  await browser.route('**/api/sale-workspace**', async route => {
    const request = route.request(); const path = new URL(request.url()).pathname; const body = request.method() === 'GET' ? {} : request.postDataJSON();
    if (request.method() === 'GET') { await route.fulfill({ json: { sales: saved ? [publicSaleWorkspace(saved)] : [], preview: true } }); return; }
    if (path === '/api/sale-workspace') { createdCount++; saved = createSaleWorkspace({ draft: body.draft, requestId: body.requestId }, context(), 'SALE-JOURNEY').sale; await route.fulfill({ json: { sale: publicSaleWorkspace(saved), preview: true } }); return; }
    if (!saved) throw new Error('Missing fixture sale');
    let command: any;
    if (path.endsWith('/lifecycle')) command = { action: 'lifecycle', status: body.status };
    else if (path.endsWith('/customer-links')) command = { action: 'customer-link', tokenHash: 'a'.repeat(64), expiresAt: body.expiresAt };
    else if (path.endsWith('/customer-links/email')) command = { action: 'link-email-status', delivery: { id: body.requestId, to: saved.draft.email, status: 'prepared', attemptedAt: now } };
    else if (path.endsWith('/documents')) command = { action: 'document', type: body.type };
    else if (path.endsWith('/email')) command = { action: 'email-status', delivery: { id: body.requestId, to: saved.draft.email, documentId: saved.documents.at(-1)!.id, status: 'prepared', attemptedAt: now } };
    else if (request.method() === 'PUT') command = { action: 'update', draft: body.draft };
    else throw new Error('Unintercepted fixture action: ' + path);
    commands.push(command.action); const mutation = changeSaleWorkspace(saved, command, { expectedRevision: body.expectedRevision, requestId: body.requestId }, context()); saved = mutation.sale;
    await route.fulfill({ json: { ...mutation, sale: publicSaleWorkspace(saved), preview: true, ...(command.action === 'customer-link' ? { customerUrl: '/my-purchase/' + body.token } : {}) } });
  });
  await browser.route('**/api/customer-sale/**', route => {
    if (!saved) throw new Error('Missing customer fixture');
    const id = /\/documents\/([^/]+)$/.exec(new URL(route.request().url()).pathname)?.[1];
    return route.fulfill({ json: id ? { document: customerSaleDocument(saved.documents.find(d => d.id === id)!) } : { sale: customerSaleView(saved, branding) } });
  });
  return { sale: () => saved, commands, createdCount: () => createdCount };
}

test('source enquiry starts a linked sale, creates customer access and prepares customer/document emails', async ({ page, context }) => {
  const fixture = await intercept(context);
  await page.goto(`/portal?section=sales&enquiryId=${sourceId}`);
  await expect(page.getByLabel('Customer name', { exact: true })).toHaveValue('Alex Journey');
  await page.getByRole('button', { name: 'Save sale', exact: true }).first().click();
  await expect.poll(() => fixture.sale()?.draft.sourceEnquiryId).toBe(sourceId);
  await page.getByRole('button', { name: 'Delivery & handover', exact: true }).click();
  await page.getByRole('button', { name: 'Reserve for this customer' }).click();
  await expect.poll(() => fixture.sale()?.lifecycle?.status).toBe('reserved');
  await page.getByRole('button', { name: 'Create customer link' }).click();
  await expect(page.getByLabel('Customer link', { exact: true })).toHaveValue(/\/my-purchase\/[a-f0-9]{64}/);
  await page.getByRole('button', { name: 'Prepare / send customer link', exact: true }).click();
  await expect(page.getByText('Customer link email prepared · enable Resend in API settings to send.')).toBeVisible();
  await page.getByRole('button', { name: 'Documents', exact: true }).click();
  await page.getByRole('button', { name: 'Issue sales invoice', exact: true }).click();
  await page.getByRole('button', { name: 'Prepare / send email', exact: true }).click();
  await expect.poll(() => fixture.sale()?.emailDeliveries?.at(-1)?.status).toBe('prepared');
  const publicPage = await context.newPage();
  await publicPage.goto('/my-purchase/' + 'f'.repeat(64));
  await expect(publicPage.getByRole('heading', { name: 'Your purchase, Alex Journey' })).toBeVisible();
  await expect(publicPage.getByText('£12,000.00', { exact: true }).first()).toBeVisible();
  await publicPage.screenshot({ path: '/private/tmp/luxxy-customer-sale-desktop.png', fullPage: true });
  await publicPage.setViewportSize({ width: 390, height: 844 });
  await expect(publicPage.getByRole('heading', { name: 'Your purchase, Alex Journey' })).toBeVisible();
  expect(await publicPage.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  await publicPage.screenshot({ path: '/private/tmp/luxxy-customer-sale-mobile.png', fullPage: true });
  await publicPage.getByRole('button', { name: 'Open document' }).click();
  await expect(publicPage.getByRole('article', { name: 'Sales invoice' })).toBeVisible();
  await expect(publicPage.getByText('Fixture staff')).toHaveCount(0);
  await page.reload();
  await expect(page.getByLabel('Customer name', { exact: true })).toHaveValue('Alex Journey');
  expect(fixture.createdCount()).toBe(1);
  expect(fixture.commands).toEqual(expect.arrayContaining(['lifecycle', 'customer-link', 'link-email-status', 'document', 'email-status']));
});
