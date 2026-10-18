import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { defaultEmailAppearance, defaultEmailTemplates } from '@workspace/vehicle-meta';
import { communicationsPreview } from './communications';
import { previewSettings } from './settings';

const fixture = {
  id: 'fictional-email-parity', reference: 'PREVIEW-EMAIL-TEST', customerName: 'José Example',
  email: 'fictional@example.test', phone: '', vehicleTitle: 'Example car', vehicleRegistration: 'EX26 AAA',
  vehicleId: 'fictional-vehicle', createdAt: '2026-10-17T10:00:00.000Z', status: 'new',
  workspaceRevision: 2, appointmentAt: '2026-10-19T10:30:00.000Z', appointmentStatus: 'pending',
  appointmentDurationMinutes: 45, attendance: 'scheduled', events: [],
} as Awaited<ReturnType<NonNullable<NonNullable<Parameters<typeof communicationsPreview>[3]>['readEnquiries']>>>[number];
const settings = {
  ...previewSettings,
  identity: { ...previewSettings.identity, name: 'Example Motors' },
  contact: { ...previewSettings.contact, email: 'showroom@example.test', phone: '020 0000 0000' },
  address: { ...previewSettings.address, street: '1 Example Road', city: 'London', region: '', postcode: 'AB1 2CD' },
  testDriveBooking: { ...previewSettings.testDriveBooking!, instructions: 'Please arrive five minutes early.' },
  presentation: { ...previewSettings.presentation!, parkingInstructions: 'Use the visitor parking.' },
};
const templates = defaultEmailTemplates.map(template => template.id === 'appointment_details' ? {
  ...template, body: '{{appointment_time}}\n{{appointment_status}}\n{{duration}}\n{{visit_instructions}}\n{{parking_instructions}}\n{{dealer_address}}',
} : template);

async function call(path: string, method = 'GET', body?: unknown, entry = fixture, origin?: string) {
  let output = '';
  const headers: Record<string, string> = {};
  const req = Readable.from(body === undefined ? [] : [JSON.stringify(body)]) as unknown as IncomingMessage;
  req.method = method;
  req.headers = { host: '127.0.0.1:4186', origin };
  Object.defineProperty(req, 'socket', { value: { remoteAddress: '127.0.0.1' } });
  const res = {
    statusCode: 200,
    setHeader(name: string, value: string) { headers[name.toLowerCase()] = value; },
    end(value: string) { output = value; },
  } as unknown as ServerResponse;
  const handled = await communicationsPreview(req, res, new URL(path, 'http://127.0.0.1:4186'), {
    readEnquiries: async () => [entry], readSettings: async () => settings,
    readTemplates: async () => ({ templates, appearance: defaultEmailAppearance }),
  });
  return { handled, status: res.statusCode, headers, data: JSON.parse(output) };
}
const path = `/api/staff/enquiries/${fixture.id}`;
const content = { to: fixture.email, subject: 'Your vehicle details', message: 'Hello José,\nHere are your details. <script>bad()</script>', templateId: 'enquiry_message', includeVehicle: true, includeAppointment: true, photoIds: [], documentIds: [], expectedRevision: 2 };

test('local composer gets saved templates and prose only, with actual UK appointment details', async () => {
  const result = await call(`${path}/email-context`);
  assert.equal(result.status, 200);
  assert.equal(result.data.templates.length, 6);
  assert.equal(result.data.ready, false);
  assert.doesNotMatch(result.data.defaults.message, /showroom@example\.test|020 0000 0000/);
  const appointment = result.data.templates.find((template: any) => template.id === 'appointment_details');
  assert.match(appointment.message, /11:30 \(UK time\)/);
  assert.match(appointment.message, /Awaiting showroom approval/);
  assert.match(appointment.message, /45 minutes/);
  assert.match(appointment.message, /Please arrive five minutes early\./);
  assert.match(appointment.message, /Use the visitor parking\./);
  assert.match(appointment.message, /1 Example Road, London, AB1 2CD/);
  const noAppointment = await call(`${path}/email-context`, 'GET', undefined, { ...fixture, appointmentAt: null });
  const emptyAppointment = noAppointment.data.templates.find((template: any) => template.id === 'appointment_details');
  assert.doesNotMatch(emptyAppointment.message, /Confirmed|Awaiting|minutes|11:30/);
});

test('local review renders exact shared HTML, protects facts and never sends email', async t => {
  const fetchMock = t.mock.method(globalThis, 'fetch', async () => { throw new Error('No preview network'); });
  const result = await call(`${path}/email-preview`, 'POST', content);
  assert.equal(result.status, 200);
  assert.match(result.data.html, /<!doctype html>/i);
  assert.match(result.data.html, /@media/);
  assert.match(result.data.html, /Example Motors/);
  assert.match(result.data.html, /&lt;script&gt;bad\(\)&lt;\/script&gt;/);
  assert.doesNotMatch(result.data.html, /<script>/);
  assert.match(result.data.text, /11:30 \(UK time\)/);
  assert.match(result.data.text, /Awaiting showroom approval/);
  assert.match(result.data.text, /showroom@example\.test/);
  assert.doesNotMatch(result.data.subject + result.data.text + result.data.html, /PREVIEW-EMAIL-TEST|Enquiry reference:/);
  assert.match(result.data.previewHash, /^[a-f0-9]{64}$/);
  assert.equal((await call(`${path}/email-preview`, 'POST', content)).data.previewHash, result.data.previewHash);
  assert.equal((await call(`${path}/email-preview`, 'POST', { ...content, expectedRevision: 1 })).status, 409);
  assert.equal((await call(`${path}/email-preview`, 'POST', content, { ...fixture, appointmentAt: null })).status, 400);
  for (const templateId of ['invoice_copy', 'service_history', 'pre_accident_photos']) {
    assert.equal((await call(`${path}/email-preview`, 'POST', { ...content, templateId })).status, 400);
  }
  assert.equal((await call(`${path}/email-preview`, 'POST', { ...content, photoIds: ['fictional-unvalidated'] })).status, 409);
  assert.equal((await call(`${path}/email-preview`, 'POST', { ...content, documentIds: ['fictional-unvalidated'] })).status, 409);
  assert.equal((await call(`${path}/email`, 'POST', content)).status, 503);
  assert.equal((await call(`${path}/email-preview`, 'POST', content, fixture, 'https://untrusted.example')).status, 403);
  assert.equal(fetchMock.mock.callCount(), 0);
});
