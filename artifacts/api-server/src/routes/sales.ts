import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { Router, type IRouter, type Request } from "express";
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
  const context = await loadSale(tx, saleId);
  if (!context) throw new Error("Sale not found");
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

router.get("/sales", async (_req, res) => {
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

router.post("/sales", async (req, res) => {
  const parsed = saleInput.safeParse(req.body);
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
    const context = await db.transaction(async (tx) => {
      await lockVehicle(tx, input.vehicleId);
      const [vehicle] = await tx
        .select()
        .from(vehiclesTable)
        .where(
          and(
            eq(vehiclesTable.id, input.vehicleId),
            eq(vehiclesTable.dealerId, dealerId()),
          ),
        );
      if (!vehicle) throw new Error("Vehicle not found");
      if (["sold", "archived"].includes(vehicle.inventoryStatus)) {
        throw new Error("This vehicle cannot be used for a new sale");
      }
      const active = await tx
        .select({ id: salesTable.id })
        .from(salesTable)
        .where(
          and(
            eq(salesTable.vehicleId, input.vehicleId),
            inArray(salesTable.status, [...ACTIVE_SALE_STATUSES]),
          ),
        );
      if (active.length) throw new Error("This vehicle already has an active sale");
      let customerId = input.customerId;
      if (customerId) {
        const [existingCustomer] = await tx
          .select({ id: customerTable.id })
          .from(customerTable)
          .where(
            and(
              eq(customerTable.id, customerId),
              eq(customerTable.dealerId, dealerId()),
            ),
          );
        if (!existingCustomer) throw new Error("Customer not found");
      } else if (input.customer) {
        const [createdCustomer] = await tx
          .insert(customerTable)
          .values({
            dealerId: dealerId(),
            name: input.customer.name,
            email: input.customer.email ?? null,
            phone: input.customer.phone ?? null,
          })
          .returning();
        customerId = createdCustomer.id;
      } else {
        throw new Error("A new or existing customer is required");
      }
      const [sale] = await tx
        .insert(salesTable)
        .values({
          dealerId: dealerId(),
          vehicleId: input.vehicleId,
          customerId,
          enquiryId: input.enquiryId ?? null,
          status: "draft",
          currency: "GBP",
          agreedPricePence: total,
          depositPence: input.depositPence,
          balancePence: total - input.depositPence,
          mileageAtSale: input.mileageAtSale ?? vehicle.mileage,
          disclosureNotes:
            input.disclosureNotes ??
            "Development disclosure placeholder — requires legal review before production use.",
          internalNotes: input.internalNotes ?? null,
        })
        .returning();
      if (input.adjustments.length) {
        await tx.insert(saleAdjustmentsTable).values(
          input.adjustments.map((adjustment) => ({ saleId: sale.id, ...adjustment })),
        );
      }
      if (input.partExchange) {
        await tx.insert(salePartExchangesTable).values({
          saleId: sale.id,
          description: input.partExchange.description,
          registration: input.partExchange.registration ?? null,
          agreedValuePence: input.partExchange.agreedValuePence,
          customerDeclaration: input.partExchange.customerDeclaration,
        });
      }
      if (input.warranty) {
        await tx.insert(saleWarrantiesTable).values({
          saleId: sale.id,
          name: input.warranty.name,
          durationMonths: input.warranty.durationMonths ?? null,
          pricePence: input.warranty.pricePence,
          terms: input.warranty.terms,
        });
      }
      if (input.fulfilment) {
        await tx.insert(saleFulfilmentsTable).values({
          saleId: sale.id,
          method: input.fulfilment.method,
          targetDate: input.fulfilment.targetDate
            ? new Date(input.fulfilment.targetDate)
            : null,
          address: input.fulfilment.address ?? null,
          notes: input.fulfilment.notes ?? null,
        });
      }
      await recordEvent(tx, sale.id, "sale.created", "staff", {
        vehicleId: input.vehicleId,
        customerId,
        enquiryId: input.enquiryId ?? null,
      });
      return loadSale(tx, sale.id);
    });
    res.status(201).json(saleSummary(context));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to create sale";
    res.status(message.includes("already has") ? 409 : 400).json({ error: message });
  }
});

router.get("/sales/:id", async (req, res) => {
  try {
    const context = await loadSale(db, req.params.id);
    if (!context) {
      res.status(404).json({ error: "Sale not found" });
      return;
    }
    res.json(saleSummary(context));
  } catch (error) {
    res.status(500).json({ error: "Unable to load sale", detail: String(error) });
  }
});

router.post("/sales/:id/prepare", async (req, res) => {
  try {
    const result = await db.transaction(async (tx) => {
      await lockSale(tx, req.params.id);
      const context = await loadSale(tx, req.params.id);
      if (!context) throw new Error("Sale not found");
      await lockVehicle(tx, context.sale.vehicleId);
      const prepared = await createRevisionAndSession(tx, req.params.id, req);
      return { prepared, context: await loadSale(tx, req.params.id) };
    });
    res.status(201).json({
      ...developmentOnly(),
      sale: saleSummary(result.context),
      revision: {
        id: result.prepared.revision.id,
        revisionNumber: result.prepared.revision.revisionNumber,
        packHash: result.prepared.revision.packHash,
      },
      signingSession: {
        id: result.prepared.session.id,
        status: result.prepared.session.status,
        expiresAt: result.prepared.session.expiresAt,
      },
      signingUrl: result.prepared.signingUrl,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to prepare sale";
    res.status(message === "Sale not found" ? 404 : 400).json({ error: message });
  }
});

router.get("/sales/:id/final-checks", async (req, res) => {
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

router.post("/sales/:id/complete", async (req, res) => {
  try {
    const result = await db.transaction(async (tx) => {
      await lockSale(tx, req.params.id);
      const current = await loadSale(tx, req.params.id);
      if (!current) throw new Error("Sale not found");
      await lockVehicle(tx, current.sale.vehicleId);
      const context = await loadSale(tx, req.params.id);
      if (!context) throw new Error("Sale not found");
      if (context.sale.status === "completed") return { context, checks: await finalChecks(tx, context), idempotent: true };
      const checks = await finalChecks(tx, context);
      if (!checks.canComplete) return { context, checks, idempotent: false };
      const now = new Date();
      const [updatedSale] = await tx
        .update(salesTable)
        .set({ status: "completed", completedAt: now })
        .where(and(eq(salesTable.id, req.params.id), eq(salesTable.status, "signed")))
        .returning();
      if (!updatedSale) throw new Error("Sale changed while completing; try again");
      await tx
        .update(vehiclesTable)
        .set({ inventoryStatus: "sold", sourceStatus: "live" })
        .where(eq(vehiclesTable.id, context.sale.vehicleId));
      const invoiceNumber = `DEV-${now.toISOString().slice(0, 10).replaceAll("-", "")}-${context.sale.id.slice(0, 8).toUpperCase()}`;
      const invoiceSnapshot = {
        developmentOnly: true,
        saleId: context.sale.id,
        vehicle: context.vehicle
          ? { id: context.vehicle.id, title: context.vehicle.title, registration: context.vehicle.registration ?? context.vehicle.vrm }
          : null,
        customer: context.customer
          ? { id: context.customer.id, name: context.customer.name, email: context.customer.email }
          : null,
        totalPence: context.sale.agreedPricePence,
        depositPence: context.sale.depositPence,
        balancePence: context.sale.balancePence,
        currency: "GBP",
        note: "Development invoice snapshot only; legal, VAT and margin-scheme review required.",
      };
      await tx
        .insert(invoicesTable)
        .values({
          saleId: context.sale.id,
          invoiceNumber,
          status: "development",
          currency: "GBP",
          totalPence: context.sale.agreedPricePence,
          depositPence: context.sale.depositPence,
          balancePence: context.sale.balancePence,
          snapshot: invoiceSnapshot,
        })
        .onConflictDoNothing();
      const revision = context.revisions.find(
        (candidate) => candidate.id === context.sale.signedRevisionId,
      );
      if (!revision) throw new Error("Signed revision disappeared");
      await tx
        .insert(dealVaultArtifactsTable)
        .values({
          saleId: context.sale.id,
          revisionId: revision.id,
          artifactType: "document_pack",
          storageStatus: "metadata_only",
          packHash: revision.packHash,
          documentHashes: revision.documentHashes,
          manifest: revision.manifest,
          storageKey: null,
        })
        .onConflictDoNothing();
      await recordEvent(tx, context.sale.id, "sale.completed", "staff", {
        revisionId: revision.id,
        packHash: revision.packHash,
        invoiceNumber,
        vehicleId: context.sale.vehicleId,
      });
      return { context: await loadSale(tx, req.params.id), checks, idempotent: false };
    });
    if (!result.checks.canComplete) {
      res.status(422).json({ error: "Sale cannot be completed", checks: result.checks });
      return;
    }
    res.json({
      ...developmentOnly(),
      completed: true,
      idempotent: result.idempotent,
      sale: saleSummary(result.context),
      checks: result.checks,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to complete sale";
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
    const context = await loadSale(db, session.saleId);
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

router.post("/sales/:id/revoke-signing", async (req, res) => {
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