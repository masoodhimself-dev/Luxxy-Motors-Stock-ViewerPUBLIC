import { test, expect, type Page } from '@playwright/test';
import { createSaleWorkspace, saleWorkspaceBranding, type SaleWorkspaceContext, type SaleWorkspaceRecord } from '@workspace/vehicle-meta';

test.skip(process.env.LUXXY_LOCAL_PREVIEW !== '1', 'Fictional local interception only; no live records or communications.');
const testEnquiryId = '11111111-2222-4333-8444-555555555555';
const realEnquiryId = '99999999-8888-4777-8666-555555555555';

async function guardExternal(page: Page) {
  await page.route(/^https?:\/\//, route => new URL(route.request().url()).origin === 'http://127.0.0.1:4212' ? route.continue() : route.abort());
}
function access() { return { role: 'owner', permissions: ['sales.manage', 'sales.handover', 'payments.record'], user: { authUserId: 'fictional-safe-delete-owner', name: 'Fictional owner' } }; }

for (const width of [390, 834, 1440]) {
  test(`safe test enquiry delete has review, cancel and exact-record confirmation at ${width}`, async ({ page }) => {
    test.setTimeout(90000);
    await page.setViewportSize({ width, height: 1000 });
    await guardExternal(page);
    const sample = { reference: 'HIDDEN-TEST', type: 'general', source: 'phone', status: 'new', phone: '07700900123', email: 'operator@example.test', preferredContact: 'phone', vehicleId: null, vehicleTitle: 'Fictional car', appointmentAt: null, workspaceRevision: 2, followUpRevision: 0, createdAt: '2026-10-24T09:00:00Z', events: [] };
    const real = { ...sample, id: realEnquiryId, customerName: 'Real Buyer To Preserve', message: 'Please preserve this real customer enquiry.' };
    const fictional = { ...sample, id: testEnquiryId, customerName: 'TEST: QR sharing check', message: 'TEST: fictional enquiry for cleanup only.' };
    let enquiries = [fictional, real];
    const originalReal = JSON.stringify(real), deletes: { path: string; body: unknown }[] = [], unexpected: string[] = [], errors: string[] = [];
    let checks = 0;
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/api/**', async route => {
      const req = route.request(), path = new URL(req.url()).pathname;
      if (path === '/api/staff/access') return route.fulfill({ json: access() });
      if (path === '/api/enquiries') return route.fulfill({ json: enquiries });
      if (path === '/api/staff/email/reply-attention') return route.fulfill({ json: { enquiries: [] } });
      if (path === '/api/staff/directory') return route.fulfill({ json: { currentUserId: 'fictional-safe-delete-owner', members: [] } });
      if (path === '/api/reservations') return route.fulfill({ json: { reservations: [] } });
      if (path === '/api/staff/phone-sharing-settings') return route.fulfill({ json: { enabled: true, revision: 1 } });
      if (/^\/api\/staff\/enquiries\/[^/]+\/conversations$/.test(path)) return route.fulfill({ json: { events: [], total: 0, nextCursor: null } });
      if (path === `/api/staff/enquiries/${testEnquiryId}/deletion` && req.method() === 'GET') {
        checks++; return route.fulfill({ json: { id: testEnquiryId, expectedRevision: 2, canDelete: true, reason: null } });
      }
      if (path === `/api/staff/enquiries/${testEnquiryId}/deletion` && req.method() === 'DELETE') {
        deletes.push({ path, body: req.postDataJSON() });
        enquiries = enquiries.filter(entry => entry.id !== testEnquiryId);
        return route.fulfill({ json: { deleted: true, id: testEnquiryId } });
      }
      if (['GET', 'HEAD'].includes(req.method())) return route.continue();
      unexpected.push(`${req.method()} ${path}`); return route.abort();
    });
    await page.goto(`/portal?section=notifications&workView=customers&enquiryId=${testEnquiryId}`);
    // Vite may still be compiling the lazily loaded portal on a cold start.
    // Keep the normal short assertions for the actual deletion interactions.
    await expect(page.getByRole('status', { name: 'Loading page', exact: true })).toBeHidden({ timeout: 30000 });
    const detail = page.getByRole('region', { name: `Selected enquiry: ${fictional.customerName}` });
    await expect(detail).toBeVisible();
    await detail.getByText('Customer details & more', { exact: true }).click();
    await detail.getByRole('button', { name: 'Delete test enquiry', exact: true }).click();
    const confirmation = page.getByRole('alertdialog', { name: 'Delete this test enquiry?' });
    await expect(confirmation.getByRole('button', { name: 'Delete permanently', exact: true })).toBeDisabled();
    await expect(confirmation.getByLabel('I confirm this is test data, not a real customer enquiry.')).toBeVisible();
    expect(checks).toBe(1); expect(deletes).toEqual([]);
    await confirmation.getByRole('button', { name: 'Keep enquiry', exact: true }).click();
    await expect(confirmation).not.toBeVisible(); expect(deletes).toEqual([]);
    await detail.getByRole('button', { name: 'Delete test enquiry', exact: true }).click();
    await confirmation.getByLabel('I confirm this is test data, not a real customer enquiry.').check();
    await expect(confirmation.getByRole('button', { name: 'Delete permanently', exact: true })).toBeEnabled();
    expect(checks).toBe(2);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: `/tmp/luxxy-safe-delete-enquiry-${width}.png`, animations: 'disabled' });
    await confirmation.getByRole('button', { name: 'Delete permanently', exact: true }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Test enquiry deleted.' })).toBeVisible();
    await expect(page).not.toHaveURL(new RegExp(testEnquiryId));
    await expect(page.getByRole('button', { name: `Open enquiry for ${fictional.customerName}, Fictional car`, exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: 'Open enquiry for Real Buyer To Preserve, Fictional car', exact: true }).click();
    const preserved = page.getByRole('region', { name: 'Selected enquiry: Real Buyer To Preserve' });
    await expect(preserved).toContainText(real.message);
    await preserved.getByText('Customer details & more', { exact: true }).click();
    await expect(preserved.getByRole('button', { name: 'Delete test enquiry', exact: true })).toHaveCount(0);
    expect(deletes).toEqual([{ path: `/api/staff/enquiries/${testEnquiryId}/deletion`, body: { expectedRevision: 2, confirmTestOnly: true } }]);
    expect(enquiries).toEqual([real]); expect(JSON.stringify(real)).toBe(originalReal);
    expect(unexpected).toEqual([]); expect(errors).toEqual([]);
  });

  test(`safe empty sale delete preserves real saved sale at ${width}`, async ({ page, request }) => {
    test.setTimeout(90000);
    await page.setViewportSize({ width, height: 1000 });
    await guardExternal(page);
    const settings = await (await request.get('/api/dealer-settings')).json();
    const context: SaleWorkspaceContext = { now: '2026-10-24T09:00:00.000Z', actor: 'Fictional cleanup tester', branding: saleWorkspaceBranding(settings), nextId: () => crypto.randomUUID(), nextNumber: type => `TEST-${type}` };
    const empty = { ...createSaleWorkspace({ requestId: crypto.randomUUID(), draft: {} }, context, 'TEST-EMPTY').sale, emptyDraftDeletable: true };
    const real = { ...createSaleWorkspace({ requestId: crypto.randomUUID(), draft: { customer: 'Real Sale To Preserve', phone: '07700900123', email: 'operator@example.test', vehicle: 'Fictional protected car', price: '10000' } }, context, 'PRESERVE-REAL').sale, emptyDraftDeletable: false };
    let sales: SaleWorkspaceRecord[] = [empty, real];
    const originalReal = JSON.stringify(real), deletes: { path: string; body: unknown }[] = [], unexpected: string[] = [], errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/api/**', async route => {
      const req = route.request(), path = new URL(req.url()).pathname;
      if (path === '/api/staff/access') return route.fulfill({ json: access() });
      if (path === '/api/enquiries') return route.fulfill({ json: [] });
      if (path === '/api/reservations') return route.fulfill({ json: { reservations: [] } });
      if (path === '/api/sale-workspace') return route.fulfill({ json: { sales } });
      if (path === `/api/sale-workspace/${empty.id}` && req.method() === 'DELETE') {
        deletes.push({ path, body: req.postDataJSON() }); sales = sales.filter(sale => sale.id !== empty.id);
        return route.fulfill({ json: { deleted: true, id: empty.id } });
      }
      if ([`/api/sale-workspace/${empty.id}`, `/api/sale-workspace/${real.id}`].includes(path)) return route.fulfill({ json: { sale: sales.find(sale => path.endsWith(sale.id)) } });
      if (['GET', 'HEAD'].includes(req.method())) return route.continue();
      unexpected.push(`${req.method()} ${path}`); return route.abort();
    });
    await page.goto(`/portal?section=sales&saleId=${empty.id}`);
    await expect(page.getByRole('status', { name: 'Loading page', exact: true })).toBeHidden({ timeout: 30000 });
    const summary = page.getByRole('region', { name: 'Saved sale summary', exact: true });
    await expect(summary).toBeVisible();
    await summary.getByRole('button', { name: 'Delete draft', exact: true }).click();
    const confirmation = page.getByRole('dialog', { name: 'Delete this draft?' });
    await expect(confirmation).toBeVisible();
    const layers = await confirmation.evaluate(element => ({
      dialog: Number(getComputedStyle(element).zIndex),
      workspace: Number(getComputedStyle(document.querySelector('.invoice-builder.is-editing')!).zIndex),
    }));
    // A portalled dialog can remain focusable/clickable behind a pointer-disabled
    // workspace. Check its visible layer as well as its accessibility presence.
    expect(layers.dialog).toBeGreaterThan(layers.workspace);
    await expect(confirmation.getByRole('button', { name: 'Keep draft', exact: true })).toBeFocused();
    expect(deletes).toEqual([]);
    await confirmation.getByRole('button', { name: 'Keep draft', exact: true }).click();
    await expect(confirmation).not.toBeVisible(); expect(deletes).toEqual([]);
    await summary.getByRole('button', { name: 'Delete draft', exact: true }).click();
    await expect(confirmation).toBeVisible();
    await expect(confirmation.getByRole('button', { name: 'Delete draft permanently', exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: `/tmp/luxxy-safe-delete-sale-${width}.png`, animations: 'disabled' });
    await confirmation.getByRole('button', { name: 'Delete draft permanently', exact: true }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Draft deleted.' })).toBeVisible();
    await expect(page.getByRole('button', { name: /Customer to add.*In progress/ })).toHaveCount(0);
    await page.getByRole('button', { name: /Real Sale To Preserve.*Fictional protected car/ }).click();
    await expect(summary).toContainText('Real Sale To Preserve');
    await expect(summary.getByRole('button', { name: 'Delete draft', exact: true })).toHaveCount(0);
    expect(deletes).toEqual([{ path: `/api/sale-workspace/${empty.id}`, body: { expectedRevision: empty.revision, confirm: true } }]);
    expect(sales).toEqual([real]); expect(JSON.stringify(real)).toBe(originalReal);
    expect(unexpected).toEqual([]); expect(errors).toEqual([]);
  });
}
