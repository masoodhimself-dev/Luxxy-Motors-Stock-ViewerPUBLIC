import { replaceLiteralIgnoreCase } from "./literal-redaction";
import { createHash } from "node:crypto";
import {
  applicableSalesTerms,
  saleWorkspacePence,
  SaleWorkspaceError,
  type FullSalesTermsContent,
  type SaleWorkspaceRecord,
} from "@workspace/vehicle-meta";
import type { SaleReviewIssue } from "../../../../lib/vehicle-meta/src/sale-operations";
import { DealerIntegrationsStore } from "./dealer-integrations-store";
import { getDeliveryEvidenceReview } from "./delivery-evidence";

type Client = {
  query: (
    text: string,
    parameters?: any[],
  ) => Promise<{ rows: Record<string, any>[] }>;
};
const hash = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
const uuid = (v: string) =>
  /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(v);
const plate = (v: unknown) =>
  String(v ?? "")
    .replace(/[^a-z0-9]/gi, "")
    .toUpperCase();
const clean = (v: unknown, max = 1200) =>
  typeof v === "string" ? v.slice(0, max) : "";

/** Facts outside the deal revision. All reads use the caller's connection and tenant.
 * The hash binds full facts, while model input is bounded and excludes contacts,
 * secrets, raw coordinates, photos and document payloads. */
export async function readSaleReviewContext(
  client: Client,
  dealerId: string,
  sale: SaleWorkspaceRecord,
) {
  const available =
    (
      await client.query(`SELECT
    to_regclass('public.sale_delivery_evidence') AS delivery,
    to_regclass('public.sale_delivery_evidence_photos') AS photos,
    to_regclass('public.dealer_sales_terms') AS terms,
    to_regclass('public.dealer_sales_terms_versions') AS versions,
    to_regclass('public.sale_terms_documents') AS documents,
    to_regclass('public.dealer_private_settings') AS private_settings`)
    ).rows[0] ?? {};
  const config =
    (
      await client.query(
        "SELECT config FROM dealer_settings WHERE dealer_id=$1 FOR SHARE",
        [dealerId],
      )
    ).rows[0]?.config ?? {};
  // FOR SHARE keeps import/edit writers from changing disclosure facts while a
  // caller holds the final issuance transaction. Outside a transaction the caller
  // must reread the context before committing the model result.
  const rawVehicle = uuid(sale.draft.vehicleId ?? "")
    ? (
        await client.query(
          "SELECT to_jsonb(v) AS data FROM vehicles v WHERE dealer_id=$1 AND id=$2::uuid FOR SHARE",
          [dealerId, sale.draft.vehicleId],
        )
      ).rows[0]?.data
    : null;
  const extras = rawVehicle?.raw_source_data?.sourceExtras ?? {};
  const privatePayload = available.private_settings
    ? (
        await client.query(
          "SELECT encrypted_payload FROM dealer_private_settings WHERE dealer_id=$1 FOR SHARE",
          [dealerId],
        )
      ).rows[0]?.encrypted_payload
    : null;
  const privateSettings = privatePayload
    ? new DealerIntegrationsStore({ dealerId }).readPrivateSnapshot(
        privatePayload,
      )
    : null;
  const compact = {
    saleTerms: privateSettings?.salesPaperwork?.saleTerms ?? "",
    reservationTerms: privateSettings?.salesPaperwork?.reservationTerms ?? "",
  };
  const currentTerms =
    available.terms && available.versions
      ? (
          await client.query(
            `SELECT v.id,v.version,v.content FROM dealer_sales_terms s JOIN dealer_sales_terms_versions v ON v.dealer_id=s.dealer_id AND v.id=s.published_version_id WHERE s.dealer_id=$1 FOR SHARE OF s,v`,
            [dealerId],
          )
        ).rows[0]
      : null;
  const issuedTerms = available.documents
    ? (
        await client.query(
          "SELECT id,snapshot FROM sale_terms_documents WHERE dealer_id=$1 AND sale_id=$2::uuid ORDER BY created_at DESC,id DESC LIMIT 30",
          [dealerId, sale.id],
        )
      ).rows
    : [];
  const delivery =
    available.delivery && available.photos
      ? await getDeliveryEvidenceReview(client, { dealerId, saleId: sale.id })
      : { hash: hash([]), summary: [] };
  const secrets = [
    sale.draft.customer,
    sale.draft.email,
    sale.draft.phone,
    sale.draft.address,
    sale.draft.fulfilment?.recipient,
    sale.draft.fulfilment?.phone,
    sale.draft.fulfilment?.address,
  ].filter((v): v is string => typeof v === "string" && v.length >= 2);
  const redact = (v: unknown, max = 1200) => {
    let text = clean(v, max * 2);
    for (const secret of secrets)
      text = replaceLiteralIgnoreCase(text, secret, "[private]");
    return text
      .replace(/https?:\/\/\S+|[\w.+-]+@[\w.-]+\.[a-z]{2,}/gi, "[private]")
      .replace(/\b(?:sk|re|whsec)_[a-z0-9_-]+\b/gi, "[private]")
      .replace(/\b[0-9a-f]{32,}\b/gi, "[private]")
      .replace(/(?:\+?\d[\d ().-]{7,}\d)/g, "[private]")
      .slice(0, max);
  };
  const vehicleFacts = rawVehicle
    ? {
        title: rawVehicle.website_title_override || rawVehicle.title || "",
        registration:
          rawVehicle.plate || rawVehicle.vrm || rawVehicle.registration || "",
        year: rawVehicle.year ?? null,
        mileage: rawVehicle.mileage ?? null,
        owners: rawVehicle.owners ?? null,
        category: rawVehicle.write_off_category ?? "",
        serviceHistory:
          extras.serviceHistory ??
          extras.historyExtras?.serviceHistory?.description ??
          "",
        description: rawVehicle.website_description || extras.description || "",
        motExpiry: extras.motExpiry || extras.motExpiryDate || "",
      }
    : null;
  const included = Array.isArray(config.presentation?.includedItems)
    ? config.presentation.includedItems
        .filter((v: unknown): v is string => typeof v === "string")
        .slice(0, 30)
    : [];
  const warranty = clean(config.warranty?.description, 3000);
  const termsContent = currentTerms?.content as
    FullSalesTermsContent | undefined;
  const applicable = termsContent?.sections
    ? applicableSalesTerms(termsContent, vehicleFacts?.category)
    : [];
  const termsText = [
    compact.saleTerms,
    ...applicable.flatMap((section) => section.paragraphs),
  ].join("\n");
  const configuredWarranty = /\b(\d+)\s*[- ]?months?\b/i.exec(
    [warranty, ...included].join(" "),
  )?.[1];
  const promisedDurations = [
    ...termsText.matchAll(/\b(\d+)\s*[- ]?months?\s+warranty\b/gi),
  ].map((m) => m[1]);
  const issues: SaleReviewIssue[] = [];
  const issue = (field: string, message: string) =>
    issues.push({ field, message, severity: "error" });
  const latestInvoice = [...sale.documents]
    .reverse()
    .find((document) => document.type === "invoice" && document.invoiceKind !== "deposit");
  const frozenInvoice = latestInvoice?.snapshot.draft;
  const identityText = (value: unknown) => String(value ?? "").trim().replace(/\s+/g, " ").toLocaleLowerCase("en-GB");
  const currentPrice = saleWorkspacePence(String(sale.draft.price ?? ""));
  const frozenPrice = saleWorkspacePence(String(frozenInvoice?.price ?? ""));
  // Only compare stable invoice identity and the agreed vehicle price. Payments,
  // balances and later separately invoiced delivery charges legitimately change.
  const latestFullInvoice = frozenInvoice
    ? {
        present: true,
        customerMatches: identityText(frozenInvoice.customer) === identityText(sale.draft.customer),
        addressMatches: identityText(frozenInvoice.address) === identityText(sale.draft.address),
        vehicleMatches: String(frozenInvoice.vehicleId ?? "") === String(sale.draft.vehicleId ?? ""),
        registrationMatches: plate(frozenInvoice.registration) === plate(sale.draft.registration),
        priceMatches: Number.isSafeInteger(frozenPrice) && Number.isSafeInteger(currentPrice) && frozenPrice === currentPrice,
      }
    : { present: false };
  if (Object.values(latestFullInvoice).some((matches) => matches === false) && latestFullInvoice.present)
    issue(
      "invoices",
      "The latest full invoice has different customer, vehicle or agreed vehicle price details from this deal. Review the original invoice and correct the paperwork before continuing.",
    );
  if (
    configuredWarranty &&
    promisedDurations.some((months) => months !== configuredWarranty)
  )
    issue(
      "invoices",
      "The warranty duration in the sale terms differs from the dealership warranty settings. Confirm the actual cover and correct the wording.",
    );
  if (
    vehicleFacts?.registration &&
    plate(vehicleFacts.registration) !== plate(sale.draft.registration)
  )
    issue(
      "vehicle",
      "The saved registration differs from the current stock vehicle. Check the vehicle identity.",
    );
  for (const row of issuedTerms) {
    const snapshot = row.snapshot ?? {};
    if (
      snapshot.customer !== sale.draft.customer ||
      snapshot.customerAddress !== sale.draft.address ||
      snapshot.vehicle !== sale.draft.vehicle ||
      plate(snapshot.registration) !== plate(sale.draft.registration)
    ) {
      issue(
        "invoices",
        "An issued terms document has different customer or vehicle details. Review the original paperwork and the current deal.",
      );
      break;
    }
  }
  // Failed/partial evidence is never treated as a completed physical handover.
  const latestReport = delivery.summary.find(
    (report: any) => report.status === "received" && report.matchesDeal,
  );
  if (
    sale.draft.fulfilment?.completedAt &&
    latestReport &&
    (latestReport.outcome !== "delivered" || !latestReport.acknowledged)
  )
    issue(
      "handover",
      "The recorded handover conflicts with the latest delivery evidence. Review the outcome and recipient acknowledgement.",
    );
  const sourceHash = hash({
    dealerId,
    vehicleFacts,
    warranty,
    included,
    compact,
    currentTerms,
    issuedTerms,
    latestInvoiceIdentity: frozenInvoice ? {
      id: latestInvoice!.id,
      customer: frozenInvoice.customer,
      address: frozenInvoice.address,
      vehicleId: frozenInvoice.vehicleId,
      registration: frozenInvoice.registration,
      price: frozenInvoice.price,
    } : null,
    delivery: delivery.hash,
  });
  let remaining = 8000;
  const excerpts = applicable
    .slice(0, 40)
    .map((section) => {
      const heading = redact(section.heading, 160);
      const text = redact(
        section.paragraphs.join("\n"),
        Math.max(0, remaining),
      );
      remaining -= text.length;
      return { heading, text };
    })
    .filter((section) => section.text);
  return {
    hash: sourceHash,
    issues,
    evidence: delivery.summary,
    vehicle: vehicleFacts
      ? {
          found: true,
          title: redact(vehicleFacts.title, 200),
          year: vehicleFacts.year,
          mileage: vehicleFacts.mileage,
          owners: vehicleFacts.owners,
          category: clean(vehicleFacts.category, 40),
          serviceHistory: redact(vehicleFacts.serviceHistory, 1200),
          description: redact(vehicleFacts.description, 4000),
          motExpiry: clean(vehicleFacts.motExpiry, 40),
          registrationMatches:
            plate(vehicleFacts.registration) === plate(sale.draft.registration),
        }
      : { found: false },
    terms: {
      publishedVersion: currentTerms?.version ?? null,
      applicableSectionCount: applicable.length,
      excerpts,
      textTruncated: remaining <= 0,
      compactSaleTerms: redact(compact.saleTerms, 600),
      reservationTerms: redact(compact.reservationTerms, 600),
      warranty: redact(warranty, 1500),
      included: included.map((v: string) => redact(v, 160)),
      issuedDocuments: issuedTerms.length,
      latestFullInvoice,
    },
  };
}

export async function assertSaleReviewContext(
  client: Client,
  dealerId: string,
  sale: SaleWorkspaceRecord,
) {
  const context = await readSaleReviewContext(client, dealerId, sale);
  const review = sale.finalReview;
  if (
    !review ||
    !["passed", "overridden"].includes(review.status) ||
    review.reviewedRevision !== sale.revision ||
    review.contextHash !== context.hash
  )
    throw new SaleWorkspaceError(
      "The deal or supporting records changed. Run the final checks again before continuing.",
      409,
    );
  return context;
}
