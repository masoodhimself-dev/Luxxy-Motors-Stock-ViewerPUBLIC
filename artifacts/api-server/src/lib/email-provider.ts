import { defaultEmailTemplates, renderEmailTemplate, type EmailFacts } from '@workspace/vehicle-meta';
import { dealerIntegrationsStore, effectiveResendSettings, integrationReadiness, type ResendSettings } from './dealer-integrations-store';

/** Transport is injectable so readiness and tests never send an email. */
export async function sendEmailWithSettings(config: ResendSettings, request: { to: string; subject: string; html: string; text?: string; idempotencyKey: string; attachments?: Array<{ filename: string; content: string }> }, transport: typeof fetch = fetch): Promise<string> {
  if (!config.enabled) throw new Error('Email delivery is disabled. Configure and enable Resend in integration settings.');
  if (!integrationReadiness({ resend: config, stripe: { enabled: false, mode: 'test', publishableKey: '', secretKey: '', webhookSecret: '' } }).resend.ready) throw new Error('Configure RESEND_API_KEY and RESEND_FROM_EMAIL or complete the private Resend settings before sending email.');
  if (!/^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(request.to) || !request.subject.trim() || request.subject.length > 200 || /[\r\n\u0000-\u001f]/.test(request.subject)) throw new Error('The email recipient or subject is invalid.');
  let response: Response;
  try {
    response = await transport('https://api.resend.com/emails', {
      method: 'POST', signal: AbortSignal.timeout(15_000),
      headers: { Authorization: `Bearer ${config.apiKey}`, 'Content-Type': 'application/json', 'Idempotency-Key': request.idempotencyKey },
      body: JSON.stringify({ from: config.from, to: [request.to], subject: request.subject, html: request.html, ...(request.text ? { text: request.text } : {}), ...(config.replyTo ? { reply_to: config.replyTo } : {}), ...(request.attachments?.length ? { attachments: request.attachments } : {}) }),
    });
  } catch { throw new Error('Email provider connection failed.'); }
  if (!response.ok) throw new Error(`Email provider returned HTTP ${response.status}.`);
  const result = await response.json() as { id?: string };
  if (!result.id || typeof result.id !== 'string') throw new Error('Email provider did not return a delivery identifier.');
  return result.id;
}
async function resendSettings(): Promise<ResendSettings> {
  const saved = await dealerIntegrationsStore.readPrivate();
  // Environment provisioning is explicit too, and applies only before the owner saves settings.
  return effectiveResendSettings(saved);
}
export async function renderDealerEmail(input: { templateId: string; variables: Record<string, string | number | null | undefined>; facts: EmailFacts }) {
  const { templates, appearance } = await dealerIntegrationsStore.listTemplates();
  const template = templates.find(item => item.id === input.templateId);
  if (!template || !defaultEmailTemplates.some(item => item.id === input.templateId)) throw new Error('This email template is unavailable.');
  return renderEmailTemplate(template, input.variables, input.facts, appearance);
}
export async function sendTemplatedEmail(input: { templateId: string; to: string; variables: Record<string, string | number | null | undefined>; facts: EmailFacts; idempotencyKey: string; attachments?: Array<{ filename: string; content: string }> }): Promise<string> {
  const rendered = await renderDealerEmail(input);
  return sendEmailWithSettings(await resendSettings(), { ...rendered, to: input.to, idempotencyKey: input.idempotencyKey, attachments: input.attachments });
}
/** Direct Resend transport. Never depends on hosting-provider credentials. */
export async function sendEmail(
  to: string,
  subject: string,
  html: string,
  idempotencyKey: string,
  _dealerName: string,
  attachments?: Array<{ filename: string; content: string }>,
) {
  return sendEmailWithSettings(await resendSettings(), { to, subject, html, idempotencyKey, attachments });
}
