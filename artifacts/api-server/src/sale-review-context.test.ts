import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { createSaleWorkspace, saleWorkspaceTotals, type SaleWorkspaceDocument, type SaleWorkspaceRecord } from "@workspace/vehicle-meta";
import {
  readSaleReviewContext,
  assertSaleReviewContext,
} from "./lib/sale-review-context";
import {
  deliveryJobContext,
  deliveryContextHash,
} from "./lib/delivery-evidence";
import { redactAiText } from "./lib/ai-assistance";

const create = () =>
  createSaleWorkspace(
    {
      requestId: randomUUID(),
      draft: {
        customer: "Private Buyer",
        email: "buyer@example.test",
        phone: "07700900123",
        address: "14 Secret Road",
        vehicleId: randomUUID(),
        vehicle: "Ford Focus",
        registration: "AB20 XYZ",
        price: "10000",
        fulfilment: {
          method: "delivery",
          viewed: "viewed",
          address: "14 Secret Road",
          recipient: "Private Buyer",
          phone: "07700900123",
          scheduledDate: "2026-11-06",
          timeWindow: "Afternoon",
          instructions: "",
        },
      },
    },
    {
      now: "2026-11-03T12:00:00Z",
      actor: "Staff",
      nextId: randomUUID,
      nextNumber: () => "INV-1",
      branding: {
        identity: { name: "Example Motors", logoText: "", logoAsset: "" },
        contact: { phone: "", email: "" },
        address: { street: "", city: "", region: "", postcode: "" },
        legal: { companyName: "", companyNumber: "", vatNumber: "" },
      },
    },
    "SALE-1",
  ).sale;
async function fixture() {
  const engine = new PGlite();
  await engine.exec(
    "CREATE TABLE dealer_settings(dealer_id text primary key,config jsonb); CREATE TABLE vehicles(id uuid primary key,dealer_id text,title text,registration text,write_off_category text,website_description text); CREATE TABLE sale_workspace(id uuid primary key,dealer_id text,state jsonb);",
  );
  const client = {
    query: (sql: string, values: any[] = []) =>
      engine.query<Record<string, any>>(sql, values),
  };
  const sale = create();
  await client.query("INSERT INTO dealer_settings VALUES($1,$2)", [
    "a",
    {
      identity: { name: "Example Motors" },
      warranty: { description: "6 month warranty" },
      presentation: { includedItems: ["6 month warranty"] },
    },
  ]);
  await client.query("INSERT INTO vehicles VALUES($1,$2,$3,$4,$5,$6)", [
    sale.draft.vehicleId,
    "a",
    "Ford Focus",
    "AB20 XYZ",
    "S",
    "Private Buyer at 14 Secret Road. Email buyer@example.test. Token sk_secret123 and https://secret.example.test.",
  ]);
  await client.query("INSERT INTO sale_workspace VALUES($1,$2,$3)", [
    sale.id,
    "a",
    sale,
  ]);
  return { engine, client, sale };
}
function invoice(sale: SaleWorkspaceRecord): SaleWorkspaceDocument {
  return {
    id: randomUUID(), number: "INV-1", type: "invoice", invoiceKind: "full",
    title: "Sales invoice", issuedAt: "2026-11-03T12:00:00Z", issuedBy: "Staff", version: 1,
    balanceAtIssue: saleWorkspaceTotals(sale.draft, sale.payments).balance,
    snapshot: {
      draft: structuredClone(sale.draft), payments: structuredClone(sale.payments),
      totals: saleWorkspaceTotals(sale.draft, sale.payments),
      branding: {
        identity: { name: "Example Motors", logoText: "", logoAsset: "" },
        contact: { phone: "", email: "" },
        address: { street: "", city: "", region: "", postcode: "" },
        legal: { companyName: "", companyNumber: "", vatNumber: "" },
      },
    },
  };
}
test("the latest full invoice checks frozen identity and vehicle price without exposing customer details", async () => {
  const { engine, client, sale } = await fixture();
  try {
    sale.documents.push(invoice(sale));
    const matching = await readSaleReviewContext(client, "a", sale);
    assert.deepEqual(matching.terms.latestFullInvoice, {
      present: true, customerMatches: true, addressMatches: true, vehicleMatches: true,
      registrationMatches: true, priceMatches: true,
    });
    const wrong = invoice(sale);
    wrong.snapshot.draft = { ...wrong.snapshot.draft,
      customer: "Different Private Customer", address: "9 Other Private Lane",
      vehicleId: randomUUID(), registration: "CD21 ABC", price: "9500",
    };
    sale.documents.push(wrong);
    const newerDeposit = invoice(sale);
    newerDeposit.invoiceKind = "deposit";
    sale.documents.push(newerDeposit);
    const mismatched = await readSaleReviewContext(client, "a", sale);
    assert.deepEqual(mismatched.terms.latestFullInvoice, {
      present: true, customerMatches: false, addressMatches: false, vehicleMatches: false,
      registrationMatches: false, priceMatches: false,
    });
    assert.ok(mismatched.issues.some((issue) => issue.field === "invoices" && /latest full invoice/.test(issue.message)));
    assert.notEqual(matching.hash, mismatched.hash);
    assert.ok(!JSON.stringify(mismatched).includes("Different Private Customer"));
    assert.ok(!JSON.stringify(mismatched).includes("9 Other Private Lane"));
    assert.ok(!JSON.stringify(mismatched).includes("CD21 ABC"));
  } finally { await engine.close(); }
});
test("later payments and a separately agreed delivery charge do not contradict the full invoice identity", async () => {
  const { engine, client, sale } = await fixture();
  try {
    const original = invoice(sale);
    original.snapshot.draft.price = "10000.00";
    original.snapshot.draft.registration = "ab20xyz";
    sale.documents.push(original);
    sale.draft.deliveryCharge = "200";
    sale.payments.push({
      id: randomUUID(), amount: "10200", amountPence: 1020000, signedAmountPence: 1020000,
      method: "bank transfer", date: "2026-11-03", reference: "Later settlement", kind: "final-payment",
      status: "confirmed", recordedBy: "Staff", recordedAt: "2026-11-03T14:00:00Z",
    });
    const checked = await readSaleReviewContext(client, "a", sale);
    assert.equal(checked.terms.latestFullInvoice.present, true);
    assert.ok(Object.values(checked.terms.latestFullInvoice).every(Boolean));
    assert.ok(!checked.issues.some((issue) => issue.field === "invoices"));
    assert.equal(original.snapshot.payments.length, 0);
    assert.equal(original.snapshot.draft.deliveryCharge, "");
  } finally { await engine.close(); }
});
test("context hashes full source facts while the provider view excludes contacts and secrets", async () => {
  const { engine, client, sale } = await fixture();
  try {
    const before = await readSaleReviewContext(client, "a", sale),
      text = JSON.stringify({
        evidence: before.evidence,
        terms: before.terms,
        vehicle: before.vehicle,
      });
    for (const secret of [
      "Private Buyer",
      "14 Secret Road",
      "buyer@example.test",
      "07700900123",
      "sk_secret123",
      "secret.example.test",
    ])
      assert.ok(!text.includes(secret), secret);
    assert.equal((before.vehicle as any).registrationMatches, true);
    sale.finalReview = {
      id: randomUUID(),
      checkedAt: new Date().toISOString(),
      reviewedRevision: sale.revision,
      status: "passed",
      contextHash: before.hash,
      issues: [],
      summary: "Checked",
    };
    assert.equal(
      (await assertSaleReviewContext(client, "a", sale)).hash,
      before.hash,
    );
    await client.query(
      "UPDATE vehicles SET write_off_category=$2 WHERE id=$1",
      [sale.draft.vehicleId, "N"],
    );
    assert.notEqual(
      (await readSaleReviewContext(client, "a", sale)).hash,
      before.hash,
    );
    await assert.rejects(
      assertSaleReviewContext(client, "a", sale),
      /supporting records changed/,
    );
    const changed = await readSaleReviewContext(client, "a", sale);
    sale.finalReview = {
      ...sale.finalReview,
      status: "overridden",
      contextHash: changed.hash,
      override: {
        actor: "Staff",
        reason: "Documents checked with customer",
        at: new Date().toISOString(),
      },
    };
    await assertSaleReviewContext(client, "a", sale);
    sale.revision++;
    await assert.rejects(
      assertSaleReviewContext(client, "a", sale),
      /supporting records changed/,
    );
    const other = await readSaleReviewContext(client, "b", sale);
    assert.equal((other.vehicle as any).found, false);
    assert.equal((other.terms as any).warranty, "");
  } finally {
    await engine.close();
  }
});
test("published terms, category applicability and mismatched frozen customer paperwork affect review", async () => {
  const { engine, client, sale } = await fixture();
  try {
    await engine.exec(
      await readFile("../../lib/db/drizzle/0082_sales_terms.sql", "utf8"),
    );
    const version = randomUUID(),
      content = {
        title: "Terms",
        sections: [
          {
            heading: "Warranty",
            paragraphs: ["15 month warranty"],
            condition: "all",
          },
          {
            heading: "Category S",
            paragraphs: ["Known structural damage disclosed"],
            condition: "category-s",
          },
        ],
      };
    await client.query(
      "INSERT INTO dealer_sales_terms_versions(id,dealer_id,version,content,created_by) VALUES($1,$2,1,$3,$4)",
      [version, "a", content, "Staff"],
    );
    await client.query(
      "INSERT INTO dealer_sales_terms(dealer_id,revision,draft,published_version_id,updated_by) VALUES($1,1,$2,$3,$4)",
      ["a", content, version, "Staff"],
    );
    const checked = await readSaleReviewContext(client, "a", sale);
    assert.ok(checked.issues.some((i) => /warranty duration/.test(i.message)));
    assert.equal((checked.terms as any).applicableSectionCount, 2);
    await client.query(
      "UPDATE vehicles SET write_off_category=$2 WHERE id=$1",
      [sale.draft.vehicleId, "N"],
    );
    const nonS = await readSaleReviewContext(client, "a", sale);
    assert.equal((nonS.terms as any).applicableSectionCount, 1);
    await client.query(
      "INSERT INTO sale_terms_documents(id,dealer_id,sale_id,request_id,request_hash,snapshot,dealer_pdf,both_pdf,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)",
      [
        randomUUID(),
        "a",
        sale.id,
        randomUUID(),
        "a".repeat(64),
        {
          customer: "Different Buyer",
          customerAddress: "",
          vehicle: sale.draft.vehicle,
          registration: sale.draft.registration,
        },
        "",
        "",
        "Staff",
      ],
    );
    const mismatched = await readSaleReviewContext(client, "a", sale);
    assert.ok(
      mismatched.issues.some((i) => /different customer/.test(i.message)),
    );
    assert.notEqual(mismatched.hash, nonS.hash);
    assert.ok(
      !JSON.stringify(mismatched).includes("Different Buyer"),
      "Frozen customer identity never enters the provider view",
    );
  } finally {
    await engine.close();
  }
});
test("literal redaction handles unbalanced punctuation and unequal case in names and addresses", async () => {
  const { engine, client, sale } = await fixture();
  try {
    const name = "A+B (Buyer [North",
      address = "Apt. [4]+ West (Road";
    sale.draft.customer = name;
    sale.draft.address = address;
    sale.draft.fulfilment!.recipient = name;
    sale.draft.fulfilment!.address = address;
    const description = `${name.toLowerCase()} visited ${address.toUpperCase()}.`;
    await client.query(
      "UPDATE vehicles SET website_description=$2 WHERE id=$1",
      [sale.draft.vehicleId, description],
    );
    const result = await readSaleReviewContext(client, "a", sale),
      text = JSON.stringify(result.vehicle).toLowerCase();
    assert.ok(!text.includes(name.toLowerCase()));
    assert.ok(!text.includes(address.toLowerCase()));
    const shared = redactAiText(`${name} and ${name.toLowerCase()}`, [name]);
    assert.equal(shared, "[customer] and [customer]");
  } finally {
    await engine.close();
  }
});
test("a new delivery report invalidates a review without changing sale revision and exposes no raw location", async () => {
  const { engine, client, sale } = await fixture();
  try {
    await engine.exec(
      await readFile("../../lib/db/drizzle/0081_delivery_evidence.sql", "utf8"),
    );
    const before = await readSaleReviewContext(client, "a", sale),
      snapshot = deliveryJobContext(sale, "Example Motors");
    const report = {
      source: "driver",
      outcome: "failed",
      driverName: "Private Driver",
      recipientName: "Private Buyer",
      acknowledged: false,
      documentsProvided: false,
      keys: 0,
      mileage: 42000,
      notes: "Private Buyer called buyer@example.test",
      handoverAt: "2026-11-03T12:00:00Z",
      location: { latitude: 51.5, longitude: -0.12, accuracy: 20 },
    };
    await client.query(
      "INSERT INTO sale_delivery_evidence(id,dealer_id,sale_id,vehicle_id,request_id,create_hash,token_hash,context_hash,snapshot,created_at,created_by,expires_at,submitted_at,submission_request_id,submission_hash,submission) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)",
      [
        randomUUID(),
        "a",
        sale.id,
        sale.draft.vehicleId,
        randomUUID(),
        "b".repeat(64),
        "c".repeat(64),
        deliveryContextHash(snapshot),
        snapshot,
        "2026-11-03T11:00:00Z",
        "Staff",
        "2099-01-01T00:00:00Z",
        "2026-11-03T12:00:00Z",
        randomUUID(),
        "d".repeat(64),
        report,
      ],
    );
    const after = await readSaleReviewContext(client, "a", sale);
    assert.notEqual(after.hash, before.hash);
    assert.equal(sale.revision, 1);
    assert.equal(after.evidence.length, 1);
    assert.equal(after.evidence[0].locationRecorded, true);
    const text = JSON.stringify(after.evidence);
    assert.ok(!text.includes("latitude"));
    assert.ok(!text.includes("longitude"));
    assert.ok(!text.includes("Private Buyer"));
    assert.ok(!text.includes("buyer@example.test"));
    sale.draft.fulfilment!.completedAt = "2026-11-03T12:00:00Z";
    await client.query("UPDATE sale_workspace SET state=$2 WHERE id=$1", [
      sale.id,
      sale,
    ]);
    const completed = await readSaleReviewContext(client, "a", sale);
    assert.equal(completed.evidence[0].current, false);
    assert.equal(completed.evidence[0].matchesDeal, true);
    assert.ok(
      completed.issues.some((i) =>
        /conflicts with the latest delivery evidence/.test(i.message),
      ),
    );
    sale.draft.fulfilment!.address = "Rearranged delivery address";
    await client.query("UPDATE sale_workspace SET state=$2 WHERE id=$1", [
      sale.id,
      sale,
    ]);
    const rearranged = await readSaleReviewContext(client, "a", sale);
    assert.equal(rearranged.evidence[0].matchesDeal, false);
    assert.ok(
      !rearranged.issues.some((i) =>
        /conflicts with the latest delivery evidence/.test(i.message),
      ),
      "A superseded failed attempt must not be treated as evidence for the later handover",
    );
  } finally {
    await engine.close();
  }
});
