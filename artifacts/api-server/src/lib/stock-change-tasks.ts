import { and, desc, eq, gt, inArray, isNull, sql } from "drizzle-orm";
import {
  db,
  pool,
  stockChangeTasksTable,
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
    await query
      .insert(vehicleChangesTable)
      .values({
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
    const fresh = chunk.filter((v) => !known.has(v.id));
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

export type StockChangeCustomer = {
  enquiryId: string;
  customerName: string;
  email: string | null;
  phone: string | null;
  preferredContact: string | null;
  appointmentAt: string | null;
  appointmentStatus: string | null;
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
  urgency: "urgent" | "normal";
  affectedCustomers: StockChangeCustomer[];
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
  } = {},
): Promise<{ tasks: StockChangeTask[]; total: number; generatedAt: string }> {
  const now = options.now ?? new Date();
  const platform = options.activePlatform ?? (await activeStockPlatform());
  const result = await pool.query(
    `WITH selected AS (
    SELECT t.*, count(*) OVER()::int AS total FROM stock_change_tasks t JOIN vehicles v ON v.id=t.vehicle_id AND v.dealer_id=t.dealer_id
    WHERE t.dealer_id=$1 AND ($2::uuid IS NULL AND t.status='open' OR t.id=$2::uuid)
      AND ($2::uuid IS NOT NULL OR (t.kind='missing_stock' AND v.source=$5 AND v.source_status='missing' AND v.inventory_status IN ('available','reserved') AND v.archived_at IS NULL)
        OR (t.kind='price_drop' AND v.source=$5 AND v.currency='GBP' AND v.source_status='live' AND v.inventory_status IN ('available','reserved') AND v.archived_at IS NULL AND v.missing_count<$4 AND coalesce(v.website_price_override,v.source_price)=t.current_price))
    ORDER BY (EXISTS (SELECT 1 FROM enquiries e WHERE e.dealer_id=$1 AND e.vehicle_id=t.vehicle_id AND e.status<>'closed' AND e.merged_into_id IS NULL AND e.appointment_cancelled_at IS NULL AND e.appointment_at>=$3 AND e.attendance IN ('scheduled','arrived'))
      OR EXISTS (SELECT 1 FROM leads l WHERE l.dealer_id=$1 AND l.vehicle_id=t.vehicle_id AND l.closed_at IS NULL AND l.deposit_pence>0)
      OR EXISTS (SELECT 1 FROM sale_workspace s WHERE s.dealer_id=$1 AND s.state#>>'{draft,vehicleId}'=t.vehicle_id::text AND coalesce(s.state#>>'{lifecycle,status}','') NOT IN ('released','sold') AND coalesce(s.state#>>'{draft,handover}','false')<>'true'
        AND (SELECT coalesce(sum(CASE WHEN p->>'signedAmountPence' ~ '^-?[0-9]+$' THEN (p->>'signedAmountPence')::numeric ELSE 0 END),0) FROM jsonb_array_elements(CASE WHEN jsonb_typeof(s.state->'payments')='array' THEN s.state->'payments' ELSE '[]'::jsonb END) p WHERE p->>'status'='confirmed')>0)) DESC,t.created_at DESC,t.id DESC LIMIT 100
  ) SELECT t.*, v.title,v.website_title_override,v.make,v.model,v.registration,v.plate,v.vrm,v.website_hero_image_override,v.source_hero_image,
    v.source,v.currency,v.inventory_status,v.archived_at,v.missing_count AS actual_missing_count,v.source_status,coalesce(v.website_price_override,v.source_price) AS actual_price,
    contacts.people, appointments.amount AS appointment_count, commitments.amount AS paid_count
  FROM selected t JOIN vehicles v ON v.id=t.vehicle_id AND v.dealer_id=t.dealer_id
  CROSS JOIN LATERAL (SELECT coalesce(jsonb_agg(jsonb_build_object('enquiryId',e.id,'customerName',e.customer_name,
      'email',CASE WHEN EXISTS (SELECT 1 FROM enquiry_emails m JOIN email_delivery_checks c ON c.dealer_id=m.dealer_id AND c.message_key='enquiry:'||m.id::text AND c.provider_id=m.provider_id WHERE m.dealer_id=$1 AND m.enquiry_id=e.id AND lower(m.recipient)=lower(e.email) AND c.last_event IN ('bounced','complained','suppressed')) THEN NULL ELSE e.email END,
      'phone',e.phone,'preferredContact',e.preferred_contact,'appointmentAt',CASE WHEN e.appointment_cancelled_at IS NULL THEN e.appointment_at ELSE NULL END,'appointmentStatus',e.appointment_status)), '[]'::jsonb) AS people
    FROM (SELECT e.* FROM enquiries e WHERE e.dealer_id=$1 AND e.vehicle_id=t.vehicle_id AND e.status<>'closed' AND e.merged_into_id IS NULL
      AND (t.kind<>'price_drop' OR (NOT EXISTS (SELECT 1 FROM sale_workspace s WHERE s.dealer_id=$1 AND s.state#>>'{draft,vehicleId}'=t.vehicle_id::text AND (s.state#>>'{draft,sourceEnquiryId}'=e.id::text OR (nullif(e.email,'') IS NOT NULL AND lower(s.state#>>'{draft,email}')=lower(e.email)) OR (nullif(e.phone,'') IS NOT NULL AND regexp_replace(s.state#>>'{draft,phone}','[^0-9]','','g')=regexp_replace(e.phone,'[^0-9]','','g'))) AND coalesce(s.state#>>'{lifecycle,status}','')<>'released')
        AND NOT EXISTS (SELECT 1 FROM leads l WHERE l.dealer_id=$1 AND l.vehicle_id=t.vehicle_id AND (l.enquiry_id=e.id OR (nullif(e.email,'') IS NOT NULL AND lower(l.email)=lower(e.email)) OR (nullif(e.phone,'') IS NOT NULL AND regexp_replace(l.phone,'[^0-9]','','g')=regexp_replace(e.phone,'[^0-9]','','g'))) AND l.closed_at IS NULL AND (l.deposit_pence>0 OR l.stage IN ('reserved','sale_agreed')))))
      ORDER BY e.appointment_at ASC NULLS LAST,e.created_at DESC LIMIT 100) e) contacts
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
      urgency:
        row.appointment_count > 0 || row.paid_count > 0 ? "urgent" : "normal",
      affectedCustomers: (obsolete ? [] : row.people || []).map(
        (person: StockChangeCustomer) => ({
          ...person,
          appointmentAt: iso(person.appointmentAt),
        }),
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
