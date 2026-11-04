import assert from "node:assert/strict";
import test from "node:test";
import { createHash, randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  createSaleWorkspace,
  changeSaleWorkspace,
  saleWorkspaceTotals,
  publicSaleWorkspace,
  type SaleWorkspaceDraft,
  type SaleWorkspaceRecord,
  type SaleWorkspaceContext,
} from "@workspace/vehicle-meta";
import {
  requestSalePayment,
  returnAndReplaceSale,
  salePaymentAgreement,
  salePaymentRequestAvailable,
  salePaymentRequestRemaining,
  saleDeterministicReview,
  finalReviewCurrent,
} from "../../../lib/vehicle-meta/src/sale-operations";
import {
  saleOperation as persistedSaleOperation,
  saleTokenHash,
} from "./lib/sale-operations-store";
import { engine } from "./test/tenant-test-db";
import { runWithTenant } from "./lib/tenant-context";

const saleOperation = (...args: Parameters<typeof persistedSaleOperation>) =>
  persistedSaleOperation(...args) as Promise<{
    sale: SaleWorkspaceRecord;
    url?: string;
    document?: import("@workspace/vehicle-meta").SaleWorkspaceDocument;
    replacementId?: string;
    replayed?: boolean;
  }>;

const context = (): SaleWorkspaceContext => ({
  now: "2026-11-03T12:00:00.000Z",
  actor: "Example Staff",
  nextId: randomUUID,
  nextNumber: (type) => `${type.toUpperCase()}-${randomUUID()}`,
  branding: {
    identity: { name: "Example Motors", logoText: "EXAMPLE", logoAsset: "" },
    contact: { phone: "02000000000", email: "staff@example.invalid" },
    address: { street: "", city: "London", region: "", postcode: "" },
    legal: { companyName: "Example Motors", companyNumber: "", vatNumber: "" },
  },
});
const draft = (price = "10000"): SaleWorkspaceDraft => ({
  id: "",
  customer: "Example Buyer",
  email: "buyer@example.invalid",
  phone: "02000000001",
  address: "1 Example Street",
  vehicleId: randomUUID(),
  vehicle: "Example car",
  registration: "AB20 XYZ",
  price,
  partExchange: false,
  pxRegistration: "",
  pxDescription: "",
  pxValue: "",
  deposit: "",
  paymentMethod: "",
  notes: "",
  collection: "",
  preparation: false,
  documents: false,
  handover: false,
  exchanges: [],
  adjustments: [],
  deliveryCharge: "0",
  fulfilment: {
    method: "collection",
    viewed: "viewed",
    address: "",
    recipient: "Example Buyer",
    phone: "02000000001",
    scheduledDate: "2026-11-03",
    timeWindow: "",
    instructions: "",
  },
});
const create = (price = "10000") =>
  createSaleWorkspace(
    { draft: draft(price), requestId: randomUUID() },
    context(),
    "SALE-1001",
  ).sale;
const paid = () => {
  const initial = create();
  const receipt = changeSaleWorkspace(
    initial,
    {
      action: "payment",
      payment: {
        amount: "10000",
        kind: "final-payment",
        status: "confirmed",
        method: "Bank transfer",
        date: "2026-11-03",
        reference: "SALE-1001",
      },
    },
    { expectedRevision: initial.revision, requestId: randomUUID() },
    context(),
  ).sale;
  receipt.lifecycle = {
    status: "sold",
    vehicleId: receipt.draft.vehicleId,
    changedAt: context().now,
  };
  receipt.completedAt = context().now;
  return receipt;
};
const returnInput = (price = "12000") => ({
  replacementDraft: draft(price),
  agreedCredit: "10000",
  reason: "Agreed replacement vehicle",
  condition:
    "Vehicle returned with no new visible damage; keys and papers checked",
  mileage: 45000,
  financeConfirmed: true,
  acknowledge: true,
});

test("payment requests are documents, never receipts, payments or reservations", () => {
  const original = create(),
    before = structuredClone(original),
    mutation = requestSalePayment(
      original,
      {
        kind: "deposit",
        amount: "500",
        dueDate: "2026-11-10",
        note: "Agreed reservation deposit",
        tokenHash: "a".repeat(64),
        expiresAt: "2026-12-03T12:00:00Z",
      },
      context(),
    );
  assert.deepEqual(original, before);
  assert.equal(mutation.document.type, "payment-request");
  assert.equal(mutation.document.templateVersion, 'sales-workspace-v2');
  assert.deepEqual(mutation.document.transaction, { kind: 'payment-request', requestKind: 'deposit', amountPence: 50000, dueDate: '2026-11-10', paymentReference: original.reference, saleReference: original.reference, note: 'Agreed reservation deposit' });
  assert.equal(mutation.sale.payments.length, 0);
  assert.equal(mutation.sale.lifecycle, undefined);
  assert.equal(
    saleWorkspaceTotals(mutation.sale.draft, mutation.sale.payments).balance,
    1000000,
  );
  assert.equal(mutation.request.amountPence, 50000);
  assert.match(mutation.document.content!, /not an invoice/);
  assert.equal(
    publicSaleWorkspace(mutation.sale).paymentRequests![0].tokenHash,
    "",
  );
  assert.equal(
    salePaymentRequestAvailable(mutation.sale, mutation.request, context().now),
    true,
  );
  assert.throws(
    () =>
      requestSalePayment(
        original,
        {
          kind: "deposit",
          amount: "10000.01",
          dueDate: "2026-11-10",
          note: "",
          tokenHash: "a".repeat(64),
          expiresAt: "2026-12-03T12:00:00Z",
        },
        context(),
      ),
    /outstanding balance/,
  );
  const changed = structuredClone(mutation.sale);
  changed.draft.deliveryCharge = "200";
  assert.notEqual(salePaymentAgreement(changed), mutation.request.agreement);
  assert.equal(
    salePaymentRequestAvailable(changed, mutation.request, context().now),
    false,
  );
  assert.equal(
    salePaymentRequestAvailable(
      mutation.sale,
      mutation.request,
      "2026-12-04T12:00:00Z",
    ),
    false,
  );
  const paymentChanged = structuredClone(mutation.sale);
  paymentChanged.payments.push({
    id: randomUUID(),
    amount: "500",
    amountPence: 50000,
    signedAmountPence: 50000,
    kind: "deposit",
    method: "Bank transfer",
    date: "2026-11-03",
    reference: "",
    status: "confirmed",
    recordedBy: "Staff",
    recordedAt: context().now,
  });
  assert.equal(
    salePaymentAgreement(paymentChanged),
    mutation.request.agreement,
    "Ordinary payments must not corrupt the agreement fingerprint",
  );
});

test("a payment request tracks only confirmed funds received after its baseline and binds the customer identity", () => {
  let original = create();
  const receive = (
    sale: SaleWorkspaceRecord,
    amount: string,
    status: "pending" | "confirmed" = "confirmed",
  ) =>
    changeSaleWorkspace(
      sale,
      {
        action: "payment",
        payment: {
          amount,
          kind: "part-payment",
          status,
          method: "Bank transfer",
          date: "2026-11-03",
          reference: "SALE-1001",
        },
      },
      { expectedRevision: sale.revision, requestId: randomUUID() },
      context(),
    ).sale;
  original = receive(original, "2000");
  const requested = requestSalePayment(
    original,
    {
      kind: "deposit",
      amount: "500",
      dueDate: "2026-11-10",
      note: "",
      tokenHash: "a".repeat(64),
      expiresAt: "2026-12-03T12:00:00Z",
    },
    context(),
  );
  assert.equal(requested.request.baselinePaidPence, 200000);
  assert.equal(
    salePaymentRequestRemaining(requested.sale, requested.request),
    50000,
  );
  requested.request.paymentReportedAt = context().now;
  assert.equal(
    salePaymentRequestRemaining(requested.sale, requested.request),
    50000,
    "A customer report is not received money",
  );
  const pending = receive(requested.sale, "100", "pending");
  assert.equal(
    salePaymentRequestRemaining(pending, requested.request),
    50000,
    "Pending money does not settle requests",
  );
  assert.throws(
    () =>
      requestSalePayment(
        pending,
        {
          kind: "other",
          amount: "100",
          dueDate: "2026-11-10",
          note: "",
          tokenHash: "b".repeat(64),
          expiresAt: "2026-12-03T12:00:00Z",
        },
        context(),
      ),
    /Cancel or settle/,
  );
  const partial = receive(pending, "200");
  assert.equal(salePaymentRequestRemaining(partial, requested.request), 30000);
  const settled = receive(partial, "300");
  assert.equal(
    salePaymentRequestRemaining(settled, requested.request),
    0,
    "The original deposit must not be requested twice",
  );
  const next = requestSalePayment(
    settled,
    {
      kind: "balance",
      amount: "7500",
      dueDate: "2026-11-10",
      note: "",
      tokenHash: "b".repeat(64),
      expiresAt: "2026-12-03T12:00:00Z",
    },
    context(),
  );
  assert.equal(next.request.baselinePaidPence, 250000);
  assert.equal(salePaymentRequestRemaining(next.sale, next.request), 750000);
  for (const field of [
    "customer",
    "email",
    "phone",
    "address",
    "vehicleId",
    "registration",
    "price",
  ] as const) {
    const changed = structuredClone(requested.sale);
    changed.draft[field] = `Changed ${field}`;
    assert.equal(
      salePaymentRequestAvailable(changed, requested.request, context().now),
      false,
      `${field} must invalidate the link`,
    );
  }
  for (const field of ["recipient", "address", "phone"] as const) {
    const changed = structuredClone(requested.sale);
    changed.draft.fulfilment![field] = `Changed ${field}`;
    assert.equal(
      salePaymentRequestAvailable(changed, requested.request, context().now),
      false,
      `Delivery ${field} must invalidate the link`,
    );
  }
});
for (const [replacementPrice, expectedBalance] of [
  ["12000", 200000],
  ["10000", 0],
  ["8500", -150000],
] as const)
  test(`return and replacement ${replacementPrice} preserves original cash once and transfers credit`, () => {
    const original = paid(),
      frozen = JSON.stringify(original.documents),
      mutation = returnAndReplaceSale(
        original,
        returnInput(replacementPrice),
        context(),
        "SALE-1002",
      );
    assert.equal(mutation.returned.payments.length, original.payments.length);
    assert.equal(mutation.replacement.payments.length, 0);
    assert.equal(
      saleWorkspaceTotals(mutation.returned.draft, mutation.returned.payments)
        .balance,
      0,
    );
    assert.equal(
      saleWorkspaceTotals(mutation.returned.draft, mutation.returned.payments)
        .confirmedPaid,
      0,
    );
    assert.equal(
      saleWorkspaceTotals(
        mutation.replacement.draft,
        mutation.replacement.payments,
      ).confirmedPaid,
      1000000,
    );
    assert.equal(
      saleWorkspaceTotals(
        mutation.replacement.draft,
        mutation.replacement.payments,
      ).balance,
      expectedBalance,
    );
    assert.equal(
      mutation.returned.draft.creditEntries![0].signedAmountPence,
      -1000000,
    );
    assert.equal(
      mutation.replacement.draft.creditEntries![0].signedAmountPence,
      1000000,
    );
    assert.equal(
      mutation.returned.draft.creditEntries![0].id,
      mutation.replacement.draft.creditEntries![0].id,
    );
    assert.equal(
      JSON.stringify(mutation.returned.documents.slice(0, -1)),
      frozen,
    );
    assert.equal(original.returnReplacement, undefined);
    assert.equal(mutation.creditDocument.type, "credit-note");
    assert.equal(mutation.creditDocument.templateVersion, 'sales-workspace-v2');
    assert.equal(mutation.creditDocument.transaction?.kind, 'return-credit');
    assert.equal(mutation.replacement.lifecycle?.status, "reserved");
  });
test("return credit cannot bypass outstanding funds, unresolved finance or part-exchange property", () => {
  const original = paid();
  const pending = structuredClone(original);
  pending.payments.push({
    ...pending.payments[0],
    id: randomUUID(),
    status: "pending",
    amount: "100",
    amountPence: 10000,
    signedAmountPence: 10000,
  });
  assert.throws(
    () => returnAndReplaceSale(pending, returnInput(), context(), "SALE-1002"),
    /pending payments/,
  );
  const outstanding = structuredClone(original);
  outstanding.payments[0].amount = "9000";
  outstanding.payments[0].amountPence = 900000;
  outstanding.payments[0].signedAmountPence = 900000;
  assert.throws(
    () =>
      returnAndReplaceSale(outstanding, returnInput(), context(), "SALE-1002"),
    /original balance/,
  );
  assert.throws(
    () =>
      returnAndReplaceSale(
        original,
        { ...returnInput(), agreedCredit: "10000.01" },
        context(),
        "SALE-1002",
      ),
    /net funds retained/,
  );
  assert.throws(
    () =>
      returnAndReplaceSale(
        original,
        { ...returnInput(), financeConfirmed: false },
        context(),
        "SALE-1002",
      ),
    /finance/,
  );
  const px = structuredClone(original);
  px.draft.partExchange = true;
  assert.throws(
    () => returnAndReplaceSale(px, returnInput(), context(), "SALE-1002"),
    /part-exchange property/,
  );
  const result = returnAndReplaceSale(
    original,
    returnInput(),
    context(),
    "SALE-1002",
  );
  assert.throws(
    () =>
      returnAndReplaceSale(
        result.returned,
        returnInput(),
        context(),
        "SALE-1003",
      ),
    /already been returned/,
  );
});
test("a refund already reversed by the original ledger cannot become duplicated return credit", () => {
  const original = paid();
  const refunded = changeSaleWorkspace(
    original,
    {
      action: "reverse",
      paymentId: original.payments[0].id,
      amount: "1000",
      reason: "Prior refund",
      date: "2026-11-03",
      invoiceOnly: true,
    },
    { expectedRevision: original.revision, requestId: randomUUID() },
    context(),
  ).sale;
  assert.equal(
    saleWorkspaceTotals(refunded.draft, refunded.payments).confirmedPaid,
    900000,
  );
  assert.throws(
    () => returnAndReplaceSale(refunded, returnInput(), context(), "SALE-1002"),
    /original balance/,
  );
});
test("a returned original payment cannot be refunded a second time after credit transfer", () => {
  const mutation = returnAndReplaceSale(
    paid(),
    returnInput(),
    context(),
    "SALE-1002",
  );
  assert.throws(
    () =>
      changeSaleWorkspace(
        mutation.returned,
        {
          action: "reverse",
          paymentId: mutation.returned.payments[0].id,
          amount: "1000",
          reason: "Would duplicate transferred customer funds",
          date: "2026-11-03",
          invoiceOnly: true,
        },
        {
          expectedRevision: mutation.returned.revision,
          requestId: randomUUID(),
        },
        context(),
      ),
    /returned|replacement|credit/i,
  );
});
test("final checks reject duplicate credit transfers and incorrect refund signs, and passes belong to one revision", () => {
  const original = paid();
  original.finalReview = {
    id: randomUUID(),
    checkedAt: context().now,
    reviewedRevision: original.revision,
    status: "passed",
    issues: [],
    summary: "Checked",
  };
  assert.equal(finalReviewCurrent(original), true);
  original.revision++;
  assert.equal(finalReviewCurrent(original), false);
  const badSign = paid();
  badSign.payments[0].kind = "refund";
  assert.ok(
    saleDeterministicReview(badSign).some((i) => i.severity === "error"),
    "A positive refund must be rejected deterministically",
  );
  const duplicate = create();
  const transfer = {
    id: randomUUID(),
    sourceSaleId: randomUUID(),
    reference: "SALE-PREV",
    signedAmountPence: 100,
    at: context().now,
  };
  duplicate.draft.creditEntries = [transfer, { ...transfer }];
  assert.ok(
    saleDeterministicReview(duplicate).some((i) => i.severity === "error"),
    "Duplicate transfer ID must be rejected deterministically",
  );
});

test('financial checks validate frozen document arithmetic without comparing old balances to later payments or delivery', () => {
  const original = paid();
  assert.equal(saleDeterministicReview(original).filter(issue => issue.field === 'invoices').length, 0);
  const changed = structuredClone(original);
  changed.draft.deliveryCharge = '200';
  changed.draft.fulfilment!.method = 'delivery';
  changed.draft.fulfilment!.address = '1 Example Road';
  assert.equal(saleDeterministicReview(changed).filter(issue => issue.field === 'invoices').length, 0, 'A later delivery charge cannot rewrite or invalidate historical snapshot arithmetic');
  const corrupted = structuredClone(original);
  corrupted.documents[0].snapshot.totals.balance += 1;
  assert.ok(saleDeterministicReview(corrupted).some(issue => issue.field === 'invoices' && /original ledger/.test(issue.message)));
  const wrongBalance = structuredClone(original);
  wrongBalance.documents[0].balanceAtIssue += 1;
  assert.ok(saleDeterministicReview(wrongBalance).some(issue => issue.field === 'invoices' && /original ledger/.test(issue.message)));
});

test('successive replacements preserve earlier links and conserve credit without inventing cash', () => {
  const first = returnAndReplaceSale(paid(), returnInput('10000'), context(), 'SALE-1002');
  first.replacement.completedAt = context().now;
  first.replacement.lifecycle!.status = 'sold';
  const next = returnAndReplaceSale(first.replacement, returnInput('8500'), context(), 'SALE-1003');
  assert.equal(next.returned.payments.length, 0);
  assert.equal(next.replacement.payments.length, 0);
  assert.equal(next.returned.returnReplacementHistory?.[0].otherSaleId, first.returned.id);
  assert.equal(next.replacement.returnReplacementHistory?.[0].otherSaleId, first.returned.id);
  assert.equal(saleWorkspaceTotals(next.returned.draft, next.returned.payments).balance, 0);
  assert.equal(saleWorkspaceTotals(next.replacement.draft, next.replacement.payments).balance, -150000);
});

const dealer = (id: string) => ({
  dealerId: id,
  canonicalOrigin: `https://${id}.example.test`,
  platform: "cazoo" as const,
  retailerId: id,
  sourceUrl: "https://www.cazoo.co.uk/fictional",
  kind: "website" as const,
});
test("stored operations enforce tenant/revision boundaries and exact return balances without an AI approval stage", async () => {
  process.env.MULTI_TENANT_ENABLED = "true";
  for (const file of (await readdir("../../lib/db/drizzle"))
    .filter((f) => /^\d+.*\.sql$/.test(f))
    .sort())
    await engine.exec(
      await readFile(join("../../lib/db/drizzle", file), "utf8"),
    );
  const a = dealer("sale-ops-a"),
    b = dealer("sale-ops-b"),
    within = <T>(fn: () => T, tenant = a) => runWithTenant(tenant, fn);
  for (const tenant of [a, b]) {
    await engine.query(
      "INSERT INTO dealerships(id,name,status,canonical_origin,stock_platform,retailer_id,source_url) VALUES($1,$1,'active',$2,'cazoo',$1,$3)",
      [tenant.dealerId, tenant.canonicalOrigin, tenant.sourceUrl],
    );
    await engine.query(
      "INSERT INTO dealer_settings(dealer_id,config) VALUES($1,$2::jsonb)",
      [
        tenant.dealerId,
        JSON.stringify({ identity: { name: "Example Motors", logoAsset: "" } }),
      ],
    );
  }
  const sale = create();
  sale.draft.fulfilment!.method = "delivery";
  sale.draft.fulfilment!.address = "1 Example Street";
  const privateToken = "f".repeat(64);
  sale.draft.notes = `Example Buyer buyer@example.invalid +447700900123 https://private.example/payment-request/${privateToken} sk-private-test-key`;
  await engine.query(
    "INSERT INTO sale_workspace(id,dealer_id,reference,revision,state,created_at,updated_at) VALUES($1,$2,$3,$4,$5::jsonb,$6,$6)",
    [
      sale.id,
      a.dealerId,
      sale.reference,
      sale.revision,
      JSON.stringify(sale),
      context().now,
    ],
  );
  const read = async () =>
    (
      await engine.query<{ state: SaleWorkspaceRecord }>(
        "SELECT state FROM sale_workspace WHERE id=$1",
        [sale.id],
      )
    ).rows[0].state;
  try {
    const request = {
      action: "request-payment",
      requestId: randomUUID(),
      expectedRevision: sale.revision,
      kind: "deposit",
      amount: "500",
      dueDate: "2026-11-10",
      note: "Agreed deposit",
    };
    await assert.rejects(
      within(() => saleOperation(sale.id, request, "Staff B"), b),
      /not found/,
    );
    const result = await within(() =>
      saleOperation(sale.id, request, "Staff A"),
    );
    assert.equal(result.sale.payments.length, 0);
    assert.equal(result.sale.paymentRequests?.length, 1);
    assert.match(
      String(result.url),
      /^https:\/\/sale-ops-a.example.test\/payment-request\/[a-f0-9]{64}$/,
    );
    const token = String(result.url).split("/").pop()!;
    assert.equal(
      (await read()).paymentRequests![0].tokenHash,
      saleTokenHash(token),
    );
    assert.equal(result.sale.paymentRequests![0].tokenHash, "");
    assert.equal(
      (await within(() => saleOperation(sale.id, request, "Staff A"))).replayed,
      true,
    );
    await assert.rejects(
      within(() =>
        saleOperation(sale.id, { ...request, amount: "501" }, "Staff A"),
      ),
      /different details/,
    );
    let current = await read();
    const delivery = await within(() =>
      saleOperation(
        sale.id,
        {
          action: "delivery-charge",
          requestId: randomUUID(),
          expectedRevision: current.revision,
          amount: "200",
        },
        "Staff A",
      ),
    );
    assert.equal(
      saleWorkspaceTotals(delivery.sale.draft, delivery.sale.payments).totalDue,
      1020000,
    );
    current = await read();
    const invoiced = changeSaleWorkspace(
      current,
      { action: "document", type: "invoice" },
      { expectedRevision: current.revision, requestId: randomUUID() },
      context(),
    );
    const frozenInvoice = structuredClone(invoiced.document);
    await engine.query(
      "UPDATE sale_workspace SET state=$2::jsonb,revision=$3 WHERE id=$1",
      [sale.id, JSON.stringify(invoiced.sale), invoiced.sale.revision],
    );
    const supplement = await within(() =>
      saleOperation(
        sale.id,
        {
          action: "delivery-charge",
          requestId: randomUUID(),
          expectedRevision: invoiced.sale.revision,
          amount: "300",
        },
        "Staff A",
      ),
    );
    assert.deepEqual(
      supplement.sale.documents.find((d) => d.id === invoiced.document!.id),
      frozenInvoice,
    );
    assert.equal(
      saleWorkspaceTotals(supplement.sale.draft, supplement.sale.payments)
        .totalDue,
      1030000,
    );
    assert.match(
      (supplement.document as { content: string }).content,
      /100\.00 GBP/,
    );
    assert.equal(
      (supplement.document as { type: string }).type,
      "delivery-invoice",
    );
    await assert.rejects(
      within(() =>
        saleOperation(
          sale.id,
          {
            action: "delivery-charge",
            requestId: randomUUID(),
            expectedRevision: supplement.sale.revision,
            amount: "200",
          },
          "Staff A",
        ),
      ),
      /credit correction/,
    );
    // A return and its reservation/credit must persist as one real transaction.
    const original = paid();
    original.reference = "SALE-2001";
    original.finalReview = { id: randomUUID(), status: 'unavailable', reviewedRevision: 0, checkedAt: context().now, summary: 'Old review unavailable', issues: [] };
    original.reviewHistory = [{kind:'final',review:{...original.finalReview,id:randomUUID()}}];
    const replacementId = randomUUID(),
      oldId = original.draft.vehicleId;
    await engine.query(
      "INSERT INTO vehicles(id,dealer_id,source,advert_id,title,source_price,plate,inventory_status,audit_metadata) VALUES($1,$2,'cazoo','old-car','Original car',10000,'AB20 XYZ','sold',$3::jsonb),($4,$2,'cazoo','replacement-car','Replacement estate',8500,'AB21 ABC','available','{}'::jsonb)",
      [
        oldId,
        a.dealerId,
        JSON.stringify({ saleWorkspaceId: original.id }),
        replacementId,
      ],
    );
    await engine.query(
      "INSERT INTO sale_workspace(id,dealer_id,reference,revision,state,created_at,updated_at) VALUES($1,$2,$3,$4,$5::jsonb,$6,$6)",
      [
        original.id,
        a.dealerId,
        original.reference,
        original.revision,
        JSON.stringify(original),
        context().now,
      ],
    );
    const pendingEnquiry = randomUUID(), contactedEnquiry = randomUUID();
    for (const enquiryId of [pendingEnquiry, contactedEnquiry]) await engine.query("INSERT INTO enquiries(id,dealer_id,type,customer_name,message) VALUES($1,$2,'general','Fictional interested buyer','Earlier vehicle enquiry')",[enquiryId,a.dealerId]);
    for (const [enquiryId,status] of [[pendingEnquiry,'pending'],[contactedEnquiry,'contacted']] as const) await engine.query("INSERT INTO sold_vehicle_follow_ups(dealer_id,sale_id,vehicle_id,enquiry_id,related_enquiry_ids,kind,status,updated_by) VALUES($1,$2,$3,$4,$5::jsonb,'interest',$6,'Staff A')",[a.dealerId,original.id,oldId,enquiryId,JSON.stringify([enquiryId]),status]);
    const swap = {
      action: "return-replace",
      requestId: randomUUID(),
      expectedRevision: original.revision,
      replacementVehicleId: replacementId,
      replacementPrice: "8500",
      agreedCredit: "10000",
      reason: "Customer prefers another vehicle",
      condition: "No new visible damage. Two keys and papers received.",
      mileage: 45000,
      financeConfirmed: true,
      acknowledge: true,
    };
    await assert.rejects(within(() => saleOperation(original.id, { ...swap, expectedRevision: 0 }, 'Staff A')), /changed/);
    await assert.rejects(within(() => saleOperation(original.id, { ...swap, financeConfirmed: false }, 'Staff A')), /Confirm/);
    assert.equal((await engine.query<{inventory_status:string}>('SELECT inventory_status FROM vehicles WHERE id=$1',[replacementId])).rows[0].inventory_status,'available');
    const swapped = await within(() =>
      saleOperation(original.id, swap, "Staff A"),
    );
    assert.ok(swapped.replacementId);
    assert.deepEqual(swapped.sale.finalReview,original.finalReview);
    assert.deepEqual(swapped.sale.reviewHistory,original.reviewHistory);
    const followUps = (await engine.query<{enquiry_id:string;status:string;cancelled_at:unknown;note:string}>("SELECT enquiry_id,status,cancelled_at,note FROM sold_vehicle_follow_ups WHERE dealer_id=$1 AND sale_id=$2",[a.dealerId,original.id])).rows;
    assert.equal(followUps.find(row=>row.enquiry_id===pendingEnquiry)?.status,'not_needed'); assert.equal(followUps.find(row=>row.enquiry_id===pendingEnquiry)?.cancelled_at, null, 'Closing a sold follow-up must not claim an appointment was cancelled');
    assert.equal(followUps.find(row=>row.enquiry_id===contactedEnquiry)?.status,'contacted','Already-contacted history must stay intact');
    const replacement = (
      await engine.query<{ state: SaleWorkspaceRecord }>(
        "SELECT state FROM sale_workspace WHERE id=$1",
        [swapped.replacementId],
      )
    ).rows[0].state;
    assert.equal(replacement.draft.vehicleId, replacementId);
    assert.equal(replacement.payments.length, 0);
    assert.equal(
      saleWorkspaceTotals(replacement.draft, replacement.payments).balance,
      -150000,
    );
    assert.equal(
      saleWorkspaceTotals(swapped.sale.draft, swapped.sale.payments).balance,
      0,
    );
    const cars = await engine.query<{
      id: string;
      inventory_status: string;
      audit_metadata: Record<string, unknown>;
    }>(
      "SELECT id,inventory_status,audit_metadata FROM vehicles WHERE id IN ($1,$2)",
      [oldId, replacementId],
    );
    assert.equal(
      cars.rows.find((c) => c.id === oldId)?.inventory_status,
      "hidden",
    );
    assert.equal(
      cars.rows.find((c) => c.id === oldId)?.audit_metadata
        .returnInspectionPending,
      true,
    );
    assert.equal(
      cars.rows.find((c) => c.id === replacementId)?.inventory_status,
      "reserved",
    );
    assert.equal(
      (await within(() => saleOperation(original.id, swap, "Staff A")))
        .replayed,
      true,
    );
    await assert.rejects(
      within(() =>
        saleOperation(
          original.id,
          {
            ...swap,
            requestId: randomUUID(),
            expectedRevision: swapped.sale.revision,
          },
          "Staff A",
        ),
      ),
      (error: unknown) =>
        error instanceof Error &&
        "status" in error &&
        error.status === 409 &&
        /final checks|already|original vehicle|returned/i.test(error.message),
    );
    const refund = {
      action: "refund-credit",
      requestId: randomUUID(),
      expectedRevision: replacement.revision,
      amount: "1500",
      method: "Bank transfer",
      date: new Date().toISOString().slice(0, 10),
      confirmReceived: true,
    };
    const refunded = await within(() =>
      saleOperation(replacement.id, refund, "Staff A"),
    );
    assert.equal(
      saleWorkspaceTotals(refunded.sale.draft, refunded.sale.payments).balance,
      0,
    );
    assert.equal(refunded.sale.payments.length, 1);
    assert.equal(refunded.sale.payments[0].signedAmountPence, -150000);
    assert.equal(refunded.document?.paymentId, refunded.sale.payments[0].id);
    assert.equal(refunded.document?.paymentAmountPence, -150000);
    assert.equal(refunded.document?.snapshot.totals.balance, 0);
    assert.equal(
      (await within(() => saleOperation(replacement.id, refund, "Staff A")))
        .replayed,
      true,
    );
    await assert.rejects(
      within(() =>
        saleOperation(
          replacement.id,
          {
            ...refund,
            requestId: randomUUID(),
            expectedRevision: refunded.sale.revision,
            amount: "1",
          },
          "Staff A",
        ),
      ),
      /refund exceeds/,
    );
    for (const [price, expectedBalance] of [['12000', 200000], ['10000', 0], ['9000', -100000]] as const) {
      const original = paid(); original.reference = `MATRIX-${price}`;
      const candidateId = randomUUID();
      await engine.query("INSERT INTO vehicles(id,dealer_id,source,advert_id,title,source_price,plate,inventory_status,audit_metadata) VALUES($1,$2,'cazoo',$3,'Original car',10000,'AB20 XYZ','sold',$4::jsonb),($5,$2,'cazoo',$6,'Replacement car',$7,'RE20 ABC','available','{}'::jsonb)", [original.draft.vehicleId, a.dealerId, `old-${price}`, JSON.stringify({saleWorkspaceId:original.id}), candidateId, `candidate-${price}`, Number(price)]);
      await engine.query('INSERT INTO sale_workspace(id,dealer_id,reference,revision,state,created_at,updated_at) VALUES($1,$2,$3,$4,$5::jsonb,$6,$6)', [original.id,a.dealerId,original.reference,original.revision,JSON.stringify(original),context().now]);
      const proposal = { requestId: randomUUID(), expectedRevision: original.revision, replacementVehicleId: candidateId, replacementPrice: price, agreedCredit: '10000', reason: 'Agreed vehicle replacement', condition: 'Returned without further damage, both keys received.', mileage: 45000, financeConfirmed: true, acknowledge: true };
      const command = {...proposal,action:'return-replace'};
      await assert.rejects(within(() => saleOperation(original.id, command, `Matrix ${price}`), b), /not found/);
      for (const change of ["source_status='missing'", "missing_count=1", "archived_at=now()", "inventory_status='reserved'"]) {
        await engine.exec(`UPDATE vehicles SET ${change} WHERE id='${candidateId}'`);
        await assert.rejects(within(() => saleOperation(original.id, command, `Matrix ${price}`)), /not available/);
        await engine.query("UPDATE vehicles SET source_status='live',missing_count=0,archived_at=NULL,inventory_status='available' WHERE id=$1",[candidateId]);
      }
      // An unrelated advert edit never forces another AI approval stage.
      await engine.query("UPDATE vehicles SET colour='Blue' WHERE id=$1",[candidateId]);
      const result = await within(() => saleOperation(original.id, command, `Matrix ${price}`));
      const replacement = (await engine.query<{state:SaleWorkspaceRecord}>('SELECT state FROM sale_workspace WHERE id=$1',[result.replacementId])).rows[0].state;
      assert.equal(saleWorkspaceTotals(replacement.draft,replacement.payments).balance,expectedBalance);
      assert.equal(replacement.payments.length,0); assert.equal(result.sale.payments.length,1);
      assert.equal(result.document?.templateVersion,'sales-workspace-v2'); assert.equal(result.document?.transaction?.kind,'return-credit');
      assert.equal((await within(() => saleOperation(original.id, command, `Matrix ${price}`))).replacementId,result.replacementId);
    }

  } finally {
    await engine.close();
  }
});
