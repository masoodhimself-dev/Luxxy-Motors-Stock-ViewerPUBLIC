import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { dailySalePaymentsOptions } from '@workspace/vehicle-meta';
import { readDailySalePayments } from './lib/sale-daily-payments';

test('daily payment query scopes by dealer and date, separates pending and reconciles every page', async () => {
  const database = new PGlite();
  try {
    await database.exec('CREATE TABLE sale_workspace (id uuid PRIMARY KEY, dealer_id text, reference text, state jsonb)');
    const payment = (id: string, kind: string, signedAmountPence: number, options: Record<string, unknown> = {}) => ({
      id, kind, signedAmountPence, status: 'confirmed', date: '2026-11-08', recordedAt: '2026-11-08T12:00:00Z',
      method: 'Bank transfer', reference: `TEST-${id}`, ...options,
    });
    const sale = async (dealerId: string, payments: object[]) => database.query('INSERT INTO sale_workspace VALUES ($1,$2,$3,$4)', [
      randomUUID(), dealerId, `SALE-${dealerId}`, JSON.stringify({ draft: { vehicle: 'Fixture car', registration: 'AB20XYZ', email: 'private@example.test' }, payments }),
    ]);
    await sale('dealer-a', [
      ...Array.from({ length: 26 }, (_, i) => payment(`deposit-${i}`, 'deposit', 10000)),
      payment('refund', 'refund', -2500, { method: 'Debit card' }),
      payment('reversal', 'reversal', -2000),
      payment('pending', 'part-payment', 50000, { status: 'pending', date: '2026-11-07', expectedDate: '2026-11-08' }),
      payment('prior-day', 'deposit', 90000, { date: '2026-11-07' }),
      payment('cancelled', 'deposit', 90000, { status: 'cancelled' }),
    ]);
    await sale('dealer-b', [payment('other-dealer', 'deposit', 90000)]);
    const first = await readDailySalePayments(database, 'dealer-a', dailySalePaymentsOptions('2026-11-08', undefined, undefined));
    assert.equal(first.confirmed.length, 25);
    assert.equal(first.confirmedHasMore, true);
    assert.deepEqual(first.totals, { receivedPence: 260000, refundsPence: 2500, adjustmentsPence: -2000, adjustmentCount: 1, pendingPence: 50000, confirmedCount: 28, pendingCount: 1 });
    assert.deepEqual(first.methods, [{ method: 'Bank transfer', receivedPence: 260000, refundsPence: 0 }, { method: 'Debit card', receivedPence: 0, refundsPence: 2500 }]);
    assert.deepEqual(first.pending.map(row => row.reference), ['TEST-pending']);
    assert.ok(first.confirmed.every(row => row.saleReference === 'SALE-dealer-a'));
    assert.ok(!JSON.stringify(first).includes('private@example.test'));
    const next = await readDailySalePayments(database, 'dealer-a', dailySalePaymentsOptions('2026-11-08', '25', undefined));
    assert.equal(next.confirmed.length, 3);
    assert.equal(next.confirmedHasMore, false);
    assert.deepEqual(next.pending, first.pending);
    assert.deepEqual(next.totals, first.totals);
    assert.ok(next.confirmed.every(row => !first.confirmed.some(existing => existing.id === row.id)));
    assert.throws(() => dailySalePaymentsOptions('2026-02-30', undefined, undefined), /valid payment date/);
    assert.throws(() => dailySalePaymentsOptions('2026-11-08', '-1', undefined), /valid payments page/);
  } finally {
    await database.close();
  }
});
