import { describe, expect, it } from 'vitest';
import { saleHandoverMessage, type SaleWorkspaceDraft, type SaleWorkspaceFulfilment } from '@workspace/vehicle-meta';

const draft: SaleWorkspaceDraft = {
  id: 'test-sale', customer: 'Fictional buyer', email: 'buyer@example.test', phone: '', address: '',
  vehicleId: 'test-car', vehicle: 'Test car', registration: 'TEST', price: '1000',
  partExchange: false, pxRegistration: '', pxDescription: '', pxValue: '',
  deposit: '', paymentMethod: '', notes: '', collection: '',
  preparation: false, documents: false, handover: false,
};
const message = (method: SaleWorkspaceFulfilment['method'], changes: Partial<SaleWorkspaceFulfilment> = {}) =>
  saleHandoverMessage({ draft: { ...draft, fulfilment: {
    method, viewed: 'viewed', address: '123 Test Road', recipient: 'Planned recipient', phone: '',
    scheduledDate: '2026-11-03', timeWindow: '14:00–16:00', instructions: '', stage: 'booked', ...changes,
  } } }, 'Test Motors');

describe.each(['delivery', 'collection'] as const)('%s handover messages', method => {
  it('names the recorded recipient after completion instead of the planned recipient', () => {
    const text = message(method, { completedAt: '2026-11-02T12:00:00Z', completedRecipient: 'Actual recipient' });

    expect(text).toContain('Received by: Actual recipient');
    expect(text).not.toContain('Planned recipient');
    expect(text).not.toContain('Receiving the car:');
    expect(text).toContain(`Status: ${method === 'delivery' ? 'Delivered' : 'Collected'}.`);
    expect(text).toContain('Received: ');
    expect(text).not.toContain('Planned date:');
    expect(text).not.toMatch(/UK time|London time/);
    if (method === 'delivery') expect(text).toContain('Delivery address: 123 Test Road');
    expect(text).toContain('Please reply if any details need changing or you have any questions.\n\nTest Motors');
  });

  it.each([undefined, ''])('omits recipient claims when completedRecipient is %s', completedRecipient => {
    const text = message(method, { completedAt: '2026-11-02T12:00:00Z', completedRecipient });

    expect(text).not.toContain('Received by:');
    expect(text).not.toContain('Receiving the car:');
    expect(text).not.toContain('Planned recipient');
    expect(text).toContain('Received: ');
  });

  it('keeps the planned recipient and arrangements before completion', () => {
    const text = message(method, { completedRecipient: 'Unconfirmed recipient' });

    expect(text).toContain('Receiving the car: Planned recipient');
    expect(text).not.toContain('Received by:');
    expect(text).not.toContain('Unconfirmed recipient');
    expect(text).toMatch(/Planned date: Tuesday,? 3 November 2026, 14:00–16:00\./);
    expect(text).not.toMatch(/UK time|London time/);
  });
});

it.each([['2026-07-15T12:00:00Z', '13:00:00'], ['2026-12-15T12:00:00Z', '12:00:00']])('keeps the London clock for completed handover %s without a timezone label', (completedAt, time) => {
  const text = message('delivery', { completedAt });
  expect(text).toContain(time);
  expect(text).not.toMatch(/UK time|London time/);
});
