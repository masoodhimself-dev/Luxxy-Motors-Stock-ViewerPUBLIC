import { and, desc, eq, gt, inArray, isNull, sql } from "drizzle-orm";
import {
  db,
  pool,
  stockChangeTasksTable,
  stockChangeSettingsTable,
  stockChangeCustomerOutcomesTable,
  stockChangeContactEventsTable,
  enquiriesTable,
  vehiclesTable,
  enquiryEventsTable,
  vehicleChangesTable,
  type Vehicle,
} from "@workspace/db";

import { dealerIntegrationsStore } from "./dealer-integrations-store";

export async function activeStockPlatform(transaction?: unknown) {
  const { connection } =
    await dealerIntegrationsStore.readStockConnection(transaction);
  return connection.platform;
}

type Query = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];
export const effectiveStockPrice = (
  vehicle: Pick<Vehicle, "websitePriceOverride" | "sourcePrice">,
) => vehicle.websitePriceOverride ?? vehicle.sourcePrice;
export function stockChangeVisible(
  vehicle: Pick<
    Vehicle,
    | "source"
    | "inventoryStatus"
    | "archivedAt"
    | "missingCount"
    | "sourcePrice"
    | "websitePriceOverride"
    | "priceReviewRequired"
  >,
  threshold = 2,
  activePlatform?: string,
) {
  return (
    (!activePlatform || vehicle.source === activePlatform) &&
    !vehicle.archivedAt &&
    ["available", "reserved"].includes(vehicle.inventoryStatus) &&
    vehicle.missingCount < threshold &&
    !(vehicle.priceReviewRequired && effectiveStockPrice(vehicle) == null)
  );
}
/** Called inside the same transaction and vehicle/dealer lock as the price write. */
export async function recordPublishedStockPrice(
  query: Query,
  before: Vehicle,
  after: Vehicle,
  changeKey: string,
  now = new Date(),
  threshold = 2,
  importRunId?: string,
  platform?: string,
) {
  const activePlatform = platform ?? (await activeStockPlatform(query));
  const previousPrice = effectiveStockPrice(before),
    currentPrice = effectiveStockPrice(after);
  const currencyChanged = before.currency !== after.currency;
  const samePounds = before.currency === "GBP" && after.currency === "GBP";
  const changed = previousPrice !== currentPrice || currencyChanged;
  const visible =
    stockChangeVisible(after, threshold, activePlatform) &&
    after.currency === "GBP";
  if (changed || !visible)
    await query
      .update(stockChangeTasksTable)
      .set({
        status: "resolved",
        resolvedAt: now,
        resolution: visible ? "price_changed" : "no_longer_public",
        revision: sql`${stockChangeTasksTable.revision} + 1`,
        updatedAt: now,
      })
      .where(
        and(
          eq(stockChangeTasksTable.dealerId, after.dealerId),
          eq(stockChangeTasksTable.vehicleId, after.id),
          eq(stockChangeTasksTable.kind, "price_drop"),
          isNull(stockChangeTasksTable.resolvedAt),
        ),
      );
  // Currency boundaries are explicit tombstones in public-price history. Even
  // returning to GBP at the same numeric price cannot revive an older badge.
  if (currencyChanged) {
    await query.insert(vehicleChangesTable).values({
      vehicleId: after.id,
      importRunId,
      fieldName: "websitePublishedPrice",
      oldValue: previousPrice,
      newValue: null,
      changedAt: now,
      auditMetadata: {
        reason: "Public price currency changed",
        dealerId: after.dealerId,
        fromCurrency: before.currency,
        toCurrency: after.currency,
      },
    });
    return;
  }
  if (
    !changed ||
    !visible ||
    !samePounds ||
    !stockChangeVisible(before, threshold, activePlatform)
  )
    return;
  // A separate effective-price history prevents feed overrides or imported hints
  // from being mistaken for a real change seen on the customer's website.
  await query.insert(vehicleChangesTable).values({
    vehicleId: after.id,
    importRunId,
    fieldName: "websitePublishedPrice",
    oldValue: previousPrice,
    newValue: currentPrice,
    changedAt: now,
    auditMetadata: {
      reason: "Effective published price changed",
      dealerId: after.dealerId,
      fromCurrency: before.currency,
      toCurrency: after.currency,
    },
  });
  if (
    previousPrice == null ||
    currentPrice == null ||
    currentPrice <= 0 ||
    previousPrice <= currentPrice
  )
    return;
  await query
    .insert(stockChangeTasksTable)
    .values({
      dealerId: after.dealerId,
      vehicleId: after.id,
      kind: "price_drop",
      changeKey,
      previousPrice,
      currentPrice,
      lastSeenAt: after.lastSeenAt,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoNothing();
}

/** One episode per car, including after staff have reviewed it. Subsequent
 * absences update that episode rather than repeatedly putting it in Home. */
export async function recordMissingStockTasks(
  query: Query,
  vehicles: Vehicle[],
  runId: string,
  now = new Date(),
) {
  const candidates = vehicles.filter(
    (v) =>
      ["available", "reserved"].includes(v.inventoryStatus) && !v.archivedAt,
  );
  for (let start = 0; start < candidates.length; start += 300) {
    const chunk = candidates.slice(start, start + 300);
    await query
      .update(stockChangeTasksTable)
      .set({
        status: "resolved",
        resolvedAt: now,
        resolution: "source_missing",
        revision: sql`${stockChangeTasksTable.revision} + 1`,
        updatedAt: now,
      })
      .where(
        and(
          eq(stockChangeTasksTable.dealerId, chunk[0].dealerId),
          inArray(
            stockChangeTasksTable.vehicleId,
            chunk.map((v) => v.id),
          ),
          eq(stockChangeTasksTable.kind, "price_drop"),
          isNull(stockChangeTasksTable.resolvedAt),
        ),
      );
    const existing = await query
      .select()
      .from(stockChangeTasksTable)
      .where(
        and(
          eq(stockChangeTasksTable.dealerId, chunk[0].dealerId),
          inArray(
            stockChangeTasksTable.vehicleId,
            chunk.map((v) => v.id),
          ),
          eq(stockChangeTasksTable.kind, "missing_stock"),
          isNull(stockChangeTasksTable.resolvedAt),
        ),
      );
    const known = new Set(existing.map((task) => task.vehicleId));
    // Do not backfill old absences on rollout. Only a newly observed transition
    // starts work; an existing unresolved episode still advances below.
    const fresh = chunk.filter(
      (v) =>
        !known.has(v.id) && v.sourceStatus === "live" && v.missingCount === 0,
    );
    if (fresh.some((vehicle) => vehicle.sourceStatus === "live"))
      await query.insert(vehicleChangesTable).values(
        fresh
          .filter((vehicle) => vehicle.sourceStatus === "live")
          .map((vehicle) => ({
            vehicleId: vehicle.id,
            importRunId: runId,
            fieldName: "sourceStatus",
            oldValue: "live",
            newValue: "missing",
            changedAt: now,
            auditMetadata: {
              reason: "Absent from a complete validated stock snapshot",
              dealerId: vehicle.dealerId,
            },
          })),
      );
    if (fresh.length)
      await query
        .insert(stockChangeTasksTable)
        .values(
          fresh.map((vehicle) => ({
            dealerId: vehicle.dealerId,
            vehicleId: vehicle.id,
            kind: "missing_stock" as const,
            changeKey: `missing:${runId}:${vehicle.id}`,
            currentPrice: effectiveStockPrice(vehicle),
            missingCount: vehicle.missingCount + 1,
            lastSeenAt: vehicle.lastSeenAt,
            createdAt: now,
            updatedAt: now,
          })),
        )
        .onConflictDoNothing();
    if (existing.length)
      await query.execute(
        sql`UPDATE stock_change_tasks t SET missing_count=v.missing_count, current_price=coalesce(v.website_price_override,v.source_price), revision=t.revision+1, updated_at=${now} FROM vehicles v WHERE t.dealer_id=${chunk[0].dealerId} AND t.vehicle_id=v.id AND v.dealer_id=t.dealer_id AND t.kind='missing_stock' AND t.resolved_at IS NULL AND t.vehicle_id IN (${sql.join(
          existing.map((task) => sql`${task.vehicleId}::uuid`),
          sql`,`,
        )})`,
      );
  }
}
export async function resolveReappearedStockTasks(
  query: Query,
  dealerId: string,
  vehicleIds: string[],
  now = new Date(),
  importRunId?: string,
) {
  if (!vehicleIds.length) return;
  await query.insert(vehicleChangesTable).values(
    vehicleIds.map((vehicleId) => ({
      vehicleId,
      importRunId,
      fieldName: "sourceStatus",
      oldValue: "missing",
      newValue: "live",
      changedAt: now,
      auditMetadata: {
        reason: "Reappeared in a complete validated stock snapshot",
        dealerId,
      },
    })),
  );
  await query
    .update(stockChangeTasksTable)
    .set({
      status: "resolved",
      resolution: "source_reappeared",
      resolvedAt: now,
      updatedAt: now,
      revision: sql`${stockChangeTasksTable.revision} + 1`,
    })
    .where(
      and(
        eq(stockChangeTasksTable.dealerId, dealerId),
        inArray(stockChangeTasksTable.vehicleId, vehicleIds),
        eq(stockChangeTasksTable.kind, "missing_stock"),
        isNull(stockChangeTasksTable.resolvedAt),
      ),
    );
}

export type StockChangeSettings = {
  minimumReduction: number;
  contactIntervalDays: number;
  revision: number;
};
export async function readStockChangeSettings(
  dealerId: string,
  query: Query = db,
): Promise<StockChangeSettings> {
  const [row] = await query
    .select()
    .from(stockChangeSettingsTable)
    .where(eq(stockChangeSettingsTable.dealerId, dealerId));
  return row
    ? {
        minimumReduction: row.minimumReduction,
        contactIntervalDays: row.contactIntervalDays,
        revision: row.revision,
      }
    : { minimumReduction: 100, contactIntervalDays: 7, revision: 0 };
}
export type StockChangeCustomerOutcome = {
  status: "pending" | "contacted" | "not_needed" | "follow_up";
  revision: number;
  channel: "call" | "email" | "whatsapp" | null;
  followUpAt: string | null;
  note: string | null;
  updatedAt: string | null;
};
export type StockChangeCustomer = {
  enquiryId: string;
  customerName: string;
  email: string | null;
  phone: string | null;
  preferredContact: string | null;
  appointmentAt: string | null;
  appointmentStatus: string | null;
  outcome: StockChangeCustomerOutcome;
  outreach: {
    suggested: boolean;
    reason: "below_minimum_reduction" | "recently_contacted" | null;
    lastContactedAt: string | null;
    nextContactAt: string | null;
  };
};
export type StockChangeTask = {
  id: string;
  kind: "price_drop" | "missing_stock";
  status: "open" | "reviewed" | "resolved";
  revision: number;
  createdAt: string;
  updatedAt: string;
  vehicleId: string;
  vehicleTitle: string;
  registration: string | null;
  imageUrl: string | null;
  previousPrice: number | null;
  currentPrice: number | null;
  reduction: number | null;
  missingCount: number;
  lastSeenAt: string | null;
  publiclyVisible: boolean;
  availableForPriceUpdate: boolean;
  urgency: "urgent" | "normal";
  affectedCustomers: StockChangeCustomer[];
  customerTotal: number;
  pendingCustomerTotal: number;
  priceDropSettings: StockChangeSettings;
  upcomingAppointments: number;
  paidReservations: number;
};
const iso = (value: unknown) =>
  value ? new Date(String(value)).toISOString() : null;

// Each page reads at most 100 tasks and 100 recent contacts per vehicle; counts
// are calculated in PostgreSQL rather than downloading customer/sale history.
export async function readStockChangeTasks(
  dealerId: string,
  options: {
    id?: string;
    now?: Date;
    missingThreshold?: number;
    activePlatform?: string;
    query?: (
      text: string,
      params?: unknown[],
    ) => Promise<{ rows: Record<string, any>[] }>;
  } = {},
): Promise<{ tasks: StockChangeTask[]; total: number; generatedAt: string }> {
  const now = options.now ?? new Date();
  const platform = options.activePlatform ?? (await activeStockPlatform());
  const execute =
    options.query ??
    ((text: string, params?: unknown[]) => pool.query(text, params));
  const preferenceRow = (
    await execute(
      "SELECT minimum_reduction,contact_interval_days,revision FROM stock_change_settings WHERE dealer_id=$1",
      [dealerId],
    )
  ).rows[0];
  const preferences: StockChangeSettings = preferenceRow
    ? {
        minimumReduction: preferenceRow.minimum_reduction,
        contactIntervalDays: preferenceRow.contact_interval_days,
        revision: preferenceRow.revision,
      }
    : { minimumReduction: 100, contactIntervalDays: 7, revision: 0 };
  const result = await execute(
    `WITH selected AS (
    SELECT t.*, count(*) OVER()::int AS total FROM stock_change_tasks t JOIN vehicles v ON v.id=t.vehicle_id AND v.dealer_id=t.dealer_id
    WHERE t.dealer_id=$1 AND ($2::uuid IS NULL AND t.status='open' OR t.id=$2::uuid)
      AND ($2::uuid IS NOT NULL OR (t.kind='missing_stock' AND v.source=$5 AND v.source_status='missing' AND v.inventory_status IN ('available','reserved') AND v.archived_at IS NULL)
        OR (t.kind='price_drop' AND v.source=$5 AND v.currency='GBP' AND v.source_status='live' AND v.inventory_status IN ('available','reserved') AND v.archived_at IS NULL AND v.missing_count<$4 AND coalesce(v.website_price_override,v.source_price)=t.current_price))
    AND ($2::uuid IS NOT NULL OR t.kind<>'price_drop' OR t.previous_price-t.current_price>=$6 OR EXISTS (SELECT 1 FROM stock_change_customer_outcomes planned WHERE planned.dealer_id=t.dealer_id AND planned.task_id=t.id AND planned.status='follow_up') OR (EXISTS (SELECT 1 FROM enquiries e WHERE e.dealer_id=$1 AND e.vehicle_id=t.vehicle_id AND e.status<>'closed' AND e.merged_into_id IS NULL AND e.appointment_cancelled_at IS NULL AND e.appointment_at>=$3 AND e.attendance IN ('scheduled','arrived'))
      OR EXISTS (SELECT 1 FROM leads l WHERE l.dealer_id=$1 AND l.vehicle_id=t.vehicle_id AND l.closed_at IS NULL AND l.deposit_pence>0)
      OR EXISTS (SELECT 1 FROM sale_workspace s WHERE s.dealer_id=$1 AND s.state#>>'{draft,vehicleId}'=t.vehicle_id::text AND coalesce(s.state#>>'{lifecycle,status}','') NOT IN ('released','sold') AND coalesce(s.state#>>'{draft,handover}','false')<>'true'
        AND (SELECT coalesce(sum(CASE WHEN p->>'signedAmountPence' ~ '^-?[0-9]+$' THEN (p->>'signedAmountPence')::numeric ELSE 0 END),0) FROM jsonb_array_elements(CASE WHEN jsonb_typeof(s.state->'payments')='array' THEN s.state->'payments' ELSE '[]'::jsonb END) p WHERE p->>'status'='confirmed')>0)))
    ORDER BY (EXISTS (SELECT 1 FROM enquiries e WHERE e.dealer_id=$1 AND e.vehicle_id=t.vehicle_id AND e.status<>'closed' AND e.merged_into_id IS NULL AND e.appointment_cancelled_at IS NULL AND e.appointment_at>=$3 AND e.attendance IN ('scheduled','arrived'))
      OR EXISTS (SELECT 1 FROM leads l WHERE l.dealer_id=$1 AND l.vehicle_id=t.vehicle_id AND l.closed_at IS NULL AND l.deposit_pence>0)
      OR EXISTS (SELECT 1 FROM sale_workspace s WHERE s.dealer_id=$1 AND s.state#>>'{draft,vehicleId}'=t.vehicle_id::text AND coalesce(s.state#>>'{lifecycle,status}','') NOT IN ('released','sold') AND coalesce(s.state#>>'{draft,handover}','false')<>'true'
        AND (SELECT coalesce(sum(CASE WHEN p->>'signedAmountPence' ~ '^-?[0-9]+$' THEN (p->>'signedAmountPence')::numeric ELSE 0 END),0) FROM jsonb_array_elements(CASE WHEN jsonb_typeof(s.state->'payments')='array' THEN s.state->'payments' ELSE '[]'::jsonb END) p WHERE p->>'status'='confirmed')>0)) DESC,t.created_at DESC,t.id DESC LIMIT 100
  ) SELECT t.*, v.title,v.website_title_override,v.make,v.model,v.registration,v.plate,v.vrm,v.website_hero_image_override,v.source_hero_image,
    v.source,v.currency,v.inventory_status,v.archived_at,v.missing_count AS actual_missing_count,v.source_status,coalesce(v.website_price_override,v.source_price) AS actual_price,
    contacts.people, contacts.customer_total, contacts.pending_customer_total, appointments.amount AS appointment_count, commitments.amount AS paid_count
  FROM selected t JOIN vehicles v ON v.id=t.vehicle_id AND v.dealer_id=t.dealer_id
  CROSS JOIN LATERAL (SELECT coalesce(jsonb_agg(jsonb_build_object('enquiryId',e.id,'customerName',e.customer_name,
      'email',CASE WHEN EXISTS (SELECT 1 FROM enquiry_emails m JOIN email_delivery_checks c ON c.dealer_id=m.dealer_id AND c.message_key='enquiry:'||m.id::text AND c.provider_id=m.provider_id WHERE m.dealer_id=$1 AND m.enquiry_id=e.id AND lower(m.recipient)=lower(e.email) AND c.last_event IN ('bounced','complained','suppressed')) THEN NULL ELSE e.email END,
      'phone',e.phone,'preferredContact',e.preferred_contact,'appointmentAt',CASE WHEN e.appointment_cancelled_at IS NULL THEN e.appointment_at ELSE NULL END,'appointmentStatus',e.appointment_status,
      'outcome',(SELECT jsonb_build_object('status',o.status,'revision',o.revision,'channel',o.channel,'followUpAt',o.follow_up_at,'note',o.note,'updatedAt',o.updated_at) FROM stock_change_customer_outcomes o WHERE o.dealer_id=$1 AND o.task_id=t.id AND o.enquiry_id=e.id),
      'lastContactedAt',(SELECT max(c.contacted_at) FROM stock_change_contact_events c WHERE c.dealer_id=$1 AND c.vehicle_id=t.vehicle_id AND (c.enquiry_id=e.id OR (nullif(e.email,'') IS NOT NULL AND c.customer_email=lower(e.email)) OR (nullif(e.phone,'') IS NOT NULL AND c.customer_phone=regexp_replace(regexp_replace(regexp_replace(e.phone,'[^0-9]','','g'),'^00',''),'^0','44')))))), '[]'::jsonb) AS people, coalesce(max(e.customer_total),0)::int AS customer_total, coalesce(max(e.pending_customer_total),0)::int AS pending_customer_total
    FROM (SELECT e.*, count(*) OVER()::int AS customer_total, count(*) FILTER (WHERE coalesce(customer_outcome.status,'pending') IN ('pending','follow_up')) OVER()::int AS pending_customer_total
      FROM enquiries e LEFT JOIN stock_change_customer_outcomes customer_outcome ON customer_outcome.dealer_id=e.dealer_id AND customer_outcome.task_id=t.id AND customer_outcome.enquiry_id=e.id WHERE e.dealer_id=$1 AND e.vehicle_id=t.vehicle_id AND e.status<>'closed' AND e.merged_into_id IS NULL
      AND (t.kind<>'price_drop' OR (NOT EXISTS (SELECT 1 FROM sale_workspace s WHERE s.dealer_id=$1 AND s.state#>>'{draft,vehicleId}'=t.vehicle_id::text AND (s.state#>>'{draft,sourceEnquiryId}'=e.id::text OR (nullif(e.email,'') IS NOT NULL AND lower(s.state#>>'{draft,email}')=lower(e.email)) OR (nullif(e.phone,'') IS NOT NULL AND nullif(regexp_replace(regexp_replace(regexp_replace(s.state#>>'{draft,phone}','[^0-9]','','g'),'^00',''),'^0','44'),'')=nullif(regexp_replace(regexp_replace(regexp_replace(e.phone,'[^0-9]','','g'),'^00',''),'^0','44'),''))) AND coalesce(s.state#>>'{lifecycle,status}','')<>'released')
        AND NOT EXISTS (SELECT 1 FROM leads l WHERE l.dealer_id=$1 AND l.vehicle_id=t.vehicle_id AND (l.enquiry_id=e.id OR (nullif(e.email,'') IS NOT NULL AND lower(l.email)=lower(e.email)) OR (nullif(e.phone,'') IS NOT NULL AND nullif(regexp_replace(regexp_replace(regexp_replace(l.phone,'[^0-9]','','g'),'^00',''),'^0','44'),'')=nullif(regexp_replace(regexp_replace(regexp_replace(e.phone,'[^0-9]','','g'),'^00',''),'^0','44'),''))) AND l.closed_at IS NULL AND (l.deposit_pence>0 OR l.stage IN ('reserved','sale_agreed')))))
      ORDER BY CASE coalesce(customer_outcome.status,'pending') WHEN 'pending' THEN 0 WHEN 'follow_up' THEN 1 ELSE 2 END,e.appointment_at ASC NULLS LAST,e.created_at DESC,e.id DESC LIMIT 100) e) contacts
  CROSS JOIN LATERAL (SELECT count(*)::int AS amount FROM enquiries e WHERE e.dealer_id=$1 AND e.vehicle_id=t.vehicle_id AND e.status<>'closed' AND e.merged_into_id IS NULL AND e.appointment_cancelled_at IS NULL AND e.appointment_at>=$3 AND e.attendance IN ('scheduled','arrived')) appointments
  CROSS JOIN LATERAL (SELECT count(*)::int AS amount FROM (
    SELECT 'lead:'||l.id::text AS commitment FROM leads l WHERE l.dealer_id=$1 AND l.vehicle_id=t.vehicle_id AND l.closed_at IS NULL AND l.deposit_pence>0
      AND NOT EXISTS (SELECT 1 FROM sale_workspace s WHERE s.dealer_id=$1 AND s.state#>>'{draft,sourceEnquiryId}'=l.enquiry_id::text AND s.state#>>'{draft,vehicleId}'=t.vehicle_id::text AND coalesce(s.state#>>'{lifecycle,status}','')<>'released')
    UNION ALL SELECT 'sale:'||s.id::text FROM sale_workspace s WHERE s.dealer_id=$1 AND s.state#>>'{draft,vehicleId}'=t.vehicle_id::text AND coalesce(s.state#>>'{lifecycle,status}','') NOT IN ('released','sold') AND coalesce(s.state#>>'{draft,handover}','false')<>'true'
      AND (SELECT coalesce(sum(CASE WHEN p->>'signedAmountPence' ~ '^-?[0-9]+$' THEN (p->>'signedAmountPence')::numeric ELSE 0 END),0) FROM jsonb_array_elements(CASE WHEN jsonb_typeof(s.state->'payments')='array' THEN s.state->'payments' ELSE '[]'::jsonb END) p WHERE p->>'status'='confirmed')>0
  ) paid) commitments`,
    [
      dealerId,
      options.id ?? null,
      now,
      options.missingThreshold ?? 2,
      platform,
      preferences.minimumReduction,
    ],
  );
  const tasks = result.rows.map((row) => {
    const visible =
      row.source === platform &&
      !row.archived_at &&
      ["available", "reserved"].includes(row.inventory_status) &&
      row.actual_missing_count < (options.missingThreshold ?? 2);
    // A stale detail cannot be used to prepare an inaccurate customer message.
    const obsolete =
      row.kind === "price_drop"
        ? !visible ||
          row.currency !== "GBP" ||
          row.source_status !== "live" ||
          row.actual_price !== row.current_price
        : row.source !== platform ||
          row.source_status !== "missing" ||
          !["available", "reserved"].includes(row.inventory_status) ||
          Boolean(row.archived_at);
    return {
      id: row.id,
      kind: row.kind,
      status: obsolete ? "resolved" : row.status,
      revision: row.revision,
      createdAt: iso(row.created_at)!,
      updatedAt: iso(row.updated_at)!,
      vehicleId: row.vehicle_id,
      vehicleTitle:
        row.website_title_override ||
        row.title ||
        [row.make, row.model].filter(Boolean).join(" ") ||
        "Vehicle",
      registration: row.vrm || row.plate || row.registration || null,
      imageUrl:
        row.website_hero_image_override || row.source_hero_image || null,
      previousPrice: row.currency === "GBP" ? row.previous_price : null,
      currentPrice: row.currency === "GBP" ? row.current_price : null,
      reduction:
        row.currency === "GBP" &&
        row.kind === "price_drop" &&
        row.previous_price != null &&
        row.current_price != null
          ? row.previous_price - row.current_price
          : null,
      missingCount:
        row.kind === "missing_stock"
          ? row.actual_missing_count
          : row.missing_count,
      lastSeenAt: iso(row.last_seen_at),
      publiclyVisible: visible,
      availableForPriceUpdate:
        row.kind === "price_drop" &&
        !obsolete &&
        row.status === "open" &&
        row.inventory_status === "available",
      urgency:
        row.appointment_count > 0 || row.paid_count > 0 ? "urgent" : "normal",
      priceDropSettings: preferences,
      customerTotal: obsolete ? 0 : row.customer_total,
      pendingCustomerTotal: obsolete ? 0 : row.pending_customer_total,
      affectedCustomers: (obsolete ? [] : row.people || []).map(
        (person: StockChangeCustomer & { lastContactedAt?: string | null }) => {
          const lastContactedAt = iso(person.lastContactedAt);
          const nextContactAt =
            lastContactedAt && preferences.contactIntervalDays > 0
              ? new Date(
                  new Date(lastContactedAt).getTime() +
                    preferences.contactIntervalDays * 86400000,
                ).toISOString()
              : null;
          const reason =
            row.kind === "price_drop" &&
            row.previous_price - row.current_price <
              preferences.minimumReduction
              ? "below_minimum_reduction"
              : row.kind === "price_drop" &&
                  nextContactAt &&
                  nextContactAt > now.toISOString()
                ? "recently_contacted"
                : null;
          return {
            ...person,
            appointmentAt: iso(person.appointmentAt),
            outcome: person.outcome
              ? {
                  ...person.outcome,
                  followUpAt: iso(person.outcome.followUpAt),
                  updatedAt: iso(person.outcome.updatedAt),
                }
              : {
                  status: "pending",
                  revision: 0,
                  channel: null,
                  followUpAt: null,
                  note: null,
                  updatedAt: null,
                },
            outreach: {
              suggested: !reason,
              reason,
              lastContactedAt,
              nextContactAt,
            },
          };
        },
      ),
      upcomingAppointments: row.appointment_count,
      paidReservations: row.paid_count,
    } as StockChangeTask;
  });
  tasks.sort(
    (a, b) =>
      Number(b.urgency === "urgent") - Number(a.urgency === "urgent") ||
      b.createdAt.localeCompare(a.createdAt),
  );
  return {
    tasks,
    total: result.rows[0]?.total ?? 0,
    generatedAt: now.toISOString(),
  };
}

export async function publicPriceReductions(
  vehicles: Vehicle[],
  now = new Date(),
  platform?: string,
) {
  const activePlatform = platform ?? (await activeStockPlatform());
  const result = new Map<
    string,
    {
      previousPrice: number;
      currentPrice: number;
      reduction: number;
      detectedAt: string;
      expiresAt: string;
    }
  >();
  if (!vehicles.length) return result;
  const since = new Date(now.getTime() - 14 * 86_400_000);
  const changes = await db
    .selectDistinctOn([vehicleChangesTable.vehicleId], {
      vehicleId: vehicleChangesTable.vehicleId,
      oldValue: vehicleChangesTable.oldValue,
      newValue: vehicleChangesTable.newValue,
      changedAt: vehicleChangesTable.changedAt,
      auditMetadata: vehicleChangesTable.auditMetadata,
    })
    .from(vehicleChangesTable)
    .where(
      and(
        inArray(
          vehicleChangesTable.vehicleId,
          vehicles.map((v) => v.id),
        ),
        eq(vehicleChangesTable.fieldName, "websitePublishedPrice"),
        gt(vehicleChangesTable.changedAt, since),
      ),
    )
    .orderBy(
      vehicleChangesTable.vehicleId,
      desc(vehicleChangesTable.changedAt),
      desc(vehicleChangesTable.id),
    );
  const byId = new Map(vehicles.map((v) => [v.id, v]));
  for (const change of changes) {
    const previousPrice = change.oldValue,
      currentPrice = change.newValue;
    if (
      byId.get(change.vehicleId)!.source !== activePlatform ||
      byId.get(change.vehicleId)!.currency !== "GBP" ||
      change.auditMetadata.fromCurrency !== "GBP" ||
      change.auditMetadata.toCurrency !== "GBP" ||
      typeof previousPrice !== "number" ||
      typeof currentPrice !== "number" ||
      currentPrice <= 0 ||
      previousPrice <= currentPrice ||
      effectiveStockPrice(byId.get(change.vehicleId)!) !== currentPrice
    )
      continue;
    result.set(change.vehicleId, {
      previousPrice,
      currentPrice,
      reduction: previousPrice - currentPrice,
      detectedAt: change.changedAt.toISOString(),
      expiresAt: new Date(
        change.changedAt.getTime() + 14 * 86_400_000,
      ).toISOString(),
    });
  }
  return result;
}

export class StockChangeActionError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
const normalPhone = (value: string | null) =>
  value?.replace(/\D/g, "").replace(/^00/, "").replace(/^0/, "44") || null;
const followUpMarker = (taskId: string) => `Price update follow-up (${taskId})`;

/** Record only a confirmed send/contact. This is intentionally safe after an old
 * task was superseded: a real successful send still counts towards the interval. */
export async function recordStockChangeContact(
  input: {
    dealerId: string;
    taskId: string;
    enquiryId: string;
    channel: "call" | "email" | "whatsapp";
    eventKey: string;
    staffName: string;
    now?: Date;
  },
  query?: Query,
): Promise<boolean> {
  const work = async (tx: Query) => {
    const [task] = await tx
      .select()
      .from(stockChangeTasksTable)
      .where(
        and(
          eq(stockChangeTasksTable.id, input.taskId),
          eq(stockChangeTasksTable.dealerId, input.dealerId),
        ),
      );
    const [enquiry] = await tx
      .select()
      .from(enquiriesTable)
      .where(
        and(
          eq(enquiriesTable.id, input.enquiryId),
          eq(enquiriesTable.dealerId, input.dealerId),
        ),
      );
    if (
      !task ||
      task.kind !== "price_drop" ||
      !enquiry ||
      enquiry.vehicleId !== task.vehicleId
    )
      return false;
    const now = input.now ?? new Date();
    const [event] = await tx
      .insert(stockChangeContactEventsTable)
      .values({
        dealerId: input.dealerId,
        taskId: task.id,
        vehicleId: task.vehicleId,
        enquiryId: enquiry.id,
        eventKey: input.eventKey,
        channel: input.channel,
        customerEmail: enquiry.email?.toLowerCase() || null,
        customerPhone: normalPhone(enquiry.phone),
        contactedAt: now,
      })
      .onConflictDoNothing()
      .returning({ id: stockChangeContactEventsTable.id });
    if (!event) return false;
    const [previousOutcome] = await tx
      .select()
      .from(stockChangeCustomerOutcomesTable)
      .where(
        and(
          eq(stockChangeCustomerOutcomesTable.dealerId, input.dealerId),
          eq(stockChangeCustomerOutcomesTable.taskId, task.id),
          eq(stockChangeCustomerOutcomesTable.enquiryId, enquiry.id),
        ),
      );
    const [updatedOutcome] = await tx
      .insert(stockChangeCustomerOutcomesTable)
      .values({
        dealerId: input.dealerId,
        taskId: task.id,
        enquiryId: enquiry.id,
        status: "contacted",
        revision: 1,
        channel: input.channel,
        updatedBy: input.staffName,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [
          stockChangeCustomerOutcomesTable.dealerId,
          stockChangeCustomerOutcomesTable.taskId,
          stockChangeCustomerOutcomesTable.enquiryId,
        ],
        set: {
          status: "contacted",
          channel: input.channel,
          followUpAt: null,
          updatedBy: input.staffName,
          updatedAt: now,
          revision: sql`${stockChangeCustomerOutcomesTable.revision}+1`,
        },
        // A repaired historical send must not replace a newer staff decision.
        setWhere: sql`${stockChangeCustomerOutcomesTable.updatedAt} <= ${now}`,
      })
      .returning({ id: stockChangeCustomerOutcomesTable.id });
    // Complete only this reminder, never a newer callback or separate task.
    if (
      updatedOutcome &&
      previousOutcome?.status === "follow_up" &&
      previousOutcome.followUpAt
    )
      await tx
        .update(enquiriesTable)
        .set({
          followUpCompletedAt: now,
          followUpRevision: sql`${enquiriesTable.followUpRevision}+1`,
          updatedAt: now,
        })
        .where(
          and(
            eq(enquiriesTable.id, enquiry.id),
            eq(enquiriesTable.dealerId, input.dealerId),
            sql`${enquiriesTable.followUpCompletedAt} is null`,
            eq(enquiriesTable.followUpAt, previousOutcome.followUpAt),
            sql`${enquiriesTable.followUpNote} like ${followUpMarker(task.id) + "%"}`,
          ),
        );
    return true;
  };
  return query ? work(query) : db.transaction(work);
}

export async function updateStockChangeCustomer(input: {
  dealerId: string;
  taskId: string;
  enquiryId: string;
  expectedRevision: number;
  expectedCustomerRevision: number;
  action: "contacted" | "not_needed" | "follow_up";
  channel?: "call" | "email" | "whatsapp";
  followUpAt?: string;
  note?: string;
  staffName: string;
  missingThreshold?: number;
  now?: Date;
}) {
  const now = input.now ?? new Date();
  const { tasks } = await readStockChangeTasks(input.dealerId, {
    id: input.taskId,
    now,
    missingThreshold: input.missingThreshold,
  });
  const current = tasks[0];
  if (!current)
    throw new StockChangeActionError(404, "Stock change not found.");
  if (
    current.kind !== "price_drop" ||
    current.status !== "open" ||
    current.revision !== input.expectedRevision
  )
    throw new StockChangeActionError(
      409,
      "This price change is no longer current. Refresh before continuing.",
    );
  if (
    !current.affectedCustomers.some(
      (person) => person.enquiryId === input.enquiryId,
    )
  )
    throw new StockChangeActionError(
      409,
      "This customer is no longer eligible for this price update. Open their enquiry to review it.",
    );
  await db.transaction(async (tx) => {
    const [vehicle] = await tx
      .select()
      .from(vehiclesTable)
      .where(
        and(
          eq(vehiclesTable.id, current.vehicleId),
          eq(vehiclesTable.dealerId, input.dealerId),
        ),
      )
      .for("update");
    const [task] = await tx
      .select()
      .from(stockChangeTasksTable)
      .where(
        and(
          eq(stockChangeTasksTable.id, input.taskId),
          eq(stockChangeTasksTable.dealerId, input.dealerId),
        ),
      )
      .for("update");
    const [enquiry] = await tx
      .select()
      .from(enquiriesTable)
      .where(
        and(
          eq(enquiriesTable.id, input.enquiryId),
          eq(enquiriesTable.dealerId, input.dealerId),
        ),
      )
      .for("update");
    if (
      !task ||
      !vehicle ||
      task.status !== "open" ||
      task.revision !== input.expectedRevision ||
      task.currentPrice !== effectiveStockPrice(vehicle) ||
      vehicle.sourceStatus !== "live" ||
      vehicle.currency !== "GBP" ||
      !stockChangeVisible(vehicle, input.missingThreshold ?? 2) ||
      enquiry?.vehicleId !== task.vehicleId ||
      enquiry.status === "closed" ||
      enquiry.mergedIntoId
    )
      throw new StockChangeActionError(
        409,
        "This price change or customer has changed. Refresh before continuing.",
      );
    // Recheck commitments under the vehicle lock used by the sale workflow.
    const commitment = await tx.execute(
      sql`SELECT 1 FROM sale_workspace s WHERE s.dealer_id=${input.dealerId} AND s.state#>>'{draft,vehicleId}'=${task.vehicleId} AND (s.state#>>'{draft,sourceEnquiryId}'=${enquiry.id} OR (nullif(${enquiry.email},'') IS NOT NULL AND lower(s.state#>>'{draft,email}')=lower(${enquiry.email})) OR (nullif(${enquiry.phone},'') IS NOT NULL AND nullif(regexp_replace(regexp_replace(regexp_replace(s.state#>>'{draft,phone}','[^0-9]','','g'),'^00',''),'^0','44'),'')=nullif(regexp_replace(regexp_replace(regexp_replace(${enquiry.phone},'[^0-9]','','g'),'^00',''),'^0','44'),''))) AND coalesce(s.state#>>'{lifecycle,status}','')<>'released' UNION ALL SELECT 1 FROM leads l WHERE l.dealer_id=${input.dealerId} AND l.vehicle_id=${task.vehicleId} AND (l.enquiry_id=${enquiry.id} OR (nullif(${enquiry.email},'') IS NOT NULL AND lower(l.email)=lower(${enquiry.email})) OR (nullif(${enquiry.phone},'') IS NOT NULL AND nullif(regexp_replace(regexp_replace(regexp_replace(l.phone,'[^0-9]','','g'),'^00',''),'^0','44'),'')=nullif(regexp_replace(regexp_replace(regexp_replace(${enquiry.phone},'[^0-9]','','g'),'^00',''),'^0','44'),''))) AND l.closed_at IS NULL AND (l.deposit_pence>0 OR l.stage IN ('reserved','sale_agreed')) LIMIT 1`,
    );
    if (commitment.rows.length)
      throw new StockChangeActionError(
        409,
        "This customer now has an agreed sale or deposit. Review their enquiry instead.",
      );
    const [outcome] = await tx
      .select()
      .from(stockChangeCustomerOutcomesTable)
      .where(
        and(
          eq(stockChangeCustomerOutcomesTable.dealerId, input.dealerId),
          eq(stockChangeCustomerOutcomesTable.taskId, task.id),
          eq(stockChangeCustomerOutcomesTable.enquiryId, enquiry.id),
        ),
      );
    if ((outcome?.revision ?? 0) !== input.expectedCustomerRevision)
      throw new StockChangeActionError(
        409,
        "This customer outcome has changed. Refresh before continuing.",
      );
    if (input.action === "contacted") {
      if (!input.channel)
        throw new StockChangeActionError(
          400,
          "Choose how you contacted this customer.",
        );
      await recordStockChangeContact(
        {
          dealerId: input.dealerId,
          taskId: task.id,
          enquiryId: enquiry.id,
          channel: input.channel,
          eventKey: `manual:${task.id}:${enquiry.id}:${input.expectedCustomerRevision}`,
          staffName: input.staffName,
          now,
        },
        tx,
      );
    } else {
      const at =
        input.action === "follow_up" && input.followUpAt
          ? new Date(input.followUpAt)
          : null;
      if (
        input.action === "follow_up" &&
        (!at || !Number.isFinite(at.getTime()) || at <= now)
      )
        throw new StockChangeActionError(
          400,
          "Choose a future follow-up date and time.",
        );
      const marker = followUpMarker(task.id);
      if (
        at &&
        enquiry.followUpAt &&
        !enquiry.followUpCompletedAt &&
        !enquiry.followUpNote?.startsWith(marker)
      )
        throw new StockChangeActionError(
          409,
          "This customer already has an unfinished follow-up. Open the enquiry and review it before replacing the reminder.",
        );
      if (at)
        await tx
          .update(enquiriesTable)
          .set({
            followUpAt: at,
            followUpNote: `${marker}\n${input.note || "Check whether the customer is still interested. Confirm the current price before contacting them."}`,
            followUpCompletedAt: null,
            followUpRevision: sql`${enquiriesTable.followUpRevision}+1`,
            updatedAt: now,
          })
          .where(
            and(
              eq(enquiriesTable.id, enquiry.id),
              eq(enquiriesTable.dealerId, input.dealerId),
            ),
          );
      if (
        !at &&
        enquiry.followUpNote?.startsWith(marker) &&
        !enquiry.followUpCompletedAt
      )
        await tx
          .update(enquiriesTable)
          .set({
            followUpCompletedAt: now,
            followUpRevision: sql`${enquiriesTable.followUpRevision}+1`,
            updatedAt: now,
          })
          .where(
            and(
              eq(enquiriesTable.id, enquiry.id),
              eq(enquiriesTable.dealerId, input.dealerId),
            ),
          );
      await tx
        .insert(stockChangeCustomerOutcomesTable)
        .values({
          dealerId: input.dealerId,
          taskId: task.id,
          enquiryId: enquiry.id,
          status: input.action,
          channel: null,
          followUpAt: at,
          note: input.note || null,
          updatedBy: input.staffName,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: [
            stockChangeCustomerOutcomesTable.dealerId,
            stockChangeCustomerOutcomesTable.taskId,
            stockChangeCustomerOutcomesTable.enquiryId,
          ],
          set: {
            status: input.action,
            channel: null,
            followUpAt: at,
            note: input.note || null,
            updatedBy: input.staffName,
            updatedAt: now,
            revision: sql`${stockChangeCustomerOutcomesTable.revision}+1`,
          },
        });
    }
    // Initial rows start at revision 1 after their first explicit decision.
    if (!outcome)
      await tx
        .update(stockChangeCustomerOutcomesTable)
        .set({ revision: 1, note: input.note || null })
        .where(
          and(
            eq(stockChangeCustomerOutcomesTable.dealerId, input.dealerId),
            eq(stockChangeCustomerOutcomesTable.taskId, task.id),
            eq(stockChangeCustomerOutcomesTable.enquiryId, enquiry.id),
          ),
        );
    const channel = input.channel === "call" ? "phone" : input.channel;
    await tx.insert(enquiryEventsTable).values({
      dealerId: input.dealerId,
      enquiryId: enquiry.id,
      vehicleId: task.vehicleId,
      vehicleTitle: current.vehicleTitle,
      kind: "conversation_logged",
      actor: "dealer",
      summary:
        input.action === "contacted"
          ? `Price update: staff confirmed contact by ${channel}`
          : input.action === "not_needed"
            ? "Price update: contact not needed"
            : "Price update: follow-up requested",
      detail: {
        stockChangeTaskId: task.id,
        outcome: input.action,
        channel: input.channel ?? null,
        followUpAt: input.followUpAt ?? null,
        note: input.note ?? null,
        staffName: input.staffName,
      },
      occurredAt: now,
    });
  });
  return (
    await readStockChangeTasks(input.dealerId, {
      id: input.taskId,
      now,
      missingThreshold: input.missingThreshold,
    })
  ).tasks[0];
}
