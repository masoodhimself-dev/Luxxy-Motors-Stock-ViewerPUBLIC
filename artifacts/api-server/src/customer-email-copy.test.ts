import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultEmailTemplates, renderEmailTemplate, defaultEmailAppearance } from '@workspace/vehicle-meta';
import { approvedNotificationWhatsApp, captureNotificationStock, captureNotificationWhatsApp, notificationVehicleFacts } from './lib/notification-email-copy';
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
  assert.match(previewEmailTemplate('booking_request', template('booking_request')).bodyText, /wait for our confirmation before travelling/);
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

test('team enquiry notices show the customer details once and keep the message and contact preference', () => {
  const rendered = previewEmailTemplate('dealer_notification', template('dealer_notification'));
  for (const value of [sampleEmailVariables.customer_name!, sampleEmailVariables.customer_email!, sampleEmailVariables.message!]) {
    assert.equal(rendered.text.split(value).length - 1, 1, `${value} should not be repeated in the message and facts`);
  }
  assert.match(rendered.text, /Preferred contact: Phone call/);
  assert.match(rendered.text, /Phone: 07700 900456/);
});

test('website WhatsApp drafts open the customer chat and retain number-only links for approved retries', () => {
  const general = { customerName: "Alex Taylor" };
  const link = new URL(captureNotificationWhatsApp("07700 900456", general)!);
  assert.equal(link.origin + link.pathname, "https://wa.me/447700900456");
  assert.equal(link.searchParams.get("text"), "Hi Alex,\n\n");
  assert.equal(
    new URL(captureNotificationWhatsApp("+33 6 12 34 56 78", {})!).searchParams.get("text"),
    "Hi there,\n\n",
  );
  for (const phone of [null, "", "0770", "7700900456", "07700 900456 ext 9", "07700 900456?text=hello"])
    assert.equal(captureNotificationWhatsApp(phone, general), undefined);
  assert.equal(approvedNotificationWhatsApp(undefined), undefined);
  assert.equal(approvedNotificationWhatsApp(link.href), link.href);
  const oldLink = "https://wa.me/447700900456";
  assert.equal(approvedNotificationWhatsApp(oldLink), oldLink);
  for (const invalid of [oldLink + "?draft=message", oldLink + "?text=message&extra=1", oldLink + "?text=%0", "https://other.example/447700900456"])
    assert.throws(() => approvedNotificationWhatsApp(invalid));
});

test('dealer vehicle notifications show a public stock photo without exposing it to customer acknowledgements', () => {
  const title = '2015 Lexus RX';
  const stock = captureNotificationStock({
    title, year: 2015, variant: '450h F Sport', mileage: 132_000,
    fuel: 'Petrol hybrid', transmission: 'Automatic', currency: 'GBP',
    heroImage: '/media/lexus.jpg?width=640&format=jpeg',
  }, { registration: 'SK15 NVJ', price: 9_990 }, 'https://example.test');
  const facts = notificationVehicleFacts(title, stock);
  const variables = { ...sampleEmailVariables, vehicle_title: title };
  const dealer = renderEmailTemplate(template('dealer_notification'), variables, facts, defaultEmailAppearance,
    { templateId: 'dealer_notification', dealerVehicleNotice: { photoUrl: stock.photoUrl } });
  assert.match(dealer.html, /src="https:\/\/example\.test\/media\/lexus\.jpg\?width=640&amp;format=jpeg"/);
  assert.match(dealer.html, /alt="2015 Lexus RX listing photo"/);
  assert.match(dealer.html, />Vehicle<\/p>/);
  assert.doesNotMatch(dealer.html, /Your vehicle|Contact the dealership|hello@example.test/);
  assert.doesNotMatch(dealer.text, /hello@example.test/);
  assert.match(dealer.text, /Registration: SK15 NVJ/);
  assert.match(dealer.text, /Price at enquiry: £9,990/);
  assert.match(dealer.text, /Mileage: 132,000 miles/);
  assert.match(dealer.text, /Fuel: Petrol hybrid/);
  assert.match(dealer.text, /Gearbox: Automatic/);
  assert.doesNotMatch(dealer.text, /Year: 2015|Reply in DealerOS/);

  const customer = renderEmailTemplate(template('enquiry_acknowledgement'), variables, facts, defaultEmailAppearance,
    { templateId: 'enquiry_acknowledgement', dealerVehicleNotice: { photoUrl: stock.photoUrl } });
  assert.doesNotMatch(customer.html, /lexus\.jpg/);
  assert.match(customer.html, /Your vehicle|Contact the dealership/);
  assert.match(customer.text, /hello@example.test/);

  for (const heroImage of [
    'javascript:alert(1)', 'https://user:pass@example.test/photo.jpg',
    'https://example.test/photo.jpg" onerror="alert(1)', '//example.test/photo.jpg',
  ]) {
    const invalid = captureNotificationStock({ heroImage }, { registration: null, price: null }, 'https://example.test');
    assert.equal(invalid.photoUrl, undefined);
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


test('deposit emails use simple request and received copy without generating a payment link', () => {
  const request = previewEmailTemplate('deposit_request', template('deposit_request'));
  assert.match(request.bodyText, /Thank you for choosing Example Motors/);
  assert.match(request.bodyText, /£100.00 deposit request/);
  assert.match(request.bodyText, /vehicle price is £12,500.00/);
  assert.match(request.bodyText, /Once we confirm your deposit has arrived/);
  assert.doesNotMatch(request.bodyText, /500 people|pay now|https?:|already reserved/);
  const confirmation = previewEmailTemplate('deposit_confirmation', template('deposit_confirmation'));
  assert.match(confirmation.bodyText, /received your deposit of £100.00/);
  assert.match(confirmation.bodyText, /reserved the car for you/);
  assert.match(confirmation.bodyText, /when the deposit was recorded/);
});
