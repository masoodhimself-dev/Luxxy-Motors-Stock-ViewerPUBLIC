import { createHash, randomUUID } from "node:crypto";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { cazooCustomerReplyLeadJoins } from "./cazoo-customer-reply-lineage";
import { renderCazooCustomerReplyForwardEmail } from "./cazoo-forward-email";
import { cazooLeadForwardRecipient } from "./cazoo-lead-forwarding";
import { mailbox, replyConfiguration } from "./customer-email-replies";
import { dealerFeatureEnabled } from "./dealer-features";
import { dealerIntegrationsStore, effectiveResendSettings, integrationReadiness } from "./dealer-integrations-store";
import { classifyEmailFailure, EmailProviderError, emailAccountHash, prepareEmailWithSettings, sendPreparedEmail } from "./email-provider";
import { serviceLifecycle } from "./service-lifecycle";
import { runBoundedDealerJob } from "./tenant-jobs";

type Forward = {
  reply_id: string; dealer_id: string; recipient: string; attempts: number;
  retry_deadline: Date | string; payload: string | null; payload_hash: string | null; account_hash: string | null;
};
type Source = {
  canonical_origin: string; retailer_id: string; source_url: string; lead_mailbox: string; reply_address: string;
  enquiry_id: string; customer_name: string; vehicle_title: string | null; vehicle_registration: string | null;
  subject: string; message: string; sender: string;
};
type EndStatus = "sent" | "failed" | "unknown" | "cancelled";
type Options = { send?: typeof sendPreparedEmail };
const hash = (value: string) => createHash("sha256").update(value).digest("hex");

const sources = sql`enquiry_email_replies m
  JOIN enquiry_email_reply_routes route ON route.id=m.route_id AND route.dealer_id=m.dealer_id
  ${cazooCustomerReplyLeadJoins}
  JOIN enquiries original ON original.id=m.enquiry_id AND original.dealer_id=m.dealer_id
  JOIN enquiries e ON e.id=coalesce(original.merged_into_id,original.id) AND e.dealer_id=m.dealer_id
  JOIN dealerships d ON d.id=m.dealer_id
  JOIN cazoo_lead_forwarding_settings s ON s.dealer_id=d.id`;

// Used both when building the notice and immediately before recording a send attempt.
const eligible = sql`m.id=f.reply_id AND m.dealer_id=f.dealer_id AND r.id=f.lead_receipt_id
  AND m.status='received' AND m.error_code IS NULL AND m.sender=route.recipient
  AND m.subject IS NOT NULL AND m.message IS NOT NULL AND m.sender<>f.recipient
  AND r.status='imported' AND r.error_code IS DISTINCT FROM 'owner_test'
  AND coalesce(lead.merged_into_id,lead.id)=e.id
  AND e.merged_into_id IS NULL AND e.archived_at IS NULL
  AND d.status='active' AND d.stock_platform='cazoo' AND s.enabled=true AND s.forward_replies=true AND s.recipient=f.recipient
  AND NOT EXISTS(SELECT 1 FROM dealer_demos demo WHERE demo.dealer_id=d.id AND demo.converted_at IS NULL)
  AND NOT EXISTS(SELECT 1 FROM enquiry_email_reply_routes alias WHERE alias.reply_address=f.recipient)
  AND NOT EXISTS(SELECT 1 FROM vehicle_watch_reply_routes alias WHERE alias.reply_address=f.recipient)`;

async function finish(row: Forward, lease: string, status: EndStatus, reason: string | null, providerId: string | null = null) {
  await db.execute(sql`UPDATE cazoo_customer_reply_forwards
    SET status=${status},error_code=${reason},provider_id=${providerId},finished_at=now(),lease_token=NULL,lease_until=NULL,
      payload=NULL,payload_hash=NULL,account_hash=NULL
    WHERE reply_id=${row.reply_id}::uuid AND dealer_id=${row.dealer_id} AND lease_token=${lease}::uuid`);
}

async function reschedule(row: Forward, lease: string, seconds: number, reason: string, discardAttempt = false) {
  const next = new Date(Date.now() + seconds * 1000);
  const attempts = row.attempts - Number(discardAttempt);
  if (next.getTime() >= new Date(row.retry_deadline).getTime()) {
    await finish(row, lease, attempts ? "unknown" : "failed", "retry_window_expired");
    return;
  }
  await db.execute(sql`UPDATE cazoo_customer_reply_forwards
    SET status='pending',next_attempt_at=${next},error_code=${reason},lease_token=NULL,lease_until=NULL,attempts=${attempts}
    WHERE reply_id=${row.reply_id}::uuid AND dealer_id=${row.dealer_id} AND lease_token=${lease}::uuid`);
}

async function deliver(row: Forward, source: Source, lease: string, send: typeof sendPreparedEmail) {
  const { cazooLeadMailboxes, cazooLeadsEnabled } = await import("./cazoo-leads");
  const mailboxes = cazooLeadMailboxes();
  const replyDomain = replyConfiguration(row.dealer_id)?.domain;
  const recipient = cazooLeadForwardRecipient(row.recipient, Object.values(mailboxes));
  if (!cazooLeadsEnabled() || mailboxes[row.dealer_id] !== source.lead_mailbox || !replyDomain ||
    !source.reply_address.endsWith(`@${replyDomain}`) || !recipient || recipient.endsWith(`@${replyDomain}`) ||
    mailbox(source.sender) === recipient) {
    await finish(row, lease, row.attempts ? "unknown" : "cancelled", "forwarding_changed");
    return;
  }
  if (!(await dealerFeatureEnabled("customerEmails", row.dealer_id))) {
    await reschedule(row, lease, 300, "delivery_disabled");
    return;
  }
  const settings = await dealerIntegrationsStore.readPrivate();
  const resend = { ...effectiveResendSettings(settings), replyTo: "" };
  if (!resend.enabled || !integrationReadiness({ ...settings, resend }).resend.ready) {
    await reschedule(row, lease, 300, "delivery_not_ready");
    return;
  }
  const content = renderCazooCustomerReplyForwardEmail({
    origin: source.canonical_origin, enquiryId: source.enquiry_id, replyId: row.reply_id,
    customerName: source.customer_name, vehicleTitle: source.vehicle_title, vehicleRegistration: source.vehicle_registration,
    subject: source.subject, message: source.message,
  });
  if (!content) {
    await finish(row, lease, row.attempts ? "unknown" : "cancelled", "portal_unavailable");
    return;
  }
  const key = `cazoo-customer-reply-forward-${row.reply_id}`;
  const prepared = await prepareEmailWithSettings(resend, { ...content, to: recipient, idempotencyKey: key });
  const rendered = JSON.stringify(prepared.body);
  const payloadHash = hash(rendered), accountHash = emailAccountHash(prepared.config);
  if (row.payload !== null && (row.payload_hash !== payloadHash || row.account_hash !== accountHash || hash(row.payload) !== payloadHash)) {
    await finish(row, lease, row.attempts ? "unknown" : "cancelled", "delivery_configuration_changed");
    return;
  }
  const payload = row.payload ?? rendered;
  const attempt = (await db.execute(sql`UPDATE cazoo_customer_reply_forwards f
    SET attempts=f.attempts+1,payload=${payload},payload_hash=${payloadHash},account_hash=${accountHash}
    FROM ${sources}
    WHERE ${eligible} AND f.reply_id=${row.reply_id}::uuid AND f.dealer_id=${row.dealer_id} AND f.lease_token=${lease}::uuid
      AND f.lease_until>now() AND f.retry_deadline>now() AND d.canonical_origin=${source.canonical_origin}
      AND r.mailbox=${source.lead_mailbox} AND route.reply_address=${source.reply_address} AND e.id=${source.enquiry_id}::uuid
      AND m.subject=${source.subject} AND m.message=${source.message}
    RETURNING f.attempts`)).rows[0];
  if (!attempt) {
    await finish(row, lease, row.attempts ? "unknown" : "cancelled", "forwarding_changed");
    return;
  }
  row.attempts = Number(attempt.attempts);
  try {
    const providerId = await send(prepared.config, payload, key);
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

/** A reply notice has a separate identity and never participates in the customer email thread. */
export async function processCazooCustomerReplyForwards({ send = sendPreparedEmail }: Options = {}) {
  await db.execute(sql`UPDATE cazoo_customer_reply_forwards
    SET status=CASE WHEN attempts>0 THEN 'unknown' ELSE 'failed' END,
      error_code=CASE WHEN status='sending' THEN 'lease_expired' ELSE 'retry_window_expired' END,
      finished_at=now(),lease_token=NULL,lease_until=NULL,payload=NULL,payload_hash=NULL,account_hash=NULL
    WHERE reply_id IN(SELECT reply_id FROM cazoo_customer_reply_forwards
      WHERE (status='sending' AND lease_until<=now()) OR (status='pending' AND retry_deadline<=now()) LIMIT 20)
      AND ((status='sending' AND lease_until<=now()) OR (status='pending' AND retry_deadline<=now()))`);
  for (let count = 0; count < 5 && !serviceLifecycle.isDraining(); count++) {
    const lease = randomUUID();
    const row = (await db.execute(sql`WITH candidate AS (
      SELECT f.reply_id FROM cazoo_customer_reply_forwards f
      WHERE f.status='pending' AND f.next_attempt_at<=now() AND f.retry_deadline>now() AND f.attempts<3
      ORDER BY f.next_attempt_at,f.reply_id FOR UPDATE OF f SKIP LOCKED LIMIT 1
    ) UPDATE cazoo_customer_reply_forwards f SET status='sending',lease_token=${lease}::uuid,lease_until=now()+interval '2 minutes'
      FROM candidate c WHERE f.reply_id=c.reply_id RETURNING f.*`)).rows[0] as unknown as Forward | undefined;
    if (!row) break;
    const attempts = row.attempts;
    try {
      const source = (await db.execute(sql`SELECT d.canonical_origin,d.retailer_id,d.source_url,r.mailbox AS lead_mailbox,
        route.reply_address,e.id AS enquiry_id,e.customer_name,e.vehicle_title,e.vehicle_registration,m.subject,m.message,m.sender
        FROM ${sources},cazoo_customer_reply_forwards f
        WHERE ${eligible} AND f.reply_id=${row.reply_id}::uuid AND f.dealer_id=${row.dealer_id} AND f.lease_token=${lease}::uuid`)).rows[0] as unknown as Source | undefined;
      if (!source) {
        await finish(row, lease, row.attempts ? "unknown" : "cancelled", "forwarding_changed");
        continue;
      }
      await runBoundedDealerJob({ dealerId: row.dealer_id, canonicalOrigin: source.canonical_origin, platform: "cazoo",
        retailerId: source.retailer_id, sourceUrl: source.source_url }, () => deliver(row, source, lease, send));
    } catch {
      if (row.attempts > attempts) await finish(row, lease, "unknown", "acceptance_unknown");
      else await reschedule(row, lease, 300, "preparation_unavailable");
    }
  }
}
