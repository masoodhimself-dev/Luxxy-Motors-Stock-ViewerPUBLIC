import { recordStockChangeContact } from "./stock-change-tasks";
import { validateStockChangeMessage, StockChangeMessageError } from "./stock-change-message-context";
import { routeCustomerReply } from './customer-email-replies';
import { createHash, randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import type { Logger } from "pino";
import { currentDealerId, multiTenantEnabled } from "./tenant-context";
import { runBoundedDealerJob } from "./tenant-jobs";
import { serviceLifecycle, startLifecycleWorker } from "./service-lifecycle";
import {
  dealerIntegrationsStore,
  effectiveResendSettings,
  type ResendSettings,
} from "./dealer-integrations-store";
import {
  classifyEmailFailure,
  EmailProviderError,
  emailAccountHash,
  prepareEmailWithSettings,
  sendPreparedEmail,
  type EmailEnvelope,
  type EmailRequest,
} from "./email-provider";
import {
  EmailPreparationBusy,
  withEmailPreparation,
} from "./email-preparation";

type Executor = Pick<typeof db, "execute">;
export type OutboxKind = "staff" | "customer" | "dealer" | "reminder";
export type EmailOutbox = {
  id: string;
  dealer_id: string;
  enquiry_id: string;
  delivery_id: string | null;
  kind: OutboxKind;
  send_key: string;
  payload: string | null;
  payload_hash: string;
  validation_hash: string;
  validation: Record<string, any>;
  account_hash: string;
  status: "queued" | "sending" | "sent" | "failed" | "unknown" | "cancelled";
  attempts: number;
  next_attempt_at: Date | string;
  lease_token: string | null;
  lease_until: Date | string | null;
  retry_deadline: Date | string;
  provider_id: string | null;
  error_code: string | null;
  created_at: Date | string;
  finished_at: Date | string | null;
};
const digest = (text: string) =>
  createHash("sha256").update(text).digest("hex");
const instant = (value: Date | string) => new Date(value).getTime();
export const emailRetryWindowMs = 23 * 3600000; // Resend retains keys for24h; leave a one-hour safety margin.
const leaseMs = 2 * 60000;

/** DTSTAMP is volatile metadata; transport retries still use the original bytes. */
export function emailValidationHash(body: EmailEnvelope) {
  return digest(
    JSON.stringify({
      ...body,
      ...(body.attachments
        ? {
            attachments: body.attachments.map((item) =>
              item.filename === "viewing.ics"
                ? {
                    ...item,
                    content: Buffer.from(
                      Buffer.from(item.content, "base64")
                        .toString("utf8")
                        .replace(/^DTSTAMP:.*$/gm, "DTSTAMP:fixed"),
                      "utf8",
                    ).toString("base64"),
                  }
                : item,
            ),
          }
        : {}),
    }),
  );
}

export async function enqueueEmailOutbox(
  input: {
    enquiryId: string;
    deliveryId?: string;
    kind: OutboxKind;
    request: EmailRequest;
    config: ResendSettings;
    validation: Record<string, unknown>;
    now?: Date;
  },
  executor: Executor = db,
): Promise<EmailOutbox> {
  const dealer = currentDealerId(),
    now = input.now ?? new Date();
  const prepared = await prepareEmailWithSettings(
      input.config,
      input.kind === "dealer" ? input.request : await routeCustomerReply(input.request, input.enquiryId, executor),
      executor,
    ),
    payload = JSON.stringify(prepared.body);
  if (Buffer.byteLength(payload) > 22_000_000)
    throw new Error("The approved email is too large to queue.");
  const hash = digest(payload),
    factsHash = emailValidationHash(prepared.body);
  await executor.execute(sql`INSERT INTO email_outbox(dealer_id,enquiry_id,delivery_id,kind,send_key,payload,payload_hash,validation_hash,validation,account_hash,retry_deadline,created_at,updated_at,next_attempt_at)
    VALUES(${dealer},${input.enquiryId}::uuid,${input.deliveryId ?? null}::uuid,${input.kind},${input.request.idempotencyKey},${payload},${hash},${factsHash},${JSON.stringify(input.validation)}::jsonb,${emailAccountHash(prepared.config)},${new Date(now.getTime() + emailRetryWindowMs)},${now},${now},${now}) ON CONFLICT(dealer_id,send_key) DO NOTHING`);
  const row = (
    await executor.execute(
      sql`SELECT * FROM email_outbox WHERE dealer_id=${dealer} AND send_key=${input.request.idempotencyKey}`,
    )
  ).rows[0] as unknown as EmailOutbox;
  if (
    !row ||
    row.enquiry_id !== input.enquiryId ||
    row.kind !== input.kind ||
    row.delivery_id !== (input.deliveryId ?? null)
  )
    throw new Error(
      "This email identity belongs to different approved details.",
    );
  // A new rendering never replaces the payload behind an existing key.
  if (row.validation_hash !== factsHash && row.status === "queued") {
    await executor.execute(
      sql`UPDATE email_outbox SET status='unknown',error_code='details_changed',finished_at=${now},updated_at=${now} WHERE id=${row.id}::uuid AND dealer_id=${dealer} AND status='queued'`,
    );
    row.status = "unknown";
    row.error_code = "details_changed";
    await syncTarget(row, executor);
  }
  return row;
}

function message(row: EmailOutbox) {
  if (row.error_code === 'price_update_changed') return 'This price update was not sent because the price, availability or customer eligibility changed. Review the car and prepare a fresh message.';
  if (row.status === "queued")
    return "The email provider is temporarily busy. The same approved email is queued for a bounded retry.";
  if (row.status === "failed")
    return "The email provider rejected this message. Check the sender and recipient before preparing another email.";
  if (
    row.error_code === "details_changed" ||
    row.error_code === "policy_changed"
  )
    return "The customer, car, booking or sender details changed. Review the email and check Resend before preparing another copy.";
  return "Provider acceptance could not be confirmed. Check Resend before preparing another copy.";
}

async function syncTarget(row: EmailOutbox, executor: Executor = db) {
  const status =
    row.status === "queued" || row.status === "sending"
      ? "sending"
      : row.status === "cancelled"
        ? "unknown"
        : row.status;
  const error =
    status === "sent" ? null : row.status === "sending" ? null : message(row);
  if (row.kind === "staff") {
    if (row.status === 'sent' && row.validation.input?.stockChange) await recordStockChangeContact({dealerId: row.dealer_id, taskId: row.validation.input.stockChange.taskId, enquiryId: row.enquiry_id, channel: 'email', eventKey: `email:${row.delivery_id}`, staffName: String(row.validation.stockChangeStaffName || 'Staff'), now: new Date(row.finished_at || row.created_at)}, executor as typeof db);
    if (row.status === "sent") await executor.execute(sql`UPDATE enquiry_email_replies SET resolved_at=now(),resolved_by='email_reply' WHERE dealer_id=${row.dealer_id} AND enquiry_id=${row.enquiry_id}::uuid AND status='received' AND resolved_at IS NULL AND received_at<=${row.created_at} AND lower(sender)=(SELECT lower(recipient) FROM enquiry_emails WHERE id=${row.delivery_id}::uuid AND dealer_id=${row.dealer_id})`);
    await executor.execute(
      sql`UPDATE enquiry_emails SET status=${status},provider_id=${row.provider_id},error=${error},finished_at=${status === "sending" ? null : new Date()} WHERE id=${row.delivery_id}::uuid AND dealer_id=${row.dealer_id} AND enquiry_id=${row.enquiry_id}::uuid`,
    );
    await executor.execute(
      sql`UPDATE enquiry_email_drafts d SET status=${status === "failed" ? "draft" : status},version=version+1,updated_at=now() FROM enquiry_emails m WHERE d.dealer_id=${row.dealer_id} AND d.enquiry_id=${row.enquiry_id}::uuid AND m.id=${row.delivery_id}::uuid AND m.dealer_id=d.dealer_id AND d.send_request_id=m.request_id AND d.status<>${status === "failed" ? "draft" : status}`,
    );
  } else {
    const prefix =
      row.kind === "customer"
        ? "customer_notification"
        : row.kind === "dealer"
          ? "dealer_notification"
          : "reminder";
    await executor.execute(sql`UPDATE enquiries SET ${sql.identifier(`${prefix}_status`)}=${status},${sql.identifier(`${prefix}_error`)}=${error},${sql.identifier(`${prefix}_provider_id`)}=${row.provider_id},${sql.identifier(`${prefix}_sent_at`)}=${status === "sent" ? new Date() : null}
      WHERE id=${row.enquiry_id}::uuid AND dealer_id=${row.dealer_id} AND appointment_revision=${Number(row.validation.appointmentRevision ?? -1)}`);
  }
}

export async function readEmailOutbox(
  id: string,
  executor: Executor = db,
): Promise<EmailOutbox | undefined> {
  return (
    await executor.execute(
      sql`SELECT * FROM email_outbox WHERE id=${id}::uuid AND dealer_id=${currentDealerId()}`,
    )
  ).rows[0] as unknown as EmailOutbox | undefined;
}

/** Expiry also applies to suspended/expired demos; this operation cannot send. */
export async function recoverExpiredEmailOutboxes(
  now = new Date(),
  dealer?: string,
) {
  const expired = (
    await db.execute(sql`UPDATE email_outbox SET status='unknown',error_code=CASE WHEN retry_deadline<=${now} THEN 'retry_window_expired' ELSE 'lease_expired' END,lease_token=NULL,lease_until=NULL,finished_at=${now},updated_at=${now}
    WHERE ${dealer ? sql`dealer_id=${dealer}` : sql`true`} AND status IN ('queued','sending') AND id IN(SELECT id FROM email_outbox WHERE ${dealer ? sql`dealer_id=${dealer}` : sql`true`} AND ((status='sending' AND lease_until<=${now}) OR (status='queued' AND retry_deadline<=${now})) ORDER BY created_at,id LIMIT 10)
    RETURNING id,dealer_id,enquiry_id,delivery_id,kind,status,validation,provider_id,error_code`)
  ).rows as unknown as EmailOutbox[];
  for (const row of expired) await syncTarget(row);
}

/** No expired lease is resent: a crash may have happened after provider acceptance. */
export async function recoverEmailOutbox(now = new Date()) {
  const dealer = currentDealerId();
  await recoverExpiredEmailOutboxes(now, dealer);
  // Pre-migration sends have no immutable envelope. Never replay them on deploy.
  await db.execute(sql`UPDATE enquiry_emails m SET status='unknown',error='The previous send was interrupted. Check Resend before preparing another copy.',finished_at=${now}
    WHERE m.dealer_id=${dealer} AND m.status='sending' AND m.created_at<${new Date(now.getTime() - 5 * 60000)} AND NOT EXISTS(SELECT 1 FROM email_outbox q WHERE q.dealer_id=m.dealer_id AND q.delivery_id=m.id)`);
  await db.execute(
    sql`UPDATE enquiry_email_drafts d SET status='unknown',version=version+1,updated_at=${now} FROM enquiry_emails m WHERE d.dealer_id=${dealer} AND m.dealer_id=d.dealer_id AND m.enquiry_id=d.enquiry_id AND d.send_request_id=m.request_id AND m.status='unknown' AND d.status='sending'`,
  );
  for (const kind of ["customer", "dealer", "reminder"] as const) {
    const prefix =
      kind === "customer"
        ? "customer_notification"
        : kind === "dealer"
          ? "dealer_notification"
          : "reminder";
    await db.execute(
      sql`UPDATE enquiries e SET ${sql.identifier(`${prefix}_status`)}='unknown',${sql.identifier(`${prefix}_error`)}='The previous send was interrupted. Check Resend before preparing another copy.' WHERE e.dealer_id=${dealer} AND ${sql.identifier(`${prefix}_status`)}='sending' AND (${sql.identifier(`${prefix}_attempted_at`)} IS NULL OR ${sql.identifier(`${prefix}_attempted_at`)}<${new Date(now.getTime() - 15 * 60000)}) AND NOT EXISTS(SELECT 1 FROM email_outbox q WHERE q.dealer_id=e.dealer_id AND q.enquiry_id=e.id AND q.kind=${kind} AND (q.validation->>'appointmentRevision')::integer=e.appointment_revision)`,
    );
  }
  await purgeTerminalEmailPayloads(now, dealer);
}

/** Bounded housekeeping also covers expired demos, without sending any messages. */
export async function purgeTerminalEmailPayloads(
  now = new Date(),
  dealer?: string,
) {
  // Original invoices/payment records and enquiry email audit are never removed.
  await db.execute(
    sql`UPDATE email_outbox SET payload=NULL,validation='{"payloadRetained":false}'::jsonb WHERE id IN (SELECT id FROM email_outbox WHERE ${dealer ? sql`dealer_id=${dealer}` : sql`true`} AND status IN ('sent','failed','unknown','cancelled') AND payload IS NOT NULL AND created_at<${new Date(now.getTime() - 48 * 3600000)} ORDER BY created_at,id LIMIT 25)`,
  );
}

type OutboxOptions = {
  now?: Date;
  clock?: () => Date;
  settings?: () => Promise<ResendSettings>;
  rebuild?: (row: EmailOutbox) => Promise<EmailRequest>;
  send?: (config: ResendSettings, body: string, key: string) => Promise<string>;
};

async function rebuildEmail(row: EmailOutbox, config: ResendSettings) {
  if (row.kind === "staff") {
    const { rebuildStaffOutboxEmail } =
      await import("../routes/enquiry-emails");
    return rebuildStaffOutboxEmail(row);
  }
  const { rebuildAutomaticOutboxEmail } =
    await import("./enquiry-notifications");
  return rebuildAutomaticOutboxEmail(row);
}

/** Exactly one lease owner can attempt the stored envelope; side effects end before releasing it. */
export function deliverEmailOutbox(
  id: string,
  options: OutboxOptions = {},
): Promise<EmailOutbox | undefined> {
  return serviceLifecycle.track(async () => {
    try {
      return await withEmailPreparation(async () => {
        const dealer = currentDealerId(),
          now = options.clock?.() ?? options.now ?? new Date();
        // Metadata first: never load a second large payload copy just to inspect state.
        const existing = (
          await db.execute(
            sql`SELECT id,dealer_id,enquiry_id,delivery_id,kind,status,attempts,next_attempt_at,provider_id,error_code FROM email_outbox WHERE id=${id}::uuid AND dealer_id=${dealer}`,
          )
        ).rows[0] as unknown as EmailOutbox | undefined;
        if (
          !existing ||
          existing.status !== "queued" ||
          instant(existing.next_attempt_at) > now.getTime()
        )
          return existing;
        const token = randomUUID();
        const claimed = await db.transaction(async (tx) => {
          const row = (
            await tx.execute(
              sql`SELECT * FROM email_outbox WHERE id=${id}::uuid AND dealer_id=${dealer} AND status='queued' AND next_attempt_at<=${now} FOR UPDATE SKIP LOCKED`,
            )
          ).rows[0] as unknown as EmailOutbox | undefined;
          if (!row) return undefined;
          if (
            row.attempts >= 3 ||
            instant(row.retry_deadline) <= now.getTime()
          ) {
            const changed = (
              await tx.execute(
                sql`UPDATE email_outbox SET status='unknown',error_code='retry_window_expired',finished_at=${now},updated_at=${now} WHERE id=${id}::uuid RETURNING *`,
              )
            ).rows[0] as unknown as EmailOutbox;
            await syncTarget(changed, tx);
            return changed;
          }
          await tx.execute(
            sql`INSERT INTO email_account_throttle(account_hash,next_allowed_at) VALUES(${row.account_hash},${now}) ON CONFLICT DO NOTHING`,
          );
          const account = (
            await tx.execute(
              sql`SELECT next_allowed_at FROM email_account_throttle WHERE account_hash=${row.account_hash} FOR UPDATE`,
            )
          ).rows[0];
          if (instant(account!.next_allowed_at as Date) > now.getTime()) {
            return (
              await tx.execute(
                sql`UPDATE email_outbox SET next_attempt_at=${account!.next_allowed_at as Date},updated_at=${now} WHERE id=${id}::uuid RETURNING *`,
              )
            ).rows[0] as unknown as EmailOutbox;
          }
          await tx.execute(
            sql`UPDATE email_account_throttle SET next_allowed_at=${new Date(now.getTime() + 1000)} WHERE account_hash=${row.account_hash}`,
          );
          await tx.execute(
            sql`UPDATE email_outbox SET status='sending',attempts=attempts+1,lease_token=${token}::uuid,lease_until=${new Date(now.getTime() + leaseMs)},updated_at=${now} WHERE id=${id}::uuid`,
          );
          return {
            ...row,
            status: "sending" as const,
            attempts: Number(row.attempts) + 1,
            lease_token: token,
            lease_until: new Date(now.getTime() + leaseMs),
          };
        });
        if (
          !claimed ||
          claimed.status !== "sending" ||
          claimed.lease_token !== token
        )
          return claimed ?? (await readEmailOutbox(id));
        let status: EmailOutbox["status"] = "sent",
          code: string | null = null,
          providerId: string | null = null,
          nextAttempt = now,
          countAttempt = true,
          accountCooldown: Date | null = null;
        try {
          if (
            !claimed.payload ||
            digest(claimed.payload) !== claimed.payload_hash
          )
            throw new Error(
              "The saved email payload failed its integrity check.",
            );
          const config = await (
            options.settings ??
            (async () =>
              effectiveResendSettings(
                await dealerIntegrationsStore.readPrivate(),
              ))
          )();
          const request = await (
            options.rebuild ?? ((row) => rebuildEmail(row, config))
          )(claimed);
          // Recheck immediately before every provider attempt, including queued
          // retries. The approved wording/bytes are never refreshed silently.
          if (claimed.kind === 'staff') await validateStockChangeMessage(claimed.validation.input?.stockChange, {dealerId: claimed.dealer_id, enquiryId: claimed.enquiry_id, email: claimed.validation.input?.to});
          const prepared = await prepareEmailWithSettings(config, claimed.kind === "dealer" ? request : await routeCustomerReply(request, claimed.enquiry_id, db, false));
          if (
            emailAccountHash(prepared.config) !== claimed.account_hash ||
            emailValidationHash(prepared.body) !== claimed.validation_hash
          ) {
            status = "unknown";
            code = "policy_changed";
          } else {
            providerId = await (options.send ?? sendPreparedEmail)(
              prepared.config,
              claimed.payload!,
              claimed.send_key,
            );
          }
        } catch (error) {
          const failure = classifyEmailFailure(error);
          const receivedAt = options.clock?.() ?? options.now ?? new Date();
          countAttempt = !(
            (error instanceof EmailProviderError && !error.attempted) || error instanceof StockChangeMessageError
          );
          if (
            countAttempt &&
            failure.kind === "retryable" &&
            error instanceof EmailProviderError &&
            (error.httpStatus === 429 || failure.retryAfterSeconds !== null)
          )
            accountCooldown = new Date(
              receivedAt.getTime() +
                Math.max(failure.retryAfterSeconds ?? 60, 1) * 1000,
            );
          if (error instanceof StockChangeMessageError) {
            status = 'failed';
            code = 'price_update_changed';
          } else if (failure.kind === "permanent") {
            status = "failed";
            code = "provider_rejected";
          } else if (
            failure.kind === "retryable" &&
            (claimed.attempts < 3 || !countAttempt)
          ) {
            nextAttempt = new Date(
              receivedAt.getTime() +
                Math.max(
                  failure.retryAfterSeconds ?? 0,
                  countAttempt ? (claimed.attempts === 1 ? 60 : 300) : 15,
                ) *
                  1000,
            );
            if (nextAttempt.getTime() < instant(claimed.retry_deadline)) {
              status = "queued";
              code = "temporary_rejection";
            } else {
              status = "unknown";
              code = "retry_window_expired";
            }
          } else {
            // Concurrent409 and server errors cannot prove nonacceptance. Exhaustion
            // must never invite a second independent send while acceptance is unclear.
            status =
              failure.kind === "retryable" &&
              error instanceof EmailProviderError &&
              error.httpStatus === 429
                ? "failed"
                : "unknown";
            code =
              failure.kind === "retryable"
                ? "attempt_limit"
                : "acceptance_unknown";
          }
        }
        return db.transaction(async (tx) => {
          if (accountCooldown)
            await tx.execute(
              sql`UPDATE email_account_throttle SET next_allowed_at=greatest(next_allowed_at,${accountCooldown}) WHERE account_hash=${claimed.account_hash}`,
            );
          const row = (
            await tx.execute(sql`UPDATE email_outbox SET status=${status},provider_id=${providerId},error_code=${code},attempts=greatest(0,attempts-${countAttempt ? 0 : 1}),next_attempt_at=${nextAttempt},lease_token=NULL,lease_until=NULL,finished_at=${status === "queued" ? null : new Date()},updated_at=now()
        WHERE id=${id}::uuid AND dealer_id=${dealer} AND status='sending' AND lease_token=${token}::uuid RETURNING *`)
          ).rows[0] as unknown as EmailOutbox | undefined;
          if (row) await syncTarget(row, tx);
          return row ?? (await readEmailOutbox(id, tx));
        });
      });
    } catch (error) {
      if (!(error instanceof EmailPreparationBusy)) throw error;
      const now = options.clock?.() ?? options.now ?? new Date();
      const row = (
        await db.execute(
          sql`UPDATE email_outbox SET next_attempt_at=${new Date(now.getTime() + 15000)},error_code='local_capacity',updated_at=${now} WHERE id=${id}::uuid AND dealer_id=${currentDealerId()} AND status='queued' RETURNING id,dealer_id,enquiry_id,delivery_id,kind,status,attempts,next_attempt_at,validation,provider_id,error_code`,
        )
      ).rows[0] as unknown as EmailOutbox | undefined;
      if (row) await syncTarget(row);
      return row;
    }
  });
}

/** A normal customer/dealer pair may wait one account-spacing interval, never a retry backoff. */
export function attemptQueuedEmail(id: string, options: OutboxOptions = {}) {
  return serviceLifecycle.track(async () => {
    let row = await deliverEmailOutbox(id, options);
    const delay = row ? instant(row.next_attempt_at) - Date.now() : 0;
    if (
      row?.status === "queued" &&
      row.attempts === 0 &&
      delay > 0 &&
      delay <= 1100
    ) {
      await new Promise((r) => setTimeout(r, delay + 5));
      row = await deliverEmailOutbox(id, options);
    }
    return row;
  });
}

export async function staffOutboxMetadata(enquiryId: string) {
  const rows = (
    await db.execute(
      sql`SELECT delivery_id,attempts,CASE WHEN status='queued' THEN next_attempt_at ELSE NULL END AS retry_at FROM email_outbox WHERE dealer_id=${currentDealerId()} AND enquiry_id=${enquiryId}::uuid AND delivery_id IS NOT NULL ORDER BY created_at DESC LIMIT 50`,
    )
  ).rows;
  return new Map(
    rows.map((row) => [
      String(row.delivery_id),
      {
        attempts: Number(row.attempts),
        retryAt: row.retry_at
          ? new Date(row.retry_at as string).toISOString()
          : null,
      },
    ]),
  );
}

export async function processDealerEmailOutbox(
  log: Pick<Logger, "info" | "warn">,
) {
  await recoverEmailOutbox();
  const due = (
    await db.execute(
      sql`SELECT id FROM email_outbox WHERE dealer_id=${currentDealerId()} AND status='queued' AND next_attempt_at<=now() ORDER BY next_attempt_at,id LIMIT 5`,
    )
  ).rows;
  let attempted = 0,
    unknown = 0;
  for (const row of due) {
    if (serviceLifecycle.isDraining()) break;
    const result = await deliverEmailOutbox(String(row.id));
    if (result?.attempts) attempted++;
    if (result?.status === "unknown") unknown++;
  }
  if (attempted || unknown)
    log.info({ attempted, unknown }, "Email outbox check completed");
}

/** Read-only discovery; no customer/provider work starts here. */
export async function findDueEmailDealers() {
  return (
    await db.execute(sql`SELECT d.id,d.canonical_origin,d.stock_platform,d.retailer_id,d.source_url,min(p.due) AS due FROM (
        SELECT dealer_id,next_attempt_at AS due FROM email_outbox WHERE status='queued' AND next_attempt_at<=now()
        UNION ALL SELECT dealer_id,lease_until FROM email_outbox WHERE status='sending' AND lease_until<=now()
        UNION ALL SELECT m.dealer_id,m.created_at FROM enquiry_emails m WHERE m.status='sending' AND m.created_at<now()-interval '5 minutes' AND NOT EXISTS(SELECT 1 FROM email_outbox q WHERE q.dealer_id=m.dealer_id AND q.delivery_id=m.id)
      ) p JOIN dealerships d ON d.id=p.dealer_id LEFT JOIN dealer_demos demo ON demo.dealer_id=d.id AND demo.converted_at IS NULL WHERE d.status='active' AND demo.dealer_id IS NULL GROUP BY d.id,d.canonical_origin,d.stock_platform,d.retailer_id,d.source_url ORDER BY min(p.due) LIMIT 10`)
  ).rows;
}

export function startEmailOutboxWorker(log: Pick<Logger, "info" | "warn">) {
  return startLifecycleWorker({
    intervalMs: 15000,
    onError: () =>
      log.warn(
        "Email outbox check unavailable; saved messages remain protected.",
      ),
    work: async () => {
      await recoverExpiredEmailOutboxes();
      await purgeTerminalEmailPayloads();
      if (!multiTenantEnabled()) {
        await serviceLifecycle.run(() => processDealerEmailOutbox(log));
        return;
      }
      const dealers = await findDueEmailDealers();
      for (const dealer of dealers) {
        if (serviceLifecycle.isDraining()) break;
        await runBoundedDealerJob(
          {
            dealerId: String(dealer.id),
            canonicalOrigin: String(dealer.canonical_origin),
            platform: dealer.stock_platform as "autotrader" | "cazoo",
            retailerId: String(dealer.retailer_id),
            sourceUrl: String(dealer.source_url),
          },
          () => processDealerEmailOutbox(log),
        ).catch(() =>
          log.warn(
            "A dealership email outbox check could not complete; saved work remains protected.",
          ),
        );
      }
    },
  });
}
