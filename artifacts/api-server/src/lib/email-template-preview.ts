import { defaultEmailTemplates, EmailTemplateError, renderEmailTemplate, validateEmailAppearance, validateEmailTemplate, type EmailAppearance } from '@workspace/vehicle-meta';
export const sampleEmailVariables: Record<string, string> = { dealer_name: 'Example Motors', dealer_email: 'hello@example.test', dealer_phone: '07700 900123', dealer_address: '12 Example Road, London', customer_name: 'Alex Taylor', customer_email: 'alex@example.test', reference: 'RSV-SAMPLE', vehicle_title: '2022 Example Hatchback', vehicle_registration: 'AB22 CDE', appointment_time: 'Monday 12 October 2026 at 10:30', appointment_status: 'confirmed', duration: '30 minutes', visit_instructions: 'Please bring your driving licence.', parking_instructions: 'Customer parking is beside the showroom.', manage_url: 'https://example.test/viewing/sample', message: 'I would like to arrange a test drive.', preferred_contact: 'Phone call', document_number: 'INV-SAMPLE', document_type: 'Invoice', amount: '£100.00', amount_received: '£100.00', balance: '£12,400.00', payment_status: 'confirmed', reservation_status: 'reserved', portal_url: 'https://example.test/my-purchase/sample', expires_at: '12 October 2026 at 18:00' };
export function previewEmailTemplate(id: string, raw: unknown, savedAppearance?: EmailAppearance) {
  const template = defaultEmailTemplates.find(item => item.id === id);
  if (!template) throw new EmailTemplateError('Email template not found.', 404);
  const copy = validateEmailTemplate(raw);
  const booking = template.category === 'Bookings';
  const payment = template.category === 'Reservations' || template.category === 'Sales';
  const facts = [ { label: 'Reference', value: 'SAMPLE-001' }, { label: 'Vehicle', value: sampleEmailVariables.vehicle_title! }, ...(booking ? [{ label: 'Appointment status', value: id === 'booking_request' ? 'requested — awaiting confirmation' : id === 'booking_cancellation' ? 'cancelled' : 'confirmed' }, { label: 'Appointment', value: sampleEmailVariables.appointment_time! }] : []), ...(payment ? [{ label: 'Payment status', value: 'confirmed' }, { label: 'Amount received', value: '£100.00' }, { label: 'Outstanding balance', value: '£12,400.00' }] : []) ];
  const requestedAppearance = (raw as { appearance?: unknown } | null)?.appearance;
  const appearance = requestedAppearance ? validateEmailAppearance(requestedAppearance) : savedAppearance;
  return { ...renderEmailTemplate(copy, sampleEmailVariables, facts, appearance), sample: true, sent: false };
}
