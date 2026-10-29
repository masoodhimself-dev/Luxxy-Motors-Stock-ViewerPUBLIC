import { test, expect, type Page } from '@playwright/test';
import { createSaleWorkspace, saleWorkspaceBranding, type SaleWorkspaceContext, type SaleWorkspaceRecord } from '@workspace/vehicle-meta';

test.skip(process.env.LUXXY_LOCAL_PREVIEW !== '1', 'Fictional local interception only; no live records or communications.');

async function guardExternal(page: Page) {
  await page.route(/^https?:\/\//, route => new URL(route.request().url()).origin === 'http://127.0.0.1:4212' ? route.continue() : route.abort());
}
function access() { return { role: 'owner', permissions: ['sales.manage', 'sales.handover', 'payments.record'], user: { authUserId: 'fictional-safe-delete-owner', name: 'Fictional owner' } }; }

// Enquiry deletion now uses explicit permanent confirmation; its responsive
// journeys and protected-record checks live in enquiry-deletion.spec.ts.
for (const width of [390, 834, 1440]) {
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
