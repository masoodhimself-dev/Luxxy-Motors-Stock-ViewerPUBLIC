import { createHash, randomUUID } from "node:crypto";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { z } from "zod/v4";
import { cazooEmailText } from "./cazoo-lead-parser";
import { renderCazooForwardEmail } from "./cazoo-forward-email";
import { cazooTestSender } from "./cazoo-owner-test";
import { mailbox, replyConfiguration, type retrieveReply } from "./customer-email-replies";
import { dealerFeatureEnabled } from "./dealer-features";
import { dealerIntegrationsStore, effectiveResendSettings, integrationReadiness } from "./dealer-integrations-store";
import { classifyEmailFailure, EmailProviderError, emailAccountHash, prepareEmailWithSettings, sendPreparedEmail } from "./email-provider";
import { emailRetryWindowMs } from "./email-outbox";
import { serviceLifecycle } from "./service-lifecycle";
import { runBoundedDealerJob } from "./tenant-jobs";

type Executor = Pick<typeof db, "execute">;
type Receipt = { id: string; dealer_id: string; provider_id: string; mailbox: string };
type ReceivedEmail = Awaited<ReturnType<typeof retrieveReply>>;
type Forward = {
  receipt_id: string; dealer_id: string; recipient: string;
  subject: string; body: string; payload: string | null; payload_hash: string | null; account_hash: string | null;
  attempts: number; retry_deadline: Date | string;
};
type Dealer = { canonical_origin: string; retailer_id: string; source_url: string; mailbox: string };
type EndStatus = "sent" | "failed" | "unknown" | "cancelled";
const cazooSender = "dealerleads@info.cazoo.co.uk";
const uuid = z.string().uuid();
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const sendKey = (id: string) => `cazoo-lead-forward-${id}`;
const escape = (value: string) => value.replace(/[&<>]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[char]!));

export function cazooLeadForwardRecipient(value: unknown, leadMailboxes: readonly string[]): string | null {
  const to = mailbox(value);
  return to && typeof value === "string" && value.trim().toLowerCase() === to &&
    to !== cazooSender && !leadMailboxes.includes(to) ? to : null;
}

/** Only verified direct Cazoo messages can cross the dedicated mailbox boundary. */
export async function queueCazooLeadForward(
  receipt: Receipt,
  email: ReceivedEmail,
  executor: Executor = db,
): Promise<"queued" | "already_queued" | "not_eligible"> {
  if (!uuid.safeParse(receipt.id).success || email.id !== receipt.provider_id ||
    mailbox(email.from) !== cazooSender || email.authentication?.dmarc?.toLowerCase() !== "pass" ||
    cazooTestSender(receipt.dealer_id)?.email === cazooSender ||
    email.to.length !== 1 || mailbox(email.to[0]) !== receipt.mailbox) return "not_eligible";
  const { cazooLeadMailboxes, cazooLeadsEnabled } = await import("./cazoo-leads");
  const mailboxes = cazooLeadMailboxes();
  if (!cazooLeadsEnabled() || mailboxes[receipt.dealer_id] !== receipt.mailbox) return "not_eligible";
  const body = cazooEmailText(email);
  const references = [...body.matchAll(/^\s*CorrelationID:\s*([a-f0-9]{32})\s*$/gim)];
  const dedupeKey = references.length === 1 ? `c:${references[0]![1]!.toLowerCase()}` : `p:${email.id}`;
  const known = (await executor.execute(sql`SELECT 1 FROM cazoo_lead_forwards WHERE dealer_id=${receipt.dealer_id}
    AND (receipt_id=${receipt.id}::uuid OR dedupe_key=${dedupeKey})`)).rows[0];
  if (known) return "already_queued";
  const settings = (await executor.execute(sql`SELECT recipient FROM cazoo_lead_forwarding_settings
    WHERE dealer_id=${receipt.dealer_id} AND enabled=true`)).rows[0];
  const recipient = cazooLeadForwardRecipient(settings?.recipient, Object.values(mailboxes));
  const replyDomain = replyConfiguration(receipt.dealer_id)?.domain;
  if (!recipient || (replyDomain && recipient.endsWith(`@${replyDomain}`))) return "not_eligible";
  const title = email.subject.replace(/[\p{Cc}\p{Cf}]/gu, " ").trim().slice(0, 174);
  const subject = title ? `Cazoo lead: ${title}` : "New Cazoo lead";
  const inserted = (await executor.execute(sql`
    INSERT INTO cazoo_lead_forwards(receipt_id,dealer_id,dedupe_key,recipient,subject,body,retry_deadline)
    SELECT r.id,r.dealer_id,${dedupeKey},${recipient},${subject},${body},${new Date(Date.now() + emailRetryWindowMs)}
    FROM cazoo_lead_receipts r JOIN dealerships d ON d.id=r.dealer_id
    JOIN cazoo_lead_forwarding_settings s ON s.dealer_id=r.dealer_id
    WHERE r.id=${receipt.id}::uuid AND r.dealer_id=${receipt.dealer_id} AND r.provider_id=${receipt.provider_id}::uuid
      AND r.mailbox=${receipt.mailbox} AND r.status IN ('imported','review')
      AND r.error_code IS DISTINCT FROM 'owner_test'
      AND s.enabled=true AND s.recipient=${recipient} AND d.status='active' AND d.stock_platform='cazoo'
      AND NOT EXISTS(SELECT 1 FROM dealer_demos WHERE dealer_id=d.id AND converted_at IS NULL)
    ON CONFLICT DO NOTHING RETURNING receipt_id
  `)).rows[0];
  if (inserted) return "queued";
  const conflict = (await executor.execute(sql`SELECT 1 FROM cazoo_lead_forwards WHERE dealer_id=${receipt.dealer_id}
    AND (receipt_id=${receipt.id}::uuid OR dedupe_key=${dedupeKey})`)).rows[0];
  return conflict ? "already_queued" : "not_eligible";
}

async function finish(row: Forward, lease: string, status: EndStatus, reason: string | null, providerId: string | null = null) {
  await db.execute(sql`UPDATE cazoo_lead_forwards
    SET status=${status},error_code=${reason},provider_id=${providerId},finished_at=now(),lease_token=NULL,lease_until=NULL,
      subject=NULL,body=NULL,payload=NULL,payload_hash=NULL,account_hash=NULL
    WHERE receipt_id=${row.receipt_id}::uuid AND dealer_id=${row.dealer_id} AND lease_token=${lease}::uuid`);
}

async function reschedule(row: Forward, lease: string, seconds: number, reason: string, discardAttempt = false) {
  const next = new Date(Date.now() + seconds * 1000);
  const previousAttempts = row.attempts - Number(discardAttempt);
  if (next.getTime() >= new Date(row.retry_deadline).getTime()) {
    await finish(row, lease, previousAttempts ? "unknown" : "failed", "retry_window_expired");
    return;
  }
  await db.execute(sql`UPDATE cazoo_lead_forwards
    SET status='pending',next_attempt_at=${next},error_code=${reason},lease_token=NULL,lease_until=NULL,
      attempts=greatest(0,attempts-${Number(discardAttempt)})
    WHERE receipt_id=${row.receipt_id}::uuid AND dealer_id=${row.dealer_id} AND lease_token=${lease}::uuid`);
}

type ForwardOptions = { send?: typeof sendPreparedEmail };
async function deliver(row: Forward, dealer: Dealer, lease: string, options: ForwardOptions) {
  const { cazooLeadMailboxes, cazooLeadsEnabled } = await import("./cazoo-leads");
  const mailboxes = cazooLeadMailboxes();
  const settings = (await db.execute(sql`SELECT s.recipient FROM cazoo_lead_forwarding_settings s JOIN dealerships d ON d.id=s.dealer_id
    WHERE s.dealer_id=${row.dealer_id} AND s.enabled=true AND d.status='active' AND d.stock_platform='cazoo'
      AND NOT EXISTS(SELECT 1 FROM dealer_demos WHERE dealer_id=d.id AND converted_at IS NULL)`)).rows[0];
  const recipient = cazooLeadForwardRecipient(settings?.recipient, Object.values(mailboxes));
  const replyDomain = replyConfiguration(row.dealer_id)?.domain;
  if (!cazooLeadsEnabled() || mailboxes[row.dealer_id] !== dealer.mailbox || recipient !== row.recipient ||
    (replyDomain && recipient.endsWith(`@${replyDomain}`))) {
    await finish(row, lease, row.attempts ? "unknown" : "cancelled", "forwarding_changed");
    return;
  }
  if (!(await dealerFeatureEnabled("customerEmails", row.dealer_id))) {
    await reschedule(row, lease, 300, "delivery_disabled");
    return;
  }
  const privateSettings = await dealerIntegrationsStore.readPrivate();
  const configuredResend = effectiveResendSettings(privateSettings);
  const resend = { ...configuredResend, replyTo: "" };
  if (!resend.enabled || !integrationReadiness({ ...privateSettings, resend }).resend.ready) {
    await reschedule(row, lease, 300, "delivery_not_ready");
    return;
  }
  const key = sendKey(row.receipt_id);
  const blockedAddresses = [recipient, ...Object.values(mailboxes), mailbox(resend.from),
    mailbox(configuredResend.replyTo)];
  const content = renderCazooForwardEmail(row.subject, row.body, blockedAddresses, replyDomain);
  const envelope = { to: row.recipient, idempotencyKey: key };
  const prepared = await prepareEmailWithSettings(resend, { ...envelope, ...content });
  let payload = JSON.stringify(prepared.body);
  // An attempted send must keep its original payload across format changes.
  if (row.payload !== null && row.payload_hash !== hash(payload)) {
    const previousContent = renderCazooForwardEmail(row.subject, row.body, blockedAddresses, replyDomain, "before-part-ex");
    const previous = await prepareEmailWithSettings(resend, { ...envelope, ...previousContent });
    payload = JSON.stringify(previous.body);
  }
  if (row.payload !== null && row.payload_hash !== hash(payload)) {
    const text = ["Cazoo enquiry forwarded by DealerOS", "", row.body || "No message body was supplied."].join("\n");
    const legacy = await prepareEmailWithSettings(resend, {
      ...envelope, subject: row.subject, text,
      html: `<div style="font-family:Arial,sans-serif;line-height:1.5">${escape(text).replace(/\n/g, "<br>")}</div>`,
    });
    payload = JSON.stringify(legacy.body);
  }
  const payloadHash = hash(payload), accountHash = emailAccountHash(prepared.config);
  if (row.payload !== null && (row.payload_hash !== payloadHash || row.account_hash !== accountHash || hash(row.payload) !== payloadHash)) {
    await finish(row, lease, row.attempts ? "unknown" : "cancelled", "delivery_configuration_changed");
    return;
  }
  const attempt = (await db.execute(sql`UPDATE cazoo_lead_forwards f
    SET attempts=attempts+1,payload=${row.payload ?? payload},payload_hash=${payloadHash},account_hash=${accountHash}
    WHERE f.receipt_id=${row.receipt_id}::uuid AND f.dealer_id=${row.dealer_id} AND f.lease_token=${lease}::uuid
      AND f.lease_until>now() AND f.retry_deadline>now()
      AND EXISTS(SELECT 1 FROM cazoo_lead_receipts r WHERE r.id=f.receipt_id AND r.dealer_id=f.dealer_id
        AND r.mailbox=${dealer.mailbox} AND r.status IN ('imported','review') AND r.error_code IS DISTINCT FROM 'owner_test')
      AND EXISTS(SELECT 1 FROM cazoo_lead_forwarding_settings s
        JOIN dealerships d ON d.id=s.dealer_id WHERE s.dealer_id=f.dealer_id AND s.enabled=true
          AND s.recipient=f.recipient AND d.status='active' AND d.stock_platform='cazoo'
          AND NOT EXISTS(SELECT 1 FROM dealer_demos WHERE dealer_id=d.id AND converted_at IS NULL))
    RETURNING attempts`)).rows[0];
  if (!attempt) {
    await finish(row, lease, row.attempts ? "unknown" : "cancelled", "forwarding_changed");
    return;
  }
  row.attempts = Number(attempt.attempts);
  try {
    const providerId = await (options.send ?? sendPreparedEmail)(prepared.config, row.payload ?? payload, key);
    await finish(row, lease, "sent", null, providerId);
  } catch (error) {
    const result = classifyEmailFailure(error);
    const local = error instanceof EmailProviderError && !error.attempted;
    if (result.kind === "retryable" && (row.attempts < 3 || local)) {
      await reschedule(row, lease, Math.max(result.retryAfterSeconds ?? 0, local ? 15 : 60 * row.attempts), "temporary_rejection", local);
    } else {
      const definite = row.attempts === 1 && result.kind === "permanent";
      await finish(row, lease, definite ? "failed" : "unknown", definite ? "provider_rejected" : "acceptance_unknown");
    }
  }
}

/** One leased immutable send per receipt, separate from customer reply history. */
export async function processCazooLeadForwards(options: ForwardOptions = {}) {
  await db.execute(sql`UPDATE cazoo_lead_forwards
    SET status=CASE WHEN attempts>0 THEN 'unknown' ELSE 'failed' END,
      error_code=CASE WHEN status='sending' THEN 'lease_expired' ELSE 'retry_window_expired' END,
      finished_at=now(),lease_token=NULL,lease_until=NULL,subject=NULL,body=NULL,payload=NULL,payload_hash=NULL,account_hash=NULL
    WHERE receipt_id IN(SELECT receipt_id FROM cazoo_lead_forwards
      WHERE (status='sending' AND lease_until<=now()) OR (status='pending' AND retry_deadline<=now()) LIMIT 20)
      AND ((status='sending' AND lease_until<=now()) OR (status='pending' AND retry_deadline<=now()))`);
  for (let count = 0; count < 5 && !serviceLifecycle.isDraining(); count++) {
    const lease = randomUUID();
    const row = (await db.execute(sql`WITH candidate AS (
      SELECT f.receipt_id FROM cazoo_lead_forwards f
      WHERE f.status='pending' AND f.next_attempt_at<=now() AND f.retry_deadline>now() AND f.attempts<3
      ORDER BY f.next_attempt_at,f.receipt_id FOR UPDATE OF f SKIP LOCKED LIMIT 1
    ) UPDATE cazoo_lead_forwards f SET status='sending',lease_token=${lease}::uuid,lease_until=now()+interval '2 minutes'
      FROM candidate c WHERE f.receipt_id=c.receipt_id RETURNING f.*`)).rows[0] as unknown as Forward | undefined;
    if (!row) break;
    const dealer = (await db.execute(sql`SELECT d.canonical_origin,d.retailer_id,d.source_url,r.mailbox
      FROM cazoo_lead_receipts r JOIN dealerships d ON d.id=r.dealer_id
      WHERE r.id=${row.receipt_id}::uuid AND r.dealer_id=${row.dealer_id} AND d.status='active' AND d.stock_platform='cazoo'
        AND r.status IN ('imported','review') AND r.error_code IS DISTINCT FROM 'owner_test'`)).rows[0] as unknown as Dealer | undefined;
    if (!dealer) {
      await finish(row, lease, row.attempts ? "unknown" : "cancelled", "receipt_unavailable");
      continue;
    }
    const priorAttempts = row.attempts;
    try {
      await runBoundedDealerJob({ dealerId: row.dealer_id, canonicalOrigin: dealer.canonical_origin, platform: "cazoo",
        retailerId: dealer.retailer_id, sourceUrl: dealer.source_url }, () => deliver(row, dealer, lease, options));
    } catch {
      if (row.attempts > priorAttempts) await finish(row, lease, "unknown", "acceptance_unknown");
      else await reschedule(row, lease, 300, "preparation_unavailable");
    }
  }
}
