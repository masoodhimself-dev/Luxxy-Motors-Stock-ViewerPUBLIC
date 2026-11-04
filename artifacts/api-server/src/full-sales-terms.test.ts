import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { applicableSalesTerms, isConfirmedCategoryS, normaliseFullSalesTerms, saleWorkspaceBranding, salesTermsReviewPoints, type SalesTermsSnapshot } from '@workspace/vehicle-meta';
import { renderFullSalesTerms } from '@workspace/vehicle-meta/full-sales-terms-pdf';
import { FullSalesTermsStore } from './lib/full-sales-terms-store';
import { readSaleReviewContext } from './lib/sale-review-context';
import { shoreDriveTermsDraft } from './lib/shore-drive-terms-draft';
const content = { title: 'Sale terms', sections: [{ heading: 'Our agreement', paragraphs: ['The agreed vehicle and price are recorded on the invoice.'], condition: 'all' as const }, { heading: 'Category S', paragraphs: ['The vehicle has a confirmed Category S record.'], condition: 'category-s' as const }] };
test('full terms validate boundaries, retain exact supplied wording and filter only confirmed Category S', () => {
  assert.deepEqual(normaliseFullSalesTerms(content), content);
  assert.throws(() => normaliseFullSalesTerms({ ...content, sections: [{ ...content.sections[0], paragraphs: ['x'.repeat(6001)] }] }), /6,000/);
  assert.throws(() => normaliseFullSalesTerms({ ...content, sections: [{ ...content.sections[0], paragraphs: ['x\u0000'] }] }), /control/);
  assert.throws(() => normaliseFullSalesTerms({ ...content, sections: [{ ...content.sections[0], condition: 'probably-s' }] }), /when/);
  for (const cat of ['S', 'Category S', 'cat s', 'CAT-S']) assert.equal(isConfirmedCategoryS(cat), true);
  for (const cat of [undefined, '', 'N', 'HPI clear; previous CAT S', 'not S']) assert.equal(isConfirmedCategoryS(cat), false);
  assert.equal(applicableSalesTerms(content, 'S').length, 2); assert.equal(applicableSalesTerms(content, undefined).length, 1);
  const copy = applicableSalesTerms(content, 'S'); copy[0].paragraphs[0] = 'Changed'; assert.notEqual(copy[0].paragraphs[0], content.sections[0].paragraphs[0]);
  assert.match(shoreDriveTermsDraft.sections[0].paragraphs[0], /Seventy percent/);
  assert.match(shoreDriveTermsDraft.sections.find(s => s.heading === 'Warranties')!.paragraphs[0], /15  month warranty/);
  assert.ok(salesTermsReviewPoints(shoreDriveTermsDraft, '6 month warranty').some(p => p.includes('settings mention 6')));
});
test('PDF repeats copy labels/version and correct per-copy page counts, keeps every supplied section and signatures', () => {
  const snapshot: SalesTermsSnapshot = { rendererVersion: 'classic-ledger-terms-v1', dealerId: 'fixture', saleId: randomUUID(), saleReference: 'INV-2026-001', saleRevision: 4, termsVersionId: randomUUID(), termsVersion: 2, title: shoreDriveTermsDraft.title, sections: applicableSalesTerms(shoreDriveTermsDraft, 'S'), customer: 'Example Buyer', customerAddress: '1 Example Road', vehicle: 'Example Hatchback', registration: 'AB12 CDE', category: 'S', branding: saleWorkspaceBranding({ identity: { name: 'Shore Drive' } }), issuedAt: '2026-11-03T12:00:00.000Z', issuedBy: 'Example Staff' };
  const dealer = renderFullSalesTerms(snapshot, 'dealer'), both = renderFullSalesTerms(snapshot, 'both');
  assert.ok(dealer.copyPages.length >= 2); assert.equal(both.copyPages.length, dealer.copyPages.length * 2);
  assert.deepEqual(both.copyPages.map(p => p.number), [...dealer.copyPages.map(p => p.number), ...dealer.copyPages.map(p => p.number)]);
  for (const p of both.copyPages) {
    const lines = both.events.filter(e => e.page === p.page).map(e => e.text);
    assert.ok(lines.includes(p.label)); assert.ok(lines.includes('Terms version 2')); assert.ok(lines.includes(`${p.label} | Page ${p.number} of ${p.total}`));
  }
  for (const section of snapshot.sections) assert.ok(both.events.filter(e => e.text === section.heading).length >= 2);
  assert.equal(both.events.filter(e => e.text === 'Customer signature').length, 2);
  assert.ok(both.events.every(e => e.y >= 10 && e.y + e.height < 290));
  assert.throws(() => renderFullSalesTerms({ ...snapshot, title: 'Unsupported 🚗' }), /unsupported/);
});
test('tenant draft, explicit publication, issue snapshots and retries preserve historic documents and real sale state', async () => {
  const engine = new PGlite();
  try {
    await engine.exec('CREATE TABLE dealer_settings(dealer_id text primary key,config jsonb); CREATE TABLE sale_workspace(id uuid primary key,dealer_id text,state jsonb); CREATE TABLE vehicles(id uuid primary key,dealer_id text,write_off_category text);');
    await engine.exec(await readFile('../../lib/db/drizzle/0082_sales_terms.sql', 'utf8'));
    const database = { async query(sql: string, values: any[] = []) { if (sql.includes('pg_advisory_xact_lock')) return { rows: [] }; return engine.query<Record<string, any>>(sql, values); }, async connect() { return { query: database.query, release() {} }; } };
    const shore = new FullSalesTermsStore(database, 'shore-drive-limited', 'https://shore.example.test'), other = new FullSalesTermsStore(database, 'other', 'https://other.example.test');
    assert.equal((await shore.settings()).suppliedDraft, true); assert.equal((await shore.settings()).published, null); assert.deepEqual((await other.settings()).draft.sections, []);
    assert.equal((await engine.query('SELECT * FROM dealer_sales_terms')).rows.length, 0, 'Reading a supplied review draft cannot apply it');
    await assert.rejects(shore.publish(0, 'Owner'), /Save the current draft/);
    await assert.rejects(shore.preview(content, '', 'Owner'), /dealership name/);
    const saved = await shore.save(0, content, 'Owner'); assert.equal(saved.revision, 1); assert.equal(saved.published, null);
    await assert.rejects(shore.save(0, content, 'Owner'), /changed/);
    const published = await shore.publish(1, 'Owner'); assert.equal(published.published?.version, 1);
    assert.equal((await shore.publish(published.revision, 'Owner')).revision, published.revision, 'Re-publishing identical text does not create another version');
    const saleId = randomUUID(), vehicleId = randomUUID(), requestId = randomUUID();
    const sale = { id: saleId, reference: 'INV-001', revision: 3, finalReview: { id: randomUUID(), status: 'passed', reviewedRevision: 3, summary: 'Saved sale checked.', issues: [], checkedAt: '2026-11-03T12:00:00.000Z' }, draft: { customer: 'Example Buyer', address: '1 Example Road', vehicle: 'Example Hatchback', registration: 'AB12 CDE', vehicleId }, payments: [{ id: 'preserve-payment' }], documents: [{ id: 'preserve-issued-invoice' }] };
    await database.query('INSERT INTO dealer_settings VALUES($1,$2)', ['shore-drive-limited', { identity: { name: 'Shore Drive' } }]);
    await database.query('INSERT INTO sale_workspace VALUES($1,$2,$3)', [saleId, 'shore-drive-limited', sale]);
    await database.query('INSERT INTO vehicles VALUES($1,$2,$3)', [vehicleId, 'shore-drive-limited', 'S']);
    const input = { requestId, expectedSaleRevision: 3, termsVersionId: published.published!.id };
    // Historical unavailable/stale AI checks never prevent issuing current, valid terms.
    Object.assign(sale.finalReview, { status: 'unavailable', reviewedRevision: 1 });
    await database.query('UPDATE sale_workspace SET state=$2 WHERE id=$1', [saleId, sale]);
    const issued = await shore.issue(saleId, input, 'Salesperson'); assert.equal(issued.snapshot.sections.length, 2);
    assert.equal((await shore.issue(saleId, input, 'Salesperson')).replayed, true);
    await assert.rejects(shore.issue(saleId, { ...input, expectedSaleRevision: 4 }, 'Salesperson'), /already used/);
    await assert.rejects(other.issue(saleId, { ...input, requestId: randomUUID() }, 'Salesperson'), /not found/);
    await assert.rejects(other.pdf(saleId, issued.id, 'both'), /not found/);
    const oldPdf = await shore.pdf(saleId, issued.id, 'both');
    const updated = await shore.save(published.revision, { ...content, title: 'Revised terms' }, 'Owner'); await shore.publish(updated.revision, 'Owner');
    const preserved = await shore.pdf(saleId, issued.id, 'both'); assert.equal(preserved.bytes.toString('base64'), oldPdf.bytes.toString('base64')); assert.equal(preserved.snapshot.title, 'Sale terms');
    assert.deepEqual(((await database.query('SELECT state FROM sale_workspace WHERE id=$1', [saleId])).rows[0] as { state: unknown }).state, sale);
    assert.equal((await shore.list(saleId)).length, 1);
    const unknownCatId = randomUUID(); await database.query('INSERT INTO sale_workspace VALUES($1,$2,$3)', [unknownCatId, 'shore-drive-limited', { ...sale, id: unknownCatId, draft: { ...sale.draft, vehicleId: '' } }]);
    const genericSale = { ...sale, id: unknownCatId, draft: { ...sale.draft, vehicleId: '' }, finalReview: {...sale.finalReview} };
    Object.assign(genericSale.finalReview, {contextHash: (await readSaleReviewContext(database, 'shore-drive-limited', genericSale as any)).hash});
    await database.query('UPDATE sale_workspace SET state=$2 WHERE id=$1', [unknownCatId, genericSale]);
    const latest = await shore.settings(), generic = await shore.issue(unknownCatId, { requestId: randomUUID(), expectedSaleRevision: 3, termsVersionId: latest.published!.id }, 'Salesperson'); assert.equal(generic.snapshot.sections.length, 1);
  } finally { await engine.close(); }
});
