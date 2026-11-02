import { createHash } from 'node:crypto';
import { mailbox } from './customer-email-replies';
import { cazooEmailText, CazooLeadError, parseCazooLead, parseCazooLeadBody, type CazooLead } from './cazoo-lead-parser';

type Delivery = Parameters<typeof parseCazooLead>[0] & { id: string };
export type CazooTestSender = { email: string; expiresAt: string };
/** Exact dealer-scoped, owner-configured temporary test address. No domains or wildcard rules. */
export function cazooTestSender(dealer: string, now = Date.now()): CazooTestSender | null {
  try {
    const config: unknown = JSON.parse(process.env.CAZOO_OWNER_TEST_SENDERS || '{}');
    if (!config || typeof config !== 'object' || Array.isArray(config)) return null;
    const value = (config as Record<string, unknown>)[dealer];
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const rule = value as Record<string, unknown>;
    if (typeof rule.email !== 'string' || typeof rule.expiresAt !== 'string') return null;
    const email = mailbox(rule.email), expires = Date.parse(rule.expiresAt);
    if (!email || rule.email.trim().toLowerCase() !== email || !Number.isFinite(expires) || expires <= now || expires > now + 8 * 86400000) return null;
    return { email, expiresAt: new Date(expires).toISOString() };
  } catch { return null; }
}

/** Normal delivery checks are unchanged. Test contacts are never copied from a forwarded lead. */
export function parseCazooDelivery(dealer: string, email: Delivery, now = Date.now()): { lead: CazooLead; testDelivery: boolean } {
  const rule = cazooTestSender(dealer, now);
  if (!rule || mailbox(email.from) !== rule.email) return { lead: parseCazooLead(email), testDelivery: false };
  if (email.authentication?.dmarc?.toLowerCase() !== 'pass') throw new CazooLeadError('sender_authentication_unverified');
  const subject = email.subject.trim().replace(/^(?:(?:fwd?|re):\s*)+/i, '');
  const normalized = cazooEmailText(email).replace(/^\s*(?:>\s*)+/gm, '').trim();
  const starts = [...normalized.matchAll(/(?:^|\n)\s*New sales lead\s*(?=\n|$)/gi)];
  let lead: CazooLead;
  if (starts.length === 1) {
    // Deliberately drop all forwarding headers and any previous dealer reply.
    lead = parseCazooLeadBody({ subject, text: normalized.slice(starts[0]!.index) });
  } else {
    if (starts.length || /(?:forwarded message|Customer details|Customer message|CorrelationID:|\bwrote:)/i.test(normalized) || !normalized || normalized.length > 12000)
      throw new CazooLeadError('owner_test_format');
    // A plain owner test still needs the known vehicle subject; no AI routing guess.
    lead = parseCazooLeadBody({ subject, text: `Customer message\n${normalized}\nEnquiry type\nQuestion\nCustomer details\nOwner Test\n${rule.email}\nCall Owner\nCorrelationID: ${'0'.repeat(32)}` });
  }
  return { testDelivery: true, lead: {
    ...lead,
    // Different namespace: a forwarded test must never deduplicate a later genuine Cazoo lead.
    correlationId: createHash('sha256').update(`owner-test:${dealer}:${email.id}`).digest('hex').slice(0,32),
    customerName: 'Owner test', email: rule.email, phone: null,
  } };
}
