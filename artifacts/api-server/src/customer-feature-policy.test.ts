import assert from 'node:assert/strict';
import test from 'node:test';
import type { Request, Response, NextFunction } from 'express';
import { enforceCustomerFeaturePolicy } from './middlewares/customer-feature-policy';

function request(path: string, method: string) {
  const result: { next: boolean; status?: number; body?: unknown; cache?: string } = { next: false };
  const response = {
    set(_name: string, value: string) { result.cache = value; return this; },
    status(value: number) { result.status = value; return this; },
    json(body: unknown) { result.body = body; return this; },
  };
  enforceCustomerFeaturePolicy({ path, method } as Request, response as unknown as Response, (() => { result.next = true; }) as NextFunction);
  return result;
}

test('API middleware stops public intake before provider or persistence handlers', () => {
  for (const path of ['/reservations', '/reservations/checkout', '/Reservations/Checkout/', '/chat/conversations', '/chat/conversations/a/messages']) {
    const result = request(path, 'POST');
    assert.equal(result.next, false, path);
    assert.equal(result.status, 410, path);
    assert.equal(result.cache, 'no-store');
  }
});

test('API middleware leaves existing payments and staff core workflows intact', () => {
  for (const [path, method] of [
    ['/reservations/stripe/webhook', 'POST'], ['/reservations/payment-status', 'POST'],
    ['/reservations/a/cancel', 'POST'], ['/reservations', 'GET'],
    ['/staff/stripe-reservations', 'GET'], ['/staff/chat/conversations/a', 'GET'],
    ['/sale-workspace/a/payments', 'POST'], ['/enquiries', 'POST'], ['/test-drive-bookings', 'POST'],
  ]) {
    assert.deepEqual(request(path, method), { next: true }, path);
  }
});
