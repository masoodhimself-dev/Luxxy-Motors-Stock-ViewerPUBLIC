import type { SaleWorkspaceRecord } from "@workspace/vehicle-meta";
import { addDays, dateStringInTimezone } from "./booking-slots";

type Client = {
  query: (
    text: string,
    parameters?: any[],
  ) => Promise<{ rows: Record<string, any>[] }>;
};
type Row = Record<string, any>;
const database = async () => (await import("@workspace/db")).pool;
const iso = (v: unknown): string | null =>
  v == null ? null : new Date(v as string).toISOString();
const name = (v: unknown) =>
  String(v ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
const email = (v: unknown) =>
  String(v ?? "")
    .trim()
    .toLowerCase();
const phone = (v: unknown) =>
  String(v ?? "")
    .replace(/\D/g, "")
    .replace(/^0044/, "44")
    .replace(/^0/, "44");
const samePerson = (a: Row, b: Row) =>
  Boolean(
    name(a.customer_name) &&
    name(a.customer_name) === name(b.customer_name) &&
    ((email(a.email) && email(a.email) === email(b.email)) ||
      (phone(a.phone) && phone(a.phone) === phone(b.phone))),
  );
const activeAppointment = (e: Row, now: number) =>
  Boolean(
    e.type === "viewing" &&
    e.appointment_at &&
    !e.appointment_cancelled_at &&
    new Date(e.appointment_at).getTime() > now &&
    !["completed", "no_show"].includes(e.attendance),
  );
const unsafeDelivery = new Set([
  "failed",
  "unknown",
  "bounced",
  "complained",
  "suppressed",
]);

export class SoldVehicleFollowUpError extends Error {
  constructor(
    message: string,
    public status = 409,
  ) {
    super(message);
  }
}

async function saleContext(client: Client, dealerId: string, saleId: string) {
  const row = (
    await client.query(
      `SELECT s.state, v.inventory_status, v.audit_metadata,
    coalesce(v.website_title_override,v.title,'Vehicle') AS vehicle_title,
    coalesce(nullif(v.plate,''),nullif(v.vrm,''),v.registration) AS registration,
    coalesce(nullif(v.website_hero_image_override,''),v.source_hero_image) AS image_url
    FROM sale_workspace s LEFT JOIN vehicles v ON v.dealer_id=s.dealer_id AND v.id::text=s.state#>>'{draft,vehicleId}'
    WHERE s.dealer_id=$1 AND s.id=$2::uuid`,
      [dealerId, saleId],
    )
  ).rows[0];
  if (!row) throw new SoldVehicleFollowUpError("Sale not found.", 404);
  return row;
}

async function groupsForSale(
  client: Client,
  dealerId: string,
  record: SaleWorkspaceRecord,
  now: number,
) {
  const entries = (
    await client.query(
      "SELECT * FROM enquiries WHERE dealer_id=$1 AND vehicle_id=$2::uuid ORDER BY created_at,id",
      [dealerId, record.draft.vehicleId],
    )
  ).rows;
  const reservation = record.draft.sourceReservationId
    ? (
        await client.query(
          "SELECT enquiry_id,customer_name,email,phone FROM leads WHERE dealer_id=$1 AND id=$2::uuid AND vehicle_id=$3::uuid",
          [dealerId, record.draft.sourceReservationId, record.draft.vehicleId],
        )
      ).rows[0]
    : undefined;
  const linked = entries.find((e) => e.id === record.draft.sourceEnquiryId);
  const reservationEnquiry = entries.find(
    (e) => e.id === reservation?.enquiry_id,
  );
  const buyer = {
    customer_name: record.draft.customer,
    email: record.draft.email,
    phone: record.draft.phone,
  };
  const buyerIds = new Set<string>();
  for (const source of [linked, reservationEnquiry]) {
    let parent = source;
    while (parent && !buyerIds.has(parent.id)) {
      buyerIds.add(parent.id);
      parent = entries.find((e) => e.id === parent!.merged_into_id);
    }
  }
  const eligible = entries.filter(
    (e) =>
      !e.merged_into_id &&
      !buyerIds.has(e.id) &&
      !samePerson(e, buyer) &&
      !(linked && samePerson(e, linked)) &&
      !(reservationEnquiry && samePerson(e, reservationEnquiry)) &&
      !(reservation && samePerson(e, reservation)) &&
      (activeAppointment(e, now) ||
        (e.status !== "closed" &&
          !["completed", "no_show"].includes(e.attendance) &&
          !e.appointment_cancelled_at &&
          ["viewing", "general", "delivery", "part_exchange"].includes(
            e.type,
          ))),
  );
  const groups: Row[][] = [];
  for (const entry of eligible) {
    // A matching name and contact is required; a shared family email alone must
    // not silently remove a different customer's booking.
    const existing = groups.find((group) =>
      group.some((e) => samePerson(e, entry)),
    );
    if (existing) existing.push(entry);
    else groups.push([entry]);
  }
  return groups.map((group) =>
    group.sort(
      (a, b) =>
        Number(activeAppointment(b, now)) - Number(activeAppointment(a, now)) ||
        new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
    ),
  );
}

/** Called inside the sale transaction. It records work, never cancels or sends. */
export async function createSoldVehicleFollowUps(
  client: Client,
  dealerId: string,
  record: SaleWorkspaceRecord,
  actor: string,
) {
  const now = new Date(record.updatedAt);
  for (const group of await groupsForSale(
    client,
    dealerId,
    record,
    now.getTime(),
  )) {
    const kind = group.some((e) => activeAppointment(e, now.getTime()))
      ? "appointment"
      : "interest";
    await client.query(
      `INSERT INTO sold_vehicle_follow_ups
      (dealer_id,sale_id,vehicle_id,enquiry_id,related_enquiry_ids,kind,updated_by,created_at,updated_at)
      VALUES($1,$2::uuid,$3::uuid,$4::uuid,$5::jsonb,$6,$7,$8,$8) ON CONFLICT DO NOTHING`,
      [
        dealerId,
        record.id,
        record.draft.vehicleId,
        group[0].id,
        JSON.stringify(group.map((e) => e.id)),
        kind,
        actor,
        now,
      ],
    );
  }
}

async function customerView(
  client: Client,
  dealerId: string,
  item: Row,
  entries: Row[],
  now: number,
) {
  const group = entries.filter((e) => item.related_enquiry_ids.includes(e.id));
  const primary = group.find((e) => e.id === item.enquiry_id) ?? group[0];
  if (!primary) return null;
  const blockedReason =
    group.length !== item.related_enquiry_ids.length ||
    group.some(
      (e) =>
        e.vehicle_id !== item.vehicle_id ||
        e.merged_into_id ||
        (e.id !== primary.id && !samePerson(primary, e)),
    )
      ? "This customer record or booking has moved or been merged. Review it in Customers before closing this follow-up."
      : null;
  const appointments = group
    .filter(
      (e) =>
        e.vehicle_id === item.vehicle_id &&
        e.type === "viewing" &&
        e.appointment_at &&
        !["completed", "no_show"].includes(e.attendance),
    )
    .map((e) => ({
      enquiryId: e.id,
      at: iso(e.appointment_at)!,
      revision: e.appointment_revision,
      cancelledAt: iso(e.appointment_cancelled_at),
    }))
    .sort((a, b) => a.at.localeCompare(b.at));
  const current =
    appointments.find((a) => !a.cancelledAt && Date.parse(a.at) > now) ??
    appointments[0];
  let message: Row | undefined;
  if (item.email_id || item.id)
    message = (
      await client.query(
        `SELECT m.id,m.status,m.recipient,c.last_event FROM enquiry_emails m LEFT JOIN email_delivery_checks c ON c.dealer_id=m.dealer_id AND c.message_key='enquiry:'||m.id::text AND c.provider_id=m.provider_id WHERE m.dealer_id=$1 AND m.enquiry_id=$4::uuid AND (($2::uuid IS NOT NULL AND m.id=$2::uuid) OR ($2::uuid IS NULL AND m.request_id=$3::uuid))`,
        [dealerId, item.email_id ?? null, item.id, item.enquiry_id],
      )
    ).rows[0];
  const delivery =
    message && unsafeDelivery.has(message.status)
      ? message.status
      : (message?.last_event ?? message?.status ?? null);
  const status =
    item.outcome === "email" && (!message || unsafeDelivery.has(delivery))
      ? "pending"
      : item.status;
  const blocked = primary.email
    ? (
        await client.query(
          `SELECT 1 FROM enquiry_emails m JOIN email_delivery_checks c ON c.dealer_id=m.dealer_id AND c.message_key='enquiry:'||m.id::text AND c.provider_id=m.provider_id WHERE m.dealer_id=$1 AND m.enquiry_id=ANY($2::uuid[]) AND lower(m.recipient)=$3 AND c.last_event IN ('bounced','complained','suppressed') LIMIT 1`,
          [dealerId, group.map((e) => e.id), email(primary.email)],
        )
      ).rows.length > 0
    : false;
  return {
    enquiryId: primary.id,
    relatedEnquiryIds: group.map((e) => e.id),
    customerName: primary.customer_name,
    email: blocked || blockedReason ? null : primary.email,
    emailRequestId: item.id ?? null,
    blockedReason,
    phone: primary.phone,
    preferredContact: primary.preferred_contact,
    kind: item.kind,
    appointmentAt: current?.at ?? null,
    appointmentRevision: current?.revision ?? primary.appointment_revision,
    appointmentCancelledAt: current?.cancelledAt ?? null,
    appointments,
    status,
    revision: item.revision ?? 0,
    cancelledByReview: Boolean(item.cancelled_at),
    contactedAt: iso(item.contacted_at),
    outcome: item.outcome ?? null,
    emailStatus: delivery,
    emailBlocked: blocked,
    urgent:
      item.kind === "appointment" &&
      status === "pending" &&
      appointments.some((a) => Date.parse(a.at) - now <= 24 * 60 * 60 * 1000),
    note: item.note ?? null,
  };
}

export async function readSoldVehicleFollowUp(
  dealerId: string,
  saleId: string,
  client?: Client,
) {
  client ??= await database();
  const context = await saleContext(client, dealerId, saleId),
    record = context.state as SaleWorkspaceRecord,
    now = Date.now();
  const sold =
    context.inventory_status === "sold" &&
    context.audit_metadata?.saleWorkspaceId === saleId;
  let items = (
    await client.query(
      "SELECT * FROM sold_vehicle_follow_ups WHERE dealer_id=$1 AND sale_id=$2::uuid ORDER BY CASE WHEN kind='appointment' THEN 0 ELSE 1 END,created_at,enquiry_id",
      [dealerId, saleId],
    )
  ).rows;
  const preview = !sold;
  // Existing sold cars are not backfilled on rollout. Their old contacts have
  // not agreed to a new batch of notifications.
  if (preview)
    items = (await groupsForSale(client, dealerId, record, now)).map(
      (group) => ({
        enquiry_id: group[0].id,
        vehicle_id: record.draft.vehicleId,
        related_enquiry_ids: group.map((e) => e.id),
        kind: group.some((e) => activeAppointment(e, now))
          ? "appointment"
          : "interest",
        status: "pending",
        created_at: new Date(),
      }),
    );
  const ids = [
    ...new Set(items.flatMap((item) => item.related_enquiry_ids as string[])),
  ];
  const entries = ids.length
    ? (
        await client.query(
          "SELECT * FROM enquiries WHERE dealer_id=$1 AND id=ANY($2::uuid[])",
          [dealerId, ids],
        )
      ).rows
    : [];
  const customers = (
    await Promise.all(
      items.map((item) => customerView(client, dealerId, item, entries, now)),
    )
  ).filter((item): item is NonNullable<typeof item> => Boolean(item));
  return {
    saleId,
    vehicleId: record.draft.vehicleId,
    vehicleTitle: context.vehicle_title ?? record.draft.vehicle,
    registration: context.registration ?? record.draft.registration,
    imageUrl: context.image_url ?? null,
    sold,
    createdAt: iso(items[0]?.created_at),
    customers,
    remaining: customers.filter((c) => c.status === "pending").length,
    upcomingAppointments: customers.reduce(
      (sum, c) =>
        sum +
        c.appointments.filter((a) => !a.cancelledAt && Date.parse(a.at) > now)
          .length,
      0,
    ),
  };
}

export async function readSoldVehicleFollowUps(dealerId: string) {
  const pool = await database();
  const rows = (
    await pool.query(
      `SELECT f.sale_id,min(f.created_at) AS created_at FROM sold_vehicle_follow_ups f JOIN sale_workspace s ON s.id=f.sale_id AND s.dealer_id=f.dealer_id JOIN vehicles v ON v.id=f.vehicle_id AND v.dealer_id=f.dealer_id WHERE f.dealer_id=$1 AND v.inventory_status='sold' AND v.audit_metadata->>'saleWorkspaceId'=f.sale_id::text AND (f.status='pending' OR (f.outcome='email' AND EXISTS (SELECT 1 FROM enquiry_emails m LEFT JOIN email_delivery_checks c ON c.dealer_id=m.dealer_id AND c.message_key='enquiry:'||m.id::text AND c.provider_id=m.provider_id WHERE m.dealer_id=f.dealer_id AND m.id=f.email_id AND (m.status IN ('failed','unknown') OR c.last_event IN ('failed','unknown','bounced','complained','suppressed'))))) GROUP BY f.sale_id ORDER BY CASE WHEN bool_or(EXISTS(SELECT 1 FROM enquiries e WHERE e.dealer_id=f.dealer_id AND e.vehicle_id=f.vehicle_id AND e.id::text IN (SELECT jsonb_array_elements_text(f.related_enquiry_ids)) AND f.kind='appointment' AND e.type='viewing' AND e.appointment_at<=now()+interval '24 hours' AND e.attendance NOT IN ('completed','no_show'))) THEN 0 ELSE 1 END,min(f.created_at),f.sale_id LIMIT 100`,
      [dealerId],
    )
  ).rows;
  const tasks = (
    await Promise.all(
      rows.map((row) => readSoldVehicleFollowUp(dealerId, row.sale_id)),
    )
  ).filter((task) => task.remaining > 0);
  tasks.sort(
    (a, b) =>
      Number(b.customers.some((c) => c.status === "pending" && c.urgent)) -
        Number(a.customers.some((c) => c.status === "pending" && c.urgent)) ||
      String(a.createdAt).localeCompare(String(b.createdAt)),
  );
  return { tasks, total: tasks.length, generatedAt: new Date().toISOString() };
}

type Action =
  | {
      action: "cancel_appointment";
      expectedRevision: number;
      expectedAppointmentRevision?: number;
      expectedAppointments?: Array<{
        enquiryId: string;
        expectedRevision: number;
      }>;
    }
  | {
      action: "complete";
      expectedRevision: number;
      outcome: "phone" | "email" | "not_needed";
      note?: string;
      emailId?: string;
    };

export async function actOnSoldVehicleCustomer(
  dealerId: string,
  saleId: string,
  enquiryId: string,
  input: Action,
  actor: string,
) {
  const client = await (await database()).connect();
  try {
    await client.query("BEGIN");
    const context = await saleContext(client, dealerId, saleId);
    if (
      context.inventory_status !== "sold" ||
      context.audit_metadata?.saleWorkspaceId !== saleId
    )
      throw new SoldVehicleFollowUpError(
        "Mark this car sold before updating other customers.",
      );
    const before = (
      await client.query(
        "SELECT * FROM sold_vehicle_follow_ups WHERE dealer_id=$1 AND sale_id=$2::uuid AND enquiry_id=$3::uuid",
        [dealerId, saleId, enquiryId],
      )
    ).rows[0];
    if (!before)
      throw new SoldVehicleFollowUpError("Customer follow-up not found.", 404);
    // Match booking day -> enquiry row lock order used by every booking route.
    const entries = (
      await client.query(
        "SELECT * FROM enquiries WHERE dealer_id=$1 AND id=ANY($2::uuid[]) ORDER BY id",
        [dealerId, before.related_enquiry_ids],
      )
    ).rows;
    const days = [
      ...new Set(
        entries
          .filter((e) => e.appointment_at)
          .flatMap((e) =>
            [-1, 0, 1].map((offset) =>
              addDays(dateStringInTimezone(new Date(e.appointment_at)), offset),
            ),
          ),
      ),
    ].sort();
    for (const day of days)
      await client.query(
        "SELECT pg_advisory_xact_lock(hashtextextended($1,0))",
        [`test-drive:${dealerId}:${day}`],
      );
    const current = (
      await client.query(
        "SELECT * FROM enquiries WHERE dealer_id=$1 AND id=ANY($2::uuid[]) ORDER BY id FOR UPDATE",
        [dealerId, before.related_enquiry_ids],
      )
    ).rows;
    const primary = current.find((e) => e.id === enquiryId);
    const needsManualReview =
      !primary ||
      current.length !== before.related_enquiry_ids.length ||
      current.some(
        (e) =>
          e.vehicle_id !== context.state.draft.vehicleId ||
          e.merged_into_id ||
          (e.id !== enquiryId && !samePerson(primary, e)),
      );
    const activeSoldCarBookings = current.filter(
      (e) =>
        e.vehicle_id === context.state.draft.vehicleId &&
        activeAppointment(e, Date.now()),
    );
    const manualResolution =
      needsManualReview &&
      input.action === "complete" &&
      input.outcome === "not_needed" &&
      (input.note?.trim().length ?? 0) >= 5 &&
      activeSoldCarBookings.length === 0;
    if (needsManualReview && !manualResolution)
      throw new SoldVehicleFollowUpError(
        "This customer or vehicle changed. Review their booking in Customers; after handling it, record a note to close this follow-up.",
      );
    const item = (
      await client.query(
        "SELECT * FROM sold_vehicle_follow_ups WHERE dealer_id=$1 AND sale_id=$2::uuid AND enquiry_id=$3::uuid FOR UPDATE",
        [dealerId, saleId, enquiryId],
      )
    ).rows[0];
    if (item.revision !== input.expectedRevision)
      throw new SoldVehicleFollowUpError(
        "This customer follow-up changed. Refresh before continuing.",
      );
    const vehicle = (
      await client.query(
        "SELECT inventory_status,audit_metadata FROM vehicles WHERE dealer_id=$1 AND id=$2::uuid FOR UPDATE",
        [dealerId, context.state.draft.vehicleId],
      )
    ).rows[0];
    if (
      vehicle?.inventory_status !== "sold" ||
      vehicle.audit_metadata?.saleWorkspaceId !== saleId
    )
      throw new SoldVehicleFollowUpError(
        "This car's availability changed. Refresh before updating its customers.",
      );
    const now = new Date(),
      active = current.filter(
        (e) =>
          e.vehicle_id === context.state.draft.vehicleId &&
          activeAppointment(e, now.getTime()),
      );
    if (input.action === "cancel_appointment") {
      if (!active.length)
        throw new SoldVehicleFollowUpError(
          "There is no future appointment to cancel. Refresh the customer review.",
        );
      const expected = input.expectedAppointments ?? [
        { enquiryId, expectedRevision: input.expectedAppointmentRevision },
      ];
      if (
        active.some(
          (e) =>
            !expected.some(
              (a) =>
                a.enquiryId === e.id &&
                a.expectedRevision === e.appointment_revision,
            ),
        ) ||
        expected.some(
          (a) =>
            !active.some(
              (e) =>
                e.id === a.enquiryId &&
                e.appointment_revision === a.expectedRevision,
            ),
        )
      )
        throw new SoldVehicleFollowUpError(
          "An appointment changed. Refresh and review all appointment times before cancelling.",
        );
      for (const e of active) {
        // No pending customer/dealer notification is created. The reviewed
        // composer is the only sender for this deliberate cancellation flow.
        await client.query(
          `UPDATE enquiries SET appointment_cancelled_at=$3,appointment_revision=appointment_revision+1,
          customer_notification_status='not_sent',customer_notification_error=NULL,customer_notification_attempted_at=NULL,customer_notification_sent_at=NULL,customer_notification_provider_id=NULL,
          dealer_notification_status='not_sent',dealer_notification_error=NULL,dealer_notification_attempted_at=NULL,dealer_notification_sent_at=NULL,dealer_notification_provider_id=NULL,
          reminder_status='not_scheduled',reminder_error=NULL,reminder_attempted_at=NULL,reminder_sent_at=NULL,reminder_provider_id=NULL,updated_at=$3 WHERE dealer_id=$1 AND id=$2::uuid`,
          [dealerId, e.id, now],
        );
        await client.query(
          "UPDATE test_drive_declarations SET revoked_at=$3,revoked_by=$4,revision=revision+1 WHERE dealer_id=$1 AND enquiry_id=$2::uuid AND revoked_at IS NULL",
          [dealerId, e.id, now, actor],
        );
        await client.query(
          `INSERT INTO enquiry_events(dealer_id,enquiry_id,vehicle_id,vehicle_title,vehicle_url,kind,actor,summary,detail,occurred_at) VALUES($1,$2::uuid,$3::uuid,$4,$5,'viewing_cancelled','dealer','Appointment cancelled because the vehicle was sold',$6::jsonb,$7)`,
          [
            dealerId,
            e.id,
            e.vehicle_id,
            e.vehicle_title,
            e.vehicle_url,
            JSON.stringify({
              reason: "vehicle_sold",
              saleId,
              previousAppointmentAt: iso(e.appointment_at),
              appointmentRevision: e.appointment_revision + 1,
              customerEmail: "awaiting_staff_review",
            }),
            now,
          ],
        );
      }
      await client.query(
        "UPDATE sold_vehicle_follow_ups SET cancelled_at=$4,revision=revision+1,updated_by=$5,updated_at=$4,status='pending',contacted_at=NULL,outcome=NULL,email_id=NULL WHERE dealer_id=$1 AND sale_id=$2::uuid AND enquiry_id=$3::uuid",
        [dealerId, saleId, enquiryId, now, actor],
      );
    } else {
      if (active.length)
        throw new SoldVehicleFollowUpError(
          "Cancel the remaining test drive before recording this follow-up as finished.",
        );
      const view = await customerView(
        client,
        dealerId,
        item,
        current,
        now.getTime(),
      );
      const noContactResolution =
        input.outcome === "not_needed" &&
        (input.note?.trim().length ?? 0) >= 5 &&
        !view?.email &&
        !phone(view?.phone);
      if (
        item.kind === "appointment" &&
        input.outcome === "not_needed" &&
        !manualResolution &&
        !noContactResolution
      )
        throw new SoldVehicleFollowUpError(
          "Record a phone conversation or send the reviewed email for this cancelled appointment.",
        );
      let emailId: string | null = null;
      let emailRecipient: string | null = null;
      if (input.outcome === "email") {
        const lowerBound = item.cancelled_at ?? item.created_at;
        const message = (
          await client.query(
            `SELECT m.id,m.status,m.recipient,c.last_event FROM enquiry_emails m LEFT JOIN email_delivery_checks c ON c.dealer_id=m.dealer_id AND c.message_key='enquiry:'||m.id::text AND c.provider_id=m.provider_id WHERE m.dealer_id=$1 AND m.enquiry_id=$2::uuid AND m.created_at>=$3 AND m.status='sent' AND m.request_id=$5::uuid AND ($4::uuid IS NULL OR m.id=$4::uuid) ORDER BY m.created_at DESC LIMIT 1`,
            [dealerId, enquiryId, lowerBound, input.emailId ?? null, item.id],
          )
        ).rows[0];
        if (
          !message ||
          unsafeDelivery.has(message.last_event ?? message.status)
        )
          throw new SoldVehicleFollowUpError(
            "No successful email has been recorded for this update. Keep the follow-up open or record a phone conversation.",
          );
        emailId = message.id;
        emailRecipient = message.recipient;
      }
      await client.query(
        "UPDATE sold_vehicle_follow_ups SET status=$4,outcome=$5,contacted_at=CASE WHEN $5='not_needed' THEN NULL ELSE $6::timestamptz END,email_id=$7::uuid,note=$8,revision=revision+1,updated_by=$9,updated_at=$6 WHERE dealer_id=$1 AND sale_id=$2::uuid AND enquiry_id=$3::uuid",
        [
          dealerId,
          saleId,
          enquiryId,
          input.outcome === "not_needed" ? "not_needed" : "contacted",
          input.outcome,
          now,
          emailId,
          input.note ?? null,
          actor,
        ],
      );
      await client.query(
        `INSERT INTO enquiry_events(dealer_id,enquiry_id,vehicle_id,vehicle_title,kind,actor,summary,detail,occurred_at) VALUES($1,$2::uuid,$3::uuid,$4,'conversation_logged','dealer',$5,$6::jsonb,$7)`,
        [
          dealerId,
          enquiryId,
          context.state.draft.vehicleId,
          context.vehicle_title,
          input.outcome === "phone"
            ? "Staff recorded a sold-car update by phone"
            : input.outcome === "email"
              ? "Staff sent a reviewed sold-car update"
              : "Staff marked the sold-car update as not needed",
          JSON.stringify({
            saleId,
            outcome: input.outcome,
            note: input.note ?? null,
            emailId,
            emailRecipient,
          }),
          now,
        ],
      );
    }
    await client.query("COMMIT");
    return readSoldVehicleFollowUp(dealerId, saleId);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
