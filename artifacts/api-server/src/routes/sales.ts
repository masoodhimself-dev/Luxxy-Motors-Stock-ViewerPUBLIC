import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { Router, type IRouter, type Request } from "express";
import { requireStaff } from "../middlewares/staff-auth";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import {
  acknowledgementsTable,
  customerTable,
  dealVaultArtifactsTable,
  invoicesTable,
  saleAdjustmentsTable,
  saleDocumentsTable,
  saleEventsTable,
  saleFulfilmentsTable,
  salePartExchangesTable,
  saleChecklistItemsTable,
  salePaymentsTable,
  saleRevisionsTable,
  saleWarrantiesTable,
  salesTable,
  signaturesTable,
  signingSessionsTable,
  vehiclesTable,
  type Sale,
} from "@workspace/db";
import { db } from "@workspace/db";
import { demoESignProvider } from "../lib/esign-provider";
import { advanceLeadForSale, LeadError, resolveLeadForSale } from "../lib/leads";
import {
  GetSaleChecklistParams,
  GetSaleChecklistResponse,
  UpdateSaleChecklistItemBody,
  UpdateSaleChecklistItemParams,
  UpdateSaleChecklistItemResponse,
} from "@workspace/api-zod";

const router: IRouter = Router();
const ACTIVE_SALE_STATUSES = ["draft", "ready", "signing", "signed"] as const;
const SESSION_LIFETIME_MS = 72 * 60 * 60 * 1000;
const tokenAttempts = new Map<string, { count: number; resetAt: number }>();

const customerInput = z.object({
  id: z.string().uuid().optional(),
  name: z.string().trim().min(2).max(120),
  email: z.string().trim().email().max(320).nullable().optional(),
  phone: z.string().trim().max(40).nullable().optional(),
});
const saleInput = z.object({
  vehicleId: z.string().uuid(),
  enquiryId: z.string().uuid().nullable().optional(),
  leadId: z.string().uuid().nullable().optional(),
  customer: customerInput.optional(),
  customerId: z.string().uuid().optional(),
  agreedPricePence: z.number().int().min(0).max(10_000_000),
  depositPence: z.number().int().min(0).max(10_000_000).default(0),
  mileageAtSale: z.number().int().min(0).max(2_000_000).nullable().optional(),
  disclosureNotes: z.string().trim().max(4000).nullable().optional(),
  internalNotes: z.string().trim().max(4000).nullable().optional(),
  adjustments: z
    .array(
      z.object({
        kind: z.string().trim().min(1).max(40),
        description: z.string().trim().min(1).max(240),
        amountPence: z.number().int().min(-10_000_000).max(10_000_000),
      }),
    )
    .max(30)
    .default([]),
  partExchange: z
    .object({
      description: z.string().trim().min(1).max(240),
      registration: z.string().trim().max(20).nullable().optional(),
      agreedValuePence: z.number().int().min(0).max(10_000_000),
      customerDeclaration: z.string().trim().min(1).max(4000),
    })
    .nullable()
    .optional(),
  warranty: z
    .object({
      name: z.string().trim().min(1).max(120),
      durationMonths: z.number().int().min(1).max(120).nullable().optional(),
      pricePence: z.number().int().min(0).max(10_000_000).default(0),
      terms: z.string().trim().min(1).max(4000),
    })
    .nullable()
    .optional(),
  fulfilment: z
    .object({
      method: z.string().trim().min(1).max(80),
      targetDate: z.string().datetime().nullable().optional(),
      address: z.record(z.string(), z.unknown()).nullable().optional(),
      notes: z.string().trim().max(2000).nullable().optional(),
    })
    .nullable()
    .optional(),
});
const demoSignatureInput = z.object({
  signerName: z.string().trim().min(2).max(120),
  signerEmail: z.string().trim().email().max(320).nullable().optional(),
  acceptedCodes: z.array(z.string().trim().min(1).max(80)).max(30),
});

const checklistCodes = [
  "customer_confirmed",
  "vehicle_confirmed",
  "price_confirmed",
  "disclosure_confirmed",
  "mileage_confirmed",
  "warranty_confirmed",
  "fulfilment_confirmed",
  "part_exchange_confirmed",
  "deposit_confirmed",
  "documents_generated",
] as const;
type ChecklistCode = (typeof checklistCodes)[number];

type SaleInput = z.infer<typeof saleInput>;
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type QueryDb = Tx | typeof db;

function dealerId() {
  return process.env.STOCK_DEALER_ID ?? "luxxy-motors";
}

function canonicalJson(value: unknown): string {
  if (value === null) return "null";
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .filter((key) => record[key] !== undefined)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
      .join(",")}}`;
  }
  if (typeof value === "undefined") return "null";
  if (typeof value === "number" && !Number.isFinite(value)) return "null";
  return JSON.stringify(value);
}

const hashValue = (value: unknown) =>
  createHash("sha256").update(canonicalJson(value)).digest("hex");

function tokenHash(token: string) {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error("SESSION_SECRET is required for signing sessions");
  return createHmac("sha256", secret).update(token).digest("hex");
}

function tokenMatches(stored: string, candidate: string) {
  const actual = tokenHash(candidate);
  const a = Buffer.from(stored, "hex");
  const b = Buffer.from(actual, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

function signingUrl(req: Request, token: string) {
  const host = req.get("host");
  if (!host) return `/sign/${token}`;
  return `${req.protocol}://${host}/sign/${token}`;
}

function developmentOnly() {
  return {
    developmentOnly: true,
    warning: "DEVELOPMENT ONLY. Staff authentication and legal review are required before production use.",
  };
}

function rateLimitToken(req: Request, token: string) {
  const key = `${req.ip}:${hashValue(token).slice(0, 16)}`;
  const now = Date.now();
  const prior = tokenAttempts.get(key);
  if (!prior || prior.resetAt <= now) {
    tokenAttempts.set(key, { count: 1, resetAt: now + 10 * 60 * 1000 });
    return true;
  }
  if (prior.count >= 30) return false;
  prior.count += 1;
  return true;
}

function moneyTotal(input: SaleInput) {
  const adjustmentTotal = input.adjustments.reduce(
    (sum, adjustment) => sum + adjustment.amountPence,
    0,
  );
  const warrantyTotal = input.warranty?.pricePence ?? 0;
  const partExchangeCredit = input.partExchange?.agreedValuePence ?? 0;
  return input.agreedPricePence + adjustmentTotal + warrantyTotal - partExchangeCredit;
}

async function lockVehicle(tx: Tx, vehicleId: string) {
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtext(${"sale-vehicle:" + vehicleId}))`,
  );
}

async function lockSale(tx: Tx, saleId: string) {
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtext(${"sale:" + saleId}))`,
  );
}

async function recordEvent(
  tx: Tx,
  saleId: string,
  eventType: string,
  actorType: "staff" | "customer" | "system" | "provider",
  payload: Record<string, unknown>,
) {
  await tx.insert(saleEventsTable).values({
    saleId,
    eventType,
    actorType,
    payload,
  });
}

async function loadSale(tx: QueryDb, saleId: string) {
  const [sale] = await tx
    .select()
    .from(salesTable)
    .where(and(eq(salesTable.id, saleId), eq(salesTable.dealerId, dealerId())));
  if (!sale) return null;
  const [customer] = await tx
    .select()
    .from(customerTable)
    .where(eq(customerTable.id, sale.customerId));
  const [vehicle] = await tx
    .select()
    .from(vehiclesTable)
    .where(eq(vehiclesTable.id, sale.vehicleId));
  const revisions = await tx
    .select()
    .from(saleRevisionsTable)
    .where(eq(saleRevisionsTable.saleId, saleId))
    .orderBy(desc(saleRevisionsTable.revisionNumber));
  const revisionIds = revisions.map((revision) => revision.id);
  const documents = revisionIds.length
    ? await tx
        .select()
        .from(saleDocumentsTable)
        .where(inArray(saleDocumentsTable.revisionId, revisionIds))
        .orderBy(asc(saleDocumentsTable.sortOrder))
    : [];
  const sessions = await tx
    .select()
    .from(signingSessionsTable)
    .where(eq(signingSessionsTable.saleId, saleId))
    .orderBy(desc(signingSessionsTable.createdAt));
  const sessionIds = sessions.map((session) => session.id);
  const acknowledgements = sessionIds.length
    ? await tx
        .select()
        .from(acknowledgementsTable)
        .where(inArray(acknowledgementsTable.signingSessionId, sessionIds))
    : [];
  const signatures = sessionIds.length
    ? await tx
        .select()
        .from(signaturesTable)
        .where(inArray(signaturesTable.signingSessionId, sessionIds))
    : [];
  const [invoice] = await tx
    .select()
    .from(invoicesTable)
    .where(eq(invoicesTable.saleId, saleId));
  const vault = await tx
    .select()
    .from(dealVaultArtifactsTable)
    .where(eq(dealVaultArtifactsTable.saleId, saleId));
  const adjustments = await tx
    .select()
    .from(saleAdjustmentsTable)
    .where(eq(saleAdjustmentsTable.saleId, saleId));
  const payments = await tx
    .select()
    .from(salePaymentsTable)
    .where(eq(salePaymentsTable.saleId, saleId));
  const partExchanges = await tx
    .select()
    .from(salePartExchangesTable)
    .where(eq(salePartExchangesTable.saleId, saleId));
  const warranties = await tx
    .select()
    .from(saleWarrantiesTable)
    .where(eq(saleWarrantiesTable.saleId, saleId));
  const fulfilments = await tx
    .select()
    .from(saleFulfilmentsTable)
    .where(eq(saleFulfilmentsTable.saleId, saleId));
  const checklistItems = await tx
    .select()
    .from(saleChecklistItemsTable)
    .where(eq(saleChecklistItemsTable.saleId, saleId));
  const events = await tx
    .select()
    .from(saleEventsTable)
    .where(eq(saleEventsTable.saleId, saleId))
    .orderBy(desc(saleEventsTable.createdAt));
  return {
    sale,
    customer,
    vehicle,
    revisions,
    documents,
    sessions,
    acknowledgements,
    signatures,
    invoice,
    vault,
    adjustments,
    payments,
    partExchanges,
    warranties,
    fulfilments,
    checklistItems,
    events,
  };
}

function saleSummary(context: Awaited<ReturnType<typeof loadSale>>) {
  if (!context) return null;
  const latestRevision = context.revisions[0] ?? null;
  const latestSession = context.sessions[0] ?? null;
  const signature = latestSession
    ? context.signatures.find(
        (candidate) => candidate.signingSessionId === latestSession.id,
      )
    : null;
  return {
    ...developmentOnly(),
    id: context.sale.id,
    status: context.sale.status,
    leadId: context.sale.leadId,
    enquiryId: context.sale.enquiryId,
    currency: context.sale.currency,
    agreedPricePence: context.sale.agreedPricePence,
    depositPence: context.sale.depositPence,
    balancePence: context.sale.balancePence,
    mileageAtSale: context.sale.mileageAtSale,
    disclosureNotes: context.sale.disclosureNotes,
    internalNotes: context.sale.internalNotes,
    createdAt: context.sale.createdAt,
    completedAt: context.sale.completedAt,
    vehicle: context.vehicle
      ? {
          id: context.vehicle.id,
          title: context.vehicle.title,
          registration: context.vehicle.registration ?? context.vehicle.vrm,
          price: context.vehicle.websitePriceOverride ?? context.vehicle.sourcePrice,
          inventoryStatus: context.vehicle.inventoryStatus,
          sourceStatus: context.vehicle.sourceStatus,
        }
      : null,
    customer: context.customer
      ? {
          id: context.customer.id,
          name: context.customer.name,
          email: context.customer.email,
          phone: context.customer.phone,
        }
      : null,
    latestRevision: latestRevision
      ? {
          id: latestRevision.id,
          revisionNumber: latestRevision.revisionNumber,
          status: latestRevision.status,
          packHash: latestRevision.packHash,
          createdAt: latestRevision.createdAt,
          signedAt: latestRevision.signedAt,
          documents: context.documents
            .filter((document) => document.revisionId === latestRevision.id)
            .map((document) => ({
              id: document.id,
              documentType: document.documentType,
              title: document.title,
              templateVersion: document.templateVersion,
              sortOrder: document.sortOrder,
              required: document.required,
              contentHash: document.contentHash,
            })),
        }
      : null,
    signingSession: latestSession
      ? {
          id: latestSession.id,
          status: latestSession.status,
          providerKind: latestSession.providerKind,
          expiresAt: latestSession.expiresAt,
          createdAt: latestSession.createdAt,
          signedAt: latestSession.signedAt,
          signatureName: signature?.signerName ?? null,
        }
      : null,
    invoice: context.invoice
      ? {
          id: context.invoice.id,
          invoiceNumber: context.invoice.invoiceNumber,
          status: context.invoice.status,
          totalPence: context.invoice.totalPence,
          balancePence: context.invoice.balancePence,
          issuedAt: context.invoice.issuedAt,
        }
      : null,
    dealVault: context.vault.map((artifact) => ({
      id: artifact.id,
      storageStatus: artifact.storageStatus,
      packHash: artifact.packHash,
      createdAt: artifact.createdAt,
    })),
    adjustments: context.adjustments,
    payments: context.payments,
    partExchanges: context.partExchanges,
    warranties: context.warranties,
    fulfilments: context.fulfilments,
    events: context.events.map((event) => ({
      id: event.id,
      eventType: event.eventType,
      actorType: event.actorType,
      createdAt: event.createdAt,
      payload: event.payload,
    })),
  };
}

const checklistDefinitions: Record<
  ChecklistCode,
  {
    label: string;
    description: string;
    canMarkNotApplicable: boolean;
  }
> = {
  customer_confirmed: {
    label: "Customer details confirmed",
    description: "Review the customer name and at least one contact method.",
    canMarkNotApplicable: false,
  },
  vehicle_confirmed: {
    label: "Vehicle details confirmed",
    description: "Review the vehicle identity, registration and live stock status.",
    canMarkNotApplicable: false,
  },
  price_confirmed: {
    label: "Price confirmed",
    description: "Confirm the GBP total, deposit and remaining balance.",
    canMarkNotApplicable: false,
  },
  disclosure_confirmed: {
    label: "CAT S/N disclosure acknowledged",
    description: "Confirm the category disclosure and the recorded vehicle disclosure note.",
    canMarkNotApplicable: true,
  },
  mileage_confirmed: {
    label: "Mileage acknowledged",
    description: "Confirm the mileage captured at the point of sale.",
    canMarkNotApplicable: false,
  },
  warranty_confirmed: {
    label: "Warranty selected or declined",
    description: "Confirm warranty terms or explicitly record that no additional warranty was selected.",
    canMarkNotApplicable: true,
  },
  fulfilment_confirmed: {
    label: "Delivery or collection selected",
    description: "Confirm how and when the customer will receive the vehicle.",
    canMarkNotApplicable: false,
  },
  part_exchange_confirmed: {
    label: "Part-exchange details confirmed",
    description: "Confirm the part-exchange declaration or explicitly record that there is no part exchange.",
    canMarkNotApplicable: true,
  },
  deposit_confirmed: {
    label: "Deposit recorded",
    description: "Confirm the deposit payment or explicitly record that no deposit is required.",
    canMarkNotApplicable: true,
  },
  documents_generated: {
    label: "Required documents generated",
    description: "The current revision must contain the complete hashed document pack.",
    canMarkNotApplicable: false,
  },
};

type ChecklistEvaluation = {
  code: ChecklistCode;
  label: string;
  description: string;
  status: "pending" | "complete" | "not_applicable" | "invalidated";
  required: boolean;
  eligible: boolean;
  canMarkNotApplicable: boolean;
  message: string;
  completedAt: Date | null;
  completedBy: string | null;
  evidenceHash: string;
  evidence: Record<string, unknown>;
};

function evaluateChecklistItem(
  context: NonNullable<Awaited<ReturnType<typeof loadSale>>>,
  code: ChecklistCode,
): ChecklistEvaluation {
  const { sale, customer, vehicle, revisions, documents, payments, warranties, fulfilments, partExchanges } =
    context;
  const revision = revisions[0];
  const revisionDocuments = revision
    ? documents.filter((document) => document.revisionId === revision.id)
    : [];
  const category = vehicle?.writeOffCategory?.toUpperCase() ?? null;
  const depositRecorded = payments
    .filter(
      (payment) =>
        payment.kind === "deposit" &&
        ["recorded", "received", "paid"].includes(payment.status),
    )
    .reduce((total, payment) => total + payment.amountPence, 0);
  let eligible = false;
  let canMarkNotApplicable = checklistDefinitions[code].canMarkNotApplicable;
  let message = "";
  let evidence: Record<string, unknown> = {};

  switch (code) {
    case "customer_confirmed":
      eligible = Boolean(customer?.name && (customer.email || customer.phone));
      message = eligible
        ? "A usable customer contact is ready to confirm."
        : "Add a customer name and email or phone number.";
      evidence = {
        customerId: customer?.id ?? null,
        name: customer?.name ?? null,
        email: customer?.email ?? null,
        phone: customer?.phone ?? null,
      };
      break;
    case "vehicle_confirmed":
      eligible = Boolean(
        vehicle &&
          vehicle.sourceStatus === "live" &&
          !["sold", "archived"].includes(vehicle.inventoryStatus) &&
          (vehicle.registration || vehicle.vrm) &&
          (vehicle.title || vehicle.make || vehicle.model),
      );
      message = eligible
        ? "The live vehicle identity and registration are available to confirm."
        : "The vehicle needs a live stock record, identity and registration.";
      evidence = {
        vehicleId: vehicle?.id ?? null,
        title: vehicle?.title ?? null,
        registration: vehicle?.registration ?? vehicle?.vrm ?? null,
        mileage: vehicle?.mileage ?? null,
        sourceStatus: vehicle?.sourceStatus ?? null,
        inventoryStatus: vehicle?.inventoryStatus ?? null,
      };
      break;
    case "price_confirmed":
      eligible = Boolean(
        sale.currency === "GBP" &&
          sale.agreedPricePence >= 0 &&
          sale.depositPence >= 0 &&
          sale.depositPence <= sale.agreedPricePence &&
          sale.balancePence === sale.agreedPricePence - sale.depositPence,
      );
      message = eligible
        ? "GBP totals and the remaining balance are consistent."
        : "The price, deposit and balance need to be corrected.";
      evidence = {
        currency: sale.currency,
        agreedPricePence: sale.agreedPricePence,
        depositPence: sale.depositPence,
        balancePence: sale.balancePence,
      };
      break;
    case "disclosure_confirmed":
      eligible = category === "S" || category === "N"
        ? Boolean(sale.disclosureNotes?.trim())
        : true;
      message =
        category === "S" || category === "N"
          ? eligible
            ? `CAT ${category} disclosure note is recorded and ready for acknowledgement.`
            : `Record the CAT ${category} disclosure note before confirming it.`
          : "No CAT S or CAT N category is recorded; mark this item not applicable.";
      evidence = {
        category,
        disclosureNotes: sale.disclosureNotes?.trim() ?? null,
      };
      break;
    case "mileage_confirmed":
      eligible = sale.mileageAtSale !== null && sale.mileageAtSale >= 0;
      message = eligible
        ? `${sale.mileageAtSale?.toLocaleString("en-GB")} miles are recorded at sale.`
        : "Record the mileage at sale before confirming it.";
      evidence = { mileageAtSale: sale.mileageAtSale ?? null };
      break;
    case "warranty_confirmed": {
      const warranty = warranties[0];
      eligible = !warranty || Boolean(warranty.name.trim() && warranty.terms?.trim());
      message = warranty
        ? eligible
          ? "Warranty product and terms are recorded."
          : "Add the warranty terms before confirming the selection."
        : "No additional warranty is recorded; mark this item not applicable.";
      evidence = warranty
        ? {
            id: warranty.id,
            name: warranty.name,
            durationMonths: warranty.durationMonths,
            pricePence: warranty.pricePence,
            terms: warranty.terms,
          }
        : { warranty: null };
      break;
    }
    case "fulfilment_confirmed": {
      const fulfilment = fulfilments[0];
      eligible = Boolean(fulfilment?.method);
      message = eligible
        ? `${fulfilment?.method} is selected for fulfilment.`
        : "Select delivery or collection before continuing.";
      evidence = fulfilment
        ? {
            id: fulfilment.id,
            method: fulfilment.method,
            targetDate: fulfilment.targetDate,
            address: fulfilment.address,
            notes: fulfilment.notes,
          }
        : { fulfilment: null };
      break;
    }
    case "part_exchange_confirmed": {
      const partExchange = partExchanges[0];
      eligible = !partExchange || Boolean(partExchange.customerDeclaration?.trim());
      message = partExchange
        ? eligible
          ? "The part-exchange declaration is recorded."
          : "Add the customer part-exchange declaration before confirming it."
        : "No part exchange is recorded; mark this item not applicable.";
      evidence = partExchange
        ? {
            id: partExchange.id,
            description: partExchange.description,
            registration: partExchange.registration,
            agreedValuePence: partExchange.agreedValuePence,
            customerDeclaration: partExchange.customerDeclaration,
          }
        : { partExchange: null };
      break;
    }
    case "deposit_confirmed":
      eligible = sale.depositPence === 0 || depositRecorded >= sale.depositPence;
      message =
        sale.depositPence === 0
          ? "No deposit is required; mark this item not applicable."
          : eligible
          ? `Deposit of £${(depositRecorded / 100).toFixed(2)} is recorded.`
          : `Record the £${(sale.depositPence / 100).toFixed(2)} deposit before confirming it.`;
      evidence = {
        expectedDepositPence: sale.depositPence,
        recordedDepositPence: depositRecorded,
      };
      break;
    case "documents_generated":
      eligible = Boolean(
        revision &&
          revisionDocuments.length > 0 &&
          revisionDocuments.every((document) => document.required && document.contentHash),
      );
      message = eligible
        ? `${revisionDocuments.length} hashed document(s) are attached to the current revision.`
        : "Prepare the current revision and generate all required documents.";
      evidence = {
        revisionId: revision?.id ?? null,
        documentHashes: revision?.documentHashes ?? null,
        documentIds: revisionDocuments.map((document) => document.id),
      };
      canMarkNotApplicable = false;
      break;
  }

  const row = context.checklistItems.find((item) => item.code === code);
  const evidenceHash = hashValue(evidence);
  const storedStatus = row?.status ?? "pending";
  const status =
    ["complete", "not_applicable"].includes(storedStatus) &&
    row?.evidenceHash !== evidenceHash
      ? "invalidated"
      : storedStatus;
  return {
    code,
    label: checklistDefinitions[code].label,
    description: checklistDefinitions[code].description,
    status,
    required: true,
    eligible,
    canMarkNotApplicable,
    message:
      status === "invalidated"
        ? "The deal data changed after this confirmation; review and confirm it again."
        : message,
    completedAt: status === "complete" || status === "not_applicable" ? row?.completedAt ?? null : null,
    completedBy: status === "complete" || status === "not_applicable" ? row?.completedBy ?? null : null,
    evidenceHash,
    evidence,
  };
}

function checklistState(context: NonNullable<Awaited<ReturnType<typeof loadSale>>>) {
  const items = checklistCodes.map((code) => evaluateChecklistItem(context, code));
  const completed = items.filter(
    (item) =>
      (item.status === "complete" || item.status === "not_applicable") &&
      item.eligible,
  );
  const preSignItems = items.filter((item) => item.code !== "documents_generated");
  return {
    ...developmentOnly(),
    saleId: context.sale.id,
    completedCount: completed.length,
    totalCount: items.length,
    readyForPreparation: preSignItems.every(
      (item) =>
        (item.status === "complete" || item.status === "not_applicable") &&
        item.eligible,
    ),
    readyForCompletion: items.every(
      (item) =>
        (item.status === "complete" || item.status === "not_applicable") &&
        item.eligible,
    ),
    items: items.map(({ evidenceHash: _evidenceHash, evidence: _evidence, ...item }) => item),
    internalItems: items,
  };
}

async function initializeChecklist(tx: QueryDb, saleId: string) {
  await tx
    .insert(saleChecklistItemsTable)
    .values(checklistCodes.map((code) => ({ saleId, code, status: "pending" as const })))
    .onConflictDoNothing();
}

function requiredAcknowledgements(snapshot: Record<string, unknown> | undefined) {
  const configured = snapshot?.requiredAcknowledgements;
  return Array.isArray(configured)
    ? configured.filter(
        (value): value is { code: string; statement: string } =>
          Boolean(
            value &&
              typeof value === "object" &&
              typeof (value as { code?: unknown }).code === "string" &&
              typeof (value as { statement?: unknown }).statement === "string",
          ),
      )
    : [];
}

async function finalChecks(tx: QueryDb, context: NonNullable<Awaited<ReturnType<typeof loadSale>>>) {
  const checks: Array<{
    code: string;
    label: string;
    passed: boolean;
    message: string;
  }> = [];
  const { sale, customer, vehicle, revisions, sessions, acknowledgements, signatures } =
    context;
  const revision = sale.signedRevisionId
    ? revisions.find((candidate) => candidate.id === sale.signedRevisionId)
    : revisions.find((candidate) => candidate.status === "signed");
  const session = revision
    ? sessions.find(
        (candidate) =>
          candidate.revisionId === revision.id && candidate.status === "signed",
      )
    : undefined;
  const signature = session
    ? signatures.find((candidate) => candidate.signingSessionId === session.id)
    : undefined;
  const acceptedCodes = new Set(
    acknowledgements
      .filter((acknowledgement) => acknowledgement.revisionId === revision?.id)
      .map((acknowledgement) => acknowledgement.code),
  );
  const isCompleted = sale.status === "completed";
  const required = requiredAcknowledgements(revision?.snapshot);
  const activeSales = vehicle
    ? await tx
        .select({ id: salesTable.id })
        .from(salesTable)
        .where(
          and(
            eq(salesTable.vehicleId, vehicle.id),
            inArray(salesTable.status, [...ACTIVE_SALE_STATUSES]),
          ),
        )
    : [];
  checks.push({
    code: "customer",
    label: "Customer details",
    passed: Boolean(customer?.name && (customer.email || customer.phone)),
    message: customer?.name
      ? "A usable customer contact is recorded."
      : "Add a customer name and email or phone number.",
  });
  checks.push({
    code: "vehicle",
    label: "Vehicle is still saleable",
    passed:
      Boolean(
        vehicle &&
          !["sold", "archived"].includes(vehicle.inventoryStatus) &&
          vehicle.sourceStatus === "live",
      ) ||
      Boolean(isCompleted && vehicle?.inventoryStatus === "sold" && vehicle.sourceStatus === "live"),
    message:
      isCompleted && vehicle?.inventoryStatus === "sold"
        ? "The vehicle was marked sold by this completed sale."
        : vehicle && vehicle.inventoryStatus !== "sold" && vehicle.inventoryStatus !== "archived"
        ? "The vehicle is not sold or archived."
        : "The vehicle is no longer available for completion.",
  });
  const ownsActiveLock = activeSales.length === 1 && activeSales[0]?.id === sale.id;
  const completedLockReleased = isCompleted && activeSales.length === 0;
  checks.push({
    code: "vehicle_lock",
    label: "Sale-level vehicle lock",
    passed: ownsActiveLock || completedLockReleased,
    message:
      ownsActiveLock
        ? "This sale owns the active lock for the vehicle."
        : completedLockReleased
        ? "The completed sale released its active lock after completion."
        : "Another active sale owns this vehicle.",
  });
  checks.push({
    code: "totals",
    label: "Commercial totals",
    passed:
      sale.currency === "GBP" &&
      sale.agreedPricePence >= 0 &&
      sale.depositPence >= 0 &&
      sale.depositPence <= sale.agreedPricePence &&
      sale.balancePence === sale.agreedPricePence - sale.depositPence,
    message:
      sale.depositPence <= sale.agreedPricePence
        ? "GBP totals and the remaining balance are consistent."
        : "Deposit cannot exceed the agreed total.",
  });
  checks.push({
    code: "revision",
    label: "Signed sale revision",
    passed: Boolean(revision && revision.status === "signed" && sale.signedRevisionId === revision.id),
    message: revision ? `Revision ${revision.revisionNumber} is selected for completion.` : "Prepare and sign a sale revision.",
  });
  const revisionDocuments = revision
    ? context.documents.filter((document) => document.revisionId === revision.id)
    : [];
  checks.push({
    code: "documents",
    label: "Document pack",
    passed: Boolean(
      revision &&
        revisionDocuments.length > 0 &&
        revisionDocuments.every((document) => document.required && document.contentHash),
    ),
    message: revisionDocuments.length
      ? `${revisionDocuments.length} hashed development document(s) are attached.`
      : "Prepare the required document pack.",
  });
  const recalculatedPackHash = revision
    ? hashValue({
        snapshot: revision.snapshot,
        manifest: revision.manifest,
        documentHashes: revision.documentHashes,
      })
    : "";
  checks.push({
    code: "hashes",
    label: "Pack integrity",
    passed: Boolean(revision && recalculatedPackHash === revision.packHash),
    message:
      revision && recalculatedPackHash === revision.packHash
        ? "The revision manifest and pack hash match."
        : "The revision hash does not match its manifest.",
  });
  checks.push({
    code: "acknowledgements",
    label: "Customer acknowledgements",
    passed: required.length > 0 && required.every((item) => acceptedCodes.has(item.code)),
    message:
      required.length > 0 && required.every((item) => acceptedCodes.has(item.code))
        ? "All required customer acknowledgements are recorded."
        : "Every required acknowledgement must be accepted.",
  });
  checks.push({
    code: "signature",
    label: "Revision-bound signature",
    passed: Boolean(
      session &&
        signature &&
        session.revisionId === revision?.id &&
        signature.revisionId === revision?.id &&
        signature.signatureHash &&
        (session.intendedCustomerEmail == null ||
          session.intendedCustomerEmail.toLowerCase() === (signature.signerEmail ?? "").toLowerCase()),
    ),
    message: signature ? "The demo signature is bound to this exact revision." : "Complete the customer signing step.",
  });
  checks.push({
    code: "disclosures",
    label: "Vehicle disclosures",
    passed: Boolean(sale.disclosureNotes?.trim()),
    message: sale.disclosureNotes?.trim()
      ? "A disclosure note is recorded for legal review."
      : "Record the vehicle disclosure note before completion.",
  });
  const partExchange = context.partExchanges[0];
  checks.push({
    code: "part_exchange",
    label: "Part exchange declaration",
    passed: !partExchange || Boolean(partExchange.customerDeclaration?.trim()),
    message: !partExchange
      ? "No part exchange is included."
      : "The part exchange declaration is recorded.",
  });
  const warranty = context.warranties[0];
  checks.push({
    code: "warranty",
    label: "Warranty terms",
    passed: !warranty || Boolean(warranty.terms?.trim()),
    message: !warranty ? "No additional warranty is included." : "Warranty terms are recorded.",
  });
  const fulfilment = context.fulfilments[0];
  checks.push({
    code: "fulfilment",
    label: "Fulfilment plan",
    passed: !fulfilment || Boolean(fulfilment.method),
    message: !fulfilment ? "No separate fulfilment plan is recorded." : "Fulfilment method is recorded.",
  });
  const readiness = checklistState(context);
  checks.push({
    code: "deal_readiness",
    label: "Deal readiness checklist",
    passed: readiness.readyForCompletion,
    message: readiness.readyForCompletion
      ? "All deal readiness confirmations are current."
      : `${readiness.totalCount - readiness.completedCount} readiness item(s) still need attention.`,
  });
  return {
    ...developmentOnly(),
    saleId: sale.id,
    canComplete: checks.every((check) => check.passed),
    checks,
  };
}

function publicSigningPayload(
  context: NonNullable<Awaited<ReturnType<typeof loadSale>>>,
  session: NonNullable<Awaited<ReturnType<typeof loadSale>>>["sessions"][number],
) {
  const revision = context.revisions.find((candidate) => candidate.id === session.revisionId);
  if (!revision) return null;
  const documents = context.documents
    .filter((document) => document.revisionId === revision.id)
    .sort((a, b) => a.sortOrder - b.sortOrder);
  return {
    ...developmentOnly(),
    session: {
      id: session.id,
      status: session.status,
      expiresAt: session.expiresAt,
      providerKind: session.providerKind,
    },
    sale: {
      id: context.sale.id,
      currency: context.sale.currency,
      agreedPricePence: context.sale.agreedPricePence,
      depositPence: context.sale.depositPence,
      balancePence: context.sale.balancePence,
    },
    customer: context.customer
      ? { name: context.customer.name, email: context.customer.email }
      : null,
    revision: {
      id: revision.id,
      revisionNumber: revision.revisionNumber,
      packHash: revision.packHash,
      snapshot: revision.snapshot,
      documents: documents.map((document) => ({
        id: document.id,
        documentType: document.documentType,
        title: document.title,
        content: document.content,
        contentHash: document.contentHash,
        required: document.required,
      })),
      acknowledgements: requiredAcknowledgements(revision.snapshot),
    },
  };
}

async function createRevisionAndSession(tx: Tx, saleId: string, req: Request) {
  await initializeChecklist(tx, saleId);
  const context = await loadSale(tx, saleId);
  if (!context) throw new Error("Sale not found");
  const readiness = checklistState(context);
  if (!readiness.readyForPreparation) {
    const outstanding = readiness.items
      .filter(
        (item) =>
          item.code !== "documents_generated" &&
          !(
            (item.status === "complete" || item.status === "not_applicable") &&
            item.eligible
          ),
      )
      .map((item) => item.label)
      .join(", ");
    throw new Error(`Complete the deal readiness checklist first: ${outstanding}`);
  }
  if (["completed", "cancelled"].includes(context.sale.status)) {
    throw new Error("This sale cannot be prepared");
  }
  const revisionNumber = (context.revisions[0]?.revisionNumber ?? 0) + 1;
  const customer = context.customer;
  const vehicle = context.vehicle;
  if (!customer || !vehicle) throw new Error("Sale is missing customer or vehicle");
  const snapshot = {
    saleId,
    revisionNumber,
    customer: {
      name: customer.name,
      email: customer.email,
      phone: customer.phone,
      address: customer.address,
    },
    vehicle: {
      id: vehicle.id,
      title: vehicle.title,
      make: vehicle.make,
      model: vehicle.model,
      year: vehicle.year,
      registration: vehicle.registration ?? vehicle.vrm,
      mileage: vehicle.mileage,
      writeOffCategory: vehicle.writeOffCategory,
      price: vehicle.websitePriceOverride ?? vehicle.sourcePrice,
      currency: vehicle.currency,
    },
    terms: {
      currency: context.sale.currency,
      agreedPricePence: context.sale.agreedPricePence,
      depositPence: context.sale.depositPence,
      balancePence: context.sale.balancePence,
      mileageAtSale: context.sale.mileageAtSale,
      disclosureNotes: context.sale.disclosureNotes,
    },
    requiredAcknowledgements: [
      {
        code: "sale_terms",
        statement: "I have reviewed the development sale terms and the attached document pack.",
      },
      {
        code: "vehicle_disclosures",
        statement: "I acknowledge the vehicle information and disclosures shown in this development pack.",
      },
      {
        code: "document_review",
        statement: "I have reviewed the complete pack and understand this is a development-only demonstration.",
      },
    ],
  };
  const documents = [
    {
      documentType: "sale_summary",
      title: "Development vehicle sale summary",
      templateVersion: "demo-2026-01",
      sortOrder: 1,
      required: true,
      content: [
        "DEVELOPMENT ONLY — NOT A LEGAL CONTRACT",
        "",
        `Vehicle: ${vehicle.title ?? ([vehicle.make, vehicle.model].filter(Boolean).join(" ") || "Vehicle")}`,
        `Registration: ${vehicle.registration ?? vehicle.vrm ?? "Not recorded"}`,
        `Customer: ${customer.name}`,
        `Agreed total: £${(context.sale.agreedPricePence / 100).toFixed(2)}`,
        `Deposit recorded: £${(context.sale.depositPence / 100).toFixed(2)}`,
        `Balance: £${(context.sale.balancePence / 100).toFixed(2)}`,
        "",
        "This template requires legal review before any production use.",
      ].join("\n"),
    },
    {
      documentType: "customer_declarations",
      title: "Development customer declarations",
      templateVersion: "demo-2026-01",
      sortOrder: 2,
      required: true,
      content: [
        "DEVELOPMENT ONLY — CUSTOMER DECLARATIONS TEMPLATE",
        "",
        context.sale.disclosureNotes?.trim() || "No vehicle disclosure note recorded.",
        "",
        "The customer must review the document pack and acknowledge the statements before the development signature step.",
        "This template requires legal review before any production use.",
      ].join("\n"),
    },
  ].map((document) => ({
    ...document,
    contentHash: hashValue(document.content),
  }));
  const manifest = documents.map((document) => ({
    documentType: document.documentType,
    title: document.title,
    templateVersion: document.templateVersion,
    sortOrder: document.sortOrder,
    required: document.required,
    contentHash: document.contentHash,
  }));
  const documentHashes = Object.fromEntries(
    documents.map((document) => [document.documentType, document.contentHash]),
  );
  const packHash = hashValue({ snapshot, manifest, documentHashes });
  const invalidatedAt = new Date();
  await tx
    .update(signingSessionsTable)
    .set({ status: "revoked", revokedAt: invalidatedAt })
    .where(
      and(
        eq(signingSessionsTable.saleId, saleId),
        inArray(signingSessionsTable.status, ["pending", "signed"]),
      ),
    );
  await tx
    .update(saleRevisionsTable)
    .set({ status: "superseded" })
    .where(
      and(
        eq(saleRevisionsTable.saleId, saleId),
        inArray(saleRevisionsTable.status, ["active", "signed"]),
      ),
    );
  const [revision] = await tx
    .insert(saleRevisionsTable)
    .values({
      saleId,
      revisionNumber,
      status: "active",
      snapshot,
      manifest,
      documentHashes,
      packHash,
    })
    .returning();
  await tx.insert(saleDocumentsTable).values(
    documents.map((document) => ({
      revisionId: revision.id,
      ...document,
    })),
  );
  const afterDocuments = await loadSale(tx, saleId);
  if (!afterDocuments) throw new Error("Sale disappeared while preparing");
  const documentChecklist = checklistState(afterDocuments).internalItems.find(
    (item) => item.code === "documents_generated",
  );
  await tx
    .update(saleChecklistItemsTable)
    .set({
      status: "complete",
      revisionId: revision.id,
      completedBy: "system",
      completedAt: new Date(),
      evidenceHash: documentChecklist?.evidenceHash ?? null,
      evidence: documentChecklist?.evidence ?? null,
    })
    .where(
      and(
        eq(saleChecklistItemsTable.saleId, saleId),
        eq(saleChecklistItemsTable.code, "documents_generated"),
      ),
    );
  const rawToken = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_LIFETIME_MS);
  const [session] = await tx
    .insert(signingSessionsTable)
    .values({
      saleId,
      revisionId: revision.id,
      tokenHash: tokenHash(rawToken),
      intendedCustomerEmail: customer.email,
      providerKind: "demo",
      status: "pending",
      expiresAt,
    })
    .returning();
  const providerRequest = await demoESignProvider.createSigningRequest({
    saleId,
    revisionId: revision.id,
    signerEmail: customer.email,
  });
  await tx
    .update(signingSessionsTable)
    .set({ providerRequestId: providerRequest.requestId })
    .where(eq(signingSessionsTable.id, session.id));
  await tx
    .update(salesTable)
    .set({ status: "signing", signedRevisionId: null })
    .where(eq(salesTable.id, saleId));
  await recordEvent(tx, saleId, "revision.prepared", "staff", {
    revisionId: revision.id,
    revisionNumber,
    packHash,
    providerKind: "demo",
  });
  return {
    revision,
    session,
    signingUrl: signingUrl(req, rawToken),
  };
}

router.get("/sales", requireStaff, async (_req, res) => {
  try {
    const contexts = await Promise.all(
      (
        await db
          .select({ id: salesTable.id })
          .from(salesTable)
          .where(eq(salesTable.dealerId, dealerId()))
          .orderBy(desc(salesTable.createdAt))
      ).map(({ id }) => loadSale(db, id)),
    );
    res.json(contexts.filter(Boolean).map(saleSummary));
  } catch (error) {
    res.status(500).json({ error: "Unable to load sales", detail: String(error) });
  }
});

router.post("/sales", requireStaff, async (req, res) => {
  const parsed = demoSignatureInput.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid sale", issues: parsed.error.issues });
    return;
  }
  const input = parsed.data;
  const total = moneyTotal(input);
  if (total < 0 || input.depositPence > total) {
    res.status(400).json({ error: "Deposit and adjustments must produce a non-negative balance." });
    return;
  }
  try {
    const context = await loadSale(db, req.params.id);
    res.status(201).json(saleSummary(context));
  } catch (error) {
    if (error instanceof LeadError) {
      res.status(error.status).json({ error: error.message });
      return;
    }
    const message = error instanceof Error ? error.message : "Unable to complete signing";
    res.status(message.includes("already has") ? 409 : 400).json({ error: message });
  }
});

router.get("/sales/:id/checklist", requireStaff, async (req, res): Promise<void> => {
  const parsed = demoSignatureInput.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  try {
    const context = await loadSale(db, req.params.id);
    if (!context) {
      res.status(404).json({ error: "Sale not found" });
      return;
    }
    await initializeChecklist(db, parsed.data.id);
    const current = await loadSale(db, parsed.data.id);
    if (!current) {
      res.status(404).json({ error: "Sale not found" });
      return;
    }
    res.json(GetSaleChecklistResponse.parse(checklistState(current)));
  } catch (error) {
    res.status(500).json({ error: "Unable to load sale checklist", detail: String(error) });
  }
});

router.post("/sales/:id/checklist/:code", requireStaff, async (req, res): Promise<void> => {
  const parsedParams = UpdateSaleChecklistItemParams.safeParse(req.params);
  if (!parsedParams.success) {
    res.status(400).json({ error: parsedParams.error.message });
    return;
  }
  const parsedBody = UpdateSaleChecklistItemBody.safeParse(req.body);
  if (!parsedBody.success) {
    res.status(400).json({ error: parsedBody.error.message });
    return;
  }
  try {
    const result = await db.transaction(async (tx) => {
      const sessionHash = tokenHash(token);
      const [session] = await tx
        .select()
        .from(signingSessionsTable)
        .where(eq(signingSessionsTable.tokenHash, sessionHash));
      if (!session || !tokenMatches(session.tokenHash, token)) throw new Error("Signing session not found");
      await lockSale(tx, session.saleId);
      if (session.status !== "pending") throw new Error("This signing session is no longer pending");
      if (session.expiresAt.getTime() <= Date.now()) {
        await tx
          .update(signingSessionsTable)
          .set({ status: "expired" })
          .where(eq(signingSessionsTable.id, session.id));
        throw new Error("This signing session has expired");
      }
      const context = await loadSale(tx, session.saleId);
      if (!context) throw new Error("Signing session not found");
      const revision = context.revisions.find((candidate) => candidate.id === session.revisionId);
      if (!revision || revision.status !== "active") throw new Error("This sale revision is no longer active");
      if (
        session.intendedCustomerEmail &&
        parsed.data.signerEmail &&
        session.intendedCustomerEmail.toLowerCase() !== parsed.data.signerEmail.toLowerCase()
      ) {
        throw new Error("Signer email does not match the intended customer");
      }
      const required = requiredAcknowledgements(revision.snapshot);
      const accepted = new Set(parsed.data.acceptedCodes);
      if (required.some((item) => !accepted.has(item.code))) {
        throw new Error("All required acknowledgements must be accepted");
      }
      const [existingSignature] = await tx
        .select({ id: signaturesTable.id })
        .from(signaturesTable)
        .where(eq(signaturesTable.signingSessionId, session.id));
      if (existingSignature) throw new Error("This signing session has already been completed");
      const signatureHash = hashValue({
        sessionId: session.id,
        revisionId: revision.id,
        signerName: parsed.data.signerName,
        signerEmail: parsed.data.signerEmail ?? null,
        packHash: revision.packHash,
        acceptedCodes: [...accepted].sort(),
      });
      await tx.insert(acknowledgementsTable).values(
        required.map((item) => ({
          signingSessionId: session.id,
          revisionId: revision.id,
          code: item.code,
          statement: item.statement,
        })),
      );
      await tx.insert(signaturesTable).values({
        signingSessionId: session.id,
        revisionId: revision.id,
        signatureType: "demo",
        signerName: parsed.data.signerName,
        signerEmail: parsed.data.signerEmail ?? null,
        signatureHash,
      });
      await tx
        .update(signingSessionsTable)
        .set({ status: "signed", signedAt: new Date() })
        .where(eq(signingSessionsTable.id, session.id));
      await tx
        .update(saleRevisionsTable)
        .set({ status: "signed", signedAt: new Date() })
        .where(eq(saleRevisionsTable.id, revision.id));
      await tx
        .update(salesTable)
        .set({ status: "signed", signedRevisionId: revision.id })
        .where(eq(salesTable.id, session.saleId));
      await recordEvent(tx, session.saleId, "customer.demo_signed", "customer", {
        revisionId: revision.id,
        signatureHash,
      });
      return loadSale(tx, session.saleId);
    });
    res.json({
      ...developmentOnly(),
      signed: true,
      sale: saleSummary(result),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to complete signing";
    res.status(message === "Signing session not found" ? 404 : 409).json({ error: message });
  }
});

router.post("/sales/:id/revoke-signing", requireStaff, async (req, res) => {
  try {
    const context = await loadSale(db, req.params.id);
    if (!context) {
      res.status(404).json({ error: "Sale not found" });
      return;
    }
    res.json(await finalChecks(db, context));
  } catch (error) {
    res.status(500).json({ error: "Unable to calculate final checks", detail: String(error) });
  }
});

router.post("/sales/:id/complete", requireStaff, async (req, res) => {
  try {
    const result = await db.transaction(async (tx) => {
      const sessionHash = tokenHash(token);
      const [session] = await tx
        .select()
        .from(signingSessionsTable)
        .where(eq(signingSessionsTable.tokenHash, sessionHash));
      if (!session || !tokenMatches(session.tokenHash, token)) throw new Error("Signing session not found");
      await lockSale(tx, session.saleId);
      if (session.status !== "pending") throw new Error("This signing session is no longer pending");
      if (session.expiresAt.getTime() <= Date.now()) {
        await tx
          .update(signingSessionsTable)
          .set({ status: "expired" })
          .where(eq(signingSessionsTable.id, session.id));
        throw new Error("This signing session has expired");
      }
      const context = await loadSale(tx, session.saleId);
      if (!context) throw new Error("Signing session not found");
      const revision = context.revisions.find((candidate) => candidate.id === session.revisionId);
      if (!revision || revision.status !== "active") throw new Error("This sale revision is no longer active");
      if (
        session.intendedCustomerEmail &&
        parsed.data.signerEmail &&
        session.intendedCustomerEmail.toLowerCase() !== parsed.data.signerEmail.toLowerCase()
      ) {
        throw new Error("Signer email does not match the intended customer");
      }
      const required = requiredAcknowledgements(revision.snapshot);
      const accepted = new Set(parsed.data.acceptedCodes);
      if (required.some((item) => !accepted.has(item.code))) {
        throw new Error("All required acknowledgements must be accepted");
      }
      const [existingSignature] = await tx
        .select({ id: signaturesTable.id })
        .from(signaturesTable)
        .where(eq(signaturesTable.signingSessionId, session.id));
      if (existingSignature) throw new Error("This signing session has already been completed");
      const signatureHash = hashValue({
        sessionId: session.id,
        revisionId: revision.id,
        signerName: parsed.data.signerName,
        signerEmail: parsed.data.signerEmail ?? null,
        packHash: revision.packHash,
        acceptedCodes: [...accepted].sort(),
      });
      await tx.insert(acknowledgementsTable).values(
        required.map((item) => ({
          signingSessionId: session.id,
          revisionId: revision.id,
          code: item.code,
          statement: item.statement,
        })),
      );
      await tx.insert(signaturesTable).values({
        signingSessionId: session.id,
        revisionId: revision.id,
        signatureType: "demo",
        signerName: parsed.data.signerName,
        signerEmail: parsed.data.signerEmail ?? null,
        signatureHash,
      });
      await tx
        .update(signingSessionsTable)
        .set({ status: "signed", signedAt: new Date() })
        .where(eq(signingSessionsTable.id, session.id));
      await tx
        .update(saleRevisionsTable)
        .set({ status: "signed", signedAt: new Date() })
        .where(eq(saleRevisionsTable.id, revision.id));
      await tx
        .update(salesTable)
        .set({ status: "signed", signedRevisionId: revision.id })
        .where(eq(salesTable.id, session.saleId));
      await recordEvent(tx, session.saleId, "customer.demo_signed", "customer", {
        revisionId: revision.id,
        signatureHash,
      });
      return loadSale(tx, session.saleId);
    });
    res.json({
      ...developmentOnly(),
      signed: true,
      sale: saleSummary(result),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to complete signing";
    res.status(message === "Signing session not found" ? 404 : 409).json({ error: message });
  }
});

router.post("/sales/:id/revoke-signing", requireStaff, async (req, res) => {
  try {
    const context = await loadSale(db, req.params.id);
    if (!context) {
      res.status(404).json({ error: "Sale not found" });
      return;
    }
    res.json(await finalChecks(db, context));
  } catch (error) {
    res.status(500).json({ error: "Unable to calculate final checks", detail: String(error) });
  }
});

router.post("/sales/:id/complete", requireStaff, async (req, res) => {
  try {
    const result = await db.transaction(async (tx) => {
      const sessionHash = tokenHash(token);
      const [session] = await tx
        .select()
        .from(signingSessionsTable)
        .where(eq(signingSessionsTable.tokenHash, sessionHash));
      if (!session || !tokenMatches(session.tokenHash, token)) throw new Error("Signing session not found");
      await lockSale(tx, session.saleId);
      if (session.status !== "pending") throw new Error("This signing session is no longer pending");
      if (session.expiresAt.getTime() <= Date.now()) {
        await tx
          .update(signingSessionsTable)
          .set({ status: "expired" })
          .where(eq(signingSessionsTable.id, session.id));
        throw new Error("This signing session has expired");
      }
      const context = await loadSale(tx, session.saleId);
      if (!context) throw new Error("Signing session not found");
      const revision = context.revisions.find((candidate) => candidate.id === session.revisionId);
      if (!revision || revision.status !== "active") throw new Error("This sale revision is no longer active");
      if (
        session.intendedCustomerEmail &&
        parsed.data.signerEmail &&
        session.intendedCustomerEmail.toLowerCase() !== parsed.data.signerEmail.toLowerCase()
      ) {
        throw new Error("Signer email does not match the intended customer");
      }
      const required = requiredAcknowledgements(revision.snapshot);
      const accepted = new Set(parsed.data.acceptedCodes);
      if (required.some((item) => !accepted.has(item.code))) {
        throw new Error("All required acknowledgements must be accepted");
      }
      const [existingSignature] = await tx
        .select({ id: signaturesTable.id })
        .from(signaturesTable)
        .where(eq(signaturesTable.signingSessionId, session.id));
      if (existingSignature) throw new Error("This signing session has already been completed");
      const signatureHash = hashValue({
        sessionId: session.id,
        revisionId: revision.id,
        signerName: parsed.data.signerName,
        signerEmail: parsed.data.signerEmail ?? null,
        packHash: revision.packHash,
        acceptedCodes: [...accepted].sort(),
      });
      await tx.insert(acknowledgementsTable).values(
        required.map((item) => ({
          signingSessionId: session.id,
          revisionId: revision.id,
          code: item.code,
          statement: item.statement,
        })),
      );
      await tx.insert(signaturesTable).values({
        signingSessionId: session.id,
        revisionId: revision.id,
        signatureType: "demo",
        signerName: parsed.data.signerName,
        signerEmail: parsed.data.signerEmail ?? null,
        signatureHash,
      });
      await tx
        .update(signingSessionsTable)
        .set({ status: "signed", signedAt: new Date() })
        .where(eq(signingSessionsTable.id, session.id));
      await tx
        .update(saleRevisionsTable)
        .set({ status: "signed", signedAt: new Date() })
        .where(eq(saleRevisionsTable.id, revision.id));
      await tx
        .update(salesTable)
        .set({ status: "signed", signedRevisionId: revision.id })
        .where(eq(salesTable.id, session.saleId));
      await recordEvent(tx, session.saleId, "customer.demo_signed", "customer", {
        revisionId: revision.id,
        signatureHash,
      });
      return loadSale(tx, session.saleId);
    });
    res.json({
      ...developmentOnly(),
      signed: true,
      sale: saleSummary(result),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to complete signing";
    res.status(message === "Sale not found" ? 404 : 409).json({ error: message });
  }
});

router.get("/signing/:token", async (req, res) => {
  const token = req.params.token;
  if (!rateLimitToken(req, token)) {
    res.status(429).json({ error: "Too many signing attempts. Try again later." });
    return;
  }
  try {
    const sessionHash = tokenHash(token);
    const [session] = await db
      .select()
      .from(signingSessionsTable)
      .where(eq(signingSessionsTable.tokenHash, sessionHash));
    if (!session || !tokenMatches(session.tokenHash, token)) {
      res.status(404).json({ error: "Signing session not found" });
      return;
    }
    if (session.status === "pending" && session.expiresAt.getTime() <= Date.now()) {
      await db
        .update(signingSessionsTable)
        .set({ status: "expired" })
        .where(eq(signingSessionsTable.id, session.id));
      res.status(410).json({ error: "This signing session has expired." });
      return;
    }
    if (session.status === "revoked") {
      res.status(410).json({ error: "This signing session has been revoked." });
      return;
    }
    const context = await loadSale(db, req.params.id);
    if (!context) {
      res.status(404).json({ error: "Signing session not found" });
      return;
    }
    const payload = publicSigningPayload(context, session);
    if (!payload) {
      res.status(404).json({ error: "Signing revision not found" });
      return;
    }
    res.json(payload);
  } catch (error) {
    res.status(500).json({ error: "Unable to load signing session", detail: String(error) });
  }
});

router.post("/signing/:token/complete", async (req, res) => {
  const token = req.params.token;
  if (!rateLimitToken(req, token)) {
    res.status(429).json({ error: "Too many signing attempts. Try again later." });
    return;
  }
  const parsed = demoSignatureInput.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid demo signature", issues: parsed.error.issues });
    return;
  }
  try {
    const result = await db.transaction(async (tx) => {
      const sessionHash = tokenHash(token);
      const [session] = await tx
        .select()
        .from(signingSessionsTable)
        .where(eq(signingSessionsTable.tokenHash, sessionHash));
      if (!session || !tokenMatches(session.tokenHash, token)) throw new Error("Signing session not found");
      await lockSale(tx, session.saleId);
      if (session.status !== "pending") throw new Error("This signing session is no longer pending");
      if (session.expiresAt.getTime() <= Date.now()) {
        await tx
          .update(signingSessionsTable)
          .set({ status: "expired" })
          .where(eq(signingSessionsTable.id, session.id));
        throw new Error("This signing session has expired");
      }
      const context = await loadSale(tx, session.saleId);
      if (!context) throw new Error("Signing session not found");
      const revision = context.revisions.find((candidate) => candidate.id === session.revisionId);
      if (!revision || revision.status !== "active") throw new Error("This sale revision is no longer active");
      if (
        session.intendedCustomerEmail &&
        parsed.data.signerEmail &&
        session.intendedCustomerEmail.toLowerCase() !== parsed.data.signerEmail.toLowerCase()
      ) {
        throw new Error("Signer email does not match the intended customer");
      }
      const required = requiredAcknowledgements(revision.snapshot);
      const accepted = new Set(parsed.data.acceptedCodes);
      if (required.some((item) => !accepted.has(item.code))) {
        throw new Error("All required acknowledgements must be accepted");
      }
      const [existingSignature] = await tx
        .select({ id: signaturesTable.id })
        .from(signaturesTable)
        .where(eq(signaturesTable.signingSessionId, session.id));
      if (existingSignature) throw new Error("This signing session has already been completed");
      const signatureHash = hashValue({
        sessionId: session.id,
        revisionId: revision.id,
        signerName: parsed.data.signerName,
        signerEmail: parsed.data.signerEmail ?? null,
        packHash: revision.packHash,
        acceptedCodes: [...accepted].sort(),
      });
      await tx.insert(acknowledgementsTable).values(
        required.map((item) => ({
          signingSessionId: session.id,
          revisionId: revision.id,
          code: item.code,
          statement: item.statement,
        })),
      );
      await tx.insert(signaturesTable).values({
        signingSessionId: session.id,
        revisionId: revision.id,
        signatureType: "demo",
        signerName: parsed.data.signerName,
        signerEmail: parsed.data.signerEmail ?? null,
        signatureHash,
      });
      await tx
        .update(signingSessionsTable)
        .set({ status: "signed", signedAt: new Date() })
        .where(eq(signingSessionsTable.id, session.id));
      await tx
        .update(saleRevisionsTable)
        .set({ status: "signed", signedAt: new Date() })
        .where(eq(saleRevisionsTable.id, revision.id));
      await tx
        .update(salesTable)
        .set({ status: "signed", signedRevisionId: revision.id })
        .where(eq(salesTable.id, session.saleId));
      await recordEvent(tx, session.saleId, "customer.demo_signed", "customer", {
        revisionId: revision.id,
        signatureHash,
      });
      return loadSale(tx, session.saleId);
    });
    res.json({
      ...developmentOnly(),
      signed: true,
      sale: saleSummary(result),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to complete signing";
    res.status(message === "Signing session not found" ? 404 : 409).json({ error: message });
  }
});

router.post("/sales/:id/revoke-signing", requireStaff, async (req, res) => {
  try {
    const context = await loadSale(db, req.params.id);
    if (!context) {
      res.status(404).json({ error: "Sale not found" });
      return;
    }
    const pending = context.sessions.find((session) => session.status === "pending");
    if (!pending) {
      res.status(409).json({ error: "There is no pending signing session to revoke." });
      return;
    }
    await db.transaction(async (tx) => {
      await tx
        .update(signingSessionsTable)
        .set({ status: "revoked", revokedAt: new Date() })
        .where(eq(signingSessionsTable.id, pending.id));
      await tx
        .update(salesTable)
        .set({ status: "ready" })
        .where(eq(salesTable.id, req.params.id));
      await recordEvent(tx, req.params.id, "signing.revoked", "staff", {
        sessionId: pending.id,
        revisionId: pending.revisionId,
      });
    });
    res.json({ ...developmentOnly(), revoked: true });
  } catch (error) {
    res.status(500).json({ error: "Unable to revoke signing session", detail: String(error) });
  }
});

export default router;
