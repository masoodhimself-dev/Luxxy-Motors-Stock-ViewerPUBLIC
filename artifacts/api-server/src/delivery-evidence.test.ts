import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID, createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { engine, pool } from "./test/tenant-test-db";
import { runWithTenant } from "./lib/tenant-context";
import {
  PostgresDeliveryEvidence,
  deliverySubmissionInput,
  revokeChangedDeliveryEvidence,
  getDeliveryEvidenceReview,
} from "./lib/delivery-evidence";
import { deliveryDeclarationHtml } from "./lib/delivery-declaration";
import type { NormalisedWebsiteImage } from "./lib/website-asset-image";
import { PostgresSaleWorkspaceStore } from "./lib/sale-workspace-store";
import type { SaleWorkspaceFulfilment } from "@workspace/vehicle-meta";
process.env.MULTI_TENANT_ENABLED = "true";
const dealer = (id: string) => ({
  dealerId: id,
  canonicalOrigin: `https://${id}.example.test`,
  platform: "cazoo" as const,
  retailerId: id,
  sourceUrl: "https://www.cazoo.co.uk/fictional",
  kind: "website" as const,
});
const a = dealer("delivery-a"),
  b = dealer("delivery-b"),
  saleId = randomUUID(),
  vehicleId = randomUUID();
const within = <T>(fn: () => T, tenant = a) => runWithTenant(tenant, fn);
const image = async (data: string): Promise<NormalisedWebsiteImage> =>
  ({
    bytes: Buffer.from(data),
    mimeType: "image/jpeg",
    byteSize: data.length,
    width: 10,
    height: 10,
    digest: createHash("sha256").update(data).digest("hex"),
    requestHash: createHash("sha256").update(data).digest("hex"),
  }) as NormalisedWebsiteImage;
const service = new PostgresDeliveryEvidence(pool, image);
const state = {
  id: saleId,
  reference: "SALE-1001",
  revision: 3,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  documents: [],
  events: [],
  lifecycle: { status: "reserved" },
  payments: [
    {
      id: randomUUID(),
      amount: "500.00",
      amountPence: 50000,
      signedAmountPence: 50000,
      status: "confirmed",
      method: "Bank transfer",
      kind: "deposit",
      date: "2026-11-03",
      reference: "Deposit",
      recordedAt: new Date().toISOString(),
      recordedBy: "staff-a",
    },
  ],
  draft: {
    vehicleId,
    vehicle: "Example estate",
    registration: "AB20 XYZ",
    customer: "Example Customer",
    email: "NEVER-PUBLIC@example.invalid",
    phone: "02000000000",
    price: "9000",
    fulfilment: {
      method: "delivery",
      viewed: "viewed",
      recipient: "Example Recipient",
      address: "1 Example Street",
      scheduledDate: "2026-11-03",
      timeWindow: "Afternoon",
      driver: "Example Driver",
      instructions: "Call on arrival",
    },
  },
};
const creation = (token = "a".repeat(64)) => ({
  requestId: randomUUID(),
  token,
  expectedRevision: 3,
  expiresHours: 72,
});
const photo = (slot: string) => ({
  requestId: randomUUID(),
  phase: "arrival",
  slot,
  capturedAt: new Date().toISOString(),
  dataUrl: `pixels-${slot}`,
});
const report = () => ({
  requestId: randomUUID(),
  driverName: "Example Driver",
  recipientName: "Example Recipient",
  handoverAt: new Date().toISOString(),
  mileage: 42000,
  outcome: "delivered",
    notes: "Small mark on rear bumper noted. example driver phoned EXAMPLE RECIPIENT.",
  keys: 2,
  documentsProvided: true,
  acknowledged: true,
  location: {
    latitude: 51.5,
    longitude: -0.12,
    accuracy: 24,
    capturedAt: new Date().toISOString(),
  },
  locationReason: "",
});
test("delivery evidence has isolated capabilities, immutable reports, bounded photos and safe retries", async () => {
  for (const file of (await readdir("../../lib/db/drizzle"))
    .filter((f) => /^\d+.*\.sql$/.test(f))
    .sort())
    await engine.exec(
      await readFile(join("../../lib/db/drizzle", file), "utf8"),
    );
  for (const tenant of [a, b]) {
    await engine.query(
      "INSERT INTO dealerships(id,name,status,canonical_origin,stock_platform,retailer_id,source_url) VALUES($1,$1,'active',$2,'cazoo',$1,$3)",
      [tenant.dealerId, tenant.canonicalOrigin, tenant.sourceUrl],
    );
    await engine.query(
      "INSERT INTO dealer_settings(dealer_id,config) VALUES($1,$2::jsonb)",
      [
        tenant.dealerId,
        JSON.stringify({ identity: { name: "Example Dealership" } }),
      ],
    );
  }
  await engine.query(
    "INSERT INTO sale_workspace(id,dealer_id,reference,revision,state) VALUES($1,$2,$3,3,$4::jsonb)",
    [saleId, a.dealerId, state.reference, JSON.stringify(state)],
  );
  try {
    const body = creation(),
      created = await within(() => service.create(saleId, body, "staff-a"));
    assert.equal(created.replayed, false);
    assert.equal(
      created.url,
      `${a.canonicalOrigin}/delivery-evidence/${body.token}`,
    );
    const stored = (
      await engine.query<any>(
        "SELECT * FROM sale_delivery_evidence WHERE id=$1",
        [created.job.id],
      )
    ).rows[0];
    assert.equal(
      stored.token_hash,
      createHash("sha256").update(body.token).digest("hex"),
    );
    assert.ok(!JSON.stringify(stored).includes(body.token));
    await assert.rejects(
      engine.query(
        "INSERT INTO sale_delivery_evidence_photos(dealer_id,job_id,request_id,request_hash,phase,slot,captured_at,mime_type,byte_size,width,height,digest,bytes) VALUES($1,$2,$3,'hash','arrival','front',now(),'image/jpeg',1,1,1,'hash',decode('01','hex'))",
        [b.dealerId, created.job.id, randomUUID()],
      ),
      (error: unknown) =>
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === "23503",
      "The database must reject a photo attached across dealership boundaries",
    );
    assert.equal(
      (await within(() => service.create(saleId, body, "staff-a"))).replayed,
      true,
    );
    await assert.rejects(
      within(() =>
        service.create(saleId, { ...body, expiresHours: 48 }, "staff-a"),
      ),
      /different delivery details/,
    );
    await assert.rejects(
      within(
        () => service.create(saleId, creation("b".repeat(64)), "staff-b"),
        b,
      ),
      /not found/,
    );
    await assert.rejects(
      within(() => service.read(body.token), b),
      /not found/,
    );
    await assert.rejects(
      within(() =>
        service.create(
          saleId,
          { ...creation("c".repeat(64)), expectedRevision: 2 },
          "staff-a",
        ),
      ),
      /sale changed/,
    );
    const publicView = await within(() => service.read(body.token));
    assert.equal(publicView.snapshot.registration, "AB20 XYZ");
    assert.doesNotMatch(
      JSON.stringify(publicView),
      /NEVER-PUBLIC|price|payments|token_hash|create_hash|bytes|dataUrl/,
    );
    await assert.rejects(
      within(() => service.submit(body.token, report())),
      /five arrival photos/,
    );
    const front = photo("front"),
      first = await within(() => service.photo(body.token, front));
    assert.equal(first.saved, true);
    assert.equal(
      (await within(() => service.photo(body.token, front))).replayed,
      true,
    );
    await assert.rejects(
      within(() =>
        service.photo(body.token, { ...front, dataUrl: "changed-image" }),
      ),
      /different image/,
    );
    for (const slot of ["rear", "left", "right", "dashboard"])
      await within(() => service.photo(body.token, photo(slot)));
    const savedPhoto = await within(() =>
      service.staffPhoto(saleId, created.job.id, first.id),
    );
    assert.equal(savedPhoto.bytes.toString(), "pixels-front");
    await assert.rejects(
      within(() => service.staffPhoto(saleId, created.job.id, first.id), b),
      /not found/,
    );
    assert.equal(
      deliverySubmissionInput.safeParse({
        ...report(),
        location: null,
        locationReason: "",
      }).success,
      false,
    );
    assert.equal(
      deliverySubmissionInput.safeParse({ ...report(), acknowledged: false })
        .success,
      false,
    );
    const final = report(),
      result = await within(() => service.submit(body.token, final));
    assert.equal(result.received, true);
    assert.equal(
      (await within(() => service.submit(body.token, final))).replayed,
      true,
    );
    await assert.rejects(
      within(() => service.submit(body.token, { ...final, mileage: 45000 })),
      /cannot be changed/,
    );
    assert.equal(
      (await within(() => service.photo(body.token, front))).replayed,
      true,
    );
    await assert.rejects(
      within(() => service.photo(body.token, photo("damage"))),
      /cannot be changed/,
    );
    const history = await within(() => service.list(saleId));
    assert.equal(history.jobs[0].photos.length, 5);
    assert.equal(history.jobs[0].submission.driverName, "Example Driver");
    assert.equal(history.jobs[0].submission.location.accuracy, 24);
    const reviewBefore = await getDeliveryEvidenceReview(pool, {
      dealerId: a.dealerId,
      saleId,
    });
    assert.equal(reviewBefore.summary[0].outcome, "delivered");
    assert.equal(reviewBefore.summary[0].arrivalPhotoCount, 5);
    assert.equal(reviewBefore.summary[0].accuracyMetres, 24);
    assert.equal(reviewBefore.summary[0].acknowledged, true);
    assert.doesNotMatch(
      JSON.stringify(reviewBefore),
      /51\.5|-0\.12|Example (Driver|Recipient|Customer)|NEVER-PUBLIC|02000000000|Example Street/i,
    );
    assert.equal(
      (await getDeliveryEvidenceReview(pool, { dealerId: b.dealerId, saleId }))
        .summary.length,
      0,
    );
    assert.equal(
      (await within(() => service.vehicleSales(vehicleId))).sales[0].saleId,
      saleId,
    );
    assert.deepEqual(
      (await within(() => service.vehicleSales(vehicleId), b)).sales,
      [],
    );
    const unchanged = (
      await engine.query<any>("SELECT state FROM sale_workspace WHERE id=$1", [
        saleId,
      ])
    ).rows[0].state;
    assert.deepEqual(
      unchanged,
      state,
      "Evidence never mutates payments, price or handover",
    );
    const html = deliveryDeclarationHtml(
      { ...publicView.snapshot, customer: "<script>bad()</script>" },
      new Date().toISOString(),
    );
    assert.ok(html.includes("&lt;script&gt;"));
    assert.ok(!html.includes("<script>bad"));
    assert.match(html, /@page\{size:A4/);
    assert.match(html, /does not confirm payment/);
    await engine.query(
      "UPDATE sale_delivery_evidence SET created_at=now()-interval '4 days',expires_at=now()-interval '1 day' WHERE id=$1",
      [created.job.id],
    );
    await assert.rejects(
      within(() => service.read(body.token)),
      /expired/,
    );
    assert.equal(
      (await within(() => service.list(saleId))).jobs[0].status,
      "received",
      "Historical evidence survives access expiry",
    );
    const second = creation("b".repeat(64)),
      job2 = await within(() => service.create(saleId, second, "staff-a"));
    await within(() => service.revoke(saleId, job2.job.id, "staff-a"));
    await assert.rejects(
      within(() => service.photo(second.token, photo("front"))),
      /withdrawn/,
    );
    const third = creation("c".repeat(64)),
      job3 = await within(() => service.create(saleId, third, "staff-a"));
    await engine.query(
      "UPDATE sale_workspace SET state=jsonb_set(state,'{draft,fulfilment,address}','\"Changed address\"') WHERE id=$1",
      [saleId],
    );
    await assert.rejects(
      within(() => service.read(third.token)),
      /arrangements changed/,
    );
    assert.equal(
      (await within(() => service.list(saleId))).jobs.find(
        (j) => j.id === job3.job.id,
      )?.status,
      "superseded",
    );
    await engine.query(
      "UPDATE sale_workspace SET state=$2::jsonb WHERE id=$1",
      [saleId, JSON.stringify(state)],
    );
    const fourth = creation("d".repeat(64)),
      job4 = await within(() => service.create(saleId, fourth, "staff-a"));
    await engine.query(
      "UPDATE sale_delivery_evidence SET created_at=now()-interval '4 days',expires_at=now()-interval '1 day' WHERE id=$1",
      [job4.job.id],
    );
    const paper = {
      requestId: randomUUID(),
      dataUrl: "signed-paper",
      driverName: "Paper Driver",
      recipientName: "Paper Recipient",
      handoverAt: new Date().toISOString(),
      mileage: 42000,
      keys: 2,
      documentsProvided: true,
      notes: "Signed copy checked",
      acknowledged: true,
      outcome: "delivered",
    };
    assert.equal(
      (await within(() => service.paper(saleId, job4.job.id, paper, "staff-a")))
        .received,
      true,
    );
    assert.equal(
      (await within(() => service.paper(saleId, job4.job.id, paper, "staff-a")))
        .replayed,
      true,
    );
    const paperHistory = (await within(() => service.list(saleId))).jobs.find(
      (j) => j.id === job4.job.id,
    )!;
    assert.equal(paperHistory.submission.source, "paper");
    assert.equal(paperHistory.photos[0].slot, "declaration");
    assert.equal(paperHistory.submission.location, null);
    const finalLink = creation("e".repeat(64));
    const finalJob = await within(() =>
      service.create(saleId, finalLink, "staff-a"),
    );
    await engine.query(
      "UPDATE sale_workspace SET state=jsonb_set(state,'{returnReplacement}','{\"direction\":\"returned\"}'::jsonb) WHERE id=$1",
      [saleId],
    );
    await assert.rejects(
      within(() => service.read(finalLink.token)),
      /arrangements changed/,
    );
    const returnedHistory = await within(() => service.list(saleId));
    assert.equal(
      returnedHistory.jobs.find((j) => j.id === finalJob.job.id)?.status,
      "superseded",
    );
    assert.equal(
      returnedHistory.jobs.find((j) => j.id === job4.job.id)?.status,
      "received",
      "Return closes access but keeps historical evidence available to staff",
    );
    await engine.query(
      "UPDATE sale_workspace SET state=$2::jsonb WHERE id=$1",
      [saleId, JSON.stringify(state)],
    );
    const permanent = creation("f".repeat(64));
    await within(() => service.create(saleId, permanent, "staff-a"));
    const changed = structuredClone(state);
    changed.draft.fulfilment.address = "Another delivery address";
    const client = await pool.connect();
    await client.query("BEGIN");
    await revokeChangedDeliveryEvidence(client, {
      dealerId: a.dealerId,
      saleId,
      before: state,
      after: changed,
      actor: "staff-a",
    });
    await client.query(
      "UPDATE sale_workspace SET state=$2::jsonb WHERE id=$1",
      [saleId, JSON.stringify(changed)],
    );
    await client.query("COMMIT");
    await client.query("BEGIN");
    await revokeChangedDeliveryEvidence(client, {
      dealerId: a.dealerId,
      saleId,
      before: changed,
      after: state,
      actor: "staff-a",
    });
    await client.query(
      "UPDATE sale_workspace SET state=$2::jsonb WHERE id=$1",
      [saleId, JSON.stringify(state)],
    );
    await client.query("COMMIT");
    await assert.rejects(
      within(() => service.read(permanent.token)),
      /withdrawn/,
      "Reverting an arrangement must never re-enable the old driver link",
    );
    const rollback = creation("0".repeat(64));
    await within(() => service.create(saleId, rollback, "staff-a"));
    await client.query("BEGIN");
    await revokeChangedDeliveryEvidence(client, {
      dealerId: a.dealerId,
      saleId,
      before: state,
      after: changed,
      actor: "staff-a",
    });
    await client.query("ROLLBACK");
    assert.equal(
      (await within(() => service.read(rollback.token))).status,
      "open",
      "A failed sale save must not withdraw the current job",
    );
    const paymentOnly = structuredClone(state);
    paymentOnly.payments.push({
      ...state.payments[0],
      id: randomUUID(),
      amount: "100.00",
      amountPence: 10000,
      signedAmountPence: 10000,
    });
    await revokeChangedDeliveryEvidence(client, {
      dealerId: a.dealerId,
      saleId,
      before: state,
      after: paymentOnly,
      actor: "staff-a",
    });
    assert.equal(
      (await within(() => service.read(rollback.token))).status,
      "open",
      "Payment updates do not invalidate the delivery assignment",
    );
    for (const closed of [
      { ...state, lifecycle: { status: "released" } },
      { ...state, lifecycle: { status: "cancelled" } },
      { ...state, returnReplacement: { direction: "returned" } },
      {
        ...state,
        draft: {
          ...state.draft,
          fulfilment: { ...state.draft.fulfilment, method: "collection" },
        },
      },
    ]) {
      await client.query(
        "UPDATE sale_workspace SET state=$2::jsonb WHERE id=$1",
        [saleId, JSON.stringify(closed)],
      );
      await assert.rejects(
        within(() => service.read(rollback.token)),
        /arrangements changed/,
      );
    }
    await client.query(
      "UPDATE sale_workspace SET state=$2::jsonb WHERE id=$1",
      [saleId, JSON.stringify(state)],
    );
    const reviewAfter = await getDeliveryEvidenceReview(client, {
      dealerId: a.dealerId,
      saleId,
    });
    assert.notEqual(
      reviewBefore.hash,
      reviewAfter.hash,
      "New jobs and reports invalidate a previous final review even without a sale revision edit",
    );
    const beforeImmutable = (
      await within(() => service.list(saleId))
    ).jobs.find((j) => j.id === created.job.id);
    await revokeChangedDeliveryEvidence(client, {
      dealerId: a.dealerId,
      saleId,
      before: state,
      after: changed,
      actor: "staff-a",
    });
    const afterImmutable = (await within(() => service.list(saleId))).jobs.find(
      (j) => j.id === created.job.id,
    );
    assert.deepEqual(
      afterImmutable,
      beforeImmutable,
      "Previously received evidence remains immutable on a job change",
    );
    client.release();
    const integrated = creation("1".repeat(64));
    await within(() => service.create(saleId, integrated, "staff-a"));
    const store = new PostgresSaleWorkspaceStore(
      a.dealerId,
      async () => ({
        branding: {
          identity: {
            name: "Example Dealership",
            logoAsset: "",
            logoText: "EXAMPLE",
          },
          contact: { phone: "", email: "" },
          address: { street: "", city: "", region: "", postcode: "" },
          legal: { companyName: "", companyNumber: "", vatNumber: "" },
        },
      }),
      pool,
    );
    const saved = await within(() =>
      store.mutate({
        id: saleId,
        expectedRevision: 3,
        requestId: randomUUID(),
        actor: "staff-a",
        command: {
          action: "fulfilment",
          fulfilment: {
            ...state.draft.fulfilment,
            address: "Changed by actual sale save",
          } as SaleWorkspaceFulfilment,
        },
      }),
    );
    await within(() =>
      store.mutate({
        id: saleId,
        expectedRevision: saved.sale.revision,
        requestId: randomUUID(),
        actor: "staff-a",
        command: {
          action: "fulfilment",
          fulfilment: state.draft.fulfilment as SaleWorkspaceFulfilment,
        },
      }),
    );
    await assert.rejects(
      within(() => service.read(integrated.token)),
      /withdrawn/,
      "The actual sale persistence transaction permanently withdraws changed driver jobs",
    );
  } finally {
    await engine.close();
  }
});
