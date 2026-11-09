import test from "node:test";
import assert from "node:assert/strict";
import {
  readdir,
  readFile,
  mkdtemp,
  writeFile,
  utimes,
  symlink,
  rm,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import {
  db,
  engine,
  vehiclesTable,
  dealershipsTable,
} from "./test/tenant-test-db";
import { runWithTenant } from "./lib/tenant-context";
import {
  retainDealerData,
  cleanupRetentionTemporaryFiles,
} from "./lib/data-retention";
process.env.MULTI_TENANT_ENABLED = "true";
const now = new Date("2026-10-13T12:00:00Z");
const tenant = (dealerId: string) => ({
  dealerId,
  canonicalOrigin: `https://${dealerId}.example.test`,
  platform: "autotrader" as const,
  retailerId: dealerId,
  sourceUrl: "https://www.autotrader.co.uk/example",
});
test("retention isolates dealers, waits seven days, preserves financial records and cleans only abandoned drafts", async () => {
  for (const f of (await readdir("../../lib/db/drizzle"))
    .filter((f) => /^\d+.*\.sql$/.test(f))
    .sort())
    await engine.exec(await readFile(join("../../lib/db/drizzle", f), "utf8"));
  const ids = Array.from({ length: 7 }, randomUUID);
  for (const dealer of ["a", "b"])
    await db.insert(dealershipsTable).values({
      id: dealer,
      name: dealer,
      status: "active",
      canonicalOrigin: tenant(dealer).canonicalOrigin,
      stockPlatform: "autotrader",
      retailerId: dealer,
      sourceUrl: tenant(dealer).sourceUrl,
    });
  const ago = (days: number) => new Date(now.getTime() - days * 86400000);
  await db.insert(vehiclesTable).values(
    ids.map((id, i) => ({
      id,
      dealerId: i === 6 ? "b" : "a",
      source: "autotrader",
      advertId: String(i),
      title: "Fictional car",
      inventoryStatus:
        i === 0 || i === 5 || i === 6
          ? ("sold" as const)
          : i === 3
            ? ("reserved" as const)
            : ("available" as const),
      sourceStatus:
        i === 1 || i === 3 || i === 4
          ? ("missing" as const)
          : ("live" as const),
      missingCount: i === 4 ? 1 : i === 1 || i === 3 ? 2 : 0,
      retirementStartedAt: i === 5 ? ago(6) : ago(8),
      rawSourceData: {
        sourceExtras: { description: "KEEP EXACT" },
        specifications: { year: 2020 },
      },
    })),
  );
  const archived = [];
  const draft = (extra: object = {}) => ({
    id: randomUUID(),
    reference: "TEST-" + randomUUID(),
    revision: 1,
    draft: {
      vehicleId: "",
      sourceEnquiryId: "",
      sourceReservationId: "",
      deposit: "",
    },
    payments: [],
    documents: [],
    events: [],
    ...extra,
  });
  const plain = draft(),
    paid = draft({
      payments: [{ status: "confirmed", signedAmountPence: 50000 }],
    }),
    issued = draft({
      documents: [{ id: "invoice" }],
      documentArchives: {
        invoice: { content: "ORIGINAL-PDF", sha256: "KEEP-CHECKSUM" },
      },
    }),
    reserved = draft({ lifecycle: { status: "reserved" } }),
    linked = draft({ customerAccess: { tokenHash: "keep" } }),
    oldOther = draft();
  const externalTerms = draft(), externalEvidence = draft();
  const protectedDrafts = [externalTerms, externalEvidence,
    draft({ draft: { creditEntries: [{ id: 'transfer', signedAmountPence: 10000 }] } }),
    draft({ draft: { returnCreditPence: 10000 } }),
    draft({ returnReplacement: { direction: 'returned' } }),
    draft({ returnReplacementHistory: [] }),
    draft({ returnInspection: { at: now.toISOString(), actor: 'Fixture', note: 'Keep inspection' } }),
    draft({ paymentRequests: [{ id: 'request-with-history' }] }),
  ];
  for (const [dealer, state] of [
    ["a", plain],
    ["a", paid],
    ["a", issued],
    ["a", reserved],
    ["a", linked],
    ["b", oldOther],
    ...protectedDrafts.map(state => ['a', state] as const),
  ] as const)
    await engine.query(
      "INSERT INTO sale_workspace(id,dealer_id,reference,revision,state,updated_at) VALUES($1,$2,$3,1,$4::jsonb,$5)",
      [
        state.id,
        dealer,
        state.reference,
        JSON.stringify(state),
        ago(100).toISOString(),
      ],
    );
  await engine.query("INSERT INTO sale_terms_documents(id,dealer_id,sale_id,request_id,request_hash,snapshot,dealer_pdf,both_pdf,created_by) VALUES($1,'a',$2,$3,'fixture-hash','{\"terms\":\"KEEP TERMS\"}'::jsonb,'DEALER-PDF','BOTH-PDF','Fixture')", [randomUUID(), externalTerms.id, randomUUID()]);
  await engine.query("INSERT INTO sale_delivery_evidence(id,dealer_id,sale_id,vehicle_id,request_id,create_hash,token_hash,context_hash,snapshot,created_at,created_by,expires_at) VALUES($1,'a',$2,$3,$4,'fixture-hash',$5,'context','{\"evidence\":\"KEEP EVIDENCE\"}'::jsonb,$6,'Fixture',$7)", [randomUUID(), externalEvidence.id, ids[2], randomUUID(), 'a'.repeat(64), ago(100).toISOString(), ago(99).toISOString()]);
  const presenceIds = Array.from({ length: 3 }, () => randomUUID());
  for (const [index, enquiryId] of presenceIds.entries()) {
    const dealer = index === 2 ? "b" : "a";
    const expires = index === 1 ? new Date(now.getTime() + 90_000) : ago(1);
    await engine.query(
      "INSERT INTO enquiries(id,dealer_id,type,customer_name,message) VALUES($1,$2,'general','Test customer','Test message')",
      [enquiryId, dealer],
    );
    await engine.query(
      "INSERT INTO staff_reply_presence(dealer_id,enquiry_id,staff_id,staff_name,session_id,expires_at) VALUES($1,$2,'staff','Test staff',$3,$4)",
      [dealer, enquiryId, randomUUID(), expires.toISOString()],
    );
  }
  const result = await runWithTenant(tenant("a"), () => retainDealerData(now));
  assert.equal(result.expiredReplyPresence, 1);
  const retainedPresence = await engine.query<{ enquiry_id: string }>(
    "SELECT enquiry_id FROM staff_reply_presence",
  );
  assert.deepEqual(retainedPresence.rows.map(row => row.enquiry_id).sort(), presenceIds.slice(1).sort());
  assert.equal(result.archivedCars, 2);
  assert.equal(result.abandonedDrafts, 1);
  const cars = (
    await engine.query<any>(
      "SELECT id,inventory_status,archived_at,raw_source_data,retirement_started_at FROM vehicles",
    )
  ).rows;
  assert.ok(cars.find((c) => c.id === ids[0]).archived_at);
  assert.equal(cars.find((c) => c.id === ids[0]).inventory_status, "sold");
  assert.ok(cars.find((c) => c.id === ids[1]).archived_at);
  for (const id of ids.slice(2))
    assert.equal(cars.find((c) => c.id === id).archived_at, null);
  assert.equal(
    cars.find((c) => c.id === ids[0]).raw_source_data.sourceExtras.description,
    "KEEP EXACT",
  );
  const sales = (await engine.query<any>("SELECT id,state FROM sale_workspace"))
    .rows;
  assert.equal(sales.length, 5 + protectedDrafts.length);
  for (const protectedDraft of protectedDrafts) assert.ok(sales.some(row => row.id === protectedDraft.id), 'Linked external documents and credit/return history must survive draft retention');
  assert.equal((await engine.query<any>("SELECT dealer_pdf FROM sale_terms_documents WHERE sale_id=$1", [externalTerms.id])).rows[0].dealer_pdf, 'DEALER-PDF');
  assert.equal((await engine.query<any>("SELECT snapshot FROM sale_delivery_evidence WHERE sale_id=$1", [externalEvidence.id])).rows[0].snapshot.evidence, 'KEEP EVIDENCE');
  assert.ok(!sales.some((s) => s.id === plain.id));
  assert.equal(
    sales.find((s) => s.id === issued.id).state.documentArchives.invoice
      .content,
    "ORIGINAL-PDF",
  );
  assert.equal(
    sales.find((s) => s.id === paid.id).state.payments[0].signedAmountPence,
    50000,
  );
  assert.ok(sales.some((s) => s.id === oldOther.id));
  const repeat = await runWithTenant(tenant("a"), () => retainDealerData(now));
  assert.equal(repeat.archivedCars, 0);
  assert.equal(repeat.abandonedDrafts, 0);
  await runWithTenant(tenant("a"), () =>
    retainDealerData(new Date(now.getTime() + 86400000)),
  );
  assert.ok(
    (
      await engine.query<any>("SELECT archived_at FROM vehicles WHERE id=$1", [
        ids[5],
      ])
    ).rows[0].archived_at,
  );
  await engine.close();
});
test("temporary cleanup removes only stale application-owned files and leaves current files and symlinks alone", async () => {
  const directory = await mkdtemp(join(tmpdir(), "luxxy-retention-test-"));
  const base = "a".repeat(24) + ".json." + randomUUID() + ".tmp";
  try {
    await writeFile(join(directory, base), "stale");
    await utimes(
      join(directory, base),
      new Date(now.getTime() - 172800000),
      new Date(now.getTime() - 172800000),
    );
    await writeFile(join(directory, "important.json"), "keep");
    const fresh = "b".repeat(24) + ".json." + randomUUID() + ".tmp";
    await writeFile(join(directory, fresh), "fresh");
    await symlink(
      join(directory, "important.json"),
      join(directory, "c".repeat(24) + ".json." + randomUUID() + ".tmp"),
    );
    assert.equal(await cleanupRetentionTemporaryFiles(now, directory), 1);
    assert.equal(
      await readFile(join(directory, "important.json"), "utf8"),
      "keep",
    );
    assert.equal(await readFile(join(directory, fresh), "utf8"), "fresh");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
