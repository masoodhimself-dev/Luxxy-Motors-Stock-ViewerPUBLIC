import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { db, enquiriesTable } from "@workspace/db";
import { mailbox, retrieveReply } from "./customer-email-replies";
import {
  cazooEmailText,
  CazooLeadError,
} from "./cazoo-lead-parser";
import { parseCazooDelivery } from "./cazoo-owner-test";
import { openLeadForEnquiry } from "./leads";
import { serviceLifecycle, startLifecycleWorker } from "./service-lifecycle";
import { processCazooLeadForwards, queueCazooLeadForward } from "./cazoo-lead-forwarding";
import { processCazooCustomerReplyForwards } from "./cazoo-customer-reply-forwarding";

type Executor = Pick<typeof db, "execute">;
/** Owner-provisioned exact mailboxes. Never route by subject, stock or body recipients. */
export function cazooLeadMailboxes(): Record<string, string> {
  try {
    const input: unknown = JSON.parse(process.env.CAZOO_LEAD_MAILBOXES || "{}");
    if (!input || typeof input !== "object" || Array.isArray(input)) return {};
    const entries = Object.entries(input).map(
      ([dealer, value]) => [dealer, mailbox(value)] as const,
    );
    if (
      entries.length > 1000 ||
      entries.some(
        ([dealer, address]) => !dealer || dealer.length > 100 || !address,
      ) ||
      new Set(entries.map(([, address]) => address)).size !== entries.length
    )
      return {};
    return Object.fromEntries(entries) as Record<string, string>;
  } catch {
    return {};
  }
}
export function cazooLeadsEnabled() {
  return (
    process.env.CAZOO_LEADS_ENABLED === "true" &&
    Boolean(process.env.RESEND_RECEIVING_API_KEY)
  );
}

export async function acceptCazooLeadEvent(
  event: unknown,
  executor: Executor = db,
) {
  if (!cazooLeadsEnabled()) return;
  const e = event as {
    type?: unknown;
    data?: { email_id?: unknown; to?: unknown };
  } | null;
  if (
    e?.type !== "email.received" ||
    typeof e.data?.email_id !== "string" ||
    !/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(e.data.email_id) ||
    !Array.isArray(e.data.to) ||
    e.data.to.length > 100
  )
    return;
  const recipients = e.data.to
    .map(mailbox)
    .filter((s): s is string => Boolean(s));
  const entries = Object.entries(cazooLeadMailboxes()).filter(([, address]) =>
    recipients.includes(address),
  );
  // Multi-recipient mail must not choose a dealership or mix with a customer reply route.
  if (entries.length !== 1 || new Set(recipients).size !== 1) return;
  const [dealer, address] = entries[0]!;
  await executor.execute(
    sql`INSERT INTO cazoo_lead_receipts(provider_id,dealer_id,mailbox,draft_status) SELECT ${e.data.email_id}::uuid,id,${address},'skipped' FROM dealerships WHERE id=${dealer} AND status='active' AND NOT EXISTS(SELECT 1 FROM dealer_demos WHERE dealer_id=${dealer} AND converted_at IS NULL) ON CONFLICT(provider_id) DO NOTHING`,
  );
}

export async function importCazooReceipt(
  row: Record<string, any>,
  email: Awaited<ReturnType<typeof retrieveReply>>,
  lease: Date,
) {
  const dealer = String(row.dealer_id);
  if (
    email.id !== String(row.provider_id) ||
    email.to
      .map(mailbox)
      .filter(Boolean)
      .some((a) => a !== row.mailbox) ||
    !email.to.map(mailbox).includes(String(row.mailbox))
  )
    throw new CazooLeadError("recipient_mismatch");
  const { lead, testDelivery } = parseCazooDelivery(dealer, email);
  const partExchange = testDelivery ? undefined : lead.partExchange;
  return db.transaction(async (tx) => {
    // Serialise correlation checks, including distinct provider IDs for the same lead.
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtext(${`cazoo-lead:${dealer}:${lead.correlationId}`}))`,
    );
    const locked = (
      await tx.execute(
        sql`SELECT id FROM cazoo_lead_receipts WHERE id=${row.id}::uuid AND dealer_id=${dealer} AND status='processing' AND lease_until=${lease} FOR UPDATE`,
      )
    ).rows[0];
    if (!locked) return null;
    const duplicate = (
      await tx.execute(
        sql`SELECT enquiry_id FROM cazoo_lead_receipts WHERE dealer_id=${dealer} AND correlation_id=${lead.correlationId}`,
      )
    ).rows[0];
    if (duplicate) {
      await tx.execute(
        sql`UPDATE cazoo_lead_receipts SET status='duplicate',draft_status='skipped',lease_until=NULL,review_text=NULL WHERE id=${row.id}::uuid AND dealer_id=${dealer}`,
      );
      return null;
    }
    const cars = (
      await tx.execute(
        sql`SELECT id,title,make,model,source_price,website_price_override FROM vehicles WHERE dealer_id=${dealer} AND source='cazoo' AND archived_at IS NULL AND regexp_replace(upper(coalesce(nullif(registration,''),nullif(vrm,''),plate,'')),'[^A-Z0-9]','','g')=${lead.registration} LIMIT 2`,
      )
    ).rows;
    const car = cars.length === 1 ? cars[0] : null;
    const id = randomUUID();
    const [enquiry] = await tx
      .insert(enquiriesTable)
      .values({
        id,
        dealerId: dealer,
        source: "cazoo",
        type: partExchange ? "part_exchange" : "general",
        customerName: lead.customerName,
        email: lead.email,
        phone: lead.phone,
        preferredContact: lead.email ? "email" : lead.phone ? "phone" : null,
        message: lead.message,
        ...(partExchange && {
          partExchangeRegistration: partExchange.registration,
          partExchangeMileage: partExchange.mileage,
        }),
        vehicleId: car ? String(car.id) : null,
        vehicleRegistration: lead.registration,
        vehicleTitle: car
          ? String(
              car.title ||
                `${car.make || ""} ${car.model || ""}`.trim() ||
                lead.vehicleTitle,
            )
          : lead.vehicleTitle,
        vehiclePrice: car
          ? Number(car.website_price_override ?? car.source_price) || null
          : null,
        staffNote: [
          testDelivery ? "Owner test email. The reply address is restricted to the approved owner test address; forwarded customer contact details were not imported." : null,
          !car ? "Cazoo car could not be matched uniquely. Check the registration before replying." : null,
          !testDelivery && !lead.email ? (lead.phone
            ? "Cazoo did not supply a customer email address. Use the supplied phone number."
            : "Cazoo did not supply a customer email address or a usable phone number. Check the contact details in Cazoo.") : null,
          !testDelivery && lead.email && lead.contactWarnings?.includes("phone_needs_checking") ? "The phone number supplied by Cazoo could not be confirmed and was left blank. Reply by email and ask the customer to confirm it." : null,
          !testDelivery && lead.contactWarnings?.includes("customer_name_missing") ? "Cazoo did not supply a customer name. Confirm it when replying." : null,
        ].filter(Boolean).join(" ") || null,
      })
      .returning();
    await openLeadForEnquiry(tx, enquiry!);
    await tx.execute(
      sql`INSERT INTO enquiry_events(id,dealer_id,enquiry_id,kind,actor,summary,detail) VALUES(${randomUUID()}::uuid,${dealer},${id}::uuid,'conversation_logged','customer',${testDelivery ? 'Owner test Cazoo enquiry received' : 'Cazoo enquiry received'},${JSON.stringify({ channel: "email", direction: "inbound", source: "cazoo", ...(testDelivery ? { ownerTest: true } : {}) })}::jsonb)`,
    );
    await tx.execute(
      sql`UPDATE cazoo_lead_receipts SET status='imported',correlation_id=${lead.correlationId},enquiry_id=${id}::uuid,subject=${email.subject.slice(0, 200)},review_text=NULL,error_code=${testDelivery ? "owner_test" : !car ? "vehicle_not_matched" : !lead.email ? "customer_email_missing" : null},lease_until=NULL,draft_status='skipped' WHERE id=${row.id}::uuid AND dealer_id=${dealer}`,
    );
    if (!testDelivery) await queueCazooLeadForward({
      id: String(row.id), dealer_id: dealer, provider_id: String(row.provider_id), mailbox: String(row.mailbox),
    }, email, tx);
    return id;
  });
}

export async function processCazooLeads(transport: typeof fetch = fetch) {
  if (!cazooLeadsEnabled()) return;
  // Keep only review copies for 30 days; imported customer content lives in the normal enquiry.
  await db.execute(
    sql`UPDATE cazoo_lead_receipts SET review_text=NULL WHERE review_text IS NOT NULL AND received_at<now()-interval '30 days'`,
  );
  await db.execute(
    sql`UPDATE cazoo_lead_receipts SET status='review',error_code='retrieval_failed',lease_until=NULL WHERE status='processing' AND attempts>=8 AND lease_until<=now()`,
  );
  for (let count = 0; count < 5 && !serviceLifecycle.isDraining(); count++) {
    const lease = new Date(Date.now() + 180000);
    const row = (
      await db.execute(
        sql`WITH candidate AS (SELECT r.id FROM cazoo_lead_receipts r JOIN dealerships d ON d.id=r.dealer_id WHERE d.status='active' AND NOT EXISTS(SELECT 1 FROM dealer_demos WHERE dealer_id=d.id AND converted_at IS NULL) AND r.attempts<8 AND ((r.status='pending' AND r.next_attempt_at<=now()) OR (r.status='processing' AND r.lease_until<=now())) ORDER BY r.next_attempt_at,r.id FOR UPDATE OF r SKIP LOCKED LIMIT 1) UPDATE cazoo_lead_receipts r SET status='processing',attempts=attempts+1,lease_until=${lease} FROM candidate WHERE r.id=candidate.id RETURNING r.*`,
      )
    ).rows[0];
    if (!row) break;
    try {
      if (cazooLeadMailboxes()[String(row.dealer_id)] !== row.mailbox)
        throw new CazooLeadError("mailbox_not_connected");
      const email = await retrieveReply(String(row.provider_id), transport);
      try {
        await importCazooReceipt(row, email, lease);
      } catch (error) {
        if (!(error instanceof CazooLeadError)) throw error;
        await db.transaction(async (tx) => {
          const updated = await tx.execute(
            sql`UPDATE cazoo_lead_receipts SET status='review',draft_status='skipped',subject=${email.subject.slice(0, 200)},review_text=${cazooEmailText(email)},error_code=${error.code},lease_until=NULL WHERE id=${row.id}::uuid AND dealer_id=${row.dealer_id} AND lease_until=${lease} RETURNING id`,
          );
          if (updated.rows.length) await queueCazooLeadForward({
            id: String(row.id), dealer_id: String(row.dealer_id), provider_id: String(row.provider_id), mailbox: String(row.mailbox),
          }, email, tx);
        });
      }
    } catch (error) {
      const review =
        error instanceof CazooLeadError || Number(row.attempts) >= 8;
      await db.execute(
        sql`UPDATE cazoo_lead_receipts SET status=${review ? "review" : "pending"},error_code=${error instanceof CazooLeadError ? error.code : "retrieval_failed"},next_attempt_at=now()+interval '5 minutes',lease_until=NULL WHERE id=${row.id}::uuid AND dealer_id=${row.dealer_id} AND lease_until=${lease}`,
      );
    }
  }
}
export function startCazooLeadWorker(log: { warn: (message: string) => void }) {
  return startLifecycleWorker({
    intervalMs: 15000,
    enabled: cazooLeadsEnabled,
    work: async () => {
      await processCazooLeads();
      await processCazooLeadForwards();
      await processCazooCustomerReplyForwards();
    },
    onError: () =>
      log.warn(
        "Cazoo lead processing needs attention.",
      ),
  });
}
