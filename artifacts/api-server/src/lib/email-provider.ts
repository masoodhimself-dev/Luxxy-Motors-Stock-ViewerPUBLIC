/** Direct Resend transport. Never depends on hosting-provider credentials. */
export async function sendEmail(
  to: string,
  subject: string,
  html: string,
  idempotencyKey: string,
  _dealerName: string,
  attachments?: Array<{ filename: string; content: string }>,
) {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  const from = process.env.RESEND_FROM_EMAIL?.trim();
  if (!apiKey || !from) throw new Error('Configure RESEND_API_KEY and RESEND_FROM_EMAIL before sending email.');
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    signal: AbortSignal.timeout(15_000),
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'Idempotency-Key': idempotencyKey,
    },
    body: JSON.stringify({ from, to: [to], subject, html, ...(attachments?.length ? { attachments } : {}) }),
  });
  if (!response.ok) throw new Error(`Email provider returned HTTP ${response.status}.`);
  const result = await response.json() as { id?: string };
  if (!result.id) throw new Error('Email provider did not return a delivery identifier.');
  return result.id;
}
