import { randomBytes, randomUUID } from "node:crypto";
import { convert } from "html-to-text";
import { z } from "zod/v4";
import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import type { Logger } from "pino";
import { currentDealerId } from "./tenant-context";
import { startLifecycleWorker, serviceLifecycle } from "./service-lifecycle";
import type { EmailRequest } from "./email-provider";

type Executor = Pick<typeof db, "execute">;
const uuid = z.string().uuid();
export function replyConfiguration(dealer = currentDealerId()) {
  if (
    process.env.EMAIL_REPLIES_ENABLED !== "true" ||
    !process.env.RESEND_RECEIVING_API_KEY ||
    !process.env.RESEND_RECEIVING_WEBHOOK_SECRET
  )
    return null;
  try {
    const domains = JSON.parse(
      process.env.EMAIL_REPLY_DOMAINS || "{}",
    ) as Record<string, unknown>;
    const domain = domains[dealer];
    return typeof domain === "string" &&
      /^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/.test(domain)
      ? { domain }
      : null;
  } catch {
    return null;
  }
}
export function mailbox(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 500 || /[\r\n]/.test(value))
    return null;
  const match = /^(?:[^<>]*<([^<>]+)>|([^<>]+))$/.exec(value.trim());
  const email = (match?.[1] || match?.[2] || "").trim().toLowerCase();
  return z.string().max(254).email().safeParse(email).success ? email : null;
}
export function safeMessageId(value: unknown): string | null {
  return typeof value === "string" &&
    /^<[^<>\s\x00-\x1f\x7f]{1,250}>$/.test(value)
    ? value
    : null;
}
/** Reuse one route per immutable send key, including provider retries after restart. */
export async function routeCustomerReply(
  request: EmailRequest,
  enquiryId: string,
  executor: Executor = db,
  create = true,
): Promise<EmailRequest> {
  const dealer = currentDealerId();
  let row = (
    await executor.execute(
      sql`SELECT reply_address,in_reply_to,recipient,enquiry_id FROM enquiry_email_reply_routes WHERE dealer_id=${dealer} AND send_key=${request.idempotencyKey}`,
    )
  ).rows[0];
  if (!row) {
    if (!create) return request;
    const config = replyConfiguration(dealer);
    if (!config) return request;
    const recipient = mailbox(request.to);
    if (!recipient) throw new Error("Check the email recipient.");
    const latest = (
      await executor.execute(
        sql`SELECT message_id FROM enquiry_email_replies WHERE dealer_id=${dealer} AND enquiry_id=${enquiryId}::uuid AND status='received' AND lower(sender)=${recipient} ORDER BY received_at DESC,id DESC LIMIT 1`,
      )
    ).rows[0];
    const address = `r-${randomBytes(24).toString("hex")}@${config.domain}`;
    row = (
      await executor.execute(
        sql`INSERT INTO enquiry_email_reply_routes(dealer_id,enquiry_id,send_key,reply_address,recipient,in_reply_to) VALUES(${dealer},${enquiryId}::uuid,${request.idempotencyKey},${address},${recipient},${safeMessageId(latest?.message_id)}) ON CONFLICT(dealer_id,send_key) DO UPDATE SET send_key=excluded.send_key RETURNING reply_address,in_reply_to,recipient,enquiry_id`,
      )
    ).rows[0];
  }
  if (
    String(row!.enquiry_id) !== enquiryId ||
    row!.recipient !== mailbox(request.to)
  )
    throw new Error("Reply route belongs to different approved details.");
  return {
    ...request,
    replyTo: String(row!.reply_address),
    ...(row!.in_reply_to
      ? {
          replyHeaders: {
            "In-Reply-To": String(row!.in_reply_to),
            References: String(row!.in_reply_to),
          },
        }
      : {}),
  };
}

/** Only exact, previously issued recipient capabilities are accepted. No lead parsing or name/subject guessing. */
export async function acceptReplyEvent(
  event: unknown,
  executor: Executor = db,
) {
  const parsed = z
    .object({
      type: z.string(),
      data: z.object({
        email_id: uuid,
        to: z.array(z.string().max(500)).max(100),
      }),
    })
    .safeParse(event);
  if (!parsed.success || parsed.data.type !== "email.received") return;
  const addresses = [
    ...new Set(
      parsed.data.data.to.map(mailbox).filter((a): a is string => Boolean(a)),
    ),
  ];
  if (!addresses.length) return;
  const routes = (
    await executor.execute(
      sql`SELECT r.* FROM enquiry_email_reply_routes r JOIN dealerships d ON d.id=r.dealer_id WHERE r.reply_address IN (${sql.join(
        addresses.map((a) => sql`${a}`),
        sql`,`,
      )}) AND d.status='active'`,
    )
  ).rows.filter((r) => replyConfiguration(String(r.dealer_id)));
  // Multiple known recipients would expose a message to the wrong case. Never choose one.
  if (routes.length !== 1) return;
  const route = routes[0]!;
  await executor.execute(
    sql`INSERT INTO enquiry_email_replies(provider_id,route_id,dealer_id,enquiry_id) VALUES(${parsed.data.data.email_id}::uuid,${String(route.id)}::uuid,${String(route.dealer_id)},${String(route.enquiry_id)}::uuid) ON CONFLICT(provider_id) DO NOTHING`,
  );
}

const receivedSchema = z.object({
  id: uuid,
  to: z.array(z.string().max(500)).max(100),
  from: z.string().max(500),
  subject: z.string().max(2000).default(""),
  text: z.string().max(1_000_000).nullable().optional(),
  html: z.string().max(1_000_000).nullable().optional(),
  message_id: z.string().max(1000).nullable().optional(),
  authentication: z
    .object({ dmarc: z.string().optional(), dkim: z.string().optional() })
    .nullable()
    .optional(),
  attachments: z
    .array(z.object({ filename: z.string().max(500).nullable().optional() }))
    .max(100)
    .default([]),
});
export async function retrieveReply(
  id: string,
  transport: typeof fetch = fetch,
) {
  if (!uuid.safeParse(id).success) throw new Error("Invalid receipt.");
  const response = await transport(
    `https://api.resend.com/emails/receiving/${id}?html_format=cid`,
    {
      headers: {
        Authorization: `Bearer ${process.env.RESEND_RECEIVING_API_KEY}`,
      },
      redirect: "error",
      signal: AbortSignal.timeout(10000),
    },
  );
  if (!response.ok) throw new Error("Receiving temporarily unavailable.");
  // Bound actual streamed bytes, not an untrusted Content-Length; never follow email/attachment URLs.
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Missing receipt.");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 2_100_000) throw new Error("Receipt exceeds review limit.");
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  return receivedSchema.parse(
    JSON.parse(Buffer.concat(chunks).toString("utf8")),
  );
}
/** Claims are recoverable; receipt, history event and staff task commit together exactly once. */
export async function processCustomerReplies(
  log: Pick<Logger, "warn">,
  transport: typeof fetch = fetch,
) {
  if (process.env.EMAIL_REPLIES_ENABLED !== "true") return;
  await db.execute(
    sql`UPDATE enquiry_email_replies SET status='review',error_code='retrieval_failed',lease_until=NULL WHERE status='processing' AND attempts>=8 AND lease_until<=now()`,
  );
  for (let count = 0; count < 5 && !serviceLifecycle.isDraining(); count++) {
    const lease = new Date(Date.now() + 60000);
    const row = (
      await db.execute(
        sql`WITH candidate AS (SELECT m.id FROM enquiry_email_replies m JOIN dealerships d ON d.id=m.dealer_id WHERE d.status='active' AND m.attempts<8 AND ((m.status='pending' AND m.next_attempt_at<=now()) OR (m.status='processing' AND m.lease_until<=now())) ORDER BY m.next_attempt_at,m.id FOR UPDATE OF m SKIP LOCKED LIMIT 1) UPDATE enquiry_email_replies m SET status='processing',attempts=attempts+1,lease_until=${lease} FROM candidate WHERE m.id=candidate.id RETURNING m.*`,
      )
    ).rows[0];
    if (!row) break;
    const dealer = String(row.dealer_id),
      id = String(row.id);
    try {
      if (!replyConfiguration(dealer))
        throw new Error("Receiving configuration unavailable.");
      const email = await retrieveReply(String(row.provider_id), transport);
      await db.transaction(async (tx) => {
        const locked = (
          await tx.execute(
            sql`SELECT m.*,r.recipient,r.reply_address FROM enquiry_email_replies m JOIN enquiry_email_reply_routes r ON r.id=m.route_id AND r.dealer_id=m.dealer_id WHERE m.id=${id}::uuid AND m.status='processing' AND m.lease_until=${lease} FOR UPDATE OF m`,
          )
        ).rows[0];
        if (!locked) return;
        const sender = mailbox(email.from);
        const recipients = email.to.map(mailbox);
        const reason =
          email.id !== String(row.provider_id) ||
          !recipients.includes(String(locked.reply_address))
            ? "recipient_mismatch"
            : sender !== locked.recipient
              ? "sender_mismatch"
              : email.authentication?.dmarc === "fail"
                ? "authentication_failed"
                : null;
        const message = (
          email.text?.trim() ||
          convert(email.html || "", {
            wordwrap: false,
            selectors: [
              { selector: "img", format: "skip" },
              { selector: "a", options: { ignoreHref: true } },
            ],
            limits: { maxInputLength: 1_000_000 },
          }).trim() ||
          "(Email contained no readable text.)"
        )
          .slice(0, 24000)
          .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, "");
        // Keep the recorded case, following only same-dealer merges to the surviving conversation.
        let enquiry = String(row.enquiry_id);
        for (let depth = 0; depth < 20; depth++) {
          const parent = (
            await tx.execute(
              sql`SELECT id,merged_into_id FROM enquiries WHERE dealer_id=${dealer} AND id=${enquiry}::uuid FOR UPDATE`,
            )
          ).rows[0];
          if (!parent) throw new Error("Enquiry unavailable.");
          if (!parent.merged_into_id) break;
          if (depth === 19) throw new Error("Merge chain too long.");
          enquiry = String(parent.merged_into_id);
        }
        const review = Boolean(reason);
        await tx.execute(
          sql`UPDATE enquiry_email_replies SET enquiry_id=${enquiry}::uuid,status=${review ? "review" : "received"},sender=${sender},subject=${email.subject.slice(0, 200)},message=${message},message_id=${safeMessageId(email.message_id)},attachment_names=${JSON.stringify(email.attachments.map((a) => a.filename || "Unnamed attachment"))}::jsonb,error_code=${reason},lease_until=NULL,received_at=now() WHERE id=${id}::uuid AND dealer_id=${dealer}`,
        );
        if (!review) {
          await tx.execute(
            sql`INSERT INTO enquiry_events(id,dealer_id,enquiry_id,kind,actor,summary,detail) VALUES(${randomUUID()}::uuid,${dealer},${enquiry}::uuid,'conversation_logged','customer','Customer email received',${JSON.stringify({ note: message, channel: "email", direction: "inbound", replyId: id })}::jsonb)`,
          );
          await tx.execute(
            sql`UPDATE enquiries SET workspace_revision=workspace_revision+1,updated_at=now() WHERE id=${enquiry}::uuid AND dealer_id=${dealer}`,
          );
        }
      });
    } catch {
      await db.execute(
        sql`UPDATE enquiry_email_replies SET status=${Number(row.attempts) >= 8 ? "review" : "pending"},error_code='retrieval_failed',next_attempt_at=now()+interval '5 minutes',lease_until=NULL WHERE id=${id}::uuid AND dealer_id=${dealer} AND status='processing' AND lease_until=${lease}`,
      );
      log.warn("A customer reply awaits recovery or staff review.");
    }
  }
}
export function startCustomerReplyWorker(log: Pick<Logger, "warn">) {
  return startLifecycleWorker({
    intervalMs: 15000,
    enabled: () => process.env.EMAIL_REPLIES_ENABLED === "true",
    work: () => processCustomerReplies(log),
    onError: () =>
      log.warn("Customer reply processing is temporarily unavailable."),
  });
}
