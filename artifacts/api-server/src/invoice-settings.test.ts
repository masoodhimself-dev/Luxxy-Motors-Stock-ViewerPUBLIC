import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DealerIntegrationsStore } from './lib/dealer-integrations-store';
import { defaultSaleTerms } from '@workspace/vehicle-meta';

test('invoice settings default to approved wording, persist overrides and reject stale or invalid updates', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'invoice-settings-'));
  try {
    const store = new DealerIntegrationsStore({ filename: join(dir, 'private.json'), production: false });
    const initial = await store.readSalesPaperwork();
    assert.equal(initial.saleTerms, defaultSaleTerms);
    assert.ok(initial.saleTerms.includes('Nothing in these terms limits your statutory rights.'));
    const input = { expectedRevision: initial.revision, saleTerms: 'CUSTOM TERMS', reservationTerms: 'DEPOSIT TERMS', invoiceDetails: { name: 'Test Invoice Seller', email: 'seller@example.test', vatNumber: '' } };
    await store.updateSalesPaperwork(input);
    const restored = await new DealerIntegrationsStore({ filename: join(dir, 'private.json'), production: false }).readSalesPaperwork();
    assert.equal(restored.saleTerms, 'CUSTOM TERMS');
    assert.equal(restored.invoiceDetails.name, input.invoiceDetails.name);
    await assert.rejects(store.updateSalesPaperwork(input), /changed/);
    await assert.rejects(store.updateSalesPaperwork({ ...input, expectedRevision: restored.revision, invoiceDetails: { email: 'invalid' } }));
    await assert.rejects(store.updateSalesPaperwork({ ...input, expectedRevision: restored.revision, invoiceDetails: { name: 'bad\nname' } }));
    // Older clients editing terms keep invoice overrides, including intentionally blank fields.
    await store.updateSalesPaperwork({ expectedRevision: restored.revision, saleTerms: '', reservationTerms: 'REVISED' });
    const legacy = await store.readSalesPaperwork();
    assert.equal(legacy.saleTerms, '');
    assert.equal(legacy.invoiceDetails.name, input.invoiceDetails.name);
    assert.equal(legacy.invoiceDetails.vatNumber, '');
  } finally { await rm(dir, { recursive: true, force: true }); }
});
