import { createHash } from "node:crypto";
import { db } from "@workspace/db";
import {
  SaleWorkspaceError,
  type SaleWorkspaceRecord,
  type SaleWorkspaceDraft,
} from "@workspace/vehicle-meta";
import { currentDealerId } from "./tenant-context";
import { executorQuery } from "./query-executor";
type Executor = Parameters<typeof executorQuery>[0];
const uuid = (value: string) =>
  /^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(value);
export function saleEmailIdentity(value: string) {
  const bytes = createHash("sha256").update(value).digest();
  bytes[6] = (bytes[6]! & 15) | 64;
  bytes[8] = (bytes[8]! & 63) | 128;
  const hex = bytes.subarray(0, 16).toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
/** Exact source IDs are resolved through merges. Contacts are never used to guess a case. */
export async function saleCorrespondenceEnquiry(
  record: SaleWorkspaceRecord,
  buyer: SaleWorkspaceDraft,
  executor: Executor = db,
  create = true,
) {
  const dealer = currentDealerId(),
    query = executorQuery(executor);
  if (buyer.sourceEnquiryId) {
    let id = buyer.sourceEnquiryId;
    const visited = new Set<string>();
    let original = true;
    for (;;) {
      if (!uuid(id) || visited.has(id) || visited.size >= 10)
        throw new SaleWorkspaceError(
          "The invoice customer enquiry needs review.",
          409,
        );
      visited.add(id);
      const entry = (
        await query(
          "SELECT id,vehicle_id,merged_into_id FROM enquiries WHERE dealer_id=$1 AND id=$2::uuid FOR UPDATE",
          [dealer, id],
        )
      ).rows[0];
      if (!entry)
        throw new SaleWorkspaceError(
          "The invoice customer enquiry is unavailable in this dealership.",
          409,
        );
      if (
        original &&
        entry.vehicle_id &&
        buyer.vehicleId &&
        entry.vehicle_id !== buyer.vehicleId
      )
        throw new SaleWorkspaceError(
          "The invoice and original enquiry belong to different vehicles.",
          409,
        );
      original = false;
      if (!entry.merged_into_id) return String(entry.id);
      id = String(entry.merged_into_id);
    }
  }
  const id = saleEmailIdentity(`sale-customer-thread:${dealer}:${record.id}`);
  const existing = (
    await query(
      "SELECT id,source,reference,merged_into_id FROM enquiries WHERE dealer_id=$1 AND id=$2::uuid FOR UPDATE",
      [dealer, id],
    )
  ).rows[0];
  if (existing) {
    if (
      existing.source !== "sale_document" ||
      existing.reference !== record.reference
    )
      throw new SaleWorkspaceError(
        "The sale correspondence thread needs review.",
        409,
      );
    if (existing.merged_into_id)
      return saleCorrespondenceEnquiry(
        record,
        { ...buyer, sourceEnquiryId: id },
        executor,
        false,
      );
    return id;
  }
  if (!create)
    throw new SaleWorkspaceError(
      "The invoice correspondence thread is unavailable.",
      409,
    );
  if (
    buyer.vehicleId &&
    !(
      await query(
        "SELECT id FROM vehicles WHERE dealer_id=$1 AND id=$2::uuid",
        [dealer, buyer.vehicleId],
      )
    ).rows.length
  )
    throw new SaleWorkspaceError(
      "The invoice vehicle is unavailable in this dealership.",
      409,
    );
  await query(
    `INSERT INTO enquiries(id,dealer_id,reference,type,status,customer_name,email,phone,vehicle_id,vehicle_title,vehicle_registration,message,source,preferred_contact) VALUES($1::uuid,$2,$3,'general','contacted',$4,$5,$6,$7::uuid,$8,$9,'Sale paperwork and customer correspondence.','sale_document','email')`,
    [
      id,
      dealer,
      record.reference,
      buyer.customer,
      buyer.email,
      buyer.phone || null,
      buyer.vehicleId || null,
      buyer.vehicle,
      buyer.registration || null,
    ],
  );
  return id;
}

async function readCorrespondenceSale(
  saleId: string,
  executor: Executor,
  lock = false,
) {
  if (!uuid(saleId)) throw new SaleWorkspaceError("Sale not found.", 404);
  const query = executorQuery(executor);
  if (lock)
    await query("SELECT pg_advisory_xact_lock(hashtext($1))", [
      `sale-workspace:${currentDealerId()}`,
    ]);
  const record = (
    await query(
      "SELECT state FROM sale_workspace WHERE dealer_id=$1 AND id=$2::uuid" +
        (lock ? " FOR UPDATE" : ""),
      [currentDealerId(), saleId],
    )
  ).rows[0]?.state as SaleWorkspaceRecord | undefined;
  if (!record) throw new SaleWorkspaceError("Sale not found.", 404);
  return record;
}
/** Read-only handoff: opening a chooser cannot create a customer record. */
export async function lookupSaleCorrespondence(
  saleId: string,
  executor: Executor = db,
) {
  const record = await readCorrespondenceSale(saleId, executor),
    draft = record.draft,
    query = executorQuery(executor);
  const candidate = saleEmailIdentity(
    `sale-customer-thread:${currentDealerId()}:${saleId}`,
  );
  const exists =
    draft.sourceEnquiryId ||
    (
      await query(
        "SELECT id FROM enquiries WHERE dealer_id=$1 AND id=$2::uuid",
        [currentDealerId(), candidate],
      )
    ).rows.length;
  const enquiryId = exists
    ? await saleCorrespondenceEnquiry(record, draft, executor, false)
    : null;
  return {
    enquiryId,
    saleCustomer: {
      saleId,
      customerName: draft.customer,
      email: draft.email,
      phone: draft.phone,
      vehicleId: draft.vehicleId,
      vehicleTitle: draft.vehicle,
    },
  };
}
/** Only explicit staff preparation/confirmation creates the sale-specific case. */
export async function prepareSaleCorrespondence(
  saleId: string,
  executor: Executor = db,
) {
  const record = await readCorrespondenceSale(saleId, executor, true);
  return saleCorrespondenceEnquiry(record, record.draft, executor, true);
}
