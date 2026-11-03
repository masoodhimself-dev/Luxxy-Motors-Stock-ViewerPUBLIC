import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { createSaleWorkspace, saleWorkspaceTotals, type SaleWorkspaceRecord } from '@workspace/vehicle-meta';
import { completeSaleReturnInspection } from './lib/sale-return-inspection';

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));
async function fixture() {
  const engine = new PGlite(), dealer = 'inspection-fixture', car = randomUUID(), replacement = randomUUID(), linked = randomUUID(), enquiry = randomUUID(), unrelated = randomUUID();
  await engine.exec(`CREATE TABLE sale_workspace(id uuid PRIMARY KEY,dealer_id text,revision integer,state jsonb,updated_at timestamptz);
    CREATE TABLE vehicles(id uuid PRIMARY KEY,dealer_id text,inventory_status text,source_status text,missing_count integer DEFAULT 0,archived_at timestamptz,retirement_started_at timestamptz,audit_metadata jsonb,updated_at timestamptz);
    CREATE TABLE leads(id uuid PRIMARY KEY,dealer_id text,vehicle_id uuid,enquiry_id uuid,stage text,outcome text,outcome_reason text,closed_at timestamptz,next_action text,next_action_due_at timestamptz,updated_at timestamptz,
      CHECK ((stage IN ('won','lost') AND outcome=stage AND length(btrim(outcome_reason))>0 AND closed_at IS NOT NULL) OR (stage NOT IN ('won','lost') AND outcome IS NULL AND outcome_reason IS NULL AND closed_at IS NULL)));
    CREATE TABLE lead_events(id uuid PRIMARY KEY,lead_id uuid REFERENCES leads(id),type text,actor_type text,actor text,body text,payload jsonb,occurred_at timestamptz);
    CREATE TABLE sold_vehicle_follow_ups(id uuid PRIMARY KEY,dealer_id text,sale_id uuid,vehicle_id uuid,status text,outcome text,note text,revision integer DEFAULT 0,updated_by text,updated_at timestamptz,contacted_at timestamptz,email_id uuid);
    CREATE TABLE enquiries(id uuid PRIMARY KEY,dealer_id text,appointment_cancelled_at timestamptz,attendance text);`);
  const branding = { identity: { name: 'Fixture Motors', logoText: 'FIXTURE', logoAsset: '' }, contact: { phone: '', email: '' }, address: { street: '', city: '', region: '', postcode: '' }, legal: { companyName: '', companyNumber: '', vatNumber: '' } };
  const sale = createSaleWorkspace({ requestId: randomUUID(), draft: { customer: 'Fictional Buyer', vehicleId: car, vehicle: 'Fictional estate', registration: 'AB20 XYZ', price: '10000', sourceReservationId: linked, sourceEnquiryId: enquiry } }, { now: '2026-11-03T15:00:00Z', actor: 'Fixture', nextId: randomUUID, nextNumber: () => 'TEST', branding }, 'SALE-ORIGINAL').sale;
  sale.payments = [{ id: randomUUID(), amount: '10000', amountPence: 1000000, signedAmountPence: 1000000, method: 'Bank transfer', date: '2026-11-01', reference: 'ORIGINAL-RECEIPT', kind: 'final-payment', status: 'confirmed', recordedAt: '2026-11-01T12:00:00Z', recordedBy: 'Fixture' }];
  sale.documents = [{ id: randomUUID(), number: 'INV-ORIGINAL', type: 'invoice', title: 'Sales invoice', issuedAt: '2026-11-01T12:00:00Z', issuedBy: 'Fixture', version: 1, balanceAtIssue: 0, snapshot: { draft: clone(sale.draft), payments: clone(sale.payments), totals: saleWorkspaceTotals(sale.draft, sale.payments), branding } }];
  sale.documentArchives = { [sale.documents[0].id]: { content: 'ORIGINAL-FROZEN-PDF', sha256: 'ORIGINAL-HASH' } };
  sale.draft.returnCreditPence = 1000000; sale.draft.creditEntries = [{ id: randomUUID(), sourceSaleId: replacement, reference: 'SALE-REPLACEMENT', signedAmountPence: -1000000, at: '2026-11-03T15:00:00Z' }];
  sale.lifecycle = { status: 'returned', vehicleId: car, changedAt: '2026-11-03T15:00:00Z' }; sale.completedAt = '2026-11-01T12:00:00Z';
  sale.returnReplacement = { direction: 'returned', transferId: randomUUID(), otherSaleId: replacement, otherReference: 'SALE-REPLACEMENT', creditPence: 1000000, reason: 'Customer changed vehicle', condition: 'No new damage', mileage: 45100, at: '2026-11-03T15:00:00Z', actor: 'Fixture' };
  await engine.query('INSERT INTO sale_workspace VALUES($1,$2,$3,$4::jsonb,now())', [sale.id, dealer, sale.revision, JSON.stringify(sale)]);
  await engine.query("INSERT INTO vehicles(id,dealer_id,inventory_status,source_status,missing_count,archived_at,audit_metadata,updated_at) VALUES($1,$2,'hidden','live',0,NULL,$3::jsonb,now())", [car, dealer, JSON.stringify({ returnInspectionPending: true, returnedFromSaleId: sale.id, saleWorkspaceId: null, saleWorkspaceStatus: 'returned', preserved: 'stock-history' })]);
  await engine.query("INSERT INTO leads(id,dealer_id,vehicle_id,enquiry_id,stage) VALUES($1,$2,$3,$4,'collected'),($5,$2,$3,NULL,'qualifying')", [linked, dealer, car, enquiry, unrelated]);
  await engine.query("INSERT INTO sold_vehicle_follow_ups(id,dealer_id,sale_id,vehicle_id,status,note) VALUES($1,$2,$3,$4,'pending','Previous staff note'),($5,$2,$3,$4,'contacted','Already handled'),($6,$2,$7,$4,'pending','Different sale')", [randomUUID(), dealer, sale.id, car, randomUUID(), randomUUID(), replacement]);
  await engine.query("INSERT INTO enquiries VALUES($1,$2,'2026-11-01T12:00:00Z','no_show')", [enquiry, dealer]);
  let fail = false;
  const query = async (sql: string, params?: any[]) => {
    if (sql.startsWith('SELECT pg_advisory')) return { rows: [] };
    if (fail && sql.startsWith('UPDATE sold_vehicle_follow_ups')) throw new Error('Fixture write failure');
    return engine.query<Record<string, any>>(sql, params);
  };
  const database = { query, connect: async () => ({ query, release() {} }) };
  const state = async () => (await engine.query<{ state: SaleWorkspaceRecord }>('SELECT state FROM sale_workspace WHERE id=$1', [sale.id])).rows[0].state;
  const snapshot = async () => JSON.stringify({ sale: await state(), cars: (await engine.query('SELECT * FROM vehicles ORDER BY id')).rows, leads: (await engine.query('SELECT * FROM leads ORDER BY id')).rows, followups: (await engine.query('SELECT * FROM sold_vehicle_follow_ups ORDER BY id')).rows, enquiries: (await engine.query('SELECT * FROM enquiries ORDER BY id')).rows, events: (await engine.query('SELECT * FROM lead_events ORDER BY id')).rows });
  const input = () => ({ expectedRevision: sale.revision, requestId: randomUUID(), confirm: true, note: 'Condition, keys and paperwork checked; ready to advertise.' });
  return { engine, database, dealer, sale, car, linked, unrelated, state, snapshot, input, failWrite() { fail = true; }, close: () => engine.close() };
}

test('inspection makes only the inspected return available and retains original papers, money and customer history', async () => {
  const f = await fixture(); try {
    const before = clone(f.sale), oldAppointments = (await f.engine.query('SELECT * FROM enquiries')).rows;
    const result = await completeSaleReturnInspection(f.database, f.dealer, f.sale.id, f.input(), 'Inspector');
    assert.equal(result.sale.lifecycle?.status, 'returned'); assert.equal(result.sale.revision, before.revision + 1);
    assert.equal(result.sale.returnInspection?.actor, 'Inspector'); assert.deepEqual(result.sale.documents, before.documents); assert.deepEqual(result.sale.payments, before.payments); assert.deepEqual(result.sale.draft, before.draft);
    assert.deepEqual((await f.state()).documentArchives, before.documentArchives);
    const car = (await f.engine.query<any>('SELECT * FROM vehicles WHERE id=$1', [f.car])).rows[0];
    assert.equal(car.inventory_status, 'available'); assert.equal(car.audit_metadata.returnInspectionPending, false); assert.equal(car.audit_metadata.returnedFromSaleId, before.id); assert.equal(car.audit_metadata.preserved, 'stock-history');
    const leads = (await f.engine.query<any>('SELECT * FROM leads ORDER BY id')).rows;
    assert.equal(leads.find((row: any) => row.id === f.linked).stage, 'lost'); assert.equal(leads.find((row: any) => row.id === f.linked).outcome, 'lost'); assert.equal(leads.find((row: any) => row.id === f.unrelated).stage, 'qualifying');
    const followups = (await f.engine.query<any>('SELECT * FROM sold_vehicle_follow_ups')).rows;
    assert.equal(followups.find((row: any) => row.sale_id === before.id && row.note.startsWith('Previous')).status, 'not_needed'); assert.equal(followups.find((row: any) => row.note === 'Already handled').status, 'contacted'); assert.equal(followups.find((row: any) => row.note === 'Different sale').status, 'pending');
    assert.deepEqual((await f.engine.query('SELECT * FROM enquiries')).rows, oldAppointments); assert.equal((await f.engine.query('SELECT * FROM lead_events')).rows.length, 1);
  } finally { await f.close(); }
});

test('explicit inspection restores only the trusted sold-retention archive and preserves its original audit and documents', async () => {
  const f = await fixture(); try {
    const retentionArchive = { reason: 'sold', archivedAt: '2026-10-31T12:30:00.000Z', originalInventoryStatus: 'sold' };
    await f.engine.query('UPDATE vehicles SET archived_at=$2,retirement_started_at=$3,audit_metadata=audit_metadata||$4::jsonb WHERE id=$1', [f.car, retentionArchive.archivedAt, '2026-10-01T12:30:00.000Z', JSON.stringify({ retentionArchive })]);
    const before = clone(await f.state()), input = f.input();
    const result = await completeSaleReturnInspection(f.database, f.dealer, f.sale.id, input, 'Inspector');
    const car = (await f.engine.query<any>('SELECT * FROM vehicles WHERE id=$1', [f.car])).rows[0];
    assert.equal(car.inventory_status, 'available'); assert.equal(car.archived_at, null); assert.equal(car.retirement_started_at, null);
    assert.deepEqual(car.audit_metadata.retentionArchive, retentionArchive); assert.equal(car.audit_metadata.preserved, 'stock-history');
    assert.deepEqual(car.audit_metadata.returnListingRestored, { at: result.sale.returnInspection?.at, actor: 'Inspector' });
    assert.equal(result.sale.lifecycle?.status, 'returned'); assert.deepEqual(result.sale.documents, before.documents); assert.deepEqual(result.sale.payments, before.payments); assert.deepEqual(result.sale.draft, before.draft); assert.deepEqual((await f.state()).documentArchives, before.documentArchives);
    const saved = await f.snapshot(); assert.equal((await completeSaleReturnInspection(f.database, f.dealer, f.sale.id, input, 'Inspector')).replayed, true); assert.equal(await f.snapshot(), saved);
  } finally { await f.close(); }
});

test('inspection retries are exact and do not write again; changed payload or stale revision is rejected', async () => {
  const f = await fixture(); try {
    const input = f.input(); await completeSaleReturnInspection(f.database, f.dealer, f.sale.id, input, 'Inspector'); const snapshot = await f.snapshot();
    assert.equal((await completeSaleReturnInspection(f.database, f.dealer, f.sale.id, input, 'Inspector')).replayed, true); assert.equal(await f.snapshot(), snapshot);
    await assert.rejects(completeSaleReturnInspection(f.database, f.dealer, f.sale.id, { ...input, note: 'Changed note' }, 'Inspector'), /different inspection details/);
    await assert.rejects(completeSaleReturnInspection(f.database, f.dealer, f.sale.id, { ...input, requestId: randomUUID() }, 'Inspector'), /changed/); assert.equal(await f.snapshot(), snapshot);
  } finally { await f.close(); }
});

test('an inspection write failure rolls back stock, lead closure, follow-ups and the recorded attestation', async () => {
  const f = await fixture(); try { const before = await f.snapshot(); f.failWrite(); await assert.rejects(completeSaleReturnInspection(f.database, f.dealer, f.sale.id, f.input(), 'Inspector'), /Fixture write failure/); assert.equal(await f.snapshot(), before); } finally { await f.close(); }
});

test('wrong tenant, conflicting reservation, source disappearance and changed ownership fail closed', async () => {
  for (const scenario of ['tenant', 'lead', 'source', 'missing', 'owner', 'pending', 'archive', 'inventory', 'archive-old-marker', 'archive-missing-feed', 'archive-changed-owner', 'archive-other-dealer', 'archive-competing-sale', 'archive-wrong-reason', 'archive-wrong-inventory'] as const) {
    const f = await fixture(); try {
      if (scenario === 'lead') await f.engine.query("UPDATE leads SET stage='reserved' WHERE id=$1", [f.unrelated]);
      if (scenario === 'source') await f.engine.query("UPDATE vehicles SET source_status='missing' WHERE id=$1", [f.car]);
      if (scenario === 'missing') await f.engine.query('UPDATE vehicles SET missing_count=1 WHERE id=$1', [f.car]);
      if (scenario === 'owner') await f.engine.query("UPDATE vehicles SET audit_metadata=audit_metadata||$2::jsonb WHERE id=$1", [f.car, JSON.stringify({ saleWorkspaceId: randomUUID() })]);
      if (scenario === 'pending') await f.engine.query("UPDATE vehicles SET audit_metadata=audit_metadata||'{\"returnInspectionPending\":false}'::jsonb WHERE id=$1", [f.car]);
      if (scenario === 'archive') await f.engine.query('UPDATE vehicles SET archived_at=now() WHERE id=$1', [f.car]);
      if (scenario === 'inventory') await f.engine.query("UPDATE vehicles SET inventory_status='sold' WHERE id=$1", [f.car]);
      if (scenario.startsWith('archive-')) {
        const retentionArchive = { reason: scenario === 'archive-wrong-reason' ? 'missing' : 'sold', archivedAt: '2026-10-31T12:30:00.000Z', originalInventoryStatus: scenario === 'archive-wrong-inventory' ? 'available' : 'sold' };
        await f.engine.query('UPDATE vehicles SET archived_at=$2,retirement_started_at=$3,audit_metadata=audit_metadata||$4::jsonb WHERE id=$1', [f.car, scenario === 'archive-old-marker' ? '2026-11-01T12:30:00.000Z' : retentionArchive.archivedAt, '2026-10-01T12:30:00.000Z', JSON.stringify({ retentionArchive, ...(scenario === 'archive-changed-owner' ? { saleWorkspaceId: randomUUID() } : {}) })]);
        if (scenario === 'archive-missing-feed') await f.engine.query("UPDATE vehicles SET source_status='missing' WHERE id=$1", [f.car]);
        if (scenario === 'archive-other-dealer') await f.engine.query("UPDATE vehicles SET dealer_id='different-dealer' WHERE id=$1", [f.car]);
        if (scenario === 'archive-competing-sale') { const other = { ...clone(f.sale), id: randomUUID(), lifecycle: { ...f.sale.lifecycle, status: 'reserved' } }; await f.engine.query('INSERT INTO sale_workspace VALUES($1,$2,$3,$4::jsonb,now())', [other.id, f.dealer, other.revision, JSON.stringify(other)]); }
      }
      const before = await f.snapshot(); await assert.rejects(completeSaleReturnInspection(f.database, scenario === 'tenant' ? 'different-dealer' : f.dealer, f.sale.id, f.input(), 'Inspector')); assert.equal(await f.snapshot(), before, scenario);
    } finally { await f.close(); }
  }
});

test('inspection requires explicit confirmation and a bounded note before any transaction', async () => {
  const f = await fixture(); try { const before = await f.snapshot(); for (const patch of [{ confirm: false }, { note: '' }, { note: 'x'.repeat(1201) }, { expectedRevision: -1 }, { requestId: 'bad-id' }]) await assert.rejects(completeSaleReturnInspection(f.database, f.dealer, f.sale.id, { ...f.input(), ...patch }, 'Inspector')); assert.equal(await f.snapshot(), before); } finally { await f.close(); }
});
