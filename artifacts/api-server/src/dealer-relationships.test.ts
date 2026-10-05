import assert from 'node:assert/strict';
import { test } from 'node:test';
import express from 'express';
import pino from 'pino';
import { buildDealerRelationships, type DealerRelationshipSources, type RelationshipEnquirySource, type RelationshipReservationSource, type RelationshipSaleSource } from '@workspace/vehicle-meta';
import { readDealerRelationships, relationshipQueries } from './lib/dealer-relationships';

const at = '2026-10-05T10:00:00.000Z';
const enquiry = (id: string, extra: Partial<RelationshipEnquirySource> = {}): RelationshipEnquirySource => ({
  id, reference: `ENQ-${id}`, customerName: 'Amelia Clarke', email: 'amelia@example.com', phone: '07700 900123',
  vehicleId: 'car-a', vehicleTitle: 'Ford Fiesta', vehicleRegistration: 'AB12 CDE', vehiclePrice: 5000,
  message: 'Interested in this car.', type: 'general', status: 'contacted', createdAt: at, updatedAt: at, ...extra,
});
const reservation = (id: string, extra: Partial<RelationshipReservationSource> = {}): RelationshipReservationSource => ({
  id, reference: `RSV-${id}`, vehicleId: 'car-a', vehicleTitle: 'Ford Fiesta', customerName: 'Amelia Clarke',
  email: 'amelia@example.com', phone: '+44 7700 900123', expectedPricePence: 500000, depositPence: 10000,
  amountReceivedPence: 0, paymentStatus: 'simulated', status: 'reserved', createdAt: at, ...extra,
});
const sale = (id: string, extra: Partial<RelationshipSaleSource> = {}): RelationshipSaleSource => ({
  id, reference: `SALE-${id}`, createdAt: at, updatedAt: at, lifecycle: { status: 'sold', changedAt: at },
  draft: { customer: 'Amelia Clarke', email: 'amelia@example.com', phone: '07700900123', vehicleId: 'car-a',
    vehicle: 'Ford Fiesta', registration: 'AB12 CDE', price: '5000.00', notes: 'Customer asked about collection.' },
  payments: [], documents: [], events: [], ...extra,
});
const sources = (extra: Partial<DealerRelationshipSources> = {}): DealerRelationshipSources => ({
  generatedAt: at, vehicles: [{ id: 'car-a', title: 'Ford Fiesta', registration: 'AB12 CDE', pricePence: 500000, status: 'available' }],
  enquiries: [], reservations: [], sales: [], ...extra,
});

test('exact contacts connect a customer across interested cars and count records once', () => {
  const input = sources({ enquiries: [enquiry('a'), enquiry('b', { email: ' AMELIA@EXAMPLE.COM ', phone: '+44 (7700) 900123', vehicleId: 'car-b', vehicleTitle: 'Honda Civic',
    appointmentAt: '2026-10-07T15:00:00Z', appointmentStatus: 'confirmed', followUpAt: '2026-10-06T09:00:00Z', followUpNote: 'Call about service history', staffNote: 'Customer wants a manual.' }), enquiry('a')],
    enquiryEvents: [{ id: 'rescheduled', enquiryId: 'b', vehicleId: 'car-b', kind: 'viewing_rescheduled', summary: 'Customer changed the time.', occurredAt: '2026-10-05T12:00:00Z' }],
    reservations: [reservation('r')], sales: [sale('s', { draft: { ...sale('s').draft, sourceEnquiryId: 'b', sourceReservationId: 'r' } })] });
  const before = JSON.stringify(input), result = buildDealerRelationships(input);
  assert.equal(JSON.stringify(input), before, 'aggregation does not modify data');
  assert.equal(result.customers.length, 1);
  const customer = result.customers[0];
  assert.deepEqual(customer.vehicleIds, ['car-a', 'car-b']);
  assert.deepEqual(customer.recordKeys, ['enquiry:a', 'enquiry:b', 'reservation:r', 'sale:s']);
  assert.deepEqual(customer.counts, { enquiries: 2, appointments: 1, reservations: 1, sales: 1 });
  assert.match(customer.matchingNote, /exact email/);
  assert.equal(result.vehicles.find(v => v.id === 'car-a')?.status, 'sold');
  for (const kind of ['enquiry', 'appointment', 'follow_up', 'reservation', 'sale', 'note']) assert.ok(customer.activities.some(a => a.kind === kind));
  assert.equal(customer.activities.find(a => a.id === 'enquiry:a:received')?.url, '/portal?section=enquiries&enquiryId=a');
});

test('contradictory emails and shared family contact details never bridge unrelated customers', () => {
  const result = buildDealerRelationships(sources({ enquiries: [
    enquiry('a'), enquiry('b', { customerName: 'James Bennett', email: 'james@example.com' }),
    enquiry('c', { customerName: 'Unknown caller', email: null }),
    enquiry('d', { customerName: 'A different person', email: 'amelia@example.com', phone: '07700900456' }),
    enquiry('no-contact-a', { customerName: 'Same name', email: null, phone: null }),
    enquiry('no-contact-b', { customerName: 'Same name', email: null, phone: null }),
  ], sales: [sale('conflict', { draft: { ...sale('conflict').draft, email: 'other@example.com', sourceEnquiryId: 'a' } })] }));
  assert.equal(result.customers.length, 6);
  assert.ok(result.customers.filter(c => !c.recordKeys.includes('enquiry:a')).every(c => c.recordKeys.length === 1));
  const linked = result.customers.find(c => c.recordKeys.includes('enquiry:a'))!;
  assert.deepEqual(linked.recordKeys, ['enquiry:a', 'sale:conflict']);
  assert.match(linked.matchingNote, /Explicit source link has changed email/);
  assert.match(result.customers.find(c => c.recordKeys.includes('enquiry:c'))!.matchingNote, /Shared phone/);
  assert.match(result.customers.find(c => c.recordKeys.includes('enquiry:d'))!.matchingNote, /Shared email/);
});

test('explicit staff merges show one case while preserving source cars, contacts, discussions, bookings and sale links', () => {
  const main = enquiry('main', { phone: '07700900123', message: 'Original main enquiry.' });
  const original = enquiry('original', { mergedIntoId: 'main', customerName: 'Amelia Smith', email: 'changed@example.com', phone: '07700900999',
    vehicleId: 'car-b', vehicleTitle: 'Honda Civic', message: 'Original second car request.', appointmentAt: '2026-10-07T15:00:00Z', appointmentStatus: 'confirmed', followUpAt: '2026-10-06T09:00:00Z', followUpNote: 'Call about the second car.' });
  const input = sources({ enquiries: [original, main], enquiryEvents: [{ id: 'merge-event', enquiryId: original.id, kind: 'records_merged', summary: 'Records merged by Alex', staffName: 'Alex', note: 'Customer confirmed these are the same enquiry.', occurredAt: at }],
    sales: [sale('linked-sale', { draft: { ...sale('linked-sale').draft, customer: 'Amelia Smith', email: 'changed@example.com', sourceEnquiryId: original.id } })],
    chats: [{ id: 'source-chat', reference: 'CHAT-SOURCE', enquiryId: original.id, status: 'with_staff', messages: [{ id: 'message', authorRole: 'customer', authorName: 'Amelia', body: 'Original chat question.', createdAt: at }] }] });
  const before = JSON.stringify(input);
  const result = buildDealerRelationships(input);
  assert.equal(JSON.stringify(input), before);
  assert.equal(result.customers.length, 1);
  const customer = result.customers[0];
  assert.equal(customer.name, main.customerName);
  assert.equal(customer.email, main.email);
  assert.equal(customer.counts.enquiries, 1);
  assert.equal(customer.counts.appointments, 1);
  assert.equal(customer.counts.sales, 1);
  assert.deepEqual(customer.vehicleIds, ['car-a', 'car-b']);
  assert.deepEqual(customer.recordKeys, ['enquiry:main', 'enquiry:original', 'sale:linked-sale']);
  assert.match(customer.matchingNote, /staff merge/);
  assert.match(customer.matchingNote, /different contact details/);
  const source = customer.activities.find(activity => activity.id === 'enquiry:original:received')!;
  assert.equal(source.description, original.message);
  assert.equal(source.recordId, original.id);
  assert.equal(source.caseId, main.id);
  assert.equal(source.url, '/portal?section=enquiries&enquiryId=main');
  assert.equal(source.status, 'merged');
  assert.ok(customer.activities.some(activity => activity.kind === 'follow_up' && activity.description.includes('second car')));
  assert.ok(customer.activities.some(activity => activity.description.includes('Alex: Customer confirmed')));
  assert.equal(customer.activities.find(activity => activity.id === 'chat:source-chat')?.url, '/portal?section=chat&conversationId=source-chat');
});

test('broken merge references and cycles never hide originals or invent customer matches', () => {
  const input = sources({ enquiries: [
    enquiry('missing', { mergedIntoId: 'foreign', email: 'missing@example.com', phone: null }),
    enquiry('a', { mergedIntoId: 'b', email: 'a@example.com', phone: null }),
    enquiry('b', { mergedIntoId: 'a', email: 'b@example.com', phone: null }),
  ] });
  const result = buildDealerRelationships(input);
  assert.equal(result.customers.length, 3);
  for (const customer of result.customers) {
    const activity = customer.activities.find(item => item.kind === 'enquiry')!;
    assert.equal(activity.caseId, activity.recordId);
    assert.equal(activity.url, `/portal?section=enquiries&enquiryId=${activity.recordId}`);
  }
});

test('explicit source links join changed names, and normalized phones join known same contacts without an email', () => {
  const s = sale('s'); s.draft = { ...s.draft, customer: 'Amelia Smith', sourceEnquiryId: 'a' };
  const result = buildDealerRelationships(sources({ enquiries: [enquiry('a'), enquiry('phone-a', { customerName: 'Phone Customer', email: null, phone: '07700 900999' }),
    enquiry('phone-b', { customerName: 'Phone Customer', email: null, phone: '0044 7700 900999' }),
    enquiry('phone-c', { customerName: 'Phone Customer', email: null, phone: '447700900999' })], sales: [s] }));
  assert.equal(result.customers.length, 2);
  assert.deepEqual(result.customers.find(c => c.recordKeys.includes('sale:s'))?.recordKeys, ['enquiry:a', 'sale:s']);
  assert.match(result.customers.find(c => c.recordKeys.includes('enquiry:phone-a'))!.matchingNote, /exact phone/);
  assert.equal(result.customers.find(c => c.recordKeys.includes('enquiry:phone-a'))?.recordKeys.length, 3);
});

test('identified enquiry events add car interest; anonymous visitor activity cannot create customer relationships', () => {
  const result = buildDealerRelationships(sources({ enquiries: [enquiry('a')], enquiryEvents: [
    { id: 'identified', enquiryId: 'a', vehicleId: 'car-b', vehicleTitle: 'Honda Civic', kind: 'whatsapp_intent', summary: 'Asked about this second car.', occurredAt: at },
    { id: 'anonymous', enquiryId: null, vehicleId: 'private-car', vehicleTitle: 'Anonymous browsing car', kind: 'call_intent', occurredAt: at },
    { id: 'foreign', enquiryId: 'not-in-this-dealer', vehicleId: 'foreign-car', kind: 'call_intent', occurredAt: at },
  ] }));
  assert.deepEqual(result.customers[0].vehicleIds, ['car-a', 'car-b']);
  assert.equal(result.vehicles.some(v => ['private-car', 'foreign-car'].includes(v.id)), false);
});

test('linked customer and vehicle histories preserve both staff discussions, authors and dates without replacing earlier notes', async () => {
  const original = enquiry('conversation-enquiry', { staffNote: 'Existing staff working note.', callOutcome: 'information_given' });
  const events = [
    { id: 'old-conversation', enquiryId: original.id, vehicleId: 'car-a', kind: 'conversation_logged', summary: 'Conversation logged by Alex: Callback requested', staffName: 'Alex', note: 'Customer asked for the original service invoices.', occurredAt: '2026-10-05T10:00:00.000Z' },
    { id: 'new-conversation', enquiryId: original.id, vehicleId: 'car-a', kind: 'conversation_logged', summary: 'Conversation logged by Jamie: Information given', staffName: 'Jamie', note: 'Confirmed the invoice dates and explained the last service.', occurredAt: '2026-10-06T11:00:00.000Z' },
  ];
  const before = JSON.stringify({ original, events });
  const result = await readDealerRelationships('authorised-dealer', { async query(sql, parameters) {
    assert.deepEqual(parameters, ['authorised-dealer']);
    if (sql === relationshipQueries.enquiries) return { rows: [original] };
    if (sql === relationshipQueries.enquiryEvents) {
      assert.match(sql, /detail->>'note' AS note/); assert.match(sql, /detail->>'staffName' AS "staffName"/);
      assert.doesNotMatch(sql, /SELECT[^;]*\bdetail\s*(?:,|FROM)/i);
      return { rows: [...events, { ...events[0], id: 'foreign-conversation', enquiryId: 'foreign-enquiry', note: 'FOREIGN_PRIVATE_DISCUSSION' }] };
    }
    return { rows: [] };
  } });
  const customer = result.customers[0]; const vehicle = result.vehicles.find(vehicle => vehicle.id === 'car-a')!;
  for (const history of [customer.activities, vehicle.activities]) {
    const conversations = history.filter(activity => activity.id.startsWith('enquiry-event:'));
    assert.deepEqual(conversations.map(activity => activity.id), ['enquiry-event:new-conversation', 'enquiry-event:old-conversation']);
    for (const event of events) {
      const activity = conversations.find(activity => activity.id === `enquiry-event:${event.id}`)!;
      assert.equal(activity.description, `${event.summary}\n\n${event.staffName}: ${event.note}`);
      assert.equal(activity.occurredAt, event.occurredAt); assert.equal(activity.recordId, original.id);
      assert.equal(activity.url, `/portal?section=enquiries&enquiryId=${original.id}`);
    }
    assert.ok(history.some(activity => activity.description.includes('Existing staff working note.')));
  }
  assert.equal(customer.counts.enquiries, 1); assert.equal(vehicle.counts.enquiries, 1);
  assert.equal(JSON.stringify(result).includes('FOREIGN_PRIVATE_DISCUSSION'), false);
  assert.equal(JSON.stringify({ original, events }), before);
});

test('historic and ad hoc vehicle snapshots remain available without guessing from vehicle names', () => {
  const result = buildDealerRelationships(sources({ vehicles: [{ id: 'car-a', title: 'Ford Fiesta', status: 'missing', registration: 'AB12 CDE' }], enquiries: [
    enquiry('old', { vehicleId: 'deleted-car', vehicleTitle: 'Sold car snapshot', vehicleRegistration: 'CD34 EFG' }),
    enquiry('ad-hoc-a', { vehicleId: null, vehicleTitle: 'Unlisted Ford', vehicleRegistration: null, vehicleUrl: null }),
    enquiry('ad-hoc-b', { vehicleId: null, vehicleTitle: 'Unlisted Ford', vehicleRegistration: null, vehicleUrl: null }),
    enquiry('plate', { vehicleId: null, vehicleUrl: null }),
  ] }));
  assert.equal(result.vehicles.find(v => v.id === 'deleted-car')?.title, 'Sold car snapshot');
  assert.equal(result.vehicles.find(v => v.id === 'car-a')?.status, 'missing');
  assert.equal(result.vehicles.find(v => v.id === 'car-a')?.counts.enquiries, 1, 'full plate snapshot matches the identified vehicle');
  assert.equal(result.vehicles.filter(v => v.title === 'Unlisted Ford').length, 2);
  assert.ok(result.vehicles.every(v => v.lastActivityAt && Number.isFinite(Date.parse(v.lastActivityAt))));
});

test('Stripe deposits and refunds mirrored in the linked sale ledger appear once, while simulated payments remain explicit', () => {
  const s = sale('s'); s.draft.sourceReservationId = 'stripe';
  s.payments = [{ id: 'paid', amountPence: 10000, signedAmountPence: 10000, method: 'Stripe', date: '2026-10-05', reference: 'pi_paid', kind: 'deposit', status: 'confirmed', recordedAt: at },
    { id: 'refund', amountPence: 3000, signedAmountPence: -3000, method: 'Stripe', date: '2026-10-05', reference: 'refund', kind: 'refund', status: 'confirmed', recordedAt: at }];
  s.documents = [{ id: 'receipt', number: 'REC-0001', type: 'receipt', title: 'Deposit receipt', issuedAt: at, paymentAmountPence: 10000,
    snapshot: { draft: { vehicleId: 'car-a', vehicle: 'Ford Fiesta', registration: 'AB12 CDE', price: '5000' } } }];
  const result = buildDealerRelationships(sources({ sales: [s], reservations: [reservation('stripe', { paymentStatus: 'partially_refunded', mode: 'live', amountReceivedPence: 10000, amountRefundedPence: 3000, saleId: 's' }), reservation('simulated')] }));
  const payments = result.customers[0].activities.filter(a => a.kind === 'payment');
  assert.deepEqual(payments.map(p => p.amountPence).sort((a, b) => a! - b!), [-3000, 10000]);
  assert.equal(result.customers[0].activities.filter(a => a.kind === 'document').length, 1);
  assert.match(result.customers[0].activities.find(a => a.recordId === 'simulated')!.description, /simulated; no money received/);
  assert.deepEqual(result.customers[0].counts, { enquiries: 0, appointments: 0, reservations: 2, sales: 1 });
});

test('year and registration-band labels cannot merge ad hoc cars; unknown timestamps stay unknown', () => {
  const result = buildDealerRelationships(sources({ vehicles: [], enquiries: [
    enquiry('a', { vehicleId: null, vehicleTitle: 'Ford', vehicleRegistration: '2016 (65 reg)', vehicleUrl: null, createdAt: null, updatedAt: null }),
    enquiry('b', { vehicleId: null, vehicleTitle: 'Honda', vehicleRegistration: '2016 (65 reg)', vehicleUrl: '/vehicle/foreign-car', createdAt: null, updatedAt: null }),
  ] }));
  assert.equal(result.vehicles.length, 2);
  assert.deepEqual(result.vehicles.map(v => v.id).sort(), ['snapshot:enquiry:a', 'snapshot:enquiry:b']);
  assert.equal(result.customers[0].lastActivityAt, null);
  assert.ok(result.customers[0].activities.every(a => a.occurredAt === ''));
  assert.equal(JSON.stringify(result).includes('1970'), false);
});

test('the explicit relationship whitelist omits private hashes, archives, provider retry keys, and arbitrary nested state', () => {
  const s = sale('s') as RelationshipSaleSource & Record<string, unknown>;
  s.customerAccess = { tokenHash: 'SENSITIVE_HASH' }; s.requests = { retry: { fingerprint: 'SENSITIVE_RETRY' } };
  s.providerPayments = { pi: { eventId: 'SENSITIVE_PROVIDER' } }; s.documentArchives = { doc: { content: 'SENSITIVE_ARCHIVE' } };
  s.documents = [{ id: 'doc', number: 'INV-1', title: 'Invoice', type: 'invoice', issuedAt: at, snapshot: { draft: { vehicleId: 'car-a', vehicle: 'Ford Fiesta' }, private: 'SENSITIVE_SNAPSHOT' } } as any];
  const e = { ...enquiry('e'), manageTokenHash: 'SENSITIVE_MANAGE', managePath: '/viewing/SENSITIVE_URL', visitorId: 'SENSITIVE_VISITOR' };
  const r = { ...reservation('r'), idempotencyKey: 'SENSITIVE_IDEMPOTENCY', credentialFingerprint: 'SENSITIVE_CREDENTIAL', checkoutUrl: '/checkout/SENSITIVE_CHECKOUT' };
  const text = JSON.stringify(buildDealerRelationships(sources({ enquiries: [e], reservations: [r], sales: [s] })));
  assert.equal(text.includes('SENSITIVE_'), false);
  assert.equal(text.includes('manageTokenHash'), false);
});

test('database aggregation performs only parameterized dealer scoped history reads and retains cancelled reservations', async () => {
  const calls: { sql: string; parameters: string[] }[] = [];
  const dealer = "dealer-'quoted";
  const result = await readDealerRelationships(dealer, { async query(sql, parameters) {
    calls.push({ sql, parameters });
    if (sql === relationshipQueries.reservations) return { rows: [reservation('cancelled')] };
    if (sql === relationshipQueries.reservationEvents) return { rows: [{ id: 'cancellation', reservationId: 'cancelled', type: 'online_reservation_cancelled', description: 'Customer cancelled.', occurredAt: '2026-10-05T11:00:00Z' }] };
    if (sql === relationshipQueries.sales) return { rows: [sale('s')] };
    return { rows: [] };
  } });
  assert.equal(calls.length, 7);
  for (const call of calls) {
    assert.deepEqual(call.parameters, [dealer]); assert.match(call.sql, /dealer_id\s*=\s*\$1/);
    assert.doesNotMatch(call.sql, /\b(?:INSERT|UPDATE|DELETE|TRUNCATE|FOR UPDATE)\b/i);
    assert.equal(call.sql.includes(dealer), false);
    assert.doesNotMatch(call.sql, /manage_token|tokenHash|documentArchives|providerPayments|idempotencyKey|checkoutUrl/);
  }
  const cancelled = result.customers.flatMap(c => c.activities).filter(a => a.recordId === 'cancelled' && a.kind === 'reservation');
  assert.ok(cancelled.every(a => a.status === 'cancelled'));
  assert.equal(cancelled.length, 2);
});

test('identified chat transcripts attach to both histories without counting extra enquiries or exposing anonymous conversations', () => {
  const result = buildDealerRelationships(sources({ enquiries: [enquiry('chat-enquiry')], chats: [
    { id: 'conversation', reference: 'CHAT-1', enquiryId: 'chat-enquiry', vehicleId: 'car-a', status: 'with_staff', createdAt: at, updatedAt: at,
      messages: [{ id: 'message', authorRole: 'customer', authorName: 'Alex', body: 'Can I arrange a test drive?', createdAt: at }] },
    { id: 'anonymous', reference: 'CHAT-2', enquiryId: null, vehicleId: 'car-a', status: 'assistant', messages: [{ id: 'private', authorRole: 'customer', authorName: 'Visitor', body: 'ANONYMOUS_CHAT', createdAt: at }] },
  ] }));
  const customer = result.customers[0];
  assert.equal(customer.counts.enquiries, 1);
  const activity = customer.activities.find(activity => activity.kind === 'chat');
  assert.ok(activity);
  assert.match(activity.description, /Customer: Can I arrange a test drive\?/);
  assert.equal(activity.url, '/portal?section=chat&conversationId=conversation');
  assert.ok(result.vehicles.find(vehicle => vehicle.id === 'car-a')?.activities.some(item => item.id === activity.id));
  assert.equal(JSON.stringify(result).includes('ANONYMOUS_CHAT'), false);
});

test('the staff endpoint rejects signed-out access, disables caching, fixes dealer scope, and cannot mutate', async () => {
  process.env.DATABASE_URL = 'postgres://unused:unused@127.0.0.1:1/unused';
  process.env.PORTAL_API_TOKEN = 'synthetic-relationships-token';
  const { pool } = await import('@workspace/db');
  const { createDealerRelationshipsRouter } = await import('./routes/dealer-relationships');
  const reads: string[] = [];
  const app = express(); app.use(express.json());
  app.use((req, _res, next) => {
    const signedOut = Object.assign(() => ({ userId: null, sessionId: null, tokenType: 'session_token' }), { [Symbol.for('@clerk/express.auth')]: true });
    Object.assign(req, { auth: signedOut, log: pino({ level: 'silent' }) }); next();
  });
  app.use('/api', createDealerRelationshipsRouter({ dealerId: () => 'authorised-dealer', read: async id => { reads.push(id); return buildDealerRelationships(sources()); } }));
  const server = app.listen(0, '127.0.0.1'); await new Promise<void>(resolve => server.once('listening', resolve));
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  try {
    const anonymous = await fetch(`${origin}/api/staff/relationships`);
    assert.equal(anonymous.status, 401); assert.equal(anonymous.headers.get('cache-control'), 'no-store'); assert.equal(reads.length, 0);
    const response = await fetch(`${origin}/api/staff/relationships?dealerId=foreign`, { headers: { 'x-portal-token': process.env.PORTAL_API_TOKEN! } });
    assert.equal(response.status, 200); assert.equal(response.headers.get('cache-control'), 'no-store'); assert.deepEqual(reads, ['authorised-dealer']);
    for (const method of ['POST', 'PATCH', 'DELETE']) {
      const rejected = await fetch(`${origin}/api/staff/relationships`, { method, headers: { 'x-portal-token': process.env.PORTAL_API_TOKEN! } });
      assert.equal(rejected.status, 405); assert.equal(rejected.headers.get('allow'), 'GET'); assert.equal(rejected.headers.get('cache-control'), 'no-store');
    }
    assert.equal(reads.length, 1);
  } finally {
    server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); await pool.end();
  }
});
