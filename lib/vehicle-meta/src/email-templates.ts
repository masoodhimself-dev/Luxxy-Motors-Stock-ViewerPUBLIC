/** Plain-text email copy shared by the editor and the server. Facts are supplied by the server. */
export const emailTemplateVariables = ['dealer_name', 'dealer_email', 'dealer_phone', 'dealer_address', 'customer_name', 'customer_email', 'reference', 'vehicle_title', 'vehicle_registration', 'appointment_time', 'appointment_status', 'duration', 'visit_instructions', 'parking_instructions', 'manage_url', 'message', 'preferred_contact', 'document_number', 'document_type', 'amount', 'amount_received', 'balance', 'payment_status', 'reservation_status', 'portal_url', 'expires_at'] as const;
export type EmailTemplateVariable = typeof emailTemplateVariables[number];
export type EmailTemplate = { id: string; label: string; category: 'Enquiries' | 'Bookings' | 'Reservations' | 'Sales' | 'Customer access'; subject: string; body: string; headline?: string };
export type EmailAppearance = { logoUrl: string; brandColour: string; heading: string; footer: string };
export const defaultEmailAppearance: EmailAppearance = { logoUrl: '', brandColour: '#172033', heading: '{{dealer_name}}', footer: '' };
const greeting = 'Hi {{customer_name}},\n\n';
const signoff = '\n\nThanks,\n{{dealer_name}}';
export const defaultEmailTemplates: readonly EmailTemplate[] = [
  { id: 'invoice_copy', label: 'Send a saved invoice', category: 'Enquiries', subject: 'Your invoice — {{vehicle_title}}', body: greeting + 'Your invoice is attached, ready to download and keep. If anything needs explaining, reply to this email and we’ll help.' + signoff },
  { id: 'vehicle_details', label: 'Vehicle details', category: 'Enquiries', subject: '{{vehicle_title}} — vehicle details', body: greeting + 'Here’s a closer look at {{vehicle_title}}. You’ll find the car’s details below. Have a question or want to take it for a drive? Reply to this email and we’ll help you arrange it.' + signoff },
  { id: 'service_history', label: 'Service-book photos', category: 'Enquiries', subject: '{{vehicle_title}} — service history', body: greeting + 'The service-book photos we discussed are attached. Take a look in your own time, and reply if you’d like us to explain any of the entries.' + signoff },
  { id: 'pre_accident_photos', label: 'Pre-accident photos', category: 'Enquiries', subject: '{{vehicle_title}} — requested photos', body: greeting + 'The pre-accident photos we discussed are attached. If you’d like to talk through them or ask about the car’s history, just reply to this email.' + signoff },
  { id: 'appointment_details', label: 'Appointment details', category: 'Enquiries', subject: 'Your appointment details — {{reference}}', body: greeting + 'Here are your appointment details. Check the date, time and confirmation status below. If you need to change anything, reply or give us a call.' + signoff },
  { id: 'enquiry_message', label: 'Customer message from enquiries', category: 'Enquiries', subject: '{{vehicle_title}} — {{dealer_name}}', body: greeting + '{{message}}' + signoff },
  { id: 'enquiry_acknowledgement', label: 'Enquiry acknowledgement', category: 'Enquiries', subject: 'Your {{dealer_name}} enquiry — {{reference}}', body: greeting + 'Thanks for getting in touch about {{vehicle_title}}. We’ve received your enquiry and will be in touch. If there’s anything else you’d like to ask, reply to this email.' + signoff },
  { id: 'dealer_notification', label: 'New enquiry for the team', category: 'Enquiries', subject: 'New enquiry — {{reference}}', body: 'A customer has contacted {{dealer_name}} about {{vehicle_title}}.\n\nCustomer: {{customer_name}}\nEmail: {{customer_email}}\nPreferred contact: {{preferred_contact}}\nMessage: {{message}}' },
  { id: 'callback', label: 'Callback request', category: 'Enquiries', subject: 'Your callback request — {{reference}}', body: greeting + 'Thanks for requesting a call about {{vehicle_title}}. We’ve received your request and will call you when the showroom team is available.' + signoff },
  { id: 'booking_request', label: 'Booking request received', category: 'Bookings', subject: 'Test drive requested — {{reference}}', body: greeting + 'Thanks for requesting a test drive of {{vehicle_title}} at {{appointment_time}}. We’ll check the time and contact you to confirm.\n\nYour appointment is not confirmed yet.' + signoff },
  { id: 'booking_confirmation', label: 'Booking confirmed', category: 'Bookings', subject: 'Your {{dealer_name}} test drive — {{reference}}', body: greeting + 'You’re booked in to test drive {{vehicle_title}}. Check your visit details below — we look forward to meeting you.\n\n{{visit_instructions}}\n{{parking_instructions}}' + signoff },
  { id: 'booking_change', label: 'Booking changed', category: 'Bookings', subject: 'Your test drive has changed — {{reference}}', body: greeting + 'We’ve updated your test drive of {{vehicle_title}}. Please check the new date, time and status below before setting off.\n\n{{visit_instructions}}\n{{parking_instructions}}' + signoff },
  { id: 'booking_cancellation', label: 'Booking cancelled', category: 'Bookings', subject: 'Test drive cancelled — {{reference}}', body: greeting + 'Your test drive of {{vehicle_title}} has been cancelled. If you’d like to arrange another time, reply or call us — we’ll be happy to help.' + signoff },
  { id: 'booking_reminder', label: 'Booking reminder', category: 'Bookings', subject: 'Reminder: your {{dealer_name}} test drive', body: greeting + 'We’re looking forward to seeing you for your test drive of {{vehicle_title}}. Here’s a reminder of your visit details.\n\n{{visit_instructions}}\n{{parking_instructions}}' + signoff },
  { id: 'reservation_confirmation', label: 'Reservation confirmation', category: 'Reservations', subject: 'Your reservation — {{reference}}', body: greeting + 'Thanks for your reservation request for {{vehicle_title}}. Your current reservation and payment status are shown below. We’ll be in touch about the next steps.' + signoff },
  { id: 'reservation_payment', label: 'Reservation payment confirmed', category: 'Reservations', subject: 'Your reservation deposit — {{reference}}', body: greeting + 'We’ve confirmed your reservation deposit for {{vehicle_title}}. Check the payment details below and keep this email for your records.' + signoff },
  { id: 'reservation_refund', label: 'Reservation refund', category: 'Reservations', subject: 'Reservation refund — {{reference}}', body: greeting + 'We’ve recorded a refund against your reservation of {{vehicle_title}}. The details are below. Your bank may take a little time to show the funds.' + signoff },
  { id: 'invoice', label: 'Invoice', category: 'Sales', subject: 'Invoice {{document_number}} — {{dealer_name}}', body: greeting + 'Your invoice for {{vehicle_title}} is attached. Keep a copy for your records. If you have a question about the invoice, reply and we’ll help.' + signoff },
  { id: 'payment_receipt', label: 'Payment receipt', category: 'Sales', subject: 'Receipt {{document_number}} — {{dealer_name}}', body: greeting + 'Your payment receipt for {{vehicle_title}} is attached. The details below reflect the issued document. Thank you — please keep the receipt for your records.' + signoff },
  { id: 'balance_statement', label: 'Balance statement', category: 'Sales', subject: 'Balance statement {{document_number}} — {{dealer_name}}', body: greeting + 'Your balance statement for {{vehicle_title}} is attached. It shows the balance recorded when the document was issued. Reply or call us if you’d like to discuss the next payment.' + signoff },
  { id: 'document_email', label: 'Sales document', category: 'Sales', subject: '{{document_type}} {{document_number}} — {{dealer_name}}', body: greeting + 'Your {{document_type}} for {{vehicle_title}} is attached. Keep it for your records.' + signoff },
  { id: 'customer_access_link', label: 'Private customer page link', category: 'Customer access', subject: 'Your private {{dealer_name}} customer page', body: greeting + 'Your private customer page brings your car, documents and recorded payments together. Open it using the secure link below.\n\nKeep this link private. It expires at {{expires_at}}.' + signoff },
];
export class EmailTemplateError extends Error { readonly status: number; constructor(message: string, status = 400) { super(message); this.name = 'EmailTemplateError'; this.status = status; } }
export function validateEmailTemplate(value: unknown): Pick<EmailTemplate, 'subject' | 'body' | 'headline'> {
  const input = value as { subject?: unknown; body?: unknown; headline?: unknown } | null;
  if (!input || typeof input.subject !== 'string' || typeof input.body !== 'string') throw new EmailTemplateError('Enter a subject and message.');
  const subject = input.subject.trim(), body = input.body.trim();
  if (!subject || subject.length > 200 || /[\r\n\u0000-\u001f\u007f]/.test(subject)) throw new EmailTemplateError('The subject must be 1–200 characters on one line.');
  if (!body || body.length > 12_000 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(body)) throw new EmailTemplateError('The message must be 1–12,000 characters.');
  if (input.headline !== undefined && (typeof input.headline !== 'string' || input.headline.length > 200 || /[\r\n\u0000-\u001f\u007f]/.test(input.headline))) throw new EmailTemplateError('Keep the email title within 200 characters on one line.');
  const headline = typeof input.headline === 'string' ? input.headline.trim() : undefined;
  for (const copy of [subject, body, headline ?? '']) {
    const remainder = copy.replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (_token, variable: string) => {
      if (!(emailTemplateVariables as readonly string[]).includes(variable)) throw new EmailTemplateError(`Unknown variable: ${variable}.`);
      return '';
    });
    if (remainder.includes('{{') || remainder.includes('}}')) throw new EmailTemplateError('Use variables in the form {{customer_name}}.');
  }
  return { subject, body, ...(headline === undefined ? {} : { headline }) };
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
export type EmailFacts = Array<{ label: string; value: string | number | null | undefined }>;
export type EmailRenderOptions = { templateId?: string; attachments?: readonly string[] };
const emailPresentation: Record<string, { title: string; kicker: string }> = {
  invoice_copy: { title: 'Your invoice, ready to keep', kicker: 'Your documents' },
  vehicle_details: { title: 'A closer look at your car', kicker: 'Your next car' },
  service_history: { title: 'Your service-book photos', kicker: 'Vehicle history' },
  pre_accident_photos: { title: 'The photos you requested', kicker: 'Vehicle history' },
  appointment_details: { title: 'Your appointment details', kicker: 'Your showroom visit' },
  enquiry_message: { title: 'A message for you', kicker: 'Your dealership' },
  enquiry_acknowledgement: { title: 'Thanks for getting in touch', kicker: 'Your enquiry' },
  dealer_notification: { title: 'A new enquiry to follow up', kicker: 'Showroom team' },
  callback: { title: 'We’ve received your callback request', kicker: 'Let’s talk' },
  booking_request: { title: 'Your test-drive request is in', kicker: 'Awaiting confirmation' },
  booking_confirmation: { title: 'Your test drive is booked', kicker: 'See you soon' },
  booking_change: { title: 'Your test drive has been updated', kicker: 'Your showroom visit' },
  booking_cancellation: { title: 'Your test drive is cancelled', kicker: 'Booking update' },
  booking_reminder: { title: 'Your test drive is coming up', kicker: 'Your visit reminder' },
  reservation_confirmation: { title: 'Your reservation update', kicker: 'Your next car' },
  reservation_payment: { title: 'Your deposit is confirmed', kicker: 'Payment update' },
  reservation_refund: { title: 'Your reservation refund', kicker: 'Payment update' },
  invoice: { title: 'Your invoice, ready to keep', kicker: 'Your documents' },
  payment_receipt: { title: 'Your payment receipt', kicker: 'Your documents' },
  balance_statement: { title: 'Your balance statement', kicker: 'Your documents' },
  document_email: { title: 'Your sales document', kicker: 'Your documents' },
  customer_access_link: { title: 'Everything for your car, in one place', kicker: 'Your private customer page' },
};
function secureEmailLink(value: unknown): string | undefined {
  if (typeof value !== 'string' || /[\\<>"\s\u0000-\u001f]/.test(value)) return undefined;
  // Explicit HTTPS host grammar; credentials and other schemes never become buttons.
  return /^https:\/\/(?:[a-z0-9-]+\.)+[a-z0-9-]+(?::\d{1,5})?(?:[/?#][^\s]*)?$/i.test(value) ? value : undefined;
}
function emailContrast(colour: string): string {
  const rgb = [1, 3, 5].map(index => parseInt(colour.slice(index, index + 2), 16) / 255).map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4);
  const luminance = .2126 * rgb[0]! + .7152 * rgb[1]! + .0722 * rgb[2]!;
  if (1.05 / (luminance + .05) >= 4.5) return '#ffffff';
  const dark = [.09,.1255,.2].map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4);
  const darkLuminance = .2126 * dark[0]! + .7152 * dark[1]! + .0722 * dark[2]!;
  return (luminance + .05) / (darkLuminance + .05) >= 4.5 ? '#172033' : '#000000';
}
function linkedEmailText(value: string): string {
  let result = '', start = 0;
  for (const match of value.matchAll(/https:\/\/[^\s<>]+/g)) {
    const index = match.index!;
    result += escapeEmailHtml(value.slice(start, index));
    const raw = match[0], link = secureEmailLink(raw);
    result += link ? `<a href="${escapeEmailHtml(link)}" style="color:#24577a;text-decoration:underline;word-break:break-all">${escapeEmailHtml(raw)}</a>` : escapeEmailHtml(raw);
    start = index + raw.length;
  }
  return result + escapeEmailHtml(value.slice(start));
}
/** One email-safe layout for automatic messages, document emails and staff correspondence. */
export function renderEmailTemplate(template: Pick<EmailTemplate, 'subject' | 'body' | 'headline'>, variables: Record<string, string | number | null | undefined>, facts: EmailFacts, appearance: EmailAppearance = defaultEmailAppearance, options: EmailRenderOptions = {}) {
  const copy = validateEmailTemplate(template), branding = validateEmailAppearance(appearance);
  const interpolate = (value: string) => value.replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (_token, key: string) => String(variables[key] ?? ''));
  const subject = interpolate(copy.subject).replace(/[\r\n\u0000-\u001f\u007f]/g, ' ').slice(0, 200).trim();
  if (!subject) throw new EmailTemplateError('The rendered subject is empty.');
  const prose = interpolate(copy.body).trim().replace(/^Hi\s*,/, 'Hi there,'), heading = interpolate(branding.heading), footer = interpolate(branding.footer);
  const details = facts.filter(fact => fact.value !== null && fact.value !== undefined && String(fact.value).trim() !== '');
  const presentation = emailPresentation[options.templateId ?? ''] ?? { title: 'A message for you', kicker: 'Your dealership' };
  const dealer = String(variables.dealer_name ?? '').trim();
  const factText = details.map(fact => `${fact.label}: ${fact.value}`).join('\n');
  const attachments = (options.attachments ?? []).filter(name => name.trim());
  const actionUrl = options.templateId === 'customer_access_link' ? secureEmailLink(variables.portal_url) : options.templateId?.startsWith('booking_') && options.templateId !== 'booking_cancellation' ? secureEmailLink(variables.manage_url) : undefined;
  const actionLabel = options.templateId === 'customer_access_link' ? 'Open your private page' : 'Manage your test drive';
  const foreground = emailContrast(branding.brandColour);
  const contactEmail = typeof variables.dealer_email === 'string' && /^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(variables.dealer_email) ? variables.dealer_email : '';
  const phone = String(variables.dealer_phone ?? '').trim(), dial = /^[+\d ()-]+$/.test(phone) ? phone.replace(/[^+\d]/g, '') : '';
  const contact = [contactEmail ? `<a href="mailto:${escapeEmailHtml(encodeURIComponent(contactEmail).replaceAll('%40', '@'))}" style="color:#24577a;text-decoration:underline">${escapeEmailHtml(contactEmail)}</a>` : '', phone ? dial ? `<a href="tel:${escapeEmailHtml(dial)}" style="color:#24577a;text-decoration:underline">${escapeEmailHtml(phone)}</a>` : escapeEmailHtml(phone) : ''].filter(Boolean).join(' &nbsp;·&nbsp; ');
  const paragraphs = prose.split(/\n\s*\n/).filter(Boolean).map(paragraph => `<p style="margin:0 0 18px;font-size:16px;line-height:1.75;word-break:break-word;color:#344454">${linkedEmailText(paragraph).replaceAll('\n', '<br>')}</p>`).join('');
  const factRows = details.map(fact => `<tr><th scope="row" width="38%" style="padding:13px 12px 13px 0;border-bottom:1px solid #e1e7ed;font-size:13px;line-height:1.6;font-weight:400;text-align:left;vertical-align:top;color:#536474">${escapeEmailHtml(fact.label)}</th><td style="padding:13px 0;border-bottom:1px solid #e1e7ed;font-size:14px;line-height:1.6;font-weight:600;vertical-align:top;word-break:break-word;color:#172d3e">${linkedEmailText(String(fact.value))}</td></tr>`).join('');
  const brandHeader = branding.logoUrl || heading ? `<tr><td class="email-pad" style="padding:32px 36px 24px;border-bottom:1px solid #e9eef2">${branding.logoUrl ? `<img class="email-logo" src="${escapeEmailHtml(branding.logoUrl)}" alt="${escapeEmailHtml(dealer || heading)}" width="200" style="display:block;width:auto;max-width:240px;max-height:64px;height:auto;margin:0 0 16px;border:0">` : ''}${heading ? `<p style="margin:0;font-size:18px;font-weight:700;line-height:1.4;word-break:break-word;color:#172d3e">${escapeEmailHtml(heading)}</p>` : ''}</td></tr>` : '';
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>${escapeEmailHtml(subject)}</title><style>@media only screen and (max-width:600px){.email-shell{padding:12px 8px!important}.email-pad{padding:26px 20px!important}.email-title{font-size:27px!important}.email-button{display:block!important;text-align:center!important}.email-logo{max-width:200px!important}}</style></head><body style="margin:0;padding:0;background:#f2f5f7;color:#172d3e;font-family:Arial,Helvetica,sans-serif;-webkit-text-size-adjust:100%"><div style="display:none;max-height:0;overflow:hidden;mso-hide:all">${escapeEmailHtml(prose.replace(/\s+/g, ' ').slice(0, 140))}</div><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f2f5f7"><tr><td class="email-shell" align="center" style="padding:32px 16px"><!--[if mso]><table role="presentation" width="620"><tr><td><![endif]--><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:620px;background:white;border:1px solid #dce5eb;border-radius:16px"><tr><td style="height:6px;background:${branding.brandColour};border-radius:16px 16px 0 0;font-size:0;line-height:0">&nbsp;</td></tr>${brandHeader}<tr><td class="email-pad" style="padding:32px 36px"><p style="margin:0 0 12px;font-size:12px;font-weight:700;letter-spacing:1.2px;text-transform:uppercase;color:#607485">${escapeEmailHtml(presentation.kicker)}</p><h1 class="email-title" style="margin:0 0 26px;font-size:32px;line-height:1.25;letter-spacing:-.5px;font-weight:700;word-break:break-word;color:#172d3e">${escapeEmailHtml(copy.headline ? interpolate(copy.headline) : presentation.title)}</h1>${paragraphs}${factRows ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:26px 0;background:#f6f8fa;border:1px solid #e1e7ed;border-radius:12px"><tr><td style="padding:18px 20px"><h2 style="margin:0 0 6px;font-size:16px;line-height:1.5;color:#172d3e">Details for your records</h2><table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse">${factRows}</table></td></tr></table>` : ''}${actionUrl ? `<p style="margin:28px 0"><a class="email-button" href="${escapeEmailHtml(actionUrl)}" style="display:inline-block;padding:15px 24px;border:1px solid ${branding.brandColour};border-radius:8px;background:${branding.brandColour};color:${foreground};font-size:15px;font-weight:700;line-height:1.4;text-decoration:none;mso-padding-alt:15px 24px">${actionLabel}</a></p>` : ''}${attachments.length ? `<div style="margin:26px 0 0;padding:18px 0 0;border-top:1px solid #e1e7ed"><h2 style="margin:0 0 10px;font-size:14px;line-height:1.5;color:#172d3e">Included with this email</h2>${attachments.map(name => `<p style="margin:6px 0;font-size:13px;line-height:1.6;word-break:break-word;color:#536474">${escapeEmailHtml(name)}</p>`).join('')}</div>` : ''}</td></tr>${footer || contact ? `<tr><td class="email-pad" style="padding:24px 36px;background:#f9fbfc;border-top:1px solid #e9eef2;border-radius:0 0 16px 16px">${contact ? `<p style="margin:0 0 12px;font-size:14px;line-height:1.8">${contact}</p>` : ''}${footer ? `<div style="font-size:12px;line-height:1.7;color:#607485">${linkedEmailText(footer).replaceAll('\n', '<br>')}</div>` : ''}</td></tr>` : ''}</table><!--[if mso]></td></tr></table><![endif]--></td></tr></table></body></html>`;
  // Keep the plain-text form useful for accessibility and staff template application.
  return { subject, text: [heading, options.templateId ? (copy.headline ? interpolate(copy.headline) : presentation.title) : '', prose, actionUrl ? `${actionLabel}: ${actionUrl}` : '', factText ? 'Details for your records\n' + factText : '', attachments.length ? 'Attachments\n' + attachments.join('\n') : '', [contactEmail, phone].filter(Boolean).join(' · '), footer].filter(Boolean).join('\n\n'), html };
}
