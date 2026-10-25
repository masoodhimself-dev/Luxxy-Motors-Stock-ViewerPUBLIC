import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import { createServer, request } from "node:http";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import {
  db,
  engine,
  dealershipsTable,
  vehiclesTable,
  enquiriesTable,
  leadsTable,
  stockChangeTasksTable,
  stockChangeCustomerOutcomesTable,
  saleWorkspaceTable,
  vehicleChangesTable,
} from "./test/tenant-test-db";
import { runWithTenant } from "./lib/tenant-context";
import stock from "./routes/stock";
import taskRouter from "./routes/stock-change-tasks";
import operations from "./routes/dealer-operations";
import {
  publicPriceReductions,
  readStockChangeTasks,
  recordStockChangeContact,
} from "./lib/stock-change-tasks";

process.env.MULTI_TENANT_ENABLED = "false";
process.env.STOCK_IMPORT_SECRET = "fictional-stock-change-secret";
process.env.STOCK_MAX_DROP_PERCENT = "100";
process.env.STOCK_MAX_PRICE_CHANGE_PERCENT = "50";
process.env.STOCK_MISSING_HIDE_THRESHOLD = "2";
const dealerA = "stock-task-fictional-a",
  dealerB = "stock-task-fictional-b";
let sequence = 0;
let activePlatform: "autotrader" | "cazoo" = "autotrader";
const car = (
  advertId = "test-advert",
  price = 10000,
  extra: Record<string, unknown> = {},
) => ({
  advertId,
  title: "Fictional Toyota Yaris",
  variant: "Test",
  make: "Toyota",
  model: "Yaris",
  trim: null,
  year: 2022,
  price,
  priceType: "Retail",
  currency: "GBP",
  mileage: 10000,
  mileageText: "10,000 miles",
  registration: "2022 (22 reg)",
  registrationBand: "22",
  plate: "AB22CDE",
  vrm: "AB22CDE",
  vrmVerified: false,
  fuel: "Petrol",
  transmission: "Automatic",
  bodyType: "Hatchback",
  engineSize: "1.0L",
  engineCC: 1000,
  doors: 5,
  seats: 5,
  colour: "Blue",
  emissionClass: "Euro 6",
  drivetrain: null,
  owners: 1,
  writeOffCategory: null,
  advertUrl: "https://www.autotrader.co.uk/car-details/fictional-test",
  dealerName: "Fictional dealer",
  dealerLocation: "Fictional showroom",
  imageCount: 1,
  heroImage: "https://images.example.test/car.jpg",
  images: [{ url: "https://images.example.test/car.jpg", caption: "front" }],
  specifications: {},
  sourceExtras: { sourcePlatform: "autotrader" },
  ...extra,
});
const snapshot = (
  cars: Record<string, unknown>[],
  extra: Record<string, unknown> = {},
) => ({
  schemaVersion: 1,
  runId: randomUUID(),
  source: "autotrader",
  retailerId: "fictional-retailer",
  dealerName: "Fictional dealer",
  scrapedAt: new Date(Date.now() + sequence++).toISOString(),
  complete: true,
  expectedAdvertCount: cars.length,
  count: cars.length,
  failedAdvertIds: [],
  errors: [],
  cars,
  ...extra,
});

test("durable stock tasks, public reductions and safe staff review use fictional data only", async (t) => {
  for (const file of (await readdir("../../lib/db/drizzle"))
    .filter((f) => /^\d.*\.sql$/.test(f))
    .sort()) {
    if (process.env.DEBUG_STOCK_TASK_TEST)
      process.stderr.write(`MIGRATE ${file}\n`);
    await engine.exec(await readFile(`../../lib/db/drizzle/${file}`, "utf8"));
  }
  if (process.env.DEBUG_STOCK_TASK_TEST)
    process.stderr.write("MIGRATIONS COMPLETE\n");
  const privateDir = await mkdtemp(join(tmpdir(), "luxxy-stock-tasks-"));
  process.env.INTEGRATIONS_PRIVATE_DIR = privateDir;
  for (const id of [dealerA, dealerB])
    await db.insert(dealershipsTable).values({
      id,
      name: "Fictional stock task dealer",
      status: "active",
      canonicalOrigin: `https://${id}.example.test`,
      stockPlatform: "autotrader",
      retailerId: "fictional-retailer",
      sourceUrl:
        "https://www.autotrader.co.uk/cars/retailer/stock?retailerId=fictional-retailer",
    });
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.log = {
      error: (...args: unknown[]) => {
        if (process.env.DEBUG_STOCK_TASK_TEST) console.error(...args);
      },
      warn() {},
      info() {},
      debug() {},
    } as any;
    const role = req.get("x-test-role");
    if (role === "owner" || role === "accounts" || role === "salesperson")
      req.staff = {
        authUserId: "fictional-staff",
        name: "Fictional Staff",
        email: null,
        role,
      };
    const id = req.get("x-test-dealer") || dealerA;
    runWithTenant(
      {
        dealerId: id,
        canonicalOrigin: `https://${id}.example.test`,
        platform: activePlatform,
        retailerId: "fictional-retailer",
        sourceUrl:
          "https://www.autotrader.co.uk/cars/retailer/stock?retailerId=fictional-retailer",
      },
      next,
    );
  });
  app.use("/api", taskRouter, operations, stock);
  const server = createServer(app);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const port = (server.address() as { port: number }).port;
  let outbound = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    outbound++;
    throw new Error("No external services are permitted in stock-task tests.");
  };
  const call = (
    method: string,
    path: string,
    body?: unknown,
    role = "owner",
    dealer = dealerA,
  ) =>
    new Promise<{ status: number; data: any }>((resolve, reject) => {
      const req = request(
        {
          host: "127.0.0.1",
          port,
          method,
          path: `/api${path}`,
          headers: {
            "Content-Type": "application/json",
            "X-Stock-Import-Secret": process.env.STOCK_IMPORT_SECRET!,
            "X-Test-Dealer": dealer,
            ...(role ? { "X-Test-Role": role } : {}),
          },
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on("data", (c) => chunks.push(c));
          res.on("end", () => {
            const raw = Buffer.concat(chunks).toString();
            try {
              resolve({ status: res.statusCode!, data: JSON.parse(raw) });
            } catch {
              reject(new Error(raw));
            }
          });
        },
      );
      req.on("error", reject);
      req.end(body === undefined ? undefined : JSON.stringify(body));
    });
  const importCars = (
    cars: Record<string, unknown>[],
    extra: Record<string, unknown> = {},
  ) => call("POST", "/stock/imports/autotrader", snapshot(cars, extra));
  const list = () => call("GET", "/staff/stock-change-tasks");
  const vehicle = async () =>
    (
      await db
        .select()
        .from(vehiclesTable)
        .where(eq(vehiclesTable.dealerId, dealerA))
    )[0]!;
  const reset = async () => {
    activePlatform = "autotrader";
    await engine.exec(
      "TRUNCATE stock_change_settings,stock_change_tasks,vehicle_changes,vehicle_images,vehicles,stock_import_runs,enquiries,leads,sale_workspace CASCADE",
    );
  };
  try {
    await t.test(
      "first import does not create a reduction/task; forged source price hints are removed",
      async () => {
        await reset();
        const result = await importCars([
          car("test-advert", 10000, {
            sourceExtras: {
              sourcePlatform: "autotrader",
              websitePriceReduction: {
                previousPrice: 50000,
                currentPrice: 10000,
                detectedAt: new Date().toISOString(),
              },
            },
          }),
        ]);
        assert.equal(result.status, 201, JSON.stringify(result.data));
        assert.deepEqual((await list()).data.tasks, []);
        const publicStock = await call("GET", "/stock");
        assert.equal(publicStock.status, 200);
        assert.equal(
          publicStock.data.cars[0].sourceExtras.websitePriceReduction,
          undefined,
        );
      },
    );
    await t.test(
      "genuine source drop is transactional, retry-idempotent and exposes a real 14-day badge",
      async () => {
        const payload = snapshot([car("test-advert", 9500)]);
        assert.equal(
          (await call("POST", "/stock/imports/autotrader", payload)).status,
          201,
        );
        const tasks = (await list()).data.tasks;
        assert.equal(tasks.length, 1);
        assert.equal(tasks[0].kind, "price_drop");
        assert.equal(tasks[0].previousPrice, 10000);
        assert.equal(tasks[0].currentPrice, 9500);
        assert.equal(tasks[0].reduction, 500);
        assert.equal(tasks[0].revision, 0);
        assert.equal(tasks[0].availableForPriceUpdate, true);
        assert.equal(
          (await call("POST", "/stock/imports/autotrader", payload)).data
            .status,
          "replayed",
        );
        assert.equal((await list()).data.tasks.length, 1);
        const badge = (await call("GET", "/stock")).data.cars[0].sourceExtras
          .websitePriceReduction;
        assert.equal(badge.previousPrice, 10000);
        assert.equal(badge.currentPrice, 9500);
        assert.equal(
          new Date(badge.expiresAt).getTime() -
            new Date(badge.detectedAt).getTime(),
          14 * 86400000,
        );
        assert.equal(
          (
            await publicPriceReductions(
              [await vehicle()],
              new Date(Date.now() + 15 * 86400000),
            )
          ).size,
          0,
        );
      },
    );
    await t.test(
      "unchanged runs do not duplicate tasks; held suspicious prices never create a false reduction",
      async () => {
        assert.equal(
          (await importCars([car("test-advert", 9500)])).status,
          201,
        );
        assert.equal((await list()).data.tasks.length, 1);
        assert.equal(
          (await importCars([car("test-advert", 1000)])).status,
          201,
        );
        const v = await vehicle();
        assert.equal(v.sourcePrice, 9500);
        assert.equal(v.pendingSourcePrice, 1000);
        assert.equal((await list()).data.tasks.length, 1);
        assert.equal((await call("GET", "/stock")).data.cars[0].price, 9500);
      },
    );
    await t.test(
      "an override masks source drops; manual effective drop/clearing override creates only genuine reductions",
      async () => {
        const id = (await vehicle()).id;
        assert.equal(
          (await call("PATCH", `/staff/vehicles/${id}/price`, { price: 11000 }))
            .status,
          200,
        );
        assert.equal((await list()).data.tasks.length, 0);
        assert.equal(
          (await importCars([car("test-advert", 9000)])).status,
          201,
        );
        assert.equal((await list()).data.tasks.length, 0);
        assert.equal(
          (await call("GET", "/stock")).data.cars[0].sourceExtras
            .websitePriceReduction,
          undefined,
        );
        assert.equal(
          (await call("PATCH", `/staff/vehicles/${id}/price`, { price: 10500 }))
            .status,
          200,
        );
        let tasks = (await list()).data.tasks;
        assert.equal(tasks.length, 1);
        assert.equal(tasks[0].previousPrice, 11000);
        assert.equal(tasks[0].currentPrice, 10500);
        assert.equal(
          (await call("PATCH", `/staff/vehicles/${id}/price`, { price: null }))
            .status,
          200,
        );
        tasks = (await list()).data.tasks;
        assert.equal(tasks.length, 1);
        assert.equal(tasks[0].previousPrice, 10500);
        assert.equal(tasks[0].currentPrice, 9000);
      },
    );
    await t.test(
      "bad, incomplete, quarantined and replayed payloads never create missing work",
      async () => {
        const before = await engine.query(
          "SELECT id,revision,status FROM stock_change_tasks ORDER BY id",
        );
        for (const extra of [
          { complete: false },
          { expectedAdvertCount: 4 },
          { failedAdvertIds: ["failed"] },
          { errors: [{ message: "failed" }] },
        ])
          assert.ok([400, 422].includes((await importCars([], extra)).status));
        assert.deepEqual(
          (
            await engine.query(
              "SELECT id,revision,status FROM stock_change_tasks ORDER BY id",
            )
          ).rows,
          before.rows,
        );
        assert.equal((await vehicle()).missingCount, 0);
        process.env.STOCK_MAX_DROP_PERCENT = "30";
        assert.equal((await importCars([])).status, 422);
        assert.equal((await vehicle()).missingCount, 0);
        process.env.STOCK_MAX_DROP_PERCENT = "100";
      },
    );
    await t.test(
      "first complete absence makes one task, second hides publicly, replay does not advance count",
      async () => {
        const payload = snapshot([]);
        assert.equal(
          (await call("POST", "/stock/imports/autotrader", payload)).status,
          201,
        );
        let tasks = (await list()).data.tasks;
        assert.equal(tasks.length, 1);
        assert.equal(tasks[0].kind, "missing_stock");
        assert.equal(tasks[0].missingCount, 1);
        assert.equal(tasks[0].availableForPriceUpdate, false);
        assert.equal(tasks[0].publiclyVisible, true);
        assert.equal(
          (await call("POST", "/stock/imports/autotrader", payload)).data
            .status,
          "replayed",
        );
        assert.equal((await vehicle()).missingCount, 1);
        assert.equal((await importCars([])).status, 201);
        tasks = (await list()).data.tasks;
        assert.equal(tasks.length, 1);
        assert.equal(tasks[0].missingCount, 2);
        assert.equal(tasks[0].publiclyVisible, false);
        assert.equal(tasks[0].revision, 1);
        assert.equal((await call("GET", "/stock")).data.count, 0);
      },
    );
    await t.test(
      "review is role-protected, tenant-scoped and optimistic; repeat misses do not reopen reviewed work",
      async () => {
        const task = (await list()).data.tasks[0];
        assert.equal(
          (await call("GET", "/staff/stock-change-tasks", undefined, ""))
            .status,
          401,
        );
        assert.equal(
          (
            await call(
              "GET",
              `/staff/stock-change-tasks/${task.id}`,
              undefined,
              "owner",
              dealerB,
            )
          ).status,
          404,
        );
        assert.equal(
          (
            await call(
              "PATCH",
              `/staff/stock-change-tasks/${task.id}`,
              { expectedRevision: task.revision, action: "reviewed" },
              "salesperson",
            )
          ).status,
          403,
        );
        assert.equal(
          (
            await call("PATCH", `/staff/stock-change-tasks/${task.id}`, {
              expectedRevision: 0,
              action: "reviewed",
            })
          ).status,
          409,
        );
        assert.equal(
          (
            await call("PATCH", `/staff/stock-change-tasks/${task.id}`, {
              expectedRevision: task.revision,
              action: "reviewed",
              inventoryStatus: "sold",
            })
          ).status,
          400,
        );
        const reviewed = await call(
          "PATCH",
          `/staff/stock-change-tasks/${task.id}`,
          {
            expectedRevision: task.revision,
            action: "reviewed",
            note: "Called the showroom; checking availability.",
          },
        );
        assert.equal(reviewed.status, 200);
        assert.equal(reviewed.data.status, "reviewed");
        assert.equal((await list()).data.tasks.length, 0);
        await importCars([]);
        assert.equal((await list()).data.tasks.length, 0);
        assert.equal(
          (await call("GET", `/staff/stock-change-tasks/${task.id}`)).data
            .missingCount,
          3,
        );
        assert.equal((await vehicle()).inventoryStatus, "available");
      },
    );
    await t.test(
      "reappearance resolves the episode; later absence starts a new one, sold/hidden/archived never reopen",
      async () => {
        await importCars([car("test-advert", 9000)]);
        assert.equal((await vehicle()).missingCount, 0);
        const tasks = await db.select().from(stockChangeTasksTable);
        assert.ok(
          tasks
            .filter((t) => t.kind === "missing_stock")
            .every((t) => t.status === "resolved"),
        );
        await importCars([]);
        assert.equal((await list()).data.tasks.length, 1);
        for (const status of ["sold", "hidden", "archived"] as const) {
          await db
            .update(vehiclesTable)
            .set({ inventoryStatus: status })
            .where(eq(vehiclesTable.id, (await vehicle()).id));
          await importCars([car("test-advert", 9000)]);
          assert.equal((await vehicle()).inventoryStatus, status);
          assert.equal((await list()).data.tasks.length, 0);
        }
      },
    );
    await t.test(
      "customer candidates omit closed/merged/agreed buyers, prioritise commitments and leave all money/documents untouched",
      async () => {
        await reset();
        await importCars([car()]);
        const v = await vehicle();
        const enquiry = (
          name: string,
          extra: Record<string, unknown> = {},
        ) => ({
          dealerId: dealerA,
          vehicleId: v.id,
          type: "general" as const,
          customerName: name,
          email: `${name.toLowerCase()}@example.test`,
          message: "Fictional question",
          ...extra,
        });
        const [open, closed, merged, agreed] = await db
          .insert(enquiriesTable)
          .values([
            enquiry("Open", {
              appointmentAt: new Date(Date.now() + 86400000),
              appointmentStatus: "confirmed",
            }),
            enquiry("Closed", { status: "closed" }),
            enquiry("Merged"),
            enquiry("Agreed"),
          ])
          .returning();
        await db
          .update(enquiriesTable)
          .set({ mergedIntoId: open.id })
          .where(eq(enquiriesTable.id, merged.id));
        const [lead] = await db
          .insert(leadsTable)
          .values({
            dealerId: dealerA,
            vehicleId: v.id,
            enquiryId: agreed.id,
            customerName: "Agreed",
            source: "phone",
            stage: "reserved",
            depositPence: 20000,
            depositMethod: "bank_transfer",
            depositTakenAt: new Date(),
          })
          .returning();
        const saleState = {
          draft: {
            vehicleId: v.id,
            sourceEnquiryId: agreed.id,
            customer: "Agreed",
            price: "10000",
          },
          payments: [
            { id: "p1", status: "confirmed", signedAmountPence: 20000 },
          ],
          documents: [
            {
              id: "issued-invoice",
              documentNumber: "INV-001",
              totalPence: 1000000,
            },
          ],
          lifecycle: { status: "reserved" },
        };
        await db.insert(saleWorkspaceTable).values({
          id: randomUUID(),
          dealerId: dealerA,
          reference: "FICTIONAL-SALE",
          revision: 1,
          state: saleState,
        });
        const moneyBefore = (
          await engine.query("SELECT state FROM sale_workspace")
        ).rows;
        await importCars([car("test-advert", 9500)]);
        let task = (await list()).data.tasks[0];
        assert.equal(task.urgency, "urgent");
        assert.equal(task.upcomingAppointments, 1);
        assert.equal(task.paidReservations, 1);
        assert.deepEqual(
          task.affectedCustomers.map((p: any) => p.enquiryId),
          [open.id],
        );
        await importCars([]);
        task = (await list()).data.tasks[0];
        assert.equal(task.kind, "missing_stock");
        assert.equal(task.affectedCustomers.length, 2);
        assert.equal(task.paidReservations, 1);
        await call("PATCH", `/staff/stock-change-tasks/${task.id}`, {
          expectedRevision: task.revision,
          action: "reviewed",
        });
        assert.deepEqual(
          (await engine.query("SELECT state FROM sale_workspace")).rows,
          moneyBefore,
        );
        assert.equal(
          (
            await db.select().from(leadsTable).where(eq(leadsTable.id, lead.id))
          )[0].depositPence,
          20000,
        );
        assert.equal(
          (
            await db
              .select()
              .from(enquiriesTable)
              .where(eq(enquiriesTable.id, open.id))
          )[0].appointmentCancelledAt,
          null,
        );
      },
    );
    await t.test(
      "superseded or no-longer-public price details cannot be treated as current offers",
      async () => {
        await reset();
        await importCars([car()]);
        await importCars([car("test-advert", 9500)]);
        const task = (await list()).data.tasks[0];
        await importCars([car("test-advert", 9900)]);
        assert.equal(
          (await call("GET", `/staff/stock-change-tasks/${task.id}`)).data
            .status,
          "resolved",
        );
        assert.equal((await list()).data.tasks.length, 0);
        await importCars([car("test-advert", 9000)]);
        const newer = (await list()).data.tasks[0];
        await importCars([]);
        assert.equal(
          (await call("GET", `/staff/stock-change-tasks/${newer.id}`)).data
            .status,
          "resolved",
        );
      },
    );
    await t.test(
      "staff cannot review a stale task after its car is sold outside the import flow",
      async () => {
        await reset();
        await importCars([car()]);
        await importCars([car("test-advert", 9500)]);
        const task = (await list()).data.tasks[0];
        await db
          .update(vehiclesTable)
          .set({ inventoryStatus: "sold" })
          .where(eq(vehiclesTable.id, task.vehicleId));
        assert.equal(
          (await call("GET", `/staff/stock-change-tasks/${task.id}`)).data
            .status,
          "resolved",
        );
        assert.equal(
          (
            await call("PATCH", `/staff/stock-change-tasks/${task.id}`, {
              expectedRevision: task.revision,
              action: "reviewed",
            })
          ).status,
          409,
        );
        assert.equal((await list()).data.tasks.length, 0);
      },
    );
    await t.test(
      "known bounced recipients remain phone contacts and cannot receive stock email suggestions",
      async () => {
        await reset();
        await importCars([car()]);
        const v = await vehicle();
        const id = randomUUID(),
          message = randomUUID();
        await db.insert(enquiriesTable).values({
          id,
          dealerId: dealerA,
          vehicleId: v.id,
          type: "general",
          customerName: "Bounced contact",
          email: "bounced@example.test",
          phone: "07700900123",
          message: "Question",
        });
        await engine.query(
          "INSERT INTO enquiry_emails (id,dealer_id,enquiry_id,request_id,request_hash,status,recipient,subject,message,created_by,provider_id) VALUES($1,$2,$3,$4,'test','sent','bounced@example.test','Test','Test','Staff','test-provider')",
          [message, dealerA, id, randomUUID()],
        );
        await engine.query(
          "INSERT INTO email_delivery_checks (dealer_id,message_key,provider_id,last_event) VALUES($1,$2,'test-provider','bounced')",
          [dealerA, `enquiry:${message}`],
        );
        await importCars([car("test-advert", 9500)]);
        const contact = (await list()).data.tasks[0].affectedCustomers[0];
        assert.equal(contact.email, null);
        assert.equal(contact.phone, "07700900123");
        await engine.exec(
          "TRUNCATE enquiry_emails,email_delivery_checks CASCADE",
        );
      },
    );
    await t.test(
      "an older urgent appointment is selected ahead of 100 newer normal tasks",
      async () => {
        await reset();
        const now = new Date();
        const rows = await db
          .insert(vehiclesTable)
          .values(
            Array.from({ length: 102 }, (_, i) => ({
              dealerId: dealerA,
              source: "autotrader",
              advertId: `priority-${i}`,
              title: `Fictional car ${i}`,
              sourcePrice: 9500,
            })),
          )
          .returning();
        await db.insert(stockChangeTasksTable).values(
          rows.map((v, i) => ({
            dealerId: dealerA,
            vehicleId: v.id,
            kind: "price_drop" as const,
            changeKey: `priority-${i}`,
            previousPrice: 10000,
            currentPrice: 9500,
            createdAt: new Date(now.getTime() - i * 1000),
          })),
        );
        await db.insert(enquiriesTable).values({
          dealerId: dealerA,
          vehicleId: rows[101].id,
          type: "viewing",
          customerName: "Urgent visit",
          message: "Appointment",
          appointmentAt: new Date(now.getTime() + 86400000),
          appointmentStatus: "confirmed",
        });
        const result = await list();
        assert.equal(result.status, 200);
        assert.equal(result.data.total, 102);
        assert.equal(result.data.tasks.length, 100);
        assert.equal(result.data.tasks[0].vehicleId, rows[101].id);
        assert.equal(result.data.tasks[0].urgency, "urgent");
      },
    );
    await t.test(
      "an insert failure rolls back stock, public-price history and task together",
      async () => {
        await reset();
        await importCars([car()]);
        const id = (await vehicle()).id;
        await engine.exec(
          "CREATE FUNCTION fail_fictional_stock_task() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fictional task failure'; END $$; CREATE TRIGGER fail_fictional_stock_task BEFORE INSERT ON stock_change_tasks FOR EACH ROW EXECUTE FUNCTION fail_fictional_stock_task();",
        );
        const result = await importCars([car("test-advert", 9500)]);
        assert.equal(result.status, 500);
        assert.equal((await vehicle()).sourcePrice, 10000);
        assert.equal((await list()).data.tasks.length, 0);
        assert.equal(
          (
            await engine.query(
              "SELECT * FROM vehicle_changes WHERE field_name='websitePublishedPrice'",
            )
          ).rows.length,
          0,
        );
        await engine.exec(
          "DROP TRIGGER fail_fictional_stock_task ON stock_change_tasks; DROP FUNCTION fail_fictional_stock_task()",
        );
        assert.equal(
          (await importCars([car("test-advert", 9500)])).status,
          201,
        );
        assert.equal((await vehicle()).id, id);
      },
    );
    await t.test(
      "switching marketplace hides old-source offers and missing tasks and blocks reviewing them",
      async () => {
        await reset();
        await importCars([car()]);
        await importCars([car("test-advert", 9500)]);
        const oldTask = (await list()).data.tasks[0];
        activePlatform = "cazoo";
        assert.equal((await list()).data.tasks.length, 0);
        const oldDetail = (
          await call("GET", `/staff/stock-change-tasks/${oldTask.id}`)
        ).data;
        assert.equal(oldDetail.status, "resolved");
        assert.equal(oldDetail.publiclyVisible, false);
        assert.deepEqual(oldDetail.affectedCustomers, []);
        assert.equal(
          (
            await call("PATCH", `/staff/stock-change-tasks/${oldTask.id}`, {
              expectedRevision: oldTask.revision,
              action: "reviewed",
            })
          ).status,
          409,
        );
        assert.equal(
          (
            await call("PATCH", `/staff/vehicles/${oldTask.vehicleId}/price`, {
              price: 9000,
            })
          ).status,
          200,
        );
        assert.equal((await list()).data.tasks.length, 0);
        assert.equal(
          (await publicPriceReductions([await vehicle()], new Date(), "cazoo"))
            .size,
          0,
        );
        activePlatform = "autotrader";
        await importCars([]);
        const missing = (await list()).data.tasks[0];
        assert.equal(missing.kind, "missing_stock");
        activePlatform = "cazoo";
        assert.equal((await list()).data.tasks.length, 0);
        assert.equal(
          (await call("GET", `/staff/stock-change-tasks/${missing.id}`)).data
            .status,
          "resolved",
        );
        assert.equal(
          (
            await call("PATCH", `/staff/stock-change-tasks/${missing.id}`, {
              expectedRevision: missing.revision,
              action: "reviewed",
            })
          ).status,
          409,
        );
        const [current] = await db
          .insert(vehiclesTable)
          .values({
            dealerId: dealerA,
            source: "cazoo",
            advertId: "cazoo-active",
            title: "Fictional current car",
            sourcePrice: 10000,
          })
          .returning();
        assert.equal(
          (
            await call("PATCH", `/staff/vehicles/${current.id}/price`, {
              price: 9000,
            })
          ).status,
          200,
        );
        assert.equal((await list()).data.tasks[0].vehicleId, current.id);
      },
    );
    await t.test(
      "legacy missing stock is not backfilled until it returns and newly disappears",
      async () => {
        await reset();
        const [legacy] = await db
          .insert(vehiclesTable)
          .values({
            dealerId: dealerA,
            source: "autotrader",
            advertId: "legacy-missing",
            title: "Fictional legacy car",
            sourcePrice: 9500,
            sourceStatus: "missing",
            missingCount: 5,
          })
          .returning();
        assert.equal((await importCars([])).status, 201);
        assert.equal((await vehicle()).missingCount, 6);
        assert.equal((await list()).data.tasks.length, 0);
        assert.equal((await importCars([])).status, 201);
        assert.equal((await vehicle()).missingCount, 7);
        assert.equal((await db.select().from(stockChangeTasksTable)).length, 0);
        assert.equal(
          (await importCars([car("legacy-missing", 9500)])).status,
          201,
        );
        assert.equal((await vehicle()).sourceStatus, "live");
        assert.equal((await vehicle()).missingCount, 0);
        assert.equal((await list()).data.tasks.length, 0);
        assert.equal((await importCars([])).status, 201);
        const tasks = (await list()).data.tasks;
        assert.equal(tasks.length, 1);
        assert.equal(tasks[0].kind, "missing_stock");
        assert.equal(tasks[0].vehicleId, legacy.id);
        assert.equal(tasks[0].missingCount, 1);
      },
    );
    await t.test(
      "foreign-currency stock never creates GBP tasks/badges and returning to GBP cannot revive old evidence",
      async () => {
        await reset();
        await importCars([car()]);
        await importCars([car("test-advert", 9500)]);
        const original = (await list()).data.tasks[0];
        assert.ok(
          (await call("GET", "/stock")).data.cars[0].sourceExtras
            .websitePriceReduction,
        );
        assert.equal(
          (await importCars([car("test-advert", 9500, { currency: "EUR" })]))
            .status,
          201,
        );
        assert.equal((await list()).data.tasks.length, 0);
        assert.equal(
          (await call("GET", `/staff/stock-change-tasks/${original.id}`)).data
            .status,
          "resolved",
        );
        assert.equal(
          (await call("GET", "/stock")).data.cars[0].sourceExtras
            .websitePriceReduction,
          undefined,
        );
        assert.equal(
          (await importCars([car("test-advert", 9000, { currency: "EUR" })]))
            .status,
          201,
        );
        assert.equal((await list()).data.tasks.length, 0);
        assert.equal(
          (
            await call("PATCH", `/staff/vehicles/${original.vehicleId}/price`, {
              price: 8500,
            })
          ).status,
          200,
        );
        assert.equal((await list()).data.tasks.length, 0);
        assert.equal(
          (await importCars([car("test-advert", 9000, { currency: "GBP" })]))
            .status,
          201,
        );
        assert.equal(
          (await call("GET", "/stock")).data.cars[0].sourceExtras
            .websitePriceReduction,
          undefined,
        );
        assert.equal((await list()).data.tasks.length, 0);
        await call("PATCH", `/staff/vehicles/${original.vehicleId}/price`, {
          price: 8000,
        });
        const current = (await list()).data.tasks[0];
        assert.equal(current.previousPrice, 8500);
        assert.equal(current.currentPrice, 8000);
        assert.ok(
          (await call("GET", "/stock")).data.cars[0].sourceExtras
            .websitePriceReduction,
        );
        // A direct foreign-currency change also invalidates read and review even
        // before a later validated import reconciles the persisted task.
        await db
          .update(vehiclesTable)
          .set({ currency: "EUR" })
          .where(eq(vehiclesTable.id, original.vehicleId));
        assert.equal((await list()).data.tasks.length, 0);
        assert.equal(
          (await call("GET", `/staff/stock-change-tasks/${current.id}`)).data
            .currentPrice,
          null,
        );
        assert.equal(
          (
            await call("PATCH", `/staff/stock-change-tasks/${current.id}`, {
              expectedRevision: current.revision,
              action: "reviewed",
            })
          ).status,
          409,
        );
        await db
          .update(vehiclesTable)
          .set({ currency: "GBP" })
          .where(eq(vehiclesTable.id, original.vehicleId));
      },
    );

    const priceCase = async (extra: Record<string, unknown> = {}) => {
      await reset();
      await importCars([car()]);
      const v = await vehicle();
      const [person] = await db
        .insert(enquiriesTable)
        .values({
          dealerId: dealerA,
          vehicleId: v.id,
          type: "general",
          customerName: "Fictional Price Customer",
          email: "price@example.test",
          phone: "07700900123",
          message: "Please tell me if the price changes.",
          ...extra,
        })
        .returning();
      await importCars([car("test-advert", 9500)]);
      return { v, person, task: (await list()).data.tasks[0] };
    };
    const outcome = (
      task: any,
      person: any,
      body: Record<string, unknown>,
      role = "salesperson",
      dealer = dealerA,
    ) =>
      call(
        "PATCH",
        `/staff/stock-change-tasks/${task.id}/customers/${person.id}`,
        {
          expectedRevision: task.revision,
          expectedCustomerRevision: 0,
          ...body,
        },
        role,
        dealer,
      );
    await t.test(
      "price outreach preferences are private, owner-protected, validated and optimistic",
      async () => {
        await reset();
        assert.deepEqual(
          (await call("GET", "/staff/stock-change-settings")).data,
          { minimumReduction: 100, contactIntervalDays: 7, revision: 0 },
        );
        assert.equal(
          (
            await call(
              "PUT",
              "/staff/stock-change-settings",
              { minimumReduction: 200, contactIntervalDays: 14, revision: 0 },
              "salesperson",
            )
          ).status,
          403,
        );
        assert.equal(
          (
            await call("PUT", "/staff/stock-change-settings", {
              minimumReduction: -1,
              contactIntervalDays: 366,
              revision: 0,
            })
          ).status,
          400,
        );
        const saved = await call("PUT", "/staff/stock-change-settings", {
          minimumReduction: 200,
          contactIntervalDays: 14,
          revision: 0,
        });
        assert.equal(saved.status, 200);
        assert.equal(saved.data.revision, 1);
        assert.equal(
          (
            await call("PUT", "/staff/stock-change-settings", {
              minimumReduction: 50,
              contactIntervalDays: 1,
              revision: 0,
            })
          ).status,
          409,
        );
        assert.equal(
          (
            await call(
              "GET",
              "/staff/stock-change-settings",
              undefined,
              "owner",
              dealerB,
            )
          ).data.minimumReduction,
          100,
        );
      },
    );
    await t.test(
      "minimum reduction filters Home prompts, never public history or urgent visits",
      async () => {
        await reset();
        await importCars([car()]);
        await importCars([car("test-advert", 9950)]);
        assert.equal((await list()).data.tasks.length, 0);
        const rows = await db.select().from(stockChangeTasksTable);
        assert.equal(rows.length, 1);
        assert.equal(
          (await call("GET", "/stock")).data.cars[0].sourceExtras
            .websitePriceReduction.reduction,
          50,
        );
        await db.insert(enquiriesTable).values({
          dealerId: dealerA,
          vehicleId: rows[0].vehicleId,
          type: "viewing",
          customerName: "Fictional Visitor",
          message: "Visit",
          appointmentAt: new Date(Date.now() + 86400000),
          appointmentStatus: "confirmed",
        });
        const task = (await list()).data.tasks[0];
        assert.equal(task.urgency, "urgent");
        assert.equal(
          task.affectedCustomers[0].outreach.reason,
          "below_minimum_reduction",
        );
      },
    );
    await t.test(
      "unfinished price customers prevent task review; each Not needed outcome is saved against the correct enquiry",
      async () => {
        const { person, task } = await priceCase();
        const before = await call(
          "PATCH",
          `/staff/stock-change-tasks/${task.id}`,
          { expectedRevision: task.revision, action: "reviewed" },
        );
        assert.equal(before.status, 409);
        assert.equal(
          (
            await outcome(task, person, {
              action: "not_needed",
              note: "Customer is no longer looking.",
            })
          ).status,
          200,
        );
        const refreshed = (await list()).data.tasks[0];
        assert.equal(
          refreshed.affectedCustomers[0].outcome.status,
          "not_needed",
        );
        assert.equal(refreshed.affectedCustomers[0].outcome.revision, 1);
        const events = (
          await engine.query<{ enquiry_id: string; summary: string }>(
            "SELECT enquiry_id,summary FROM enquiry_events WHERE dealer_id=$1",
            [dealerA],
          )
        ).rows;
        assert.equal(events.length, 1);
        assert.equal(events[0].enquiry_id, person.id);
        assert.equal(
          (
            await call("PATCH", `/staff/stock-change-tasks/${task.id}`, {
              expectedRevision: task.revision,
              action: "reviewed",
            })
          ).status,
          200,
        );
        assert.equal((await list()).data.tasks.length, 0);
      },
    );
    await t.test(
      "more than 100 eligible customers retain truthful counts and unfinished work always surfaces",
      async () => {
        const { person, task, v } = await priceCase();
        const others = await db
          .insert(enquiriesTable)
          .values(
            Array.from({ length: 100 }, (_, index) => ({
              dealerId: dealerA,
              vehicleId: v.id,
              type: "general" as const,
              customerName: `Fictional batch ${index}`,
              email: `batch-${index}@example.test`,
              message: "Interested in this car.",
              createdAt: new Date(Date.now() + index + 1),
            })),
          )
          .returning();
        const completed = [person, ...others.slice(0, 99)];
        const pending = others[99];
        // The oldest enquiry would previously have been stranded after LIMIT 100.
        await db
          .update(enquiriesTable)
          .set({ createdAt: new Date(Date.now() - 100 * 86400000) })
          .where(eq(enquiriesTable.id, pending.id));
        await db.insert(stockChangeCustomerOutcomesTable).values(
          completed.map((customer) => ({
            dealerId: dealerA,
            taskId: task.id,
            enquiryId: customer.id,
            status: "not_needed" as const,
            revision: 1,
            updatedBy: "Fictional Staff",
          })),
        );
        const page = (await list()).data.tasks[0];
        assert.equal(page.affectedCustomers.length, 100);
        assert.equal(page.customerTotal, 101);
        assert.equal(page.pendingCustomerTotal, 1);
        assert.equal(page.affectedCustomers[0].enquiryId, pending.id);
        // Scheduling the current batch for later must still expose new,
        // untouched customers ahead of those planned follow-ups.
        await db
          .update(stockChangeCustomerOutcomesTable)
          .set({
            status: "follow_up",
            followUpAt: new Date(Date.now() + 86400000),
          })
          .where(eq(stockChangeCustomerOutcomesTable.taskId, task.id));
        const planned = (await list()).data.tasks[0];
        assert.equal(planned.pendingCustomerTotal, 101);
        assert.equal(planned.affectedCustomers[0].enquiryId, pending.id);
        await db
          .update(stockChangeCustomerOutcomesTable)
          .set({ status: "not_needed", followUpAt: null })
          .where(eq(stockChangeCustomerOutcomesTable.taskId, task.id));
        assert.equal(
          (
            await call("PATCH", `/staff/stock-change-tasks/${task.id}`, {
              expectedRevision: task.revision,
              action: "reviewed",
            })
          ).status,
          409,
        );
        const finished = await outcome(task, pending, {
          action: "not_needed",
          note: "No further contact needed.",
        });
        assert.equal(finished.status, 200, JSON.stringify(finished.data));
        assert.equal(finished.data.customerTotal, 101);
        assert.equal(finished.data.pendingCustomerTotal, 0);
        assert.equal(
          (
            await call("PATCH", `/staff/stock-change-tasks/${task.id}`, {
              expectedRevision: task.revision,
              action: "reviewed",
            })
          ).status,
          200,
        );
        assert.equal((await list()).data.tasks.length, 0);
      },
    );
    await t.test(
      "reserved stock stays visible for staff review but is unavailable for price outreach",
      async () => {
        const { task, v } = await priceCase();
        assert.equal(task.availableForPriceUpdate, true);
        await db
          .update(vehiclesTable)
          .set({ inventoryStatus: "reserved" })
          .where(eq(vehiclesTable.id, v.id));
        const reserved = (
          await call("GET", `/staff/stock-change-tasks/${task.id}`)
        ).data;
        assert.equal(reserved.status, "open");
        assert.equal(reserved.publiclyVisible, true);
        assert.equal(reserved.availableForPriceUpdate, false);
        assert.equal(
          (await list()).data.tasks[0].availableForPriceUpdate,
          false,
        );
      },
    );
    await t.test(
      "customer outcomes are tenant and role protected and reject concurrent or superseded writes",
      async () => {
        const { person, task } = await priceCase();
        assert.equal(
          (await outcome(task, person, { action: "not_needed" }, "accounts"))
            .status,
          403,
        );
        assert.equal(
          (
            await outcome(
              task,
              person,
              { action: "not_needed" },
              "owner",
              dealerB,
            )
          ).status,
          404,
        );
        assert.equal(
          (
            await outcome(task, person, {
              action: "not_needed",
              expectedCustomerRevision: 4,
            })
          ).status,
          409,
        );
        assert.equal(
          (await outcome(task, person, { action: "not_needed" })).status,
          200,
        );
        assert.equal(
          (
            await outcome(task, person, {
              action: "contacted",
              channel: "call",
            })
          ).status,
          409,
        );
        await importCars([car("test-advert", 9000)]);
        assert.equal(
          (
            await outcome(task, person, {
              action: "not_needed",
              expectedCustomerRevision: 1,
            })
          ).status,
          409,
        );
      },
    );
    await t.test(
      "confirmed phone contact starts a cross-enquiry interval; later reductions stay available for staff decisions",
      async () => {
        const { person, task, v } = await priceCase();
        const confirmed = await outcome(task, person, {
          action: "contacted",
          channel: "call",
          note: "Explained the new price.",
        });
        assert.equal(confirmed.status, 200, JSON.stringify(confirmed.data));
        assert.equal(
          confirmed.data.affectedCustomers[0].outcome.channel,
          "call",
        );
        await importCars([car("test-advert", 9000)]);
        const [duplicate] = await db
          .insert(enquiriesTable)
          .values({
            dealerId: dealerA,
            vehicleId: v.id,
            type: "general",
            customerName: "Same fictional phone",
            phone: "+44 7700 900123",
            message: "New enquiry",
          })
          .returning();
        const next = (await list()).data.tasks[0];
        assert.equal(
          next.affectedCustomers.find((p: any) => p.enquiryId === person.id)
            .outreach.reason,
          "recently_contacted",
        );
        assert.equal(
          next.affectedCustomers.find((p: any) => p.enquiryId === duplicate.id)
            .outreach.reason,
          "recently_contacted",
        );
        const future = await readStockChangeTasks(dealerA, {
          id: next.id,
          now: new Date(Date.now() + 8 * 86400000),
        });
        assert.equal(
          future.tasks[0].affectedCustomers[0].outreach.suggested,
          true,
        );
        assert.equal(
          (
            await outcome(next, person, {
              action: "not_needed",
              note: "Already updated this week.",
            })
          ).status,
          200,
        );
      },
    );
    await t.test(
      "confirmed-send recording is idempotent and refuses foreign customers; queued or failed sends do not count",
      async () => {
        const { person, task } = await priceCase();
        const now = new Date();
        assert.equal(
          (
            await engine.query<{ contacted_at: string }>(
              "SELECT * FROM stock_change_contact_events",
            )
          ).rows.length,
          0,
        );
        assert.equal(
          await recordStockChangeContact({
            dealerId: dealerA,
            taskId: task.id,
            enquiryId: person.id,
            channel: "email",
            eventKey: "email:fictional-1",
            staffName: "Fictional Staff",
            now,
          }),
          true,
        );
        assert.equal(
          await recordStockChangeContact({
            dealerId: dealerA,
            taskId: task.id,
            enquiryId: person.id,
            channel: "email",
            eventKey: "email:fictional-1",
            staffName: "Fictional Staff",
            now: new Date(now.getTime() + 60000),
          }),
          false,
        );
        assert.equal(
          await recordStockChangeContact({
            dealerId: dealerB,
            taskId: task.id,
            enquiryId: person.id,
            channel: "email",
            eventKey: "email:fictional-1",
            staffName: "Fictional Staff",
          }),
          false,
        );
        const contacts = (
          await engine.query<{ contacted_at: string }>(
            "SELECT * FROM stock_change_contact_events",
          )
        ).rows;
        assert.equal(contacts.length, 1);
        assert.equal(
          new Date(contacts[0].contacted_at).getTime(),
          now.getTime(),
        );
        assert.equal(
          (await list()).data.tasks[0].affectedCustomers[0].outcome.revision,
          1,
        );
      },
    );
    await t.test(
      "historical confirmation repair records contact without overwriting a newer planned callback",
      async () => {
        const { person, task } = await priceCase();
        const actualContact = new Date(task.createdAt);
        const future = new Date(Date.now() + 86400000).toISOString();
        const planned = await outcome(task, person, {
          action: "follow_up",
          followUpAt: future,
          note: "Staff arranged this callback after the earlier message.",
        });
        assert.equal(planned.status, 200);
        const before = (
          await db
            .select()
            .from(enquiriesTable)
            .where(eq(enquiriesTable.id, person.id))
        )[0];
        assert.equal(
          await recordStockChangeContact({
            dealerId: dealerA,
            taskId: task.id,
            enquiryId: person.id,
            channel: "whatsapp",
            eventKey: "whatsapp:historical-repair",
            staffName: "Fictional Staff",
            now: actualContact,
          }),
          true,
        );
        const refreshed = (await list()).data.tasks[0].affectedCustomers[0];
        assert.equal(refreshed.outcome.status, "follow_up");
        assert.equal(refreshed.outcome.revision, 1);
        assert.equal(refreshed.outcome.followUpAt, future);
        assert.equal(
          refreshed.outreach.lastContactedAt,
          actualContact.toISOString(),
        );
        const after = (
          await db
            .select()
            .from(enquiriesTable)
            .where(eq(enquiriesTable.id, person.id))
        )[0];
        assert.equal(after.followUpCompletedAt, null);
        assert.equal(after.followUpRevision, before.followUpRevision);
        assert.equal(after.followUpNote, before.followUpNote);
        assert.equal(
          await recordStockChangeContact({
            dealerId: dealerA,
            taskId: task.id,
            enquiryId: person.id,
            channel: "whatsapp",
            eventKey: "whatsapp:historical-repair",
            staffName: "Fictional Staff",
          }),
          false,
        );
      },
    );
    await t.test(
      "confirming a real send completes its unchanged reminder despite a later unrelated enquiry update",
      async () => {
        const { person, task } = await priceCase();
        const planned = await outcome(task, person, {
          action: "follow_up",
          followUpAt: new Date(Date.now() + 86400000).toISOString(),
        });
        assert.equal(planned.status, 200);
        const actualContact = new Date();
        await db
          .update(enquiriesTable)
          .set({ updatedAt: new Date(actualContact.getTime() + 5) })
          .where(eq(enquiriesTable.id, person.id));
        assert.equal(
          await recordStockChangeContact({
            dealerId: dealerA,
            taskId: task.id,
            enquiryId: person.id,
            channel: "whatsapp",
            eventKey: "whatsapp:real-send",
            staffName: "Fictional Staff",
            now: actualContact,
          }),
          true,
        );
        const current = (await list()).data.tasks[0].affectedCustomers[0];
        assert.equal(current.outcome.status, "contacted");
        const [saved] = await db
          .select()
          .from(enquiriesTable)
          .where(eq(enquiriesTable.id, person.id));
        assert.equal(
          saved.followUpCompletedAt!.toISOString(),
          actualContact.toISOString(),
        );
      },
    );
    await t.test(
      "phone-only agreed buyers match UK local, international and 00 formats in leads and sales",
      async () => {
        for (const [enquiryPhone, commitmentPhone, kind] of [
          ["07700900123", "+44 7700 900123", "lead"],
          ["+44 7700 900123", "0044 7700 900123", "sale"],
        ] as const) {
          const { person, task, v } = await priceCase({
            email: null,
            phone: enquiryPhone,
          });
          if (kind === "lead")
            await db.insert(leadsTable).values({
              dealerId: dealerA,
              vehicleId: v.id,
              customerName: "Phone-only agreed buyer",
              phone: commitmentPhone,
              email: null,
              source: "phone",
              stage: "sale_agreed",
            });
          else
            await db.insert(saleWorkspaceTable).values({
              id: randomUUID(),
              dealerId: dealerA,
              reference: "FICTIONAL-PHONE-SALE",
              revision: 1,
              state: {
                draft: {
                  vehicleId: v.id,
                  customer: "Phone-only agreed buyer",
                  phone: commitmentPhone,
                  email: "",
                },
                payments: [],
                documents: [],
                lifecycle: { status: "reserved" },
              },
            });
          const current = (await list()).data.tasks[0];
          assert.equal(current.customerTotal, 0, kind);
          assert.deepEqual(current.affectedCustomers, [], kind);
          assert.equal(
            (
              await outcome(task, person, {
                action: "contacted",
                channel: "call",
              })
            ).status,
            409,
            kind,
          );
          // The atomic review guard must apply the same normalized identity.
          assert.equal(
            (
              await call("PATCH", `/staff/stock-change-tasks/${task.id}`, {
                expectedRevision: task.revision,
                action: "reviewed",
              })
            ).status,
            200,
            kind,
          );
        }
      },
    );
    await t.test(
      "follow-up remains on the enquiry after a price task is superseded and blocks premature review",
      async () => {
        const { person, task } = await priceCase();
        const at = new Date(Date.now() + 86400000).toISOString();
        assert.equal(
          (
            await outcome(task, person, {
              action: "follow_up",
              followUpAt: at,
              note: "Check their decision tomorrow.",
            })
          ).status,
          200,
        );
        assert.equal(
          (
            await call("PATCH", `/staff/stock-change-tasks/${task.id}`, {
              expectedRevision: task.revision,
              action: "reviewed",
            })
          ).status,
          409,
        );
        // A later preference change must not hide an explicitly planned callback.
        const preferences = await call("PUT", "/staff/stock-change-settings", {
          minimumReduction: 600,
          contactIntervalDays: 7,
          revision: 0,
        });
        assert.equal(preferences.status, 200);
        const home = (await list()).data.tasks;
        assert.equal(home.length, 1);
        assert.equal(home[0].id, task.id);
        assert.equal(home[0].affectedCustomers[0].outcome.status, "follow_up");
        await importCars([car("test-advert", 9900)]);
        const [saved] = await db
          .select()
          .from(enquiriesTable)
          .where(eq(enquiriesTable.id, person.id));
        assert.equal(saved.followUpAt!.toISOString(), at);
        assert.equal(saved.followUpCompletedAt, null);
        assert.match(saved.followUpNote!, /Check their decision/);
        assert.equal(
          (await call("GET", `/staff/stock-change-tasks/${task.id}`)).data
            .status,
          "resolved",
        );
      },
    );
    await t.test(
      "existing separate callbacks are protected; finishing this price contact completes only its own reminder",
      async () => {
        let { person, task } = await priceCase({
          followUpAt: new Date(Date.now() + 3600000),
          followUpNote: "Call about delivery",
          followUpCompletedAt: null,
        });
        assert.equal(
          (
            await outcome(task, person, {
              action: "follow_up",
              followUpAt: new Date(Date.now() + 86400000).toISOString(),
            })
          ).status,
          409,
        );
        await outcome(task, person, {
          action: "contacted",
          channel: "whatsapp",
        });
        let [saved] = await db
          .select()
          .from(enquiriesTable)
          .where(eq(enquiriesTable.id, person.id));
        assert.equal(saved.followUpNote, "Call about delivery");
        assert.equal(saved.followUpCompletedAt, null);
        ({ person, task } = await priceCase());
        const planned = await outcome(task, person, {
          action: "follow_up",
          followUpAt: new Date(Date.now() + 86400000).toISOString(),
        });
        assert.equal(planned.status, 200);
        assert.equal(
          (
            await outcome(task, person, {
              action: "contacted",
              channel: "call",
              expectedCustomerRevision: 1,
            })
          ).status,
          200,
        );
        [saved] = await db
          .select()
          .from(enquiriesTable)
          .where(eq(enquiriesTable.id, person.id));
        assert.ok(saved.followUpCompletedAt);
      },
    );
    await t.test(
      "invalid dates and customers acquiring a paid commitment cannot overwrite outcomes",
      async () => {
        const { person, task, v } = await priceCase();
        assert.equal(
          (
            await outcome(task, person, {
              action: "follow_up",
              followUpAt: new Date(Date.now() - 60000).toISOString(),
            })
          ).status,
          400,
        );
        assert.equal(
          (await outcome(task, person, { action: "contacted" })).status,
          400,
        );
        await db.insert(leadsTable).values({
          dealerId: dealerA,
          vehicleId: v.id,
          enquiryId: person.id,
          customerName: person.customerName,
          source: "phone",
          stage: "reserved",
          depositPence: 10000,
          depositMethod: "bank_transfer",
          depositTakenAt: new Date(),
        });
        assert.equal(
          (
            await outcome(task, person, {
              action: "contacted",
              channel: "call",
            })
          ).status,
          409,
        );
        assert.equal(
          (await engine.query("SELECT * FROM stock_change_customer_outcomes"))
            .rows.length,
          0,
        );
      },
    );
    await t.test(
      "no email, provider request, payment, cancellation or deletion is triggered by stock work",
      async () => {
        assert.equal(outbound, 0);
        for (const table of [
          "email_outbox",
          "enquiry_emails",
          "enquiry_email_drafts",
        ])
          assert.equal(
            (
              await engine.query<{ count: number }>(
                `SELECT count(*)::int AS count FROM ${table}`,
              )
            ).rows[0].count,
            0,
          );
        assert.ok(
          (await db.select().from(vehicleChangesTable)).some(
            (change) => change.fieldName === "websitePublishedPrice",
          ),
        );
      },
    );
  } finally {
    globalThis.fetch = originalFetch;
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await engine.close();
    await rm(privateDir, { recursive: true, force: true });
  }
});
