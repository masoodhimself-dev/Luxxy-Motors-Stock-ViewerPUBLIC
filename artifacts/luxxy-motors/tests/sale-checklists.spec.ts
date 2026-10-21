import { expect, test, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import {
  changeSaleWorkspace, createSaleWorkspace, publicSaleWorkspace,
  SaleWorkspaceError, partExchangeChecklistItems,
  type SaleWorkspaceCommand, type SaleWorkspaceContext, type SaleWorkspaceDraft,
} from '@workspace/vehicle-meta';

const now = '2026-10-20T12:00:00.000Z';
const vehicleId = '00000000-0000-4000-8000-000000000819';
const image = `data:image/svg+xml;base64,${Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="600" height="400"><rect width="600" height="400" fill="#dce6ed"/><path d="M100 250h400l-50-90H180z" fill="#315b75"/><circle cx="190" cy="250" r="35" fill="#192e3b"/><circle cx="420" cy="250" r="35" fill="#192e3b"/></svg>').toString('base64')}`;
const branding: SaleWorkspaceContext['branding'] = {
  identity: { name: 'Fictional Motors', logoText: 'FICTIONAL', logoAsset: '' },
  contact: { phone: '07700900101', email: 'showroom@example.test' },
  address: { street: 'Fictional showroom', city: 'London', region: '', postcode: 'ZZ1 1ZZ' },
  legal: { companyName: 'Fictional Motors', companyNumber: '', vatNumber: '' },
};
const context = (): SaleWorkspaceContext => ({
  now, actor: 'Fictional staff', nextId: randomUUID, nextNumber: () => `INV-FICTIONAL-${randomUUID().slice(0, 8)}`,
  branding, vehicle: { id: vehicleId, title: 'Toyota Yaris', year: 2020, mileage: 30000, imageUrl: image },
});
function fixture(partExchange: boolean) {
  const draft: SaleWorkspaceDraft = {
    id: '', customer: 'Alex Fictional Buyer', email: 'buyer@example.test', phone: '07700900102', address: 'Fictional buyer address',
    vehicleId, vehicle: 'Toyota Yaris', registration: 'ZZ20 TST', price: '10000',
    partExchange, pxRegistration: '', pxDescription: '', pxValue: '', deposit: '', paymentMethod: 'Bank transfer', notes: '', collection: '',
    preparation: false, documents: false, handover: false,
    exchanges: partExchange ? [{ registration: 'ZZ19 PXE', description: 'Fictional Ford Fiesta', value: '1000' }] : [], adjustments: [],
  };
  let sale = createSaleWorkspace({ draft, requestId: randomUUID() }, context(), 'SALE-FICTIONAL').sale;
  sale = changeSaleWorkspace(sale, { action: 'invoice-payment', payment: { amount: partExchange ? '9000' : '10000', method: 'Bank transfer', date: '2026-10-20', reference: 'Fictional funds only', kind: 'final-payment', status: 'confirmed' } }, { expectedRevision: sale.revision, requestId: randomUUID() }, context()).sale;
  return changeSaleWorkspace(sale, { action: 'issue-invoice', kind: 'full', acknowledge: true }, { expectedRevision: sale.revision, requestId: randomUUID() }, context()).sale;
}
async function setup(page: Page, options: { partExchange?: boolean; intakeComplete?: boolean; serverReject?: boolean } = {}) {
  let sale = fixture(Boolean(options.partExchange));
  if (options.intakeComplete) sale = changeSaleWorkspace(sale, { action: 'checklists', partExchanges: [{ registration: 'ZZ19PXE', items: Object.fromEntries(partExchangeChecklistItems.map(item => [item.id, 'checked'])) }] }, { expectedRevision: sale.revision, requestId: randomUUID() }, context()).sale;
  const originalInvoice = JSON.stringify(sale.documents);
  const originalPayments = JSON.stringify(sale.payments);
  const writes: string[] = [], actions: Array<{ path: string; body: any }> = [], errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.clock.setFixedTime(new Date(now));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.route('**/api/**', async route => {
    const request = route.request(), path = new URL(request.url()).pathname;
    if (path.startsWith(`/api/sale-workspace/${sale.id}`) && request.method() === 'POST') {
      const body = request.postDataJSON(); actions.push({ path, body });
      let command: SaleWorkspaceCommand;
      if (path.endsWith('/checklists')) command = { action: 'checklists', completion: body.completion, partExchanges: body.partExchanges };
      else if (path.endsWith('/finish-invoice-sale')) {
        command = { action: 'finish-invoice-sale', acknowledge: body.acknowledge, acknowledgeOutstanding: body.acknowledgeOutstanding };
        if (options.serverReject && sale.checklists) delete sale.checklists.partExchanges.ZZ19PXE;
      } else { writes.push(`${request.method()} ${path}`); return route.abort(); }
      try {
        const result = changeSaleWorkspace(sale, command, body, context()); sale = result.sale;
        return route.fulfill({ json: { ...result, sale: publicSaleWorkspace(sale) } });
      } catch (error) {
        if (!(error instanceof SaleWorkspaceError)) throw error;
        return route.fulfill({ status: error.status, json: { error: error.message } });
      }
    }
    if (!['GET', 'HEAD'].includes(request.method())) { writes.push(`${request.method()} ${path}`); return route.abort(); }
    if (path === '/api/sale-workspace') return route.fulfill({ json: { sales: [publicSaleWorkspace(sale)], preview: true } });
    if (path === `/api/sale-workspace/${sale.id}`) return route.fulfill({ json: { sale: publicSaleWorkspace(sale), preview: true } });
    if (path === '/api/stock') return route.fulfill({ json: { schemaVersion: 1, dealerName: 'Fictional Motors', dealerLocation: 'London', count: 1, scrapedAt: now, cars: [{ id: vehicleId, advertId: 'fictional-car', title: 'Toyota Yaris', make: 'Toyota', model: 'Yaris', plate: 'ZZ20 TST', year: 2020, price: 10000, mileage: 30000, fuel: 'Petrol', transmission: 'Automatic', heroImage: image, images: [] }] } });
    if (path === '/api/enquiries') return route.fulfill({ json: [] });
    if (path === '/api/reservations') return route.fulfill({ json: { reservations: [] } });
    if (path === '/api/staff/access') return route.fulfill({ json: { role: 'owner', permissions: ['sales.manage', 'stock.manage', 'settings.publish', 'payments.record'], user: { name: 'Fictional staff', email: 'staff@example.test' } } });
    if (path === `/api/staff/sold-vehicle-follow-ups/${sale.id}`) return route.fulfill({ json: { saleId: sale.id, vehicleId, vehicleTitle: 'Toyota Yaris', registration: 'ZZ20 TST', imageUrl: image, sold: Boolean(sale.completedAt), createdAt: null, customers: [], remaining: 0, upcomingAppointments: 0 } });
    if (path === '/api/staff/sold-vehicle-follow-ups' || path === '/api/staff/stock-change-tasks') return route.fulfill({ json: { tasks: [], total: 0, generatedAt: now } });
    return route.continue();
  });
  return { id: sale.id, actions, writes, errors, current: () => sale, originalInvoice, originalPayments };
}
async function openCompletion(page: Page, id: string) {
  await page.goto(`/portal?section=sales&saleId=${id}`);
  await page.getByRole('button', { name: 'Review sale completion', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Your invoice is ready.', exact: true })).toBeVisible();
}
async function noOverflow(page: Page, width: number) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width + 1);
  expect(await page.locator('.invoice-builder').evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
}
for (const width of [320, 390, 820, 1440]) {
  test(`final reminders need no extra checklist ticks at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 }); const state = await setup(page);
    await openCompletion(page, state.id);
    const reminder = page.getByRole('complementary', { name: 'Before completing the sale' });
    await expect(reminder).toBeVisible();
    await expect(reminder.getByRole('checkbox')).toHaveCount(0);
    await expect(reminder.getByRole('button')).toHaveCount(0);
    await noOverflow(page, width);
    expect(state.actions).toEqual([]);
    await page.getByRole('button', { name: 'Yes, mark sold & remove', exact: true }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Car marked sold and removed from the website.' })).toBeVisible();
    expect(state.current().lifecycle?.status).toBe('sold');
    expect(JSON.stringify(state.current().documents)).toBe(state.originalInvoice);
    expect(JSON.stringify(state.current().payments)).toBe(state.originalPayments);
    expect(state.actions.filter(action => action.path.endsWith('/checklists'))).toHaveLength(0);
    expect(state.writes).toEqual([]); expect(state.errors).toEqual([]);
  });
  test(`saved part-exchange intake is not asked for again at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 }); const state = await setup(page, { partExchange: true, intakeComplete: true });
    await openCompletion(page, state.id);
    const reminder = page.getByRole('complementary', { name: 'Before completing the sale' });
    await expect(reminder).toContainText('No need to complete them again');
    await expect(reminder.getByRole('checkbox')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Yes, mark sold & remove', exact: true })).toBeEnabled();
    await noOverflow(page, width);
    expect(state.actions).toEqual([]);
    expect(state.writes).toEqual([]); expect(state.errors).toEqual([]);
  });
}

test('unfinished intake is linked back to Payments without repeating its form', async ({ page }) => {
  const state = await setup(page, { partExchange: true }); await openCompletion(page, state.id);
  await expect(page.getByRole('button', { name: 'Yes, mark sold & remove', exact: true })).toBeDisabled();
  await expect(page.getByRole('complementary', { name: 'Before completing the sale' }).getByRole('checkbox')).toHaveCount(0);
  await page.getByRole('button', { name: 'Review part-exchange checks', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'What has the customer paid?', exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Part-exchange intake checks' }).getByRole('checkbox')).toHaveCount(5);
  expect(state.actions).toEqual([]);
});

test('server still refuses a genuinely incomplete part-exchange intake', async ({ page }) => {
  const state = await setup(page, { partExchange: true, intakeComplete: true, serverReject: true }); await openCompletion(page, state.id);
  await page.getByRole('button', { name: 'Yes, mark sold & remove', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Complete the intake checklist for each part-exchange vehicle' })).toBeVisible();
  expect(state.current().completedAt).toBeUndefined();
  expect(JSON.stringify(state.current().documents)).toBe(state.originalInvoice);
  expect(JSON.stringify(state.current().payments)).toBe(state.originalPayments);
  expect(state.writes).toEqual([]); expect(state.errors).toEqual([]);
});
