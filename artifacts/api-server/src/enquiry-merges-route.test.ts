import assert from 'node:assert/strict';
import test from 'node:test';
import type { Request, Response } from 'express';
import { getTableColumns } from 'drizzle-orm';

// An in-memory driver is the only possible database connection in this suite.
process.env.DATABASE_URL = 'postgres://unused:unused@127.0.0.1:1/unused';
process.env.STOCK_DEALER_ID = 'synthetic-merge-dealer';
const { pool, enquiriesTable } = await import('@workspace/db');
const { default: router } = await import('./routes/enquiry-merges');
const a = '00000000-0000-4000-8000-000000000001', b = '00000000-0000-4000-8000-000000000002';
const at = '2026-10-05T10:00:00.000Z';
const original = (id: string) => ({ id, dealerId: 'synthetic-merge-dealer', customerName: 'Synthetic customer', phone: '07700900123', email: 'customer@example.test', message: `Original ${id}`, vehicleId: null, vehicleTitle: 'Synthetic car', vehicleUrl: null, createdAt: at, updatedAt: at, mergedIntoId: null, mergedAt: null, mergedBy: null, workspaceRevision: 0, appointmentRevision: 0, followUpRevision: 0, appointmentAt: at, appointmentCancelledAt: null, appointmentDurationMinutes: 30, appointmentBufferMinutes: 0 });
const input = { recordIds: [a, b], expectedRevisions: [a, b].map(id => ({ id, workspaceRevision: 0, appointmentRevision: 0, followUpRevision: 0 })), keepAppointmentIds: [a], reason: 'Duplicate booking from the same customer', confirmDifferentCustomers: false, allowOverlappingAppointments: false };
async function request(body: unknown, role?: 'owner' | 'accounts', path = `/staff/enquiries/${a}/merge`) {
  return new Promise<{ status: number; data: any }>((resolve, reject) => {
    let status = 200;
    const signedOut = Object.assign(() => ({ userId: null, sessionId: null, tokenType: 'session_token' }), { [Symbol.for('@clerk/express.auth')]: true });
    const req = { method: 'POST', url: path, headers: {}, body, auth: signedOut, get: () => undefined, log: { error: () => {}, warn: () => {} }, ...(role ? { staff: { authUserId: 'synthetic-staff', name: 'Synthetic Staff', email: null, role } } : {}) } as unknown as Request;
    const res = { status(value: number) { status = value; return this; }, json(data: unknown) { resolve({ status, data }); return this; } } as unknown as Response;
    router(req, res, error => error ? reject(error) : reject(new Error('Merge route did not respond')));
  });
}

test('production boundary authorises before database work, locks scoped records, and commits membership with audit or rolls back everything', async () => {
  const originalConnect = pool.connect, originalQuery = pool.query;
  let rows: Array<Record<string, unknown>> = [original(a), original(b)], backup: typeof rows = [], events: unknown[][] = [], savedEvents: unknown[][] = [];
  let connections = 0, failEvent = false;
  const calls: string[] = [];
  const columns = Object.entries(getTableColumns(enquiriesTable));
  (pool as any).query = async () => { throw new Error('A real pool query is forbidden in this synthetic suite.'); };
  (pool as any).connect = async () => {
    connections++;
    return { release() {}, async query(config: string | { text: string }, params: unknown[] = []) {
      const text = typeof config === 'string' ? config : config.text; calls.push(text);
      if (/^begin/i.test(text)) { backup = structuredClone(rows); savedEvents = structuredClone(events); return { rows: [] }; }
      if (/^rollback/i.test(text)) { rows = backup; events = savedEvents; return { rows: [] }; }
      if (/^commit/i.test(text) || /pg_advisory_xact_lock/.test(text)) return { rows: [] };
      if (/^select/i.test(text)) {
        assert.match(text, /"enquiries"\."dealer_id" = \$\d+/); assert.ok(params.includes('synthetic-merge-dealer')); assert.match(text, /for update/i);
        assert.match(text, /"merged_into_id" in/i);
        return { rows: rows.map(record => columns.map(([key]) => record[key] ?? null)) };
      }
      if (/^update "enquiries"/i.test(text)) {
        assert.match(text, /"dealer_id" = \$\d+/);
        const id = params.at(-1), record = rows.find(record => record.id === id)!;
        assert.ok(record, 'update targets an original fixture row');
        const updates = text.slice(text.indexOf(' set ') + 5, text.indexOf(' where '));
        for (const match of updates.matchAll(/"([^" ]+)" = \$(\d+)/g)) {
          const key = columns.find(([, column]) => column.name === match[1])?.[0]; assert.ok(key); record[key] = params[Number(match[2]) - 1];
        }
        return { rows: [], rowCount: 1 };
      }
      if (/^insert into "enquiry_events"/i.test(text)) {
        if (failEvent) throw new Error('Synthetic event insert failure');
        const details = params.filter(value => typeof value === 'string' && value.startsWith('{')).map(value => JSON.parse(value as string));
        assert.equal(details.length, 2); assert.deepEqual(details[0].recordIds, [a, b]); assert.deepEqual(details[0].cancelledAppointmentIds, [b]); assert.equal(details[0].staffId, 'synthetic-staff'); assert.equal(details[0].note, input.reason);
        events.push(params); return { rows: [] };
      }
      throw new Error(`Unexpected synthetic driver query: ${text}`);
    } };
  };
  try {
    assert.equal((await request(input)).status, 401); assert.equal((await request(input, 'accounts')).status, 403);
    assert.equal((await request({}, 'owner')).status, 400); assert.equal((await request(input, 'owner', '/staff/enquiries/bad-id/merge')).status, 400); assert.equal(connections, 0);
    failEvent = true;
    assert.equal((await request(input, 'owner')).status, 500); assert.deepEqual(rows, [original(a), original(b)]); assert.equal(events.length, 0); assert.ok(calls.some(call => /^rollback/i.test(call)));
    failEvent = false;
    const merged = await request(input, 'owner'); assert.equal(merged.status, 200); assert.deepEqual(merged.data, { primaryId: a, recordIds: [a, b], cancelledAppointmentIds: [b] });
    assert.equal(rows[0].mergedIntoId, null); assert.equal(rows[1].mergedIntoId, a); assert.equal(rows[0].workspaceRevision, 1); assert.equal(rows[1].workspaceRevision, 1); assert.ok(rows[1].appointmentCancelledAt); assert.equal(rows[1].appointmentRevision, 1);
    assert.equal(rows[1].message, original(b).message); assert.equal(events.length, 1);
    const before = structuredClone(rows);
    assert.equal((await request(input, 'owner')).status, 409); assert.deepEqual(rows, before); assert.equal(events.length, 1);
  } finally { pool.connect = originalConnect; pool.query = originalQuery; await pool.end(); }
});
