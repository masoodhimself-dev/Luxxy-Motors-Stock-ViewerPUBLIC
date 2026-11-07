import assert from 'node:assert/strict';
import test from 'node:test';
import { GetLeadResponse } from '@workspace/api-zod';
import type { LeadEvent } from '@workspace/db';
import { leadEventPayload } from './lib/leads';

const time = new Date('2026-11-07T10:00:00Z');
const event = (payload: LeadEvent['payload']): LeadEvent => ({
  id: 'fixture-event', leadId: 'fixture-lead', type: 'note_added', actorType: 'system',
  actor: null, body: 'Reservation activity', occurredAt: time, createdAt: time, payload,
});
const view = (payload: LeadEvent['payload']) => GetLeadResponse.shape.events.element.parse(leadEventPayload(event(payload)));

test('lead history shows reservation amounts and status without exposing payment capabilities', () => {
  const facts = { reference: 'RSV-000000000001', depositPence: 9900, amountReceivedPence: 9900, paymentStatus: 'confirmed', status: 'reserved' };
  const response = view({ kind: 'online_stripe_reservation', reservation: {
    ...facts,
    checkoutUrls: { success: 'https://dealer.example.test/reservation-payment#token=private' },
    checkoutUrl: 'https://checkout.stripe.com/pay/private',
    credentialFingerprint: 'private',
    idempotencyKey: 'private',
    requestFingerprint: 'private',
    paymentIntentId: 'private',
    eventIds: ['private'],
    customerName: 'Fixture buyer',
  } });
  assert.deepEqual(JSON.parse(JSON.stringify(response.payload)), { kind: 'online_stripe_reservation', reservation: facts });
  assert.deepEqual(JSON.parse(JSON.stringify(view({ kind: 'stripe_reservation_activity', reservationId: 'fixture-lead', amountPence: 9900, eventId: 'private' }).payload)), {
    kind: 'stripe_reservation_activity', reservationId: 'fixture-lead', amountPence: 9900,
  });
});

test('ordinary lead activity keeps its existing payload', () => {
  const payload = { channel: 'whatsapp', appointmentAt: time.toISOString() };
  assert.deepEqual(view(payload).payload, payload);
});
