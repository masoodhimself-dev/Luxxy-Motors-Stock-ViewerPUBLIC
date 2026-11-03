import { replaceLiteralIgnoreCase } from "./literal-redaction";
import { createHash } from "node:crypto";
import { pool } from "@workspace/db";
import { z } from "zod/v4";
import { currentDealerId } from "./tenant-context";
import { siteUrl } from "./enquiry-links";
import type {
  SettingsDatabase,
  SettingsQueryClient,
} from "./settings-versions";
import {
  normaliseWebsiteImage,
  type NormalisedWebsiteImage,
} from "./website-asset-image";

type Row = Record<string, any>;
const digest = (text: string) =>
  createHash("sha256").update(text).digest("hex");
const iso = (value: any): string | null =>
  value ? new Date(value).toISOString() : null;
const tokenSchema = z.string().regex(/^[a-f0-9]{64}$/);
const text = (maximum: number) =>
  z
    .string()
    .trim()
    .max(maximum)
    .refine(
      (value) => !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value),
    );
const date = z.string().datetime({ offset: true });
export const createDeliveryEvidenceInput = z
  .object({
    requestId: z.uuid(),
    token: tokenSchema,
    expectedRevision: z.number().int().nonnegative(),
    expiresHours: z.number().int().min(1).max(168).default(72),
  })
  .strict();
export const deliveryPhotoInput = z
  .object({
    requestId: z.uuid(),
    phase: z.enum(["departure", "arrival"]),
    slot: z.enum(["front", "rear", "left", "right", "dashboard", "damage"]),
    capturedAt: date,
    dataUrl: z.string().max(2_800_000),
  })
  .strict();
export const deliverySubmissionInput = z
  .object({
    requestId: z.uuid(),
    driverName: text(120).min(2),
    recipientName: text(120),
    handoverAt: date,
    mileage: z.number().int().min(0).max(5_000_000),
    outcome: z.enum(["delivered", "not-delivered"]),
    notes: text(3000),
    keys: z.number().int().min(0).max(20),
    documentsProvided: z.boolean(),
    acknowledged: z.boolean(),
    location: z
      .object({
        latitude: z.number().min(-90).max(90),
        longitude: z.number().min(-180).max(180),
        accuracy: z.number().nonnegative().max(1_000_000),
        capturedAt: date,
      })
      .strict()
      .nullable(),
    locationReason: text(200),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (!value.location && value.locationReason.length < 3)
      ctx.addIssue({
        code: "custom",
        message: "Add a reason when location is unavailable.",
      });
    if (
      value.outcome === "delivered" &&
      (value.recipientName.length < 2 || !value.acknowledged)
    )
      ctx.addIssue({
        code: "custom",
        message:
          "Record the recipient acknowledgement, or choose delivery not completed.",
      });
    if (value.outcome === "not-delivered" && value.notes.length < 5)
      ctx.addIssue({
        code: "custom",
        message: "Explain why delivery was not completed.",
      });
  });
export const deliveryPaperInput = z
  .object({
    requestId: z.uuid(),
    dataUrl: z.string().max(2_800_000),
    driverName: text(120).min(2),
    recipientName: text(120),
    handoverAt: date,
    mileage: z.number().int().min(0).max(5_000_000),
    keys: z.number().int().min(0).max(20),
    documentsProvided: z.boolean(),
    notes: text(3000),
    acknowledged: z.literal(true),
    outcome: z.enum(["delivered", "not-delivered"]),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.outcome === "delivered" && value.recipientName.length < 2)
      ctx.addIssue({
        code: "custom",
        message: "Record the recipient name from the signed declaration.",
      });
    if (value.outcome === "not-delivered" && value.notes.length < 5)
      ctx.addIssue({
        code: "custom",
        message: "Record why delivery was not completed.",
      });
  });
export type DeliverySnapshot = {
  dealerName: string;
  saleReference: string;
  vehicleId: string;
  vehicle: string;
  registration: string;
  customer: string;
  recipient: string;
  phone: string;
  address: string;
  scheduledDate: string;
  timeWindow: string;
  driver: string;
  instructions: string;
};
export class DeliveryEvidenceError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}
export function deliveryJobContext(
  state: Row,
  dealerName: string,
): DeliverySnapshot {
  const d = state.draft ?? {},
    f = d.fulfilment ?? {};
  return {
    dealerName,
    saleReference: state.reference,
    vehicleId: d.vehicleId,
    vehicle: d.vehicle,
    registration: d.registration,
    customer: d.customer,
    recipient: f.recipient || d.customer,
    phone: f.phone || d.phone || "",
    address: f.address || "",
    scheduledDate: f.scheduledDate || "",
    timeWindow: f.timeWindow || "",
    driver: f.driver || "",
    instructions: f.instructions || "",
  };
}
export const deliveryContextHash = (snapshot: DeliverySnapshot) =>
  digest(JSON.stringify(snapshot));
/** Run inside the sale mutation transaction. Withdrawal is permanent, including a
 * change which staff later undo, so an old driver cannot resume a stale job. */
export async function revokeChangedDeliveryEvidence(
  client: SettingsQueryClient,
  input: {
    dealerId: string;
    saleId: string;
    before: Row;
    after: Row;
    actor: string;
  },
) {
  const relevant = (state: Row) => ({
    snapshot: deliveryJobContext(state, ""),
    method: state.draft?.fulfilment?.method ?? "collection",
    completedAt: state.draft?.fulfilment?.completedAt ?? null,
    unsuccessful: state.draft?.fulfilment?.stage === "unsuccessful",
    closed:
      ["released", "cancelled", "returned"].includes(state.lifecycle?.status) ||
      state.returnReplacement?.direction === "returned",
  });
  if (
    JSON.stringify(relevant(input.before)) ===
    JSON.stringify(relevant(input.after))
  )
    return;
  await client.query(
    "UPDATE sale_delivery_evidence SET revoked_at=now(),revoked_by=$3 WHERE dealer_id=$1 AND sale_id=$2 AND revoked_at IS NULL AND submitted_at IS NULL",
    [input.dealerId, input.saleId, input.actor],
  );
}

/** Bounded metadata for review. Photos, contacts and raw device coordinates never
 * enter the model input; the digest also detects evidence added without a sale edit. */
export async function getDeliveryEvidenceReview(
  client: SettingsQueryClient,
  input: { dealerId: string; saleId: string },
) {
  const state = (
    await client.query(
      "SELECT state FROM sale_workspace WHERE dealer_id=$1 AND id=$2",
      [input.dealerId, input.saleId],
    )
  ).rows[0]?.state;
  const config = (
    await client.query(
      "SELECT config FROM dealer_settings WHERE dealer_id=$1",
      [input.dealerId],
    )
  ).rows[0]?.config;
  const snapshot = state
    ? deliveryJobContext(state, config?.identity?.name || "The dealership")
    : null;
  const context =
    state && snapshot ? currentJobSnapshot({ state, snapshot }) : null;
  const rows = (
    await client.query(
      `SELECT j.id,j.snapshot,j.context_hash,j.created_at,j.expires_at,j.revoked_at,j.submitted_at,j.submission,j.submission_hash,
      (SELECT count(*)::integer FROM sale_delivery_evidence_photos p WHERE p.dealer_id=j.dealer_id AND p.job_id=j.id AND phase='arrival') AS arrival_photos,
      (SELECT count(*)::integer FROM sale_delivery_evidence_photos p WHERE p.dealer_id=j.dealer_id AND p.job_id=j.id AND phase='departure') AS departure_photos,
      (SELECT count(*)::integer FROM sale_delivery_evidence_photos p WHERE p.dealer_id=j.dealer_id AND p.job_id=j.id AND phase='paper') AS paper_photos
      FROM sale_delivery_evidence j WHERE j.dealer_id=$1 AND j.sale_id=$2 ORDER BY j.created_at DESC,j.id DESC LIMIT 30`,
      [input.dealerId, input.saleId],
    )
  ).rows;
  const safeNotes = (row: Row) => {
    let notes = String(row.submission?.notes ?? "").slice(0, 1200);
    for (const value of [
      row.snapshot?.customer,
      row.snapshot?.recipient,
      row.snapshot?.driver,
      row.snapshot?.phone,
      row.snapshot?.address,
      row.submission?.driverName,
      row.submission?.recipientName,
    ])
      if (typeof value === "string" && value.length >= 2)
        notes = replaceLiteralIgnoreCase(notes, value, "[private]");
    return notes
      .replace(/https?:\/\/\S+|[\w.+-]+@[\w.-]+\.[a-z]{2,}/gi, "[private]")
      .replace(/(?:\+?\d[\d ().-]{6,}\d)/g, "[private]")
      .slice(0, 600);
  };
  const summary = rows.map((row) => ({
    status: row.submitted_at ? "received" : status(row, context),
    current: !["superseded", "revoked"].includes(status(row, context)),
    matchesDeal:
      !!snapshot && deliveryContextHash(snapshot) === row.context_hash,
    source: row.submission?.source === "paper" ? "paper" : "driver",
    outcome: row.submission?.outcome ?? null,
    receivedAt: iso(row.submitted_at),
    handoverAt: row.submission?.handoverAt ?? null,
    arrivalPhotoCount: Number(row.arrival_photos),
    departurePhotoCount: Number(row.departure_photos),
    signedPaperCount: Number(row.paper_photos),
    paperEntryChecked: row.submission?.paperEntryChecked === true,
    acknowledged: row.submission?.acknowledged === true,
    documentsProvided: row.submission?.documentsProvided === true,
    keys: row.submission?.keys ?? null,
    mileage: row.submission?.mileage ?? null,
    conditionNotes: safeNotes(row),
    locationRecorded: !!row.submission?.location,
    accuracyMetres: row.submission?.location?.accuracy ?? null,
  }));
  return {
    hash: digest(
      JSON.stringify(
        rows.map((row, index) => ({
          id: row.id,
          reportHash: row.submission_hash,
          ...summary[index],
        })),
      ),
    ),
    summary,
  };
}
function currentJobSnapshot(
  context: { state: Row; snapshot: DeliverySnapshot } | null,
) {
  return context &&
    context.state.returnReplacement?.direction !== "returned" &&
    !["released", "cancelled", "returned"].includes(
      context.state.lifecycle?.status,
    ) &&
    context.state.draft?.fulfilment?.method === "delivery" &&
    context.state.draft?.fulfilment?.stage !== "unsuccessful" &&
    !context.state.draft?.fulfilment?.completedAt
    ? context.snapshot
    : null;
}
function status(row: Row, context: DeliverySnapshot | null) {
  if (row.revoked_at) return "revoked";
  if (!context || deliveryContextHash(context) !== row.context_hash)
    return "superseded";
  if (new Date(row.expires_at).getTime() <= Date.now()) return "expired";
  return row.submitted_at ? "received" : "open";
}
function view(row: Row, context: DeliverySnapshot | null) {
  return {
    id: row.id,
    status: row.submitted_at ? "received" : status(row, context),
    current: !["superseded", "revoked"].includes(status(row, context)),
    snapshot: row.snapshot as DeliverySnapshot,
    createdAt: iso(row.created_at),
    expiresAt: iso(row.expires_at),
    submittedAt: iso(row.submitted_at),
    revokedAt: iso(row.revoked_at),
    submission: row.submission ?? null,
  };
}
/** Private bounded photos and an immutable evidence report. This never marks a sale paid or handed over. */
export class PostgresDeliveryEvidence {
  constructor(
    private database: SettingsDatabase = pool,
    private normalise: (
      data: string,
    ) => Promise<NormalisedWebsiteImage> = normaliseWebsiteImage,
  ) {}
  private async context(
    client: SettingsQueryClient,
    saleId: string,
    lock = false,
  ): Promise<{ state: Row; snapshot: DeliverySnapshot } | null> {
    const row = (
      await client.query(
        `SELECT state FROM sale_workspace WHERE dealer_id=$1 AND id=$2 ${lock ? "FOR SHARE" : ""}`,
        [currentDealerId(), saleId],
      )
    ).rows[0];
    if (!row) return null;
    const config = (
      await client.query(
        "SELECT config FROM dealer_settings WHERE dealer_id=$1",
        [currentDealerId()],
      )
    ).rows[0]?.config;
    return {
      state: row.state,
      snapshot: deliveryJobContext(
        row.state,
        config?.identity?.name || "The dealership",
      ),
    };
  }
  private async transaction<T>(
    saleId: string,
    work: (
      client: SettingsQueryClient,
      context: Awaited<ReturnType<PostgresDeliveryEvidence["context"]>>,
    ) => Promise<T>,
  ): Promise<T> {
    const client = await this.database.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
        `sale-workspace:${currentDealerId()}`,
      ]);
      const context = await this.context(client, saleId, true);
      const value = await work(client, context);
      await client.query("COMMIT");
      return value;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
  private usable(
    row: Row,
    context: DeliverySnapshot | null,
    allowReceived = false,
  ) {
    const state = status(row, context);
    if (state === "superseded")
      throw new DeliveryEvidenceError(
        "The car or delivery arrangements changed. Keep your photos and ask the showroom for a new link.",
        409,
      );
    if (state === "expired" || state === "revoked")
      throw new DeliveryEvidenceError(
        "This delivery link has expired or been withdrawn. Keep any unsent photos and ask the showroom for a new link.",
        410,
      );
    if (state === "received" && !allowReceived)
      throw new DeliveryEvidenceError(
        "Delivery evidence has already been received. Its report cannot be changed.",
        409,
      );
  }
  private async find(raw: unknown) {
    const token = tokenSchema.safeParse(raw);
    const row = token.success
      ? (
          await this.database.query(
            "SELECT * FROM sale_delivery_evidence WHERE dealer_id=$1 AND token_hash=$2",
            [currentDealerId(), digest(token.data)],
          )
        ).rows[0]
      : null;
    if (!row) throw new DeliveryEvidenceError("Delivery link not found.", 404);
    return row;
  }
  async list(saleId: string) {
    const context = await this.context(this.database, saleId);
    if (!context) throw new DeliveryEvidenceError("Sale not found.", 404);
    const rows = (
      await this.database.query(
        "SELECT * FROM sale_delivery_evidence WHERE dealer_id=$1 AND sale_id=$2 ORDER BY created_at DESC,id DESC LIMIT 30",
        [currentDealerId(), saleId],
      )
    ).rows;
    const photos = (
      await this.database.query(
        "SELECT p.id,p.job_id,p.phase,p.slot,p.captured_at,p.received_at,p.byte_size FROM sale_delivery_evidence_photos p JOIN sale_delivery_evidence j ON j.id=p.job_id AND j.dealer_id=p.dealer_id WHERE p.dealer_id=$1 AND j.sale_id=$2 AND p.job_id=ANY($3::uuid[]) ORDER BY received_at LIMIT 510",
        [currentDealerId(), saleId, rows.map((row) => row.id)],
      )
    ).rows;
    return {
      jobs: rows.map((row) => ({
        ...view(row, currentJobSnapshot(context)),
        photos: photos
          .filter((p) => p.job_id === row.id)
          .map((p) => ({
            id: p.id,
            phase: p.phase,
            slot: p.slot,
            capturedAt: iso(p.captured_at),
            receivedAt: iso(p.received_at),
            byteSize: p.byte_size,
          })),
      })),
    };
  }
  async vehicleSales(vehicleId: string) {
    const rows = (
      await this.database.query(
        `SELECT s.id AS sale_id,s.reference,s.revision,count(j.id)::integer AS evidence_count
       FROM sale_delivery_evidence j JOIN sale_workspace s ON s.id=j.sale_id AND s.dealer_id=j.dealer_id
       WHERE j.dealer_id=$1 AND j.vehicle_id=$2 GROUP BY s.id,s.reference,s.revision
       ORDER BY max(j.created_at) DESC LIMIT 30`,
        [currentDealerId(), vehicleId],
      )
    ).rows;
    return {
      sales: rows.map((row) => ({
        saleId: row.sale_id,
        reference: row.reference,
        revision: Number(row.revision),
        evidenceCount: Number(row.evidence_count),
      })),
    };
  }
  async create(saleId: string, raw: unknown, actor: string) {
    const input = createDeliveryEvidenceInput.parse(raw),
      createHash = digest(JSON.stringify(input));
    return this.transaction(saleId, async (client, context) => {
      if (!context) throw new DeliveryEvidenceError("Sale not found.", 404);
      const prior = (
        await client.query(
          "SELECT * FROM sale_delivery_evidence WHERE dealer_id=$1 AND request_id=$2",
          [currentDealerId(), input.requestId],
        )
      ).rows[0];
      if (prior) {
        if (prior.sale_id !== saleId || prior.create_hash !== createHash)
          throw new DeliveryEvidenceError(
            "This request was used for different delivery details.",
            409,
          );
        this.usable(prior, currentJobSnapshot(context), true);
        return {
          job: view(prior, currentJobSnapshot(context)),
          url: siteUrl(`/delivery-evidence/${input.token}`),
          replayed: true,
        };
      }
      if (context.state.revision !== input.expectedRevision)
        throw new DeliveryEvidenceError(
          "The sale changed. Save and refresh it before generating a driver link.",
          409,
        );
      const f = context.state.draft?.fulfilment;
      if (
        !currentJobSnapshot(context) ||
        context.state.lifecycle?.status === "cancelled" ||
        f?.method !== "delivery" ||
        !context.snapshot.vehicleId ||
        !context.snapshot.address ||
        !context.snapshot.scheduledDate
      )
        throw new DeliveryEvidenceError(
          "Save the delivery address, date and vehicle before generating a driver link.",
          409,
        );
      if (f.completedAt)
        throw new DeliveryEvidenceError(
          "Handover is already recorded. Existing evidence remains in the vehicle file.",
          409,
        );
      await client.query(
        "UPDATE sale_delivery_evidence SET revoked_at=now(),revoked_by=$3 WHERE dealer_id=$1 AND sale_id=$2 AND revoked_at IS NULL AND submitted_at IS NULL",
        [currentDealerId(), saleId, actor],
      );
      const row = (
        await client.query(
          "INSERT INTO sale_delivery_evidence(dealer_id,sale_id,vehicle_id,request_id,create_hash,token_hash,context_hash,snapshot,created_by,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10) RETURNING *",
          [
            currentDealerId(),
            saleId,
            context.snapshot.vehicleId,
            input.requestId,
            createHash,
            digest(input.token),
            deliveryContextHash(context.snapshot),
            JSON.stringify(context.snapshot),
            actor,
            new Date(Date.now() + input.expiresHours * 3600_000),
          ],
        )
      ).rows[0];
      return {
        job: view(row, context.snapshot),
        url: siteUrl(`/delivery-evidence/${input.token}`),
        replayed: false,
      };
    });
  }
  async revoke(saleId: string, jobId: string, actor: string) {
    const row = (
      await this.database.query(
        "UPDATE sale_delivery_evidence SET revoked_at=coalesce(revoked_at,now()),revoked_by=coalesce(revoked_by,$4) WHERE dealer_id=$1 AND sale_id=$2 AND id=$3 RETURNING id",
        [currentDealerId(), saleId, jobId, actor],
      )
    ).rows[0];
    if (!row) throw new DeliveryEvidenceError("Delivery job not found.", 404);
    return { revoked: true };
  }
  async read(token: string) {
    const row = await this.find(token),
      context = await this.context(this.database, row.sale_id);
    this.usable(row, currentJobSnapshot(context), true);
    // A capability grants this job only. It never exposes customer email, price, payments or stock records.
    return {
      ...view(row, currentJobSnapshot(context)),
      submission: row.submitted_at
        ? {
            outcome: row.submission?.outcome,
            receivedAt: iso(row.submitted_at),
          }
        : null,
      photos: (
        await this.database.query(
          "SELECT request_id,phase,slot FROM sale_delivery_evidence_photos WHERE dealer_id=$1 AND job_id=$2",
          [currentDealerId(), row.id],
        )
      ).rows.map((p) => ({
        requestId: p.request_id,
        phase: p.phase,
        slot: p.slot,
      })),
    };
  }
  async photo(token: string, raw: unknown) {
    const input = deliveryPhotoInput.parse(raw),
      found = await this.find(token),
      context = await this.context(this.database, found.sale_id);
    this.usable(found, currentJobSnapshot(context), true);
    if (new Date(input.capturedAt).getTime() > Date.now() + 300_000)
      throw new DeliveryEvidenceError(
        "The photo time is in the future. Check the device clock.",
      );
    const image = await this.normalise(input.dataUrl),
      hash = digest(JSON.stringify({ ...input, dataUrl: image.requestHash }));
    return this.transaction(found.sale_id, async (client, current) => {
      const row = (
        await client.query(
          "SELECT * FROM sale_delivery_evidence WHERE dealer_id=$1 AND id=$2 FOR UPDATE",
          [currentDealerId(), found.id],
        )
      ).rows[0];
      this.usable(row, currentJobSnapshot(current), true);
      const prior = (
        await client.query(
          "SELECT id,request_hash FROM sale_delivery_evidence_photos WHERE dealer_id=$1 AND job_id=$2 AND request_id=$3",
          [currentDealerId(), row.id, input.requestId],
        )
      ).rows[0];
      if (prior) {
        if (prior.request_hash !== hash)
          throw new DeliveryEvidenceError(
            "This photo request already contains a different image.",
            409,
          );
        return { id: prior.id, saved: true, replayed: true };
      }
      this.usable(row, currentJobSnapshot(current));
      const quota = (
        await client.query(
          "SELECT count(*)::integer AS count,coalesce(sum(byte_size),0)::integer AS bytes FROM sale_delivery_evidence_photos WHERE dealer_id=$1 AND job_id=$2",
          [currentDealerId(), row.id],
        )
      ).rows[0];
      if (
        Number(quota.count) >= 16 ||
        Number(quota.bytes) + image.bytes.length > 16 * 1024 * 1024
      )
        throw new DeliveryEvidenceError(
          "This job has reached its photo allowance. Ask the showroom to retain any additional pictures.",
          409,
        );
      const saved = (
        await client.query(
          "INSERT INTO sale_delivery_evidence_photos(dealer_id,job_id,request_id,request_hash,phase,slot,captured_at,mime_type,byte_size,width,height,digest,bytes) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,decode($13,'hex')) RETURNING id",
          [
            currentDealerId(),
            row.id,
            input.requestId,
            hash,
            input.phase,
            input.slot,
            input.capturedAt,
            image.mimeType,
            image.bytes.length,
            image.width,
            image.height,
            image.digest,
            image.bytes.toString("hex"),
          ],
        )
      ).rows[0];
      return { id: saved.id, saved: true, replayed: false };
    });
  }
  async submit(token: string, raw: unknown) {
    const input = deliverySubmissionInput.parse(raw),
      found = await this.find(token),
      hash = digest(JSON.stringify(input));
    return this.transaction(found.sale_id, async (client, context) => {
      const row = (
        await client.query(
          "SELECT * FROM sale_delivery_evidence WHERE dealer_id=$1 AND id=$2 FOR UPDATE",
          [currentDealerId(), found.id],
        )
      ).rows[0];
      this.usable(row, currentJobSnapshot(context), true);
      if (row.submitted_at) {
        if (
          row.submission_request_id !== input.requestId ||
          row.submission_hash !== hash
        )
          throw new DeliveryEvidenceError(
            "Delivery evidence has already been received. Its report cannot be changed.",
            409,
          );
        return {
          received: true,
          receivedAt: iso(row.submitted_at),
          replayed: true,
        };
      }
      if (
        new Date(input.handoverAt).getTime() > Date.now() + 300_000 ||
        (input.location &&
          new Date(input.location.capturedAt).getTime() > Date.now() + 300_000)
      )
        throw new DeliveryEvidenceError(
          "The recorded time is in the future. Check the device clock.",
        );
      const photos = (
        await client.query(
          "SELECT slot FROM sale_delivery_evidence_photos WHERE dealer_id=$1 AND job_id=$2 AND phase='arrival'",
          [currentDealerId(), row.id],
        )
      ).rows;
      if (
        input.outcome === "delivered" &&
        ["front", "rear", "left", "right", "dashboard"].some(
          (slot) => !photos.some((p) => p.slot === slot),
        )
      )
        throw new DeliveryEvidenceError(
          "Add the five arrival photos before submitting the completed delivery.",
        );
      const saved = (
        await client.query(
          "UPDATE sale_delivery_evidence SET submitted_at=now(),submission_request_id=$3,submission_hash=$4,submission=$5::jsonb WHERE dealer_id=$1 AND id=$2 RETURNING submitted_at",
          [
            currentDealerId(),
            row.id,
            input.requestId,
            hash,
            JSON.stringify(input),
          ],
        )
      ).rows[0];
      return {
        received: true,
        receivedAt: iso(saved.submitted_at),
        replayed: false,
      };
    });
  }
  async staffJob(saleId: string, jobId: string) {
    const row = (
      await this.database.query(
        "SELECT * FROM sale_delivery_evidence WHERE dealer_id=$1 AND sale_id=$2 AND id=$3",
        [currentDealerId(), saleId, jobId],
      )
    ).rows[0];
    if (!row) throw new DeliveryEvidenceError("Delivery job not found.", 404);
    return row;
  }
  async paper(saleId: string, jobId: string, raw: unknown, actor: string) {
    const input = deliveryPaperInput.parse(raw),
      image = await this.normalise(input.dataUrl),
      hash = digest(JSON.stringify({ ...input, dataUrl: image.requestHash }));
    return this.transaction(saleId, async (client, context) => {
      const row = (
        await client.query(
          "SELECT * FROM sale_delivery_evidence WHERE dealer_id=$1 AND sale_id=$2 AND id=$3 FOR UPDATE",
          [currentDealerId(), saleId, jobId],
        )
      ).rows[0];
      if (!row) throw new DeliveryEvidenceError("Delivery job not found.", 404);
      if (row.submitted_at) {
        if (
          row.submission_request_id === input.requestId &&
          row.submission_hash === hash
        )
          return {
            received: true,
            receivedAt: iso(row.submitted_at),
            replayed: true,
          };
        throw new DeliveryEvidenceError(
          "Evidence has already been received. The original report remains unchanged.",
          409,
        );
      }
      const state = status(row, currentJobSnapshot(context));
      if (state === "superseded" || state === "revoked")
        throw new DeliveryEvidenceError(
          "Delivery details changed. Review and recover the paper declaration with the showroom before attaching it.",
          409,
        );
      if (new Date(input.handoverAt).getTime() > Date.now() + 300_000)
        throw new DeliveryEvidenceError("The handover time is in the future.");
      const report = {
        ...input,
        dataUrl: undefined,
        source: "paper",
        paperEntryChecked: true,
        acknowledged: input.outcome === "delivered",
        recordedBy: actor,
        location: null,
        locationReason: "Signed paper declaration — no device location",
        capturedAt: input.handoverAt,
      };
      await client.query(
        "INSERT INTO sale_delivery_evidence_photos(dealer_id,job_id,request_id,request_hash,phase,slot,captured_at,mime_type,byte_size,width,height,digest,bytes) VALUES($1,$2,$3,$4,'paper','declaration',$5,$6,$7,$8,$9,$10,decode($11,'hex'))",
        [
          currentDealerId(),
          jobId,
          input.requestId,
          hash,
          input.handoverAt,
          image.mimeType,
          image.bytes.length,
          image.width,
          image.height,
          image.digest,
          image.bytes.toString("hex"),
        ],
      );
      const saved = (
        await client.query(
          "UPDATE sale_delivery_evidence SET submitted_at=now(),submission_request_id=$3,submission_hash=$4,submission=$5::jsonb WHERE dealer_id=$1 AND id=$2 RETURNING submitted_at",
          [
            currentDealerId(),
            jobId,
            input.requestId,
            hash,
            JSON.stringify(report),
          ],
        )
      ).rows[0];
      return {
        received: true,
        receivedAt: iso(saved.submitted_at),
        replayed: false,
      };
    });
  }
  async staffPhoto(saleId: string, jobId: string, photoId: string) {
    await this.staffJob(saleId, jobId);
    const row = (
      await this.database.query(
        "SELECT mime_type,encode(bytes,'hex') AS bytes FROM sale_delivery_evidence_photos WHERE dealer_id=$1 AND job_id=$2 AND id=$3",
        [currentDealerId(), jobId, photoId],
      )
    ).rows[0];
    if (!row) throw new DeliveryEvidenceError("Delivery photo not found.", 404);
    return { mimeType: row.mime_type, bytes: Buffer.from(row.bytes, "hex") };
  }
}
export type DeliveryEvidenceService = Pick<
  PostgresDeliveryEvidence,
  | "list"
  | "create"
  | "revoke"
  | "read"
  | "photo"
  | "submit"
  | "staffJob"
  | "staffPhoto"
  | "paper"
  | "vehicleSales"
>;
