import { createHash, randomBytes, randomUUID } from "node:crypto";
import { pool } from "@workspace/db";
import {
  requestSalePayment,
  returnAndReplaceSale,
  returnSaleCar,
  refundSaleCredit,
  operationRevision,
  operationMoney,
  operationText,
  operationDate,
  operationDocument,
  finishSaleOperation,
  salePaymentRequestAvailable,
  type SaleReplacementProposal,
} from "../../../../lib/vehicle-meta/src/sale-operations";
import {
  saleWorkspaceTotals,
  publicSaleWorkspace,
  saleWorkspaceNumber,
  SaleWorkspaceError,
  type SaleWorkspaceRecord,
  type SaleWorkspaceContext,
  type SaleWorkspaceDocument,
  type SaleWorkspaceDraft,
} from "@workspace/vehicle-meta";
import {
  readSaleWorkspaceAssets,
  type SaleWorkspaceReadClient,
} from "./sale-workspace-store";
import { archiveSaleDocument } from "./sale-document-pdf";
import { embedInvoiceLogoAsset } from "./invoice-logo-assets";
import { currentDealerId } from "./tenant-context";
import { siteOrigin } from "./enquiry-links";
import { revokeChangedDeliveryEvidence } from './delivery-evidence';
import { assertSaleFinancialIntegrity } from './sale-financial-integrity';

export const saleTokenHash = (token: string) =>
  createHash("sha256").update(token).digest("hex");
const validRequestId = (value: unknown): value is string =>
  typeof value === "string" && /^[A-Za-z0-9_-]{8,100}$/.test(value);
const fingerprint = (input: unknown) =>
  createHash("sha256").update(JSON.stringify(input)).digest("hex");
async function load(
  client: SaleWorkspaceReadClient,
  dealer: string,
  id: string,
  lock = true,
): Promise<SaleWorkspaceRecord> {
  const row = (
    await client.query(
      `SELECT state FROM sale_workspace WHERE dealer_id=$1 AND id=$2::uuid${lock ? " FOR UPDATE" : ""}`,
      [dealer, id],
    )
  ).rows[0];
  if (!row) throw new SaleWorkspaceError("Deal not found.", 404);
  return row.state as SaleWorkspaceRecord;
}
async function persist(
  client: SaleWorkspaceReadClient,
  dealer: string,
  sale: SaleWorkspaceRecord,
) {
  await client.query(
    "INSERT INTO sale_workspace (id,dealer_id,reference,revision,state,created_at,updated_at) VALUES ($1::uuid,$2,$3,$4,$5::jsonb,$6,$7) ON CONFLICT(id) DO UPDATE SET revision=EXCLUDED.revision,state=EXCLUDED.state,updated_at=EXCLUDED.updated_at",
    [
      sale.id,
      dealer,
      sale.reference,
      sale.revision,
      JSON.stringify(sale),
      sale.createdAt,
      sale.updatedAt,
    ],
  );
}
async function documents(
  client: SaleWorkspaceReadClient,
  dealer: string,
  sale: SaleWorkspaceRecord,
  previousIds: Set<string>,
) {
  for (const document of sale.documents.filter((d) => !previousIds.has(d.id))) {
    document.snapshot.branding = await embedInvoiceLogoAsset(
      document.snapshot.branding,
      dealer,
      client,
      siteOrigin(),
    );
    (sale.documentArchives ??= {})[document.id] = archiveSaleDocument(document);
  }
}
async function context(
  client: SaleWorkspaceReadClient,
  dealer: string,
  sale: SaleWorkspaceRecord,
  actor: string,
) {
  await client.query(
    "INSERT INTO sale_workspace_counters (dealer_id,numbers) VALUES ($1,$2::jsonb) ON CONFLICT DO NOTHING",
    [dealer, "{}"],
  );
  const numbers = (
    await client.query(
      "SELECT numbers FROM sale_workspace_counters WHERE dealer_id=$1 FOR UPDATE",
      [dealer],
    )
  ).rows[0].numbers as Record<string, number>;
  const assets = await readSaleWorkspaceAssets(sale.draft, dealer, client),
    now = new Date().toISOString();
  return {
    ctx: {
      now,
      actor,
      nextId: randomUUID,
      nextNumber: (type: string) =>
        saleWorkspaceNumber(
          numbers,
          type,
          now,
          assets.branding.invoiceSettings,
        ),
      ...assets,
    } as SaleWorkspaceContext,
    numbers,
  };
}

function replacementProposal(input: Record<string, unknown>): SaleReplacementProposal {
  const replacementVehicleId = operationText(input.replacementVehicleId, 36, 'the replacement vehicle');
  if (!/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(replacementVehicleId)) throw new SaleWorkspaceError('Choose the replacement vehicle.');
  if (input.financeConfirmed !== true || input.acknowledge !== true) throw new SaleWorkspaceError('Confirm the agreed return and that finance or third-party settlement has been resolved.');
  if (!Number.isSafeInteger(input.mileage) || Number(input.mileage) < 0 || Number(input.mileage) > 2_000_000) throw new SaleWorkspaceError('Enter the returned vehicle mileage.');
  return { replacementVehicleId, replacementPrice: (operationMoney(input.replacementPrice, 'replacement price') / 100).toFixed(2), agreedCredit: (operationMoney(input.agreedCredit, 'agreed return credit') / 100).toFixed(2), reason: operationText(input.reason, 2000, 'the return reason'), condition: operationText(input.condition, 4000, 'the returned vehicle condition'), mileage: Number(input.mileage), financeConfirmed: true, acknowledge: true };
}
async function prepareReplacement(client: SaleWorkspaceReadClient, dealer: string, current: SaleWorkspaceRecord, proposal: SaleReplacementProposal, ctx: SaleWorkspaceContext, lock: boolean) {
  const vehicleId = proposal.replacementVehicleId;
  if (vehicleId === current.draft.vehicleId) throw new SaleWorkspaceError('Choose a different replacement vehicle.');
  if (lock) for (const carId of [current.draft.vehicleId, vehicleId].sort()) await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`sale-vehicle:${carId}`]);
  const oldCar = (await client.query(`SELECT inventory_status,audit_metadata FROM vehicles WHERE dealer_id=$1 AND id=$2::uuid${lock ? ' FOR UPDATE' : ''}`, [dealer, current.draft.vehicleId])).rows[0];
  const car = (await client.query(`SELECT id,coalesce(website_title_override,title,'') AS title,coalesce(plate,vrm,registration,'') AS registration,source_price,website_price_override,source_status,missing_count,archived_at,inventory_status,audit_metadata FROM vehicles WHERE dealer_id=$1 AND id=$2::uuid${lock ? ' FOR UPDATE' : ''}`, [dealer, vehicleId])).rows[0];
  if (!oldCar || oldCar.inventory_status !== 'sold' || oldCar.audit_metadata?.saleWorkspaceId !== current.id) throw new SaleWorkspaceError('The original vehicle no longer belongs to this completed sale.', 409);
  if (!car || car.inventory_status !== 'available' || car.source_status !== 'live' || car.archived_at || Number(car.missing_count ?? 0) !== 0 || car.audit_metadata?.saleWorkspaceId || car.audit_metadata?.returnInspectionPending === true) throw new SaleWorkspaceError('This replacement vehicle is not available.', 409);
  const competing = await client.query("SELECT id FROM leads WHERE dealer_id=$1 AND vehicle_id=$2::uuid AND stage IN ('reserved','sale_agreed','collected') UNION ALL SELECT id FROM sale_workspace WHERE dealer_id=$1 AND state#>>'{draft,vehicleId}'=$2::text AND state#>>'{lifecycle,status}' IN ('reserved','sold')", [dealer, vehicleId]);
  if (competing.rows.length) throw new SaleWorkspaceError('The replacement car has another active sale or reservation.', 409);
      const price = operationMoney(proposal.replacementPrice, "replacement price");
      const replacementDraft: SaleWorkspaceDraft = {
        ...current.draft,
        id: "",
        vehicleId,
        title: undefined,
        vehicle: car.title,
        registration: car.registration,
        price: (price / 100).toFixed(2),
        vin: "",
        partExchange: false,
        pxRegistration: "",
        pxDescription: "",
        pxValue: "",
        exchanges: [],
        adjustments: [],
        deliveryCharge: "0",
        creditEntries: undefined,
        returnCreditPence: undefined,
        sourceEnquiryId: "",
        sourceReservationId: "",
        appointment: undefined,
        collection: "",
        handover: false,
        preparation: false,
        documents: false,
        payments: [],
        notes: "",
        fulfilment: {
          method: "collection",
          viewed: "not-yet-viewed",
          address: "",
          recipient: current.draft.customer,
          phone: current.draft.phone,
          scheduledDate: "",
          timeWindow: "",
          instructions: "",
        },
      } as SaleWorkspaceDraft;
      const replacementContext = {
        ...ctx,
        ...(await readSaleWorkspaceAssets(replacementDraft, dealer, client)),
      };

  return { oldCar, car, vehicleId, replacementDraft, replacementContext };
}

/** All additional deal operations share the existing tenant and numbering lock. */
export async function saleOperation(
  id: string,
  input: Record<string, unknown>,
  actor: string,
) {
  if (!validRequestId(input.requestId))
    throw new SaleWorkspaceError("Check the action reference.");
  const dealer = currentDealerId(),
    client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
      `sale-workspace:${dealer}`,
    ]);
    const current = await load(client, dealer, id),
      key = input.requestId,
      hash = fingerprint(input);
    const retry = current.requests?.[key];
    if (retry) {
      if (retry.fingerprint !== hash)
        throw new SaleWorkspaceError(
          "This action reference was already used with different details.",
          409,
        );
      await client.query("COMMIT");
      return {
        sale: publicSaleWorkspace(current),
        replayed: true,
        ...(current.returnReplacement
          ? { replacementId: current.returnReplacement.otherSaleId }
          : {}),
      };
    }
    operationRevision(current, input.expectedRevision);
    const { ctx, numbers } = await context(client, dealer, current, actor);
    let sale = structuredClone(current),
      result: Record<string, unknown> = {};
    if (input.action === "request-payment") {
      const token = randomBytes(32).toString("hex"),
        expiresAt = new Date(Date.parse(ctx.now) + 30 * 86400000).toISOString();
      const mutation = requestSalePayment(
        current,
        {
          kind: input.kind,
          amount: input.amount,
          dueDate: input.dueDate,
          note: input.note,
          tokenHash: saleTokenHash(token),
          expiresAt,
        },
        ctx,
      );
      sale = mutation.sale;
      result = {
        document: mutation.document,
        requestId: mutation.request.id,
        url: `${siteOrigin()}/payment-request/${token}`,
      };
    } else if (input.action === "cancel-request") {
      const request = sale.paymentRequests?.find(
        (r) => r.id === input.paymentRequestId,
      );
      if (!request)
        throw new SaleWorkspaceError("Payment request not found.", 404);
      request.status = "cancelled";
      finishSaleOperation(sale, ctx, "Payment request cancelled");
    } else if (input.action === "renew-request-link") {
      const request = sale.paymentRequests?.find(
        (r) => r.id === input.paymentRequestId,
      );
      if (!request || !salePaymentRequestAvailable(sale, request, ctx.now))
        throw new SaleWorkspaceError(
          "This payment request is no longer current. Create a new request.",
          409,
        );
      const token = randomBytes(32).toString("hex");
      request.tokenHash = saleTokenHash(token);
      finishSaleOperation(
        sale,
        ctx,
        "Private payment request link renewed; previous link revoked",
      );
      result = {
        requestId: request.id,
        url: `${siteOrigin()}/payment-request/${token}`,
      };
    } else if (input.action === "delivery-charge") {
      if (sale.standaloneReturn || sale.lifecycle?.status === 'returned' || sale.returnReplacement?.direction === "returned")
        throw new SaleWorkspaceError(
          "This car has been returned. Open the replacement deal.",
          409,
        );
      const amount = operationMoney(input.amount, "delivery charge", true),
        previous = operationMoney(
          sale.draft.deliveryCharge ?? "0",
          "delivery charge",
          true,
        );
      if (sale.draft.fulfilment?.method !== "delivery" && amount > 0)
        throw new SaleWorkspaceError(
          "Choose delivery before adding its charge.",
        );
      if (
        sale.draft.adjustments?.some(
          (a) => a.kind === "fee" && /deliver/i.test(a.description),
        )
      )
        throw new SaleWorkspaceError(
          "Remove the existing delivery extra before using the delivery charge.",
        );
      if (
        current.documents.some((d) => d.type === "invoice") &&
        amount < previous
      )
        throw new SaleWorkspaceError(
          "A delivery charge on an issued invoice needs a credit correction; it cannot be silently reduced.",
          409,
        );
      sale.draft.deliveryCharge = (amount / 100).toFixed(2);
      if (
        current.documents.some((d) => d.type === "invoice") &&
        amount > previous
      ) {
        const delta = amount - previous;
        result.document = operationDocument(
          sale,
          ctx,
          "delivery-invoice",
          "Delivery invoice",
          `Additional delivery charge: ${(delta / 100).toFixed(2)} GBP\nLinked vehicle sale: ${sale.reference}\nThis invoice charges only the additional delivery amount. It does not charge for the vehicle again.\nDelivery address: ${sale.draft.fulfilment?.address || ""}\n${ctx.branding.invoiceSettings?.paymentInstructions || ""}`,
        );
        (result.document as SaleWorkspaceDocument).transaction = { kind: 'delivery-invoice', amountPence: delta, saleReference: sale.reference, invoiceReferences: current.documents.filter(document => document.type === 'invoice').map(document => document.number), deliveryAddress: sale.draft.fulfilment?.address || '', previousDeliveryPence: previous, totalDeliveryPence: amount };
      }
      finishSaleOperation(sale, ctx, "Delivery charge saved");
    } else if (input.action === 'return-car') {
      assertSaleFinancialIntegrity(current, true);
      const vehicleId = current.draft.vehicleId;
      if (!/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(vehicleId)) throw new SaleWorkspaceError('The returned vehicle could not be identified.', 409);
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`sale-vehicle:${vehicleId}`]);
      const car = (await client.query('SELECT inventory_status,audit_metadata FROM vehicles WHERE dealer_id=$1 AND id=$2::uuid FOR UPDATE', [dealer, vehicleId])).rows[0];
      if (!car || car.inventory_status !== 'sold' || car.audit_metadata?.saleWorkspaceId !== current.id) throw new SaleWorkspaceError('The vehicle no longer belongs to this completed sale. Review its current ownership before returning it.', 409);
      const mutation = returnSaleCar(current, { agreedCredit: input.agreedCredit, reason: input.reason, condition: input.condition, mileage: input.mileage, returnedDate: input.returnedDate, financeConfirmed: input.financeConfirmed, received: input.received, acknowledge: input.acknowledge }, ctx);
      sale = mutation.sale;
      await client.query("UPDATE vehicles SET inventory_status='hidden',audit_metadata=$3::jsonb,updated_at=$4 WHERE dealer_id=$1 AND id=$2::uuid", [dealer, vehicleId, JSON.stringify({ ...car.audit_metadata, saleWorkspaceId: null, saleWorkspaceStatus: 'returned', returnedFromSaleId: current.id, returnInspectionPending: true, returnedAt: ctx.now }), ctx.now]);
      if ((await client.query("SELECT to_regclass('public.sold_vehicle_follow_ups') AS present")).rows[0]?.present) await client.query("UPDATE sold_vehicle_follow_ups SET status='not_needed',outcome='not_needed',revision=revision+1,updated_by=$4,updated_at=$3,note=concat_ws(E'\\n',nullif(note,''),'Vehicle returned without replacement') WHERE dealer_id=$1 AND sale_id=$2::uuid AND status='pending'", [dealer, current.id, ctx.now, actor]);
      result = { document: mutation.document };
    } else if (input.action === "return-replace") {
      assertSaleFinancialIntegrity(current, true);
      const proposal = replacementProposal(input);
      const { oldCar, car, vehicleId, replacementDraft, replacementContext } = await prepareReplacement(client, dealer, current, proposal, ctx, true);
      // Revalidate the actual stock and ledger under lock; optional AI advice never authorises a transfer.
      const mutation = returnAndReplaceSale(
        current,
        {
          replacementDraft,
          ...proposal,
        },
        replacementContext,
        saleWorkspaceNumber(
          numbers,
          "sale",
          ctx.now,
          ctx.branding.invoiceSettings,
        ),
      );
      sale = mutation.returned;
      // The credit note belongs to the returned vehicle's original branding/facts.
      mutation.creditDocument.snapshot.branding = ctx.branding;
      mutation.creditDocument.snapshot.vehicle = ctx.vehicle;
      await client.query(
        "UPDATE vehicles SET inventory_status='hidden',audit_metadata=$3::jsonb,updated_at=$4 WHERE dealer_id=$1 AND id=$2::uuid",
        [
          dealer,
          current.draft.vehicleId,
          JSON.stringify({
            ...oldCar.audit_metadata,
            saleWorkspaceId: null,
            saleWorkspaceStatus: "returned",
            returnedFromSaleId: current.id,
            returnInspectionPending: true,
            returnedAt: ctx.now,
            returnReplacementSaleId: mutation.replacement.id,
          }),
          ctx.now,
        ],
      );
      await client.query(
        "UPDATE vehicles SET inventory_status='reserved',audit_metadata=$3::jsonb,updated_at=$4 WHERE dealer_id=$1 AND id=$2::uuid",
        [
          dealer,
          vehicleId,
          JSON.stringify({
            ...car.audit_metadata,
            saleWorkspaceId: mutation.replacement.id,
            saleWorkspaceStatus: "reserved",
            saleWorkspaceActor: actor,
            saleWorkspaceChangedAt: ctx.now,
          }),
          ctx.now,
        ],
      );
      if ((await client.query("SELECT to_regclass('public.sold_vehicle_follow_ups') AS present")).rows[0]?.present) await client.query("UPDATE sold_vehicle_follow_ups SET status='not_needed',outcome='not_needed',revision=revision+1,updated_by=$4,updated_at=$3,note=concat_ws(E'\\n',nullif(note,''),'Vehicle returned and credit transferred to replacement sale') WHERE dealer_id=$1 AND sale_id=$2::uuid AND status='pending'", [dealer, current.id, ctx.now, actor]);
      await persist(client, dealer, mutation.replacement);
      result = {
        replacementId: mutation.replacement.id,
        document: mutation.creditDocument,
      };
    } else if (input.action === "refund-credit") {
      assertSaleFinancialIntegrity(current, true);
      const mutation = refundSaleCredit(current, { amount: input.amount, method: input.method, date: input.date, confirmReceived: input.confirmReceived }, ctx);
      sale = mutation.sale;
      result = { document: mutation.document };
    } else throw new SaleWorkspaceError("Unknown deal action.", 400);
    (sale.requests ??= {})[key] = { fingerprint: hash };
    await documents(
      client,
      dealer,
      sale,
      new Set(current.documents.map((d) => d.id)),
    );
    await revokeChangedDeliveryEvidence(client, { dealerId: dealer, saleId: sale.id, before: current, after: sale, actor });
    await persist(client, dealer, sale);
    await client.query(
      "UPDATE sale_workspace_counters SET numbers=$2::jsonb WHERE dealer_id=$1",
      [dealer, JSON.stringify(numbers)],
    );
    await client.query("COMMIT");
    return { sale: publicSaleWorkspace(sale), ...result };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
