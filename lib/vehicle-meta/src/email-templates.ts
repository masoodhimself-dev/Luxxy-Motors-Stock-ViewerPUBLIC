/** Plain-text email copy shared by the editor and the server. Facts are supplied by the server. */
export const emailTemplateVariables = ['dealer_name', 'dealer_email', 'dealer_phone', 'dealer_address', 'customer_name', 'customer_email', 'reference', 'vehicle_title', 'vehicle_registration', 'appointment_time', 'appointment_status', 'duration', 'visit_instructions', 'parking_instructions', 'manage_url', 'message', 'preferred_contact', 'document_number', 'document_type', 'amount', 'amount_received', 'balance', 'payment_status', 'reservation_status', 'portal_url', 'expires_at'] as const;
export type EmailTemplateVariable = typeof emailTemplateVariables[number];
export type EmailTemplate = { id: string; label: string; category: 'Enquiries' | 'Bookings' | 'Reservations' | 'Sales' | 'Customer access'; subject: string; body: string };
export type EmailAppearance = { logoUrl: string; brandColour: string; heading: string; footer: string };
export const defaultEmailAppearance: EmailAppearance = { logoUrl: '', brandColour: '#172033', heading: '{{dealer_name}}', footer: '' };
const greeting = 'Hi {{customer_name}},\n\n';
const signoff = '\n\nThanks,\n{{dealer_name}}\n{{dealer_phone}}';
export const defaultEmailTemplates: readonly EmailTemplate[] = [
  { id: 'enquiry_acknowledgement', label: 'Enquiry acknowledgement', category: 'Enquiries', subject: 'Your {{dealer_name}} enquiry — {{reference}}', body: greeting + 'We have received your enquiry about {{vehicle_title}}. Our team will contact you soon.' + signoff },
  { id: 'dealer_notification', label: 'New enquiry for the team', category: 'Enquiries', subject: 'New enquiry — {{reference}}', body: 'A customer has contacted {{dealer_name}} about {{vehicle_title}}.\n\nCustomer: {{customer_name}}\nEmail: {{customer_email}}\nPreferred contact: {{preferred_contact}}\nMessage: {{message}}' },
  { id: 'callback', label: 'Callback request', category: 'Enquiries', subject: 'Your callback request — {{reference}}', body: greeting + 'We have received your callback request about {{vehicle_title}}. Our team will call you soon.' + signoff },
  { id: 'booking_request', label: 'Booking request received', category: 'Bookings', subject: 'Test drive requested — {{reference}}', body: greeting + 'We have received your test-drive request for {{vehicle_title}} at {{appointment_time}}. The showroom will confirm whether this time is available.\n\nYour appointment is not confirmed yet.\n{{manage_url}}' + signoff },
  { id: 'booking_confirmation', label: 'Booking confirmed', category: 'Bookings', subject: 'Your {{dealer_name}} test drive — {{reference}}', body: greeting + 'Your test drive for {{vehicle_title}} is confirmed. We look forward to meeting you.\n\n{{visit_instructions}}\n{{parking_instructions}}\n\nChange your test drive: {{manage_url}}' + signoff },
  { id: 'booking_change', label: 'Booking changed', category: 'Bookings', subject: 'Your test drive has changed — {{reference}}', body: greeting + 'Your test drive for {{vehicle_title}} has been updated. Please check the appointment details below.\n\n{{visit_instructions}}\n{{parking_instructions}}\n\nManage your test drive: {{manage_url}}' + signoff },
  { id: 'booking_cancellation', label: 'Booking cancelled', category: 'Bookings', subject: 'Test drive cancelled — {{reference}}', body: greeting + 'Your test drive for {{vehicle_title}} has been cancelled. Contact us if you would like to arrange another time.' + signoff },
  { id: 'booking_reminder', label: 'Booking reminder', category: 'Bookings', subject: 'Reminder: your {{dealer_name}} test drive', body: greeting + 'We look forward to seeing you for your test drive of {{vehicle_title}}.\n\n{{visit_instructions}}\n{{parking_instructions}}\n\nManage your test drive: {{manage_url}}' + signoff },
  { id: 'reservation_confirmation', label: 'Reservation confirmation', category: 'Reservations', subject: 'Your reservation — {{reference}}', body: greeting + 'Thank you for reserving {{vehicle_title}}. Please check the reservation and payment details below. Our team will contact you about the next steps.' + signoff },
  { id: 'reservation_payment', label: 'Reservation payment confirmed', category: 'Reservations', subject: 'Your reservation deposit — {{reference}}', body: greeting + 'Your reservation deposit for {{vehicle_title}} has been confirmed. Your receipt and the confirmed payment details are included below.' + signoff },
  { id: 'reservation_refund', label: 'Reservation refund', category: 'Reservations', subject: 'Reservation refund — {{reference}}', body: greeting + 'A refund for your reservation of {{vehicle_title}} has been recorded. Please check the refund details below. Your bank may take time to show it.' + signoff },
  { id: 'invoice', label: 'Invoice', category: 'Sales', subject: 'Invoice {{document_number}} — {{dealer_name}}', body: greeting + 'Your invoice for {{vehicle_title}} is attached. Please contact us if you have any questions.' + signoff },
  { id: 'payment_receipt', label: 'Payment receipt', category: 'Sales', subject: 'Receipt {{document_number}} — {{dealer_name}}', body: greeting + 'Your payment receipt for {{vehicle_title}} is attached. The confirmed payment details are shown below.' + signoff },
  { id: 'balance_statement', label: 'Balance statement', category: 'Sales', subject: 'Balance statement {{document_number}} — {{dealer_name}}', body: greeting + 'Your current balance statement for {{vehicle_title}} is attached. Please contact us to discuss payment arrangements.' + signoff },
  { id: 'document_email', label: 'Sales document', category: 'Sales', subject: '{{document_type}} {{document_number}} — {{dealer_name}}', body: greeting + 'Your {{document_type}} for {{vehicle_title}} is attached. Keep it for your records.' + signoff },
  { id: 'customer_access_link', label: 'Private customer page link', category: 'Customer access', subject: 'Your private {{dealer_name}} customer page', body: greeting + 'Use this private link to view your car, documents, confirmed payments and collection or delivery arrangements:\n\n{{portal_url}}\n\nKeep this link private. It expires at {{expires_at}}.' + signoff },
];
export class EmailTemplateError extends Error { readonly status: number; constructor(message: string, status = 400) { super(message); this.name = 'EmailTemplateError'; this.status = status; } }
export function validateEmailTemplate(value: unknown): Pick<EmailTemplate, 'subject' | 'body'> {
  const input = value as { subject?: unknown; body?: unknown } | null;
  if (!input || typeof input.subject !== 'string' || typeof input.body !== 'string') throw new EmailTemplateError('Enter a subject and message.');
  const subject = input.subject.trim(), body = input.body.trim();
  if (!subject || subject.length > 200 || /[\r\n\u0000-\u001f\u007f]/.test(subject)) throw new EmailTemplateError('The subject must be 1–200 characters on one line.');
  if (!body || body.length > 12_000 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(body)) throw new EmailTemplateError('The message must be 1–12,000 characters.');
  for (const copy of [subject, body]) {
    const remainder = copy.replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (_token, variable: string) => {
      if (!(emailTemplateVariables as readonly string[]).includes(variable)) throw new EmailTemplateError(`Unknown variable: ${variable}.`);
      return '';
    });
    if (remainder.includes('{{') || remainder.includes('}}')) throw new EmailTemplateError('Use variables in the form {{customer_name}}.');
  }
  return { subject, body };
}
export function escapeEmailHtml(value: string) { return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;'); }
export function validateEmailAppearance(value: unknown): EmailAppearance {
  const input = value as EmailAppearance | null;
  if (!input || typeof input.logoUrl !== 'string' || typeof input.brandColour !== 'string' || typeof input.heading !== 'string' || typeof input.footer !== 'string' || Object.keys(input).some(key => !['logoUrl', 'brandColour', 'heading', 'footer'].includes(key))) throw new EmailTemplateError('Enter valid email branding settings.');
  const logoUrl = input.logoUrl.trim();
  if (logoUrl && (logoUrl.length > 2000 || !/^https:\/\/(?:[a-z0-9-]+\.)+[a-z0-9-]+(?::\d{1,5})?(?:[/?#][^\s]*)?$/i.test(logoUrl) || /[\\<>"\u0000-\u001f]/.test(logoUrl))) throw new EmailTemplateError('Use a secure HTTPS address without credentials for the email logo.');
  if (!/^#[a-f0-9]{6}$/i.test(input.brandColour)) throw new EmailTemplateError('Use a six-digit hex colour, for example #172033.');
  const heading = input.heading.trim(), footer = input.footer.trim();
  if (heading.length > 200 || footer.length > 4000) throw new EmailTemplateError('Keep the heading within 200 characters and footer within 4,000 characters.');
  // The same variable grammar and control-character restrictions apply to global copy.
  validateEmailTemplate({ subject: heading || 'Email', body: footer || 'Footer' });
  return { logoUrl, brandColour: input.brandColour.toUpperCase(), heading, footer };
}
export type EmailFacts = Array<{ label: string; value: string | number }>;
export function renderEmailTemplate(template: Pick<EmailTemplate, 'subject' | 'body'>, variables: Record<string, string | number | null | undefined>, facts: EmailFacts, appearance: EmailAppearance = defaultEmailAppearance) {
  const copy = validateEmailTemplate(template);
  const branding = validateEmailAppearance(appearance);
  const interpolate = (value: string) => value.replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (_token, key: string) => String(variables[key] ?? ''));
  const subject = interpolate(copy.subject).replace(/[\r\n\u0000-\u001f\u007f]/g, ' ').slice(0, 200).trim();
  if (!subject) throw new EmailTemplateError('The rendered subject is empty.');
  const prose = interpolate(copy.body);
  const heading = interpolate(branding.heading), footer = interpolate(branding.footer);
  const factText = facts.map(fact => `${fact.label}: ${fact.value}`).join('\n');
  const factHtml = facts.map(fact => `<tr><th style="text-align:left;padding:6px 12px 6px 0;vertical-align:top">${escapeEmailHtml(fact.label)}</th><td style="padding:6px 0">${escapeEmailHtml(String(fact.value))}</td></tr>`).join('');
  return { subject, text: [heading, prose, factText ? 'Confirmed details\n' + factText : '', footer].filter(Boolean).join('\n\n'), html: `<div style="font-family:Arial,sans-serif;line-height:1.6;color:#172033;max-width:640px;border-top:4px solid ${branding.brandColour};padding-top:20px">${branding.logoUrl ? `<img src="${escapeEmailHtml(branding.logoUrl)}" alt="${escapeEmailHtml(String(variables.dealer_name ?? 'Dealership'))}" style="max-height:64px;max-width:240px;margin-bottom:16px">` : ''}${heading ? `<h1 style="font-size:24px;line-height:1.3;color:${branding.brandColour}">${escapeEmailHtml(heading)}</h1>` : ''}<div style="white-space:pre-wrap">${escapeEmailHtml(prose)}</div>${factHtml ? `<hr style="margin:24px 0;border:0;border-top:1px solid #d8dee8"><h2 style="font-size:18px">Confirmed details</h2><table style="border-collapse:collapse">${factHtml}</table>` : ''}${footer ? `<hr style="margin:24px 0;border:0;border-top:1px solid #d8dee8"><div style="white-space:pre-wrap;font-size:12px;color:#5b6574">${escapeEmailHtml(footer)}</div>` : ''}</div>` };
}
