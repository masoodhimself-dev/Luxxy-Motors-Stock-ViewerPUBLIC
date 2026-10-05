import { randomUUID } from 'node:crypto';
import { Router, type IRouter, type Request, type Response } from "express";
import { and, desc, eq, inArray, ne, sql } from "drizzle-orm";
import { z } from "zod/v4";
import { CreateReservationResponse, ListReservationsResponse, CancelReservationResponse } from "@workspace/api-zod";
import {
  db, dealerSettingsTable, leadEventsTable, leadsTable, salesTable, vehiclesTable, saleWorkspaceTable,
  type Lead, type LeadEvent,
} from "@workspace/db";
import type { SaleWorkspaceRecord } from '@workspace/vehicle-meta';
import { requireStaff, requirePermission, staffLabel } from "../middlewares/staff-auth";
import {
  assertReservationCanBeCancelled, createOnlineReservation, ReservationError,
  reservationView, type ReservationRecord, type ReservationRepository, type ReservationTransaction,
} from "../lib/online-reservations";

const router: IRouter = Router();
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Query = Tx | typeof db;
const dealerId = () => process.env.STOCK_DEALER_ID ?? "luxxy-motors";
const reservationKind = "online_reservation";
const cancellationKind = "online_reservation_cancelled";

const recordSchema = z.object({
  id: z.uuid(), dealerId: z.string(), reference: z.string(), vehicleId: z.uuid(), vehicleTitle: z.string(),
  vehicleRegistration: z.string().nullable().optional(),
  depositPence: z.number().int().positive(), amountReceivedPence: z.literal(0), paymentStatus: z.literal("simulated"),
  status: z.enum(["reserved", "cancelled"]), createdAt: z.iso.datetime(),
  idempotencyKey: z.uuid(), requestFingerprint: z.string(),
  customerName: z.string(), email: z.string(), phone: z.string(),
  terms: z.string(), termsAccepted: z.literal(true), expectedPricePence: z.number().int(),
  partExchange: z.object({ registration: z.string(), mileage: z.number().int() }).optional(),
});

function originalReservationFilter(id: string) {
  return and(
    eq(leadsTable.dealerId, id), eq(leadEventsTable.type, "note_added"),
    sql`${leadEventsTable.payload}->>'kind' = ${reservationKind}`,
  );
}

async function cancelledReservationIds(query: Query, id: string, leadIds: string[]): Promise<Set<string>> {
  if (!leadIds.length) return new Set();
  const rows = await query.select({ leadId: leadEventsTable.leadId })
    .from(leadEventsTable).innerJoin(leadsTable, eq(leadEventsTable.leadId, leadsTable.id))
    .where(and(
      eq(leadsTable.dealerId, id), inArray(leadEventsTable.leadId, leadIds),
      eq(leadEventsTable.type, "note_added"),
      sql`${leadEventsTable.payload}->>'kind' = ${cancellationKind}`,
    ));
  return new Set(rows.map((row) => row.leadId));
}

function readRecord(row: { lead: Lead; event: LeadEvent }, cancelled: boolean): ReservationRecord {
  const record = recordSchema.parse(row.event.payload.reservation);
  if (record.id !== row.lead.id || record.dealerId !== row.lead.dealerId) {
    throw new Error("Reservation metadata does not match its lead");
  }
  return { ...record, status: cancelled ? "cancelled" : "reserved" };
}

async function getReservation(query: Query, id: string, reservationId: string) {
  const [row] = await query.select({ lead: leadsTable, event: leadEventsTable })
    .from(leadEventsTable).innerJoin(leadsTable, eq(leadEventsTable.leadId, leadsTable.id))
    .where(and(originalReservationFilter(id), eq(leadsTable.id, reservationId))).limit(1);
  if (!row) return undefined;
  const cancelled = await cancelledReservationIds(query, id, [row.lead.id]);
  return { ...row, record: readRecord(row, cancelled.has(row.lead.id)) };
}

function transactionAdapter(tx: Tx, id: string): ReservationTransaction {
  return {
    async lockRequest(key) {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`online-reservation:${id}:${key}`}))`);
    },
    async findByIdempotencyKey(key) {
      const [row] = await tx.select({ lead: leadsTable, event: leadEventsTable })
        .from(leadEventsTable).innerJoin(leadsTable, eq(leadEventsTable.leadId, leadsTable.id))
        .where(and(originalReservationFilter(id), sql`${leadEventsTable.payload}->'reservation'->>'idempotencyKey' = ${key}`))
        .limit(1);
      if (!row) return undefined;
      const cancelled = await cancelledReservationIds(tx, id, [row.lead.id]);
      return readRecord(row, cancelled.has(row.lead.id));
    },
    async getSettings() {
      // Hold the settings row while reserving so switching the feature off
      // cannot interleave with a reservation based on stale configuration.
      const [settings] = await tx.select().from(dealerSettingsTable)
        .where(eq(dealerSettingsTable.dealerId, id)).for("share");
      return settings?.config.onlineReservation;
    },
    async lockVehicle(vehicleId) {
      // The sales workflow takes this same lock before creating a sale.
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`sale-vehicle:${vehicleId}`}))`);
    },
    async getVehicle(vehicleId) {
      const [vehicle] = await tx.select().from(vehiclesTable)
        .where(and(eq(vehiclesTable.dealerId, id), eq(vehiclesTable.id, vehicleId))).for("update");
      return vehicle;
    },
    async hasActiveSale(vehicleId) {
      const rows = await tx.select({ id: salesTable.id }).from(salesTable)
        .where(and(eq(salesTable.dealerId, id), eq(salesTable.vehicleId, vehicleId),
          inArray(salesTable.status, ["draft", "ready", "signing", "signed", "completed"]))).limit(1);
      return rows.length > 0;
    },
    async hasCompetingReservation(vehicleId, exceptLeadId) {
      const rows = await tx.select({ id: leadsTable.id }).from(leadsTable)
        .where(and(eq(leadsTable.dealerId, id), eq(leadsTable.vehicleId, vehicleId),
          inArray(leadsTable.stage, ["reserved", "sale_agreed", "collected"]),
          ...(exceptLeadId ? [ne(leadsTable.id, exceptLeadId)] : []))).limit(1);
      return rows.length > 0;
    },
    async create(record, vehicle) {
      // All mutations are in one transaction. Never record a simulated charge
      // as an offline deposit or as a payment in the financial tables.
      const updated = await tx.update(vehiclesTable).set({ inventoryStatus: "reserved", updatedAt: new Date() })
        .where(and(eq(vehiclesTable.dealerId, id), eq(vehiclesTable.id, vehicle.id), eq(vehiclesTable.inventoryStatus, "available")))
        .returning({ id: vehiclesTable.id });
      if (!updated.length) throw new ReservationError("This car has just become unavailable. Please choose another car.", 409);
      const createdAt = new Date(record.createdAt);
      await tx.insert(leadsTable).values({
        id: record.id, dealerId: id, vehicleId: vehicle.id, vehicleTitle: record.vehicleTitle,
        vehicleRegistration: record.vehicleRegistration ?? null,
        vehiclePrice: record.expectedPricePence / 100,
        stage: "reserved", source: "website_form", customerName: record.customerName,
        email: record.email, phone: record.phone, preferredContact: "phone",
        summary: `Online reservation ${record.reference}. Payment simulated; no money received.`,
        nextAction: "Contact the customer about their online reservation. Payment is simulated; no deposit has been received.",
        nextActionDueAt: createdAt, depositPence: 0,
        createdAt, updatedAt: createdAt,
      });
      await tx.insert(leadEventsTable).values([
        {
          leadId: record.id, type: "lead_created", actorType: "customer", actor: record.customerName,
          body: "Customer reserved this car online. Payment simulated; no money received.",
          payload: { source: "website_form", stage: "reserved" },
        },
        {
          leadId: record.id, type: "note_added", actorType: "system",
          body: `Reservation ${record.reference}: £${(record.depositPence / 100).toFixed(2)} payment simulated; £0 received.${record.partExchange ? ` Part exchange: ${record.partExchange.registration}, ${record.partExchange.mileage.toLocaleString("en-GB")} miles.` : ""}`,
          payload: { kind: reservationKind, reservation: record },
        },
      ]);
    },
  };
}

function repository(id: string): ReservationRepository {
  return { transaction: (run) => db.transaction((tx) => run(transactionAdapter(tx, id))) };
}

// Match the public signing endpoints' in-process throttling pattern, with a
// bounded map and expiry cleanup. A shared gateway limiter can supplement it.
const attempts = new Map<string, { count: number; resetAt: number }>();
function allowAttempt(ip: string) {
  const now = Date.now();
  for (const [key, attempt] of attempts) if (attempt.resetAt <= now) attempts.delete(key);
  const existing = attempts.get(ip);
  if (existing) {
    if (existing.count >= 12) return false;
    existing.count += 1;
  } else {
    if (attempts.size >= 10_000) return false;
    attempts.set(ip, { count: 1, resetAt: now + 15 * 60_000 });
  }
  return true;
}

function sendError(error: unknown, req: Request, res: Response) {
  if (error instanceof ReservationError) {
    res.status(error.status).json({ error: error.message });
  } else {
    // Do not echo request bodies, contact details or retry keys in errors.
    req.log.error({ err: error }, "Online reservation operation failed");
    res.status(500).json({ error: "We could not complete this reservation. Please try again or contact the dealership." });
  }
}

router.post("/reservations", async (req, res): Promise<void> => {
  res.set("Cache-Control", "no-store");
  if (!allowAttempt(req.ip ?? "unknown")) {
    res.set("Retry-After", "900").status(429).json({ error: "Too many reservation attempts. Please wait before trying again." });
    return;
  }
  try {
    const configuredThreshold = Number(process.env.STOCK_MISSING_HIDE_THRESHOLD ?? 2);
    const result = await createOnlineReservation(req.body, {
      dealerId: dealerId(), paymentMode: process.env.RESERVATION_PAYMENT_MODE, nodeEnv: process.env.NODE_ENV,
      missingHideThreshold: Number.isFinite(configuredThreshold) && configuredThreshold >= 0 ? configuredThreshold : 2,
    }, repository(dealerId()));
    res.status(result.replayed ? 200 : 201).json(CreateReservationResponse.parse(result.reservation));
  } catch (error) { sendError(error, req, res); }
});

router.get("/reservations", requireStaff, async (req, res): Promise<void> => {
  res.set("Cache-Control", "no-store");
  try {
    const id = dealerId();
    const rows = await db.select({ lead: leadsTable, event: leadEventsTable }).from(leadEventsTable)
      .innerJoin(leadsTable, eq(leadEventsTable.leadId, leadsTable.id))
      .where(originalReservationFilter(id)).orderBy(desc(leadsTable.createdAt));
    const cancelled = await cancelledReservationIds(db, id, rows.map((row) => row.lead.id));
    res.json(ListReservationsResponse.parse({ reservations: rows.map((row) => {
      const record = readRecord(row, cancelled.has(row.lead.id));
      return {
        ...reservationView(record), leadId: row.lead.id,
        customerName: row.lead.customerName, email: row.lead.email ?? record.email, phone: row.lead.phone ?? record.phone,
      };
    }) }));
  } catch (error) { sendError(error, req, res); }
});

router.post("/reservations/:id/cancel", requireStaff, requirePermission("sales.manage"), async (req, res): Promise<void> => {
  res.set("Cache-Control", "no-store");
  if (!z.uuid().safeParse(req.params.id).success) {
    res.status(400).json({ error: "Invalid reservation." });
    return;
  }
  try {
    const id = dealerId();
    const result = await db.transaction(async (tx) => {
      const found = await getReservation(tx, id, req.params.id);
      if (!found) throw new ReservationError("Reservation not found.", 404);
      // Sales use dealer then vehicle locks; preserve that order to avoid deadlocks.
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`sale-workspace:${id}`}))`);
      const adapter = transactionAdapter(tx, id);
      await adapter.lockVehicle(found.record.vehicleId);
      const vehicle = await adapter.getVehicle(found.record.vehicleId);
      const [lead] = await tx.select().from(leadsTable).where(and(eq(leadsTable.dealerId, id), eq(leadsTable.id, found.lead.id))).for("update");
      const latest = await getReservation(tx, id, req.params.id);
      if (!latest || !lead) throw new ReservationError("Reservation not found.", 404);
      if (latest.record.status === "cancelled") return reservationView(latest.record);
      if (lead.vehicleId !== found.record.vehicleId) {
        throw new ReservationError("The vehicle linked to this lead has changed. Review the lead before releasing the car.", 409);
      }
      const connected = await tx.select().from(saleWorkspaceTable).where(and(eq(saleWorkspaceTable.dealerId, id), sql`${saleWorkspaceTable.state}#>>'{draft,sourceReservationId}' = ${lead.id}`)).for('update');
      if (connected.some(row => (row.state as unknown as SaleWorkspaceRecord).lifecycle?.status === 'sold')) throw new ReservationError('This reservation belongs to a sold vehicle. Review its sale file.', 409);
      assertReservationCanBeCancelled({
        inventoryStatus: vehicle?.inventoryStatus, leadStage: lead.stage, depositPence: lead.depositPence,
        hasActiveSale: await adapter.hasActiveSale(found.record.vehicleId),
        hasCompetingReservation: await adapter.hasCompetingReservation(found.record.vehicleId, lead.id),
      });
      const cancelledAt = new Date().toISOString();
      for (const row of connected) {
        const sale = row.state as unknown as SaleWorkspaceRecord;
        if (sale.lifecycle?.status === 'reserved') {
          sale.lifecycle = { ...sale.lifecycle, status: 'released', changedAt: cancelledAt };
          sale.revision += 1; sale.updatedAt = cancelledAt;
          sale.events.push({ id: randomUUID(), type: 'reservation-cancelled', description: 'Linked online reservation cancelled; car released', actor: staffLabel(req), occurredAt: cancelledAt });
          await tx.update(saleWorkspaceTable).set({ state: sale as unknown as Record<string, unknown>, revision: sale.revision, updatedAt: new Date(cancelledAt) }).where(eq(saleWorkspaceTable.id, sale.id));
        }
      }
      await tx.update(vehiclesTable).set({ inventoryStatus: "available", auditMetadata: sql`${vehiclesTable.auditMetadata} || ${JSON.stringify({ saleWorkspaceId: null, saleWorkspaceStatus: 'released' })}::jsonb`, updatedAt: new Date() })
        .where(and(eq(vehiclesTable.dealerId, id), eq(vehiclesTable.id, found.record.vehicleId), eq(vehiclesTable.inventoryStatus, "reserved")));
      await tx.update(leadsTable).set({ stage: "qualifying", nextAction: "Contact the customer following cancellation of their online reservation.", updatedAt: new Date() })
        .where(and(eq(leadsTable.dealerId, id), eq(leadsTable.id, lead.id)));
      await tx.insert(leadEventsTable).values([
        {
          leadId: lead.id, type: "note_added", actorType: "staff", actor: staffLabel(req),
          body: `Online reservation ${latest.record.reference} cancelled. Car released; no payment or refund was recorded.`,
          payload: { kind: cancellationKind, reservationId: lead.id, reference: latest.record.reference, amountReceivedPence: 0 },
        },
        {
          leadId: lead.id, type: "stage_changed", actorType: "staff", actor: staffLabel(req),
          body: "Online reservation cancelled; lead returned to qualifying.", payload: { from: "reserved", to: "qualifying" },
        },
      ]);
      return reservationView({ ...latest.record, status: "cancelled" });
    });
    res.json(CancelReservationResponse.parse(result));
  } catch (error) { sendError(error, req, res); }
});

export default router;
