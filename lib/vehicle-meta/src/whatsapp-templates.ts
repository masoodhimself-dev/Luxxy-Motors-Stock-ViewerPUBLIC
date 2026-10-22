/** WhatsApp wording is deliberately independent of email wording and delivery. */
export const whatsappTemplateVariables = [
  'customer_name', 'dealer_name', 'vehicle_title', 'vehicle_registration',
  'appointment_time', 'message',
] as const;
export type WhatsAppTemplateVariable = (typeof whatsappTemplateVariables)[number];
export const whatsappTemplateIds = [
  'enquiry', 'vehicle_details', 'photos', 'video', 'appointment',
  'appointment_follow_up', 'invoice', 'reservation', 'declaration', 'customer_link',
] as const;
export type WhatsAppTemplateId = (typeof whatsappTemplateIds)[number];
export type WhatsAppTemplate = { id: WhatsAppTemplateId; label: string; body: string };
const greeting = 'Hi {{customer_name}},\n\n';
const signoff = '\n\nThanks,\n{{dealer_name}}';
export const defaultWhatsAppTemplates: readonly WhatsAppTemplate[] = [
  { id: 'enquiry', label: 'Enquiry reply', body: '{{message}}' },
  { id: 'vehicle_details', label: 'Car details', body: greeting + 'Here are the details for {{vehicle_title}}. Let us know if you have any questions or would like to arrange a test drive.' + signoff },
  { id: 'photos', label: 'Photos', body: greeting + 'Here are the photos of {{vehicle_title}} we discussed. Have a look and let us know if you would like to see anything else.' + signoff },
  { id: 'video', label: 'Car video', body: greeting + 'Here is a closer look at {{vehicle_title}}. You can watch the video using the link below. Let us know what you think.' + signoff },
  { id: 'appointment', label: 'Test drive details', body: greeting + 'Here are the details for your test drive of {{vehicle_title}}. Please check the appointment status and time below, and let us know if you need to change your plans.' + signoff },
  { id: 'appointment_follow_up', label: 'After a test drive', body: greeting + 'Just checking in about {{vehicle_title}}. Do you have any questions we can help with? If you would like to go ahead, we can explain the next steps and deposit options.' + signoff },
  { id: 'invoice', label: 'Invoice or document', body: greeting + 'Here is your document for {{vehicle_title}}. Open the private link below to download a copy. Let us know if you have any questions.' + signoff },
  { id: 'reservation', label: 'Reservation update', body: greeting + 'Here is the latest update on your reservation for {{vehicle_title}}. The current reservation and payment details are below.' + signoff },
  { id: 'declaration', label: 'Test drive declaration', body: greeting + 'Please use the link below to read and complete your test drive declaration. Let us know if you need any help.' + signoff },
  { id: 'customer_link', label: 'Customer page', body: greeting + 'Here is the link to your private customer page. You can use it to view the information we have shared with you.' + signoff },
];
export class WhatsAppTemplateError extends Error {
  readonly status: number;
  constructor(message: string, status = 400) { super(message); this.name = 'WhatsAppTemplateError'; this.status = status; }
}
/** Validate templates, never interpolate untrusted values as another template. */
export function validateWhatsAppTemplate(input: { body?: unknown }): { body: string } {
  if (typeof input?.body !== 'string' || !input.body.trim() || input.body.length > 4000)
    throw new WhatsAppTemplateError('Enter a WhatsApp message between 1 and 4,000 characters.');
  const body = input.body.replace(/\r\n?/g, '\n').trim();
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(body))
    throw new WhatsAppTemplateError('Use plain text without control characters.');
  const remaining = body.replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (_token, key: string) => {
    if (!(whatsappTemplateVariables as readonly string[]).includes(key))
      throw new WhatsAppTemplateError(`The {{${key}}} placeholder is not supported for WhatsApp.`);
    return '';
  });
  if (remaining.includes('{{') || remaining.includes('}}'))
    throw new WhatsAppTemplateError('Check the placeholders. Use the supplied {{placeholder}} names.');
  return { body };
}
/** One replacement pass means customer names/messages containing braces stay literal. */
export function renderWhatsAppTemplate(
  input: { body: string },
  variables: Partial<Record<WhatsAppTemplateVariable, string | number | null | undefined>>,
): string {
  return validateWhatsAppTemplate(input).body.replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (_token, key: WhatsAppTemplateVariable) => {
    const value = String(variables[key] ?? '').replace(/\r\n?/g, '\n');
    return key === 'customer_name' && !value.trim() ? 'there' : value;
  }).trim();
}
/** A one-off reviewed message is literal text, including any braces the staff member typed. */
export function validateWhatsAppMessage(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 4000 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value))
    throw new WhatsAppTemplateError('Enter a WhatsApp message between 1 and 4,000 characters without control characters.');
  return value.replace(/\r\n?/g, '\n').trim();
}
