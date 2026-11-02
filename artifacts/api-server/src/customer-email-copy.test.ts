import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultEmailTemplates, renderEmailTemplate, defaultEmailAppearance } from '@workspace/vehicle-meta';
import { notificationVehicleFacts } from './lib/notification-email-copy';
import { sampleEmailVariables, previewEmailTemplate } from './lib/email-template-preview';
const template = (id: string) => defaultEmailTemplates.find(item => item.id === id)!;

test('default customer copy stays short and preserves actionable booking states', () => {
  for (const item of defaultEmailTemplates.filter(item => item.id !== 'dealer_notification')) {
    const prose = item.body.replace(/\{\{.*?\}\}/g, '');
    assert.ok(prose.split(/\s+/).filter(Boolean).length <= 60, `${item.id} should remain a short note`);
    const rendered = previewEmailTemplate(item.id, item);
    assert.ok(!rendered.bodyText.includes('{{'));
    assert.ok(!rendered.subject.includes('{{'));
  }
  assert.match(previewEmailTemplate('booking_request', template('booking_request')).bodyText, /not confirmed yet/);
  const cancelled = previewEmailTemplate('booking_cancellation', template('booking_cancellation'));
  assert.match(cancelled.bodyText, /cancelled/);
  assert.ok(!cancelled.html.includes('Manage your test drive'));
  for (const id of ['booking_confirmation', 'booking_change', 'booking_reminder']) {
    const rendered = previewEmailTemplate(id, template(id));
    assert.ok(rendered.text.includes(sampleEmailVariables.visit_instructions!));
    assert.ok(rendered.text.includes(sampleEmailVariables.parking_instructions!));
    assert.ok(rendered.text.includes(sampleEmailVariables.appointment_time!));
  }
});

test('zero-balance statements report the issued balance without asking for another payment', () => {
  const rendered = renderEmailTemplate(template('balance_statement'), { ...sampleEmailVariables, balance: '£0.00' },
    [{ label: 'Balance at issue', value: '£0.00' }], defaultEmailAppearance, { templateId: 'balance_statement', attachments: ['fictional-statement.pdf'] });
  assert.match(rendered.text, /Balance at issue: £0\.00/);
  assert.match(rendered.bodyText, /when it was issued/);
  assert.doesNotMatch(rendered.bodyText, /next payment|payment due|pay now|outstanding/i);
  const receipt = previewEmailTemplate('payment_receipt', template('payment_receipt'));
  assert.match(receipt.bodyText, /when it was issued/);
});

test('general enquiries do not invent a selected vehicle or repeat dealership branding in the subject', () => {
  assert.deepEqual(notificationVehicleFacts(null), []);
  assert.deepEqual(notificationVehicleFacts('  '), []);
  assert.deepEqual(notificationVehicleFacts(' Ford Focus '), [{ label: 'Vehicle', value: 'Ford Focus' }]);
  const variables = { ...sampleEmailVariables, vehicle_title: 'your Example Motors enquiry' };
  const rendered = renderEmailTemplate(template('enquiry_acknowledgement'), variables, notificationVehicleFacts(null), defaultEmailAppearance, { templateId: 'enquiry_acknowledgement' });
  assert.equal(rendered.subject.split('Example Motors').length - 1, 1);
  assert.ok(!rendered.html.includes('Your vehicle'));
  assert.match(rendered.bodyText, /during opening hours/);
});
