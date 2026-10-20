import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { Router, type Request, type Response } from "express";
import { eq } from "drizzle-orm";
import {
  engine,
  db,
  dealershipsTable,
  vehiclesTable,
} from "./test/tenant-test-db";
import { projectVehicles } from "./routes/stock";
import { runWithTenant } from "./lib/tenant-context";
import { createVehicleDescriptionsRouter } from "./routes/vehicle-descriptions";
import {
  descriptionFacts,
  descriptionFactsHash,
  descriptionDisclosures,
  descriptionView,
  descriptionRequest,
  generateVehicleDescription,
  publishedDescription,
} from "./lib/vehicle-descriptions";
const sample = {
  title: "Ford Focus",
  year: 2015,
  mileage: 74200,
  fuel: "Petrol",
  transmission: "Manual",
  writeOffCategory: "S",
  rawSourceData: {
    sourceExtras: {
      advertDescription:
        "Air conditioning and Bluetooth. Category S repaired after accident. No service history. Engine warning light is on.",
      featureList: ["Bluetooth", "Air conditioning", "ISOFIX"],
    },
  },
};
const copy =
  "This Ford Focus has a petrol engine and a manual gearbox. Air conditioning, Bluetooth and ISOFIX child-seat mounting points are included.";
test("records only approved facts, preserves every original and makes disclosures prominent", () => {
  assert.ok(
    !JSON.stringify(
      descriptionFacts({
        ...sample,
        dealerId: "private",
        customerName: "private",
      }),
    ).includes("private"),
  );
  const notes = descriptionDisclosures(sample);
  for (const phrase of [
    "Category S repaired after accident.",
    "No service history.",
    "Engine warning light is on.",
    "Recorded write-off category: S.",
  ])
    assert.ok(notes.includes(phrase));
  assert.equal(
    publishedDescription(publishedDescription(copy, sample), sample),
    publishedDescription(copy, sample),
  );
  assert.notEqual(
    descriptionFactsHash(sample),
    descriptionFactsHash({ ...sample, mileage: 80000 }),
  );
  assert.equal(descriptionView(sample).originals.length, 1);
});
test("provider bounds requests, disables tools/storage and rejects unsupported or incomplete output", async () => {
  const request = descriptionRequest(sample);
  assert.equal(request.store, false);
  assert.deepEqual(request.tools, []);
  assert.match(request.instructions, /untrusted/);
  let calls = 0;
  const run = (description: string, status = "completed") =>
    generateVehicleDescription(sample, async (_url, options) => {
      calls++;
      assert.equal(options?.redirect, "error");
      return new Response(
        JSON.stringify({
          status,
          output: [
            {
              type: "message",
              content: [
                { type: "output_text", text: JSON.stringify({ description }) },
              ],
            },
          ],
        }),
      );
    });
  assert.equal(await run(copy), copy);
  for (const bad of [
    "Immaculate, guaranteed car with full service history.",
    "<script>This car is perfect.</script>",
    "This car comes with a warranty.",
    "This car costs £4000.",
  ])
    await assert.rejects(run(bad));
  await assert.rejects(run(copy, "incomplete"));
  await assert.rejects(
    generateVehicleDescription(
      sample,
      async () => new Response("private provider error", { status: 401 }),
    ),
    /unavailable/,
  );
  await assert.rejects(
    generateVehicleDescription(
      sample,
      async () => new Response("x".repeat(25_000)),
    ),
    /too large/,
  );
  assert.equal(calls, 6);
});
test("tenant-scoped generation, replay, stale facts, protected publishing, restore and quotas", async (t) => {
  for (const file of (await readdir("../../lib/db/drizzle"))
    .filter((file) => /^\d.*\.sql$/.test(file))
    .sort())
    await engine.exec(await readFile("../../lib/db/drizzle/" + file, "utf8"));
  process.env.MULTI_TENANT_ENABLED = "true";
  process.env.OPENAI_API_KEY = "fictional-only";
  process.env.AI_DRAFTS_DEALER_IDS = "a";
  for (const id of ["a", "b"])
    await db
      .insert(dealershipsTable)
      .values({
        id,
        name: id,
        status: "active",
        canonicalOrigin: `https://${id}.example.test`,
        stockPlatform: "autotrader",
        retailerId: id,
        sourceUrl: "https://www.autotrader.co.uk/example",
      });
  const id = randomUUID();
  await db
    .insert(vehiclesTable)
    .values({
      ...sample,
      id,
      dealerId: "a",
      source: "autotrader",
      advertId: "fictional",
    });
  let calls = 0,
    fail = false;
  let hold: Promise<void> | undefined;
  let started: (() => void) | undefined;
  const router = Router();
  router.use(
    createVehicleDescriptionsRouter(async () => {
      calls++;
      started?.();
      if (hold) await hold;
      if (fail) throw new Error("private-provider-body");
      return copy;
    }),
  );
  const invoke = (
    method: string,
    path = "",
    body?: unknown,
    dealer = "a",
    role = "owner",
    origin?: string,
  ) =>
    runWithTenant(
      {
        dealerId: dealer,
        canonicalOrigin: `https://${dealer}.example.test`,
        platform: "autotrader",
        retailerId: dealer,
        sourceUrl: "https://www.autotrader.co.uk/example",
        kind: "website",
      },
      () =>
        new Promise<{ status: number; data: any }>((resolve, reject) => {
          let status = 200;
          const req = {
            method,
            url: `/staff/vehicle-descriptions/${id}${path}`,
            body,
            get: (key: string) =>
              key === "origin"
                ? (origin ?? `https://${dealer}.example.test`)
                : undefined,
            staff: {
              authUserId: "fictional-staff",
              role,
              permissions: role === "owner" ? ["sales.manage"] : [],
            },
          } as unknown as Request;
          const res = {
            status(value: number) {
              status = value;
              return this;
            },
            set() {
              return this;
            },
            json(data: unknown) {
              resolve({ status, data });
              return this;
            },
          } as unknown as Response;
          router(req, res, (error) => reject(error || new Error("No route")));
        }),
    );
  let current = (await invoke("GET")).data;
  await t.test(
    "denies wrong role, cross-tenant lookup and forged origins",
    async () => {
      assert.equal(
        (await invoke("GET", "", undefined, "a", "accounts")).status,
        403,
      );
      assert.equal((await invoke("GET", "", undefined, "b")).status, 404);
      assert.equal(
        (
          await invoke(
            "POST",
            "/generate",
            {},
            "a",
            "owner",
            "https://evil.test",
          )
        ).status,
        403,
      );
      assert.equal(calls, 0);
    },
  );
  await t.test(
    "generates once, leaves website unchanged and requires explicit review",
    async () => {
      const input = {
        requestId: randomUUID(),
        expectedVersion: current.version,
      };
      const generated = await invoke("POST", "/generate", input);
      assert.equal(generated.status, 200);
      current = generated.data;
      assert.equal(current.current, "");
      assert.equal(current.draft, copy);
      assert.equal((await invoke("POST", "/generate", input)).status, 200);
      assert.equal(calls, 1);
      assert.equal(
        (
          await invoke("PUT", "", {
            action: "publish",
            expectedVersion: current.version,
            description: copy,
          })
        ).status,
        400,
      );
      assert.equal(
        (
          await invoke("POST", "/generate", {
            requestId: randomUUID(),
            expectedVersion: current.version,
          })
        ).status,
        429,
      );
    },
  );
  await t.test(
    "rejects stale facts, protects disclosures, publishes edited draft and restores",
    async () => {
      await db
        .update(vehiclesTable)
        .set({ mileage: 76000 })
        .where(eq(vehiclesTable.id, id));
      assert.equal(
        (
          await invoke("PUT", "", {
            action: "publish",
            expectedVersion: current.version,
            description: copy,
            reviewed: true,
          })
        ).status,
        409,
      );
      current = (await invoke("GET")).data;
      assert.equal(current.draftStale, true);
      assert.equal(
        (
          await invoke("PUT", "", {
            action: "publish",
            expectedVersion: current.version,
            description: copy,
            reviewed: true,
          })
        ).status,
        409,
      );
      current = (
        await invoke("PUT", "", {
          action: "save-draft",
          expectedVersion: current.version,
          description: copy,
        })
      ).data;
      const result = await invoke("PUT", "", {
        action: "publish",
        expectedVersion: current.version,
        description: copy,
        reviewed: true,
      });
      assert.equal(result.status, 200);
      current = result.data;
      const [row] = await db
        .select()
        .from(vehiclesTable)
        .where(eq(vehiclesTable.id, id));
      const [publicCar] = await projectVehicles([row!]);
      assert.equal(
        (publicCar!.specifications as Record<string, unknown>)?.description,
        current.current,
      );
      assert.equal(publicCar!.sourceExtras?.description, current.current);
      assert.deepEqual(
        publicCar!.sourceExtras?.originalAdvertDescriptions,
        current.originals,
      );
      assert.match(current.current, /Category S repaired after accident/);
      assert.match(current.current, /No service history/);
      assert.match(current.current, /warning light/);
      assert.equal(current.originals.length, 1);
      const restored = await invoke("PUT", "", {
        action: "restore",
        expectedVersion: current.version,
      });
      assert.equal(restored.status, 200);
      current = restored.data;
      assert.equal(current.current, "");
      assert.equal(current.originals.length, 1);
    },
  );
  await t.test(
    "provider failure publishes nothing, leaks no body and consumes quota",
    async () => {
      fail = true;
      const result = await invoke("POST", "/generate", {
        requestId: randomUUID(),
        expectedVersion: current.version,
      });
      assert.equal(result.status, 424);
      assert.ok(!JSON.stringify(result).includes("private-provider"));
      current = (await invoke("GET")).data;
      assert.equal(current.current, "");
      assert.equal(current.generationStatus, "failed");
      const [car] = await db
        .select()
        .from(vehiclesTable)
        .where(eq(vehiclesTable.id, id));
      await db
        .update(vehiclesTable)
        .set({
          auditMetadata: {
            ...car!.auditMetadata,
            vehicleDescription: {
              attempts: {
                day: new Date().toISOString().slice(0, 10),
                count: 30,
              },
            },
          },
        })
        .where(eq(vehiclesTable.id, id));
      current = (await invoke("GET")).data;
      assert.equal(
        (
          await invoke("POST", "/generate", {
            requestId: randomUUID(),
            expectedVersion: current.version,
          })
        ).status,
        429,
      );
    },
  );
  await t.test(
    "preserves a pre-existing website description and restores that exact original",
    async () => {
      const original =
        "Our original staff-written description. Recorded repair history must be retained.";
      await db
        .update(vehiclesTable)
        .set({ websiteDescription: original, auditMetadata: {} })
        .where(eq(vehiclesTable.id, id));
      current = (await invoke("GET")).data;
      assert.ok(current.originals.includes(original));
      current = (
        await invoke("PUT", "", {
          action: "save-draft",
          expectedVersion: current.version,
          description: copy,
        })
      ).data;
      current = (
        await invoke("PUT", "", {
          action: "publish",
          expectedVersion: current.version,
          description: copy,
          reviewed: true,
        })
      ).data;
      assert.ok(current.originals.includes(original));
      current = (
        await invoke("PUT", "", {
          action: "restore",
          expectedVersion: current.version,
        })
      ).data;
      assert.equal(current.current, original);
    },
  );
  await t.test(
    "concurrent generation admission performs only one provider call and can recover an interrupted request",
    async () => {
      await db
        .update(vehiclesTable)
        .set({ websiteDescription: null, auditMetadata: {} })
        .where(eq(vehiclesTable.id, id));
      current = (await invoke("GET")).data;
      fail = false;
      let release!: () => void;
      hold = new Promise<void>((resolve) => {
        release = resolve;
      });
      const hasStarted = new Promise<void>((resolve) => {
        started = resolve;
      });
      const before = calls,
        input = { requestId: randomUUID(), expectedVersion: current.version };
      const first = invoke("POST", "/generate", input);
      await hasStarted;
      const pending = await invoke("POST", "/generate", input);
      assert.equal(pending.status, 200);
      assert.equal(pending.data.generationStatus, "generating");
      const duplicate = await invoke("POST", "/generate", {
        requestId: randomUUID(),
        expectedVersion: pending.data.version,
      });
      assert.equal(duplicate.status, 409);
      release();
      assert.equal((await first).status, 200);
      assert.equal(calls, before + 1);
      hold = undefined;
      started = undefined;
      await db
        .update(vehiclesTable)
        .set({
          auditMetadata: {
            vehicleDescription: {
              draft: {
                requestId: randomUUID(),
                status: "generating",
                factsHash: "",
                startedAt: new Date(Date.now() - 180_000).toISOString(),
              },
            },
          },
        })
        .where(eq(vehiclesTable.id, id));
      current = (await invoke("GET")).data;
      const manualRecovery = await invoke("PUT", "", {
        action: "save-draft",
        expectedVersion: current.version,
        description: copy,
      });
      assert.equal(manualRecovery.status, 200);
      assert.equal(manualRecovery.data.current, "");
      assert.equal(manualRecovery.data.draft, copy);
    },
  );
  await engine.close();
});
