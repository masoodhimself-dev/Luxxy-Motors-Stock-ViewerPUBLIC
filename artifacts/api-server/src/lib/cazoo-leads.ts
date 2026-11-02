import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { db, pool, enquiriesTable } from "@workspace/db";
import { mailbox, retrieveReply } from "./customer-email-replies";
import {
  cazooEmailText,
  CazooLeadError,
  parseCazooLead,
} from "./cazoo-lead-parser";
import { openLeadForEnquiry } from "./leads";
import {
  aiConfigured,
  aiHash,
  generateAi,
  redactAiText,
} from "./ai-assistance";
import { AiAssistanceStore } from "./ai-assistance-store";
import { publicAiCar, publicAiDealer } from "./ai-public-facts";
import { runBoundedDealerJob } from "./tenant-jobs";
import { serviceLifecycle, startLifecycleWorker } from "./service-lifecycle";

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
    sql`INSERT INTO cazoo_lead_receipts(provider_id,dealer_id,mailbox) SELECT ${e.data.email_id}::uuid,id,${address} FROM dealerships WHERE id=${dealer} AND status='active' AND NOT EXISTS(SELECT 1 FROM dealer_demos WHERE dealer_id=${dealer} AND converted_at IS NULL) ON CONFLICT(provider_id) DO NOTHING`,
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
  const lead = parseCazooLead(email);
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
        type: "general",
        customerName: lead.customerName,
        email: lead.email,
        phone: lead.phone,
        preferredContact: "email",
        message: lead.message,
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
        staffNote: car
          ? null
          : "Cazoo car could not be matched uniquely. Check the registration before replying.",
      })
      .returning();
    await openLeadForEnquiry(tx, enquiry!);
    await tx.execute(
      sql`INSERT INTO enquiry_events(id,dealer_id,enquiry_id,kind,actor,summary,detail) VALUES(${randomUUID()}::uuid,${dealer},${id}::uuid,'conversation_logged','customer','Cazoo enquiry received',${JSON.stringify({ channel: "email", direction: "inbound", source: "cazoo" })}::jsonb)`,
    );
    await tx.execute(
      sql`UPDATE cazoo_lead_receipts SET status='imported',correlation_id=${lead.correlationId},enquiry_id=${id}::uuid,subject=${email.subject.slice(0, 200)},review_text=NULL,error_code=${car ? null : "vehicle_not_matched"},lease_until=NULL,draft_status=${car ? "pending" : "skipped"} WHERE id=${row.id}::uuid AND dealer_id=${dealer}`,
    );
    return id;
  });
}

const store = new AiAssistanceStore(pool);
/** A draft has no send path. Existing staff preview/approval remains mandatory. */
export async function draftCazooReply(
  row: Record<string, any>,
  generate = generateAi,
  getCar: (id: string) => Promise<any> = async (id) => {
    const { findVisibleStockVehicle } = await import("../routes/stock");
    return findVisibleStockVehicle(id);
  },
) {
  const dealer = String(row.dealer_id),
    id = String(row.enquiry_id);
  const [enquiry] = await db
    .select()
    .from(enquiriesTable)
    .where(and(eq(enquiriesTable.id, id), eq(enquiriesTable.dealerId, dealer)));
  if (
    !enquiry ||
    enquiry.mergedIntoId ||
    enquiry.status !== "new" ||
    !enquiry.email
  )
    return "skipped";
  if (!aiConfigured()) return "skipped";
  if (
    (
      await db.execute(
        sql`SELECT enquiry_id FROM enquiry_email_drafts WHERE dealer_id=${dealer} AND enquiry_id=${id}::uuid`,
      )
    ).rows.length
  )
    return "skipped";
  const config = (
    await pool.query("SELECT config FROM dealer_settings WHERE dealer_id=$1", [
      dealer,
    ])
  ).rows[0]?.config;
  if (!config) return "skipped";
  const car = enquiry.vehicleId ? await getCar(enquiry.vehicleId) : null;
  if (!car) return "skipped";
  const question = redactAiText(enquiry.message, [enquiry.customerName]);
  const facts = {
    dealer: publicAiDealer(config),
    cars: [publicAiCar(car)],
    enquiry: { type: enquiry.type, message: question },
  };
  // Uses the existing shared monthly budget plus a conservative ten automated drafts/dealer/day.
  const day = new Date().toISOString().slice(0, 10),
    session = aiHash({ dealer, day, task: "cazoo-drafts" });
  let reservation:
    Awaited<ReturnType<AiAssistanceStore["reserve"]>> | undefined;
  try {
    reservation = await store.reserve({
      dealer,
      session,
      ip: session,
      requestId: String(row.id),
      hash: aiHash({ question, facts }),
      cacheKey: null,
      staff: true,
    });
    const generated = reservation.cached
      ? { result: reservation.cached, cost: 0 }
      : await generate("reply", question, facts);
    if (!reservation.cached)
      await store.complete(
        reservation.id,
        dealer,
        generated.result,
        generated.cost,
        null,
      );
    const message = generated.result.answer.trim();
    if (!message || message.length > 12000) throw new Error("Invalid draft");
    return await db.transaction(async (tx) => {
      const current = (
        await tx.execute(
          sql`SELECT workspace_revision,status,merged_into_id FROM enquiries WHERE id=${id}::uuid AND dealer_id=${dealer} FOR UPDATE`,
        )
      ).rows[0];
      const sent = (
        await tx.execute(
          sql`SELECT id FROM enquiry_emails WHERE dealer_id=${dealer} AND enquiry_id=${id}::uuid LIMIT 1`,
        )
      ).rows[0];
      if (
        !current ||
        current.status !== "new" ||
        current.merged_into_id ||
        sent ||
        Number(current.workspace_revision) !== enquiry.workspaceRevision
      )
        return "skipped";
      const content = {
        to: enquiry.email,
        subject: `Your Cazoo enquiry — ${enquiry.vehicleTitle || "your car"}`
          .slice(0, 200)
          .replace(/[\r\n\x00-\x1f\x7f]/g, " "),
        message,
        includeVehicle: false,
        includeAppointment: false,
        photoIds: [],
        documentIds: [],
        vehiclePhotoIndices: [],
        expectedRevision: enquiry.workspaceRevision,
      };
      const saved = await tx.execute(
        sql`INSERT INTO enquiry_email_drafts(dealer_id,enquiry_id,source,content,updated_by) VALUES(${dealer},${id}::uuid,'ai',${JSON.stringify(content)}::jsonb,'cazoo-draft-worker') ON CONFLICT(dealer_id,enquiry_id) DO NOTHING RETURNING enquiry_id`,
      );
      return saved.rows.length ? "ready" : "skipped";
    });
  } catch {
    if (reservation && !reservation.cached)
      await store.fail(reservation.id, dealer).catch(() => {});
    return "failed";
  }
}

export async function processCazooLeads(
  transport: typeof fetch = fetch,
  draft = draftCazooReply,
) {
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
        await db.execute(
          sql`UPDATE cazoo_lead_receipts SET status='review',draft_status='skipped',subject=${email.subject.slice(0, 200)},review_text=${cazooEmailText(email)},error_code=${error.code},lease_until=NULL WHERE id=${row.id}::uuid AND dealer_id=${row.dealer_id} AND lease_until=${lease}`,
        );
      }
    } catch (error) {
      const review =
        error instanceof CazooLeadError || Number(row.attempts) >= 8;
      await db.execute(
        sql`UPDATE cazoo_lead_receipts SET status=${review ? "review" : "pending"},error_code=${error instanceof CazooLeadError ? error.code : "retrieval_failed"},next_attempt_at=now()+interval '5 minutes',lease_until=NULL WHERE id=${row.id}::uuid AND dealer_id=${row.dealer_id} AND lease_until=${lease}`,
      );
    }
  }
  for (let count = 0; count < 5 && !serviceLifecycle.isDraining(); count++) {
    const lease = new Date(Date.now() + 180000);
    const row = (
      await db.execute(
        sql`WITH candidate AS (SELECT r.id FROM cazoo_lead_receipts r JOIN dealerships d ON d.id=r.dealer_id WHERE d.status='active' AND r.status='imported' AND (r.draft_status='pending' OR (r.draft_status='generating' AND r.draft_lease_until<=now())) ORDER BY r.received_at FOR UPDATE OF r SKIP LOCKED LIMIT 1) UPDATE cazoo_lead_receipts r SET draft_status='generating',draft_lease_until=${lease} FROM candidate WHERE r.id=candidate.id RETURNING r.*`,
      )
    ).rows[0];
    if (!row) break;
    const dealer = (
      await pool.query(
        "SELECT * FROM dealerships WHERE id=$1 AND status='active'",
        [row.dealer_id],
      )
    ).rows[0];
    let status = "skipped";
    if (dealer && cazooLeadMailboxes()[dealer.id] === row.mailbox) {
      try {
        status = await runBoundedDealerJob(
          {
            dealerId: dealer.id,
            canonicalOrigin: dealer.canonical_origin,
            platform: dealer.stock_platform,
            retailerId: dealer.retailer_id,
            sourceUrl: dealer.source_url,
          },
          () => draft(row),
        );
      } catch {
        status = "failed";
      }
    }
    await db.execute(
      sql`UPDATE cazoo_lead_receipts SET draft_status=${status},draft_lease_until=NULL WHERE id=${row.id}::uuid AND dealer_id=${row.dealer_id} AND draft_lease_until=${lease}`,
    );
  }
}
export function startCazooLeadWorker(log: { warn: (message: string) => void }) {
  return startLifecycleWorker({
    intervalMs: 15000,
    enabled: cazooLeadsEnabled,
    work: processCazooLeads,
    onError: () =>
      log.warn(
        "Cazoo lead import needs attention. No customer email was sent.",
      ),
  });
}
