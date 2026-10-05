import assert from 'node:assert/strict';
import { test } from 'node:test';
import express from 'express';
import pino from 'pino';

// No database is contacted: this suite exercises the authentication/validation boundary only.
process.env.DATABASE_URL = 'postgres://unused:unused@127.0.0.1:1/unused';
process.env.PORTAL_API_TOKEN = 'synthetic-staff-enquiries-token';
const { pool } = await import('@workspace/db');
const { default: router } = await import('./routes/enquiries');
const { CreateStaffEnquiryBody, CreateEnquiryBody, ChangeStaffAppointmentBody, LogEnquiryConversationBody } = await import('@workspace/api-zod');

test('staff enquiry routes reject anonymous access and validate before database access', async () => {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    // Model Clerk middleware’s signed-out request; no external identity provider is contacted.
    const signedOut = Object.assign(() => ({ userId: null, sessionId: null, tokenType: 'session_token' }), { [Symbol.for('@clerk/express.auth')]: true });
    Object.assign(req, { auth: signedOut, log: pino({ level: 'silent' }) });
    if (req.get('x-synthetic-staff-role') === 'accounts') req.staff = { authUserId: 'synthetic-accounts', name: 'Accounts', email: null, role: 'accounts' };
    next();
  });
  app.use('/api', router);
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  const address = server.address() as { port: number };
  try {
    for (const [method, path] of [['GET', '/staff/directory'], ['PATCH', '/staff/enquiries/not-an-id/workspace'], ['POST', '/staff/enquiries'], ['POST', '/staff/enquiries/not-an-id/appointment'], ['POST', '/staff/enquiries/not-an-id/follow-up'], ['POST', '/staff/enquiries/not-an-id/conversations'], ['GET', '/staff/enquiries/not-an-id/availability?date=2026-10-05']]) {
      const response = await fetch(`http://127.0.0.1:${address.port}/api${path}`, { method, headers: { 'content-type': 'application/json' }, ...(method === 'POST' ? { body: '{}' } : {}) });
      assert.equal(response.status, 401, `${method} ${path} requires staff`);
    }
    for (const path of ['/staff/enquiries', '/staff/enquiries/not-an-id/appointment', '/staff/enquiries/not-an-id/follow-up', '/staff/enquiries/not-an-id/conversations']) {
      const response = await fetch(`http://127.0.0.1:${address.port}/api${path}`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-portal-token': process.env.PORTAL_API_TOKEN! }, body: '{}' });
      assert.equal(response.status, 400);
    }
    const roleDenied = await fetch(`http://127.0.0.1:${address.port}/api/staff/enquiries/not-an-id/conversations`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-synthetic-staff-role': 'accounts' }, body: '{}' });
    assert.equal(roleDenied.status, 403);
    const callback = { vehicleId: null, type: 'general', customerName: 'Callback caller', phone: '07700900123', preferredContact: null, message: 'Please call', appointmentAt: null, requestCallback: true };
    for (const input of [{ ...callback, phone: null }, { ...callback, phone: 'invalid-phone' }, { ...callback, type: 'viewing' }, { ...callback, appointmentAt: '2026-12-01T10:00:00Z' }, { ...callback, email: 'invalid' }]) {
      const response = await fetch(`http://127.0.0.1:${address.port}/api/enquiries`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input) });
      assert.equal(response.status, 400);
    }
  } finally {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
    await pool.end();
  }
});

test('phone enquiries accept no email; stale-edit revision must be a nonnegative whole number', () => {
  const payload = { vehicleId: null, type: 'general', customerName: 'Phone Caller', email: null, phone: '07700900123', preferredContact: 'phone', message: 'Called showroom', appointmentAt: null };
  assert.equal(CreateStaffEnquiryBody.safeParse(payload).success, true);
  assert.equal(CreateEnquiryBody.safeParse(payload).success, true);
  for (const expectedRevision of [-1, 0.5, undefined]) assert.equal(ChangeStaffAppointmentBody.safeParse({ action: 'cancel', expectedRevision }).success, false);
  assert.equal(ChangeStaffAppointmentBody.safeParse({ action: 'cancel', expectedRevision: 0 }).success, true);
});

test('callback schema permits omitted email and conversation schema requires both whole-number revisions', () => {
  assert.equal(CreateEnquiryBody.safeParse({ vehicleId: null, type: 'general', customerName: 'Callback caller', phone: '07700900123', preferredContact: null, message: 'Please call', appointmentAt: null, requestCallback: true }).success, true);
  const input = { expectedRevision: 0, expectedFollowUpRevision: 0, note: 'Discussed history', callOutcome: 'information_given' };
  assert.equal(LogEnquiryConversationBody.safeParse(input).success, true);
  for (const revision of [-1, 0.5, undefined]) {
    assert.equal(LogEnquiryConversationBody.safeParse({ ...input, expectedRevision: revision }).success, false);
    assert.equal(LogEnquiryConversationBody.safeParse({ ...input, expectedFollowUpRevision: revision }).success, false);
  }
  assert.equal('staffName' in LogEnquiryConversationBody.parse({ ...input, staffName: 'Impersonated staff' }), false);
});
