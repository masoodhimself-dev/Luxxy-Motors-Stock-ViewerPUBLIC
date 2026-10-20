import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { createServer, request } from "node:http";
import express from "express";
import {
  db,
  engine,
  pool,
  dealershipsTable,
  vehiclesTable,
  enquiriesTable,
  saleWorkspaceTable,
  enquiryEmailsTable,
  emailDeliveryChecksTable,
  portalUsersTable,
} from "./test/tenant-test-db";
import { runWithTenant } from "./lib/tenant-context";
import { createSoldVehicleFollowUps } from "./lib/sold-vehicle-follow-ups";
import type { SaleWorkspaceRecord } from "@workspace/vehicle-meta";
import router from "./routes/sold-vehicle-follow-ups";
import { createEnquiryEmailRouter } from "./routes/enquiry-emails";
import { defaultEmailAppearance } from "@workspace/vehicle-meta";

test("sold-car follow-ups use fictional data, explicit cancellation and reviewed sends", async (t) => {
  for (const file of (await readdir("../../lib/db/drizzle"))
    .filter((f) => /^\d.*\.sql$/.test(f))
    .sort())
    await engine.exec(await readFile(`../../lib/db/drizzle/${file}`, "utf8"));
  const a = "sold-review-fictional-a",
    b = "sold-review-fictional-b";
  for (const id of [a, b])
    await db.insert(dealershipsTable).values({
      id,
      name: "Fictional dealer",
      status: "active",
      canonicalOrigin: `https://${id}.example.test`,
      stockPlatform: "autotrader",
      retailerId: "fictional",
      sourceUrl: "https://example.test/stock",
    });
  await db
    .insert(portalUsersTable)
    .values({ dealerId: a, authUserId: "fictional-staff", role: "owner" });
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.log = {
      error(...args: unknown[]) {
        if (process.env.DEBUG_SOLD_REVIEW_TEST) console.error(...args);
      },
      info() {},
      warn() {},
    } as any;
    const role = req.get("x-test-role");
    if (role)
      req.staff = {
        authUserId: "fictional-staff",
        name: "Fictional staff",
        email: null,
        role: role as any,
      };
    const dealerId = req.get("x-test-dealer") || a;
    runWithTenant(
      {
        dealerId,
        canonicalOrigin: `https://${dealerId}.example.test`,
        platform: "autotrader",
        retailerId: "fictional",
        sourceUrl: "https://example.test/stock",
      },
      next,
    );
  });
  let fakeProviderSends = 0;
  app.use(
    "/api",
    router,
    createEnquiryEmailRouter({
      settings: async () => ({
        version: 1,
        revision: 0,
        updatedAt: null,
        resend: {
          enabled: true,
          apiKey: "re_fictional_not_used",
          from: "sales@example.test",
          replyTo: "",
        },
        stripe: {
          enabled: false,
          mode: "test",
          publishableKey: "",
          secretKey: "",
          webhookSecret: "",
        },
        templates: {},
        appearance: { ...defaultEmailAppearance },
      }),
      send: async () => {
        fakeProviderSends++;
        await new Promise((resolve) => setTimeout(resolve, 20));
        return "fictional-sold-provider";
      },
    }),
  );
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as { port: number }).port;
  let outbound = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    outbound++;
    throw new Error("External services forbidden in sold-car tests");
  };
  const call = (
    method: string,
    path: string,
    body?: unknown,
    role = "owner",
    dealer = a,
  ) =>
    new Promise<{ status: number; data: any }>((resolve, reject) => {
      const req = request(
        {
          host: "127.0.0.1",
          port,
          path: path.startsWith("/api/")
            ? path
            : `/api/staff/sold-vehicle-follow-ups${path}`,
          method,
          headers: {
            "Content-Type": "application/json",
            "X-Test-Dealer": dealer,
            ...(role ? { "X-Test-Role": role } : {}),
          },
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on("data", (c) => chunks.push(c));
          res.on("end", () => {
            try {
              resolve({
                status: res.statusCode!,
                data: JSON.parse(Buffer.concat(chunks).toString()),
              });
            } catch (error) {
              reject(error);
            }
          });
        },
      );
      req.on("error", reject);
      req.end(body === undefined ? undefined : JSON.stringify(body));
    });
  let carId: string,
    sale: SaleWorkspaceRecord,
    buyer: string,
    appointment: string,
    interest: string,
    duplicate: string,
    secondAppointment: string,
    closed: string,
    otherDealer: string;
  const future = new Date(Date.now() + 2 * 3600000);
  const addEnquiry = async (extra: Record<string, unknown> = {}) =>
    (
      await db
        .insert(enquiriesTable)
        .values({
          dealerId: a,
          vehicleId: carId,
          vehicleTitle: "Fictional Toyota Yaris",
          type: "general",
          customerName: "Fictional customer",
          email: "customer@example.test",
          message: "Fictional enquiry",
          ...extra,
        } as any)
        .returning()
    )[0].id;
  const fixture = async () => {
    await engine.exec(
      "TRUNCATE sold_vehicle_follow_ups,enquiry_emails,enquiry_events,enquiries,vehicles,sale_workspace,email_delivery_checks CASCADE",
    );
    carId = (
      await db
        .insert(vehiclesTable)
        .values({
          dealerId: a,
          source: "autotrader",
          advertId: randomUUID(),
          title: "Fictional Toyota Yaris",
          sourcePrice: 10000,
          plate: "AB22CDE",
        })
        .returning()
    )[0].id;
    buyer = await addEnquiry({
      customerName: "The Buyer",
      email: "buyer@example.test",
      type: "viewing",
      appointmentAt: future,
    });
    appointment = await addEnquiry({
      customerName: "Alex Customer",
      email: "alex@example.test",
      phone: "07700900001",
      type: "viewing",
      appointmentAt: future,
      appointmentStatus: "confirmed",
      customerNotificationStatus: "sent",
      reminderStatus: "pending",
    });
    duplicate = await addEnquiry({
      customerName: "Alex Customer",
      email: "ALEX@example.test",
      phone: "+447700900001",
    });
    secondAppointment = await addEnquiry({
      customerName: "Alex Customer",
      email: "alex@example.test",
      type: "viewing",
      appointmentAt: new Date(future.getTime() + 3600000),
      appointmentStatus: "confirmed",
    });
    interest = await addEnquiry({
      customerName: "Sam Customer",
      email: "sam@example.test",
      phone: null,
    });
    closed = await addEnquiry({
      customerName: "Closed Customer",
      email: "closed@example.test",
      status: "closed",
    });
    await addEnquiry({
      customerName: "Merged Customer",
      email: "merged@example.test",
      mergedIntoId: interest,
    });
    otherDealer = await addEnquiry({
      dealerId: b,
      vehicleId: null,
      customerName: "Other dealer",
      email: "other@example.test",
    });
    const now = new Date().toISOString();
    sale = {
      id: randomUUID(),
      reference: "SALE-TEST",
      revision: 3,
      createdAt: now,
      updatedAt: now,
      draft: {
        vehicleId: carId,
        vehicle: "Fictional Toyota Yaris",
        customer: "The Buyer",
        email: "buyer@example.test",
        phone: "",
        sourceEnquiryId: buyer,
      },
      payments: [{ id: "unchanged-payment", amountPence: 100000 }],
      documents: [{ id: "unchanged-invoice", snapshot: { price: 10000 } }],
      lifecycle: { status: "sold", vehicleId: carId, changedAt: now },
    } as unknown as SaleWorkspaceRecord;
    await db.insert(saleWorkspaceTable).values({
      id: sale.id,
      dealerId: a,
      reference: sale.reference,
      revision: sale.revision,
      state: sale as unknown as Record<string, unknown>,
    });
  };
  const persist = async () => {
    await pool.query("BEGIN");
    try {
      await pool.query(
        "UPDATE vehicles SET inventory_status='sold',audit_metadata=$2::jsonb WHERE id=$1::uuid",
        [carId, JSON.stringify({ saleWorkspaceId: sale.id })],
      );
      await createSoldVehicleFollowUps(pool, a, sale, "Fictional staff");
      await pool.query("COMMIT");
    } catch (error) {
      await pool.query("ROLLBACK");
      throw error;
    }
  };
  const detail = () => call("GET", `/${sale.id}`);
  const action = (id: string, body: unknown, role = "owner", dealer = a) =>
    call("POST", `/${sale.id}/customers/${id}`, body, role, dealer);
  try {
    await fixture();
    await t.test(
      "preview excludes buyer, closed/merged/other-tenant rows and groups duplicate enquiries without losing appointments",
      async () => {
        const result = await detail();
        assert.equal(result.status, 200);
        assert.equal(result.data.sold, false);
        assert.equal(result.data.customers.length, 2);
        assert.equal(result.data.upcomingAppointments, 2);
        const alex = result.data.customers.find(
          (c: any) => c.enquiryId === appointment,
        );
        assert.deepEqual(
          new Set(alex.relatedEnquiryIds),
          new Set([appointment, duplicate, secondAppointment]),
        );
        assert.equal(alex.urgent, true);
        assert.equal(
          (await pool.query("SELECT * FROM sold_vehicle_follow_ups")).rows
            .length,
          0,
        );
        assert.equal((await call("GET", "")).data.total, 0);
      },
    );
    await t.test(
      "unsold cancellation is refused and requires staff authentication and sales permission",
      async () => {
        assert.equal((await detail()).status, 200);
        assert.equal(
          (await call("GET", `/${sale.id}`, undefined, "")).status,
          401,
        );
        assert.equal(
          (
            await action(appointment, {
              action: "cancel_appointment",
              expectedRevision: 0,
              expectedAppointmentRevision: 0,
            })
          ).status,
          409,
        );
        assert.equal(
          (
            await action(
              appointment,
              {
                action: "cancel_appointment",
                expectedRevision: 0,
                expectedAppointmentRevision: 0,
              },
              "accounts",
            )
          ).status,
          403,
        );
      },
    );
    await t.test(
      "confirmed sale creates durable work without cancelling or sending; identical hook does not duplicate",
      async () => {
        await persist();
        await createSoldVehicleFollowUps(pool, a, sale, "Fictional staff");
        const review = (await detail()).data;
        assert.equal(review.sold, true);
        assert.equal(review.remaining, 2);
        assert.equal((await call("GET", "")).data.total, 1);
        assert.equal(
          (await pool.query("SELECT * FROM sold_vehicle_follow_ups")).rows
            .length,
          2,
        );
        const booking = (
          await pool.query("SELECT * FROM enquiries WHERE id=$1", [appointment])
        ).rows[0];
        assert.equal(booking.appointment_cancelled_at, null);
        assert.equal(booking.reminder_status, "pending");
        assert.equal(outbound, 0);
      },
    );
    await t.test(
      "tenant isolation includes details and every mutation; malformed IDs/bodies rejected",
      async () => {
        assert.equal(
          (await call("GET", `/${sale.id}`, undefined, "owner", b)).status,
          404,
        );
        assert.equal(
          (await call("GET", "", undefined, "owner", b)).data.total,
          0,
        );
        assert.equal(
          (
            await action(
              appointment,
              { action: "complete", expectedRevision: 0, outcome: "phone" },
              "owner",
              b,
            )
          ).status,
          404,
        );
        assert.equal((await call("GET", "/not-a-uuid")).status, 404);
        assert.equal(
          (
            await action(interest, {
              action: "complete",
              expectedRevision: 0,
              outcome: "phone",
              invented: true,
            })
          ).status,
          400,
        );
      },
    );
    await t.test(
      "cannot silently finish a live appointment or cancel a stale/incomplete group",
      async () => {
        assert.equal(
          (
            await action(appointment, {
              action: "complete",
              expectedRevision: 0,
              outcome: "not_needed",
            })
          ).status,
          409,
        );
        assert.equal(
          (
            await action(appointment, {
              action: "cancel_appointment",
              expectedRevision: 0,
              expectedAppointmentRevision: 0,
            })
          ).status,
          409,
        );
        assert.equal(
          (
            await action(appointment, {
              action: "cancel_appointment",
              expectedRevision: 0,
              expectedAppointments: [
                { enquiryId: appointment, expectedRevision: 0 },
                { enquiryId: secondAppointment, expectedRevision: 9 },
              ],
            })
          ).status,
          409,
        );
        assert.equal(
          (
            await pool.query(
              "SELECT * FROM enquiries WHERE id=ANY($1::uuid[]) AND appointment_cancelled_at IS NOT NULL",
              [[appointment, secondAppointment]],
            )
          ).rows.length,
          0,
        );
      },
    );
    await t.test(
      "cancellation revokes declarations and reminders, keeps history and finance, and never queues generic mail",
      async () => {
        const before = (
          await pool.query("SELECT state FROM sale_workspace WHERE id=$1", [
            sale.id,
          ])
        ).rows[0].state;
        const declaration = randomUUID();
        await pool.query(
          `INSERT INTO test_drive_declarations(id,dealer_id,enquiry_id,vehicle_id,request_id,token_hash,create_hash,appointment_revision,snapshot,context_hash,statement_version,statement,statement_hash,created_by,expires_at) VALUES($1,$2,$3,$4,$5,$6,'test',0,'{}','test','test','test','test','Staff',now()+interval '2 days')`,
          [declaration, a, appointment, carId, randomUUID(), "a".repeat(64)],
        );
        const result = await action(
          appointment,
          {
            action: "cancel_appointment",
            expectedRevision: 0,
            expectedAppointments: [
              { enquiryId: appointment, expectedRevision: 0 },
              { enquiryId: secondAppointment, expectedRevision: 0 },
            ],
          },
          "salesperson",
        );
        assert.equal(result.status, 200);
        const alex = result.data.customers.find(
          (c: any) => c.enquiryId === appointment,
        );
        assert.equal(alex.revision, 1);
        assert.equal(alex.cancelledByReview, true);
        assert.equal(alex.status, "pending");
        assert.equal(result.data.upcomingAppointments, 0);
        for (const e of (
          await pool.query("SELECT * FROM enquiries WHERE id=ANY($1::uuid[])", [
            [appointment, secondAppointment],
          ])
        ).rows) {
          assert.ok(e.appointment_cancelled_at);
          assert.equal(e.appointment_revision, 1);
          assert.equal(e.reminder_status, "not_scheduled");
          assert.equal(e.customer_notification_status, "not_sent");
          assert.equal(e.dealer_notification_status, "not_sent");
          assert.ok(e.appointment_at);
        }
        assert.ok(
          (
            await pool.query(
              "SELECT revoked_at FROM test_drive_declarations WHERE id=$1",
              [declaration],
            )
          ).rows[0].revoked_at,
        );
        assert.equal(
          (
            await pool.query(
              "SELECT * FROM enquiry_events WHERE kind='viewing_cancelled'",
            )
          ).rows.length,
          2,
        );
        assert.equal(
          (
            await pool.query(
              "SELECT appointment_cancelled_at FROM enquiries WHERE id=$1",
              [buyer],
            )
          ).rows[0].appointment_cancelled_at,
          null,
        );
        assert.deepEqual(
          (
            await pool.query("SELECT state FROM sale_workspace WHERE id=$1", [
              sale.id,
            ])
          ).rows[0].state,
          before,
        );
        assert.equal(
          (await pool.query("SELECT * FROM enquiry_emails")).rows.length,
          0,
        );
        assert.equal(outbound, 0);
      },
    );
    await t.test(
      "duplicate cancellation and stale completion return conflict without duplicate events",
      async () => {
        assert.equal(
          (
            await action(appointment, {
              action: "cancel_appointment",
              expectedRevision: 0,
              expectedAppointmentRevision: 0,
            })
          ).status,
          409,
        );
        assert.equal(
          (
            await action(appointment, {
              action: "complete",
              expectedRevision: 0,
              outcome: "phone",
            })
          ).status,
          409,
        );
        assert.equal(
          (
            await pool.query(
              "SELECT * FROM enquiry_events WHERE kind='viewing_cancelled'",
            )
          ).rows.length,
          2,
        );
      },
    );
    await t.test(
      "missing/old/failed/unknown emails cannot mark a customer contacted",
      async () => {
        assert.equal(
          (
            await action(appointment, {
              action: "complete",
              expectedRevision: 1,
              outcome: "email",
            })
          ).status,
          409,
        );
        for (const [status, offset] of [
          ["sent", -3600000],
          ["failed", 1000],
          ["unknown", 1000],
        ] as const) {
          await db.insert(enquiryEmailsTable).values({
            id: randomUUID(),
            dealerId: a,
            enquiryId: appointment,
            requestId: randomUUID(),
            requestHash: "fictional",
            status,
            recipient: "alex@example.test",
            subject: "Fictional update",
            message: "Fictional message",
            createdBy: "Fictional staff",
            createdAt: new Date(Date.now() + offset),
          });
        }
        assert.equal(
          (
            await action(appointment, {
              action: "complete",
              expectedRevision: 1,
              outcome: "email",
            })
          ).status,
          409,
        );
        assert.equal((await detail()).data.remaining, 2);
      },
    );
    let sentId: string;
    await t.test(
      "staff-reviewed sent email completes one grouped customer and reports sent rather than delivered",
      async () => {
        sentId = randomUUID();
        await db.insert(enquiryEmailsTable).values({
          id: sentId,
          dealerId: a,
          enquiryId: appointment,
          requestId: (await detail()).data.customers.find(
            (c: any) => c.enquiryId === appointment,
          ).emailRequestId,
          requestHash: "fictional",
          status: "sent",
          recipient: "alex@example.test",
          subject: "Fictional sold update",
          message: "Fictional approved update",
          providerId: "fictional-provider",
          createdBy: "Fictional staff",
          createdAt: new Date(Date.now() + 1500),
        });
        const result = await action(appointment, {
          action: "complete",
          expectedRevision: 1,
          outcome: "email",
          emailId: sentId,
        });
        assert.equal(result.status, 200);
        assert.equal(result.data.remaining, 1);
        assert.equal(
          result.data.customers.find((c: any) => c.enquiryId === appointment)
            .emailStatus,
          "sent",
        );
      },
    );
    await t.test(
      "later bounce reopens Home follow-up; phone contact resolves it without discarding enquiry",
      async () => {
        await db.insert(emailDeliveryChecksTable).values({
          dealerId: a,
          messageKey: `enquiry:${sentId}`,
          providerId: "fictional-provider",
          lastEvent: "bounced",
        });
        let review = (await detail()).data;
        const alex = review.customers.find(
          (c: any) => c.enquiryId === appointment,
        );
        assert.equal(alex.status, "pending");
        assert.equal(alex.email, null);
        assert.equal(review.remaining, 2);
        assert.equal((await call("GET", "")).data.total, 1);
        const result = await action(appointment, {
          action: "complete",
          expectedRevision: alex.revision,
          outcome: "phone",
          note: "Customer told by phone; offer another vehicle.",
        });
        assert.equal(result.status, 200);
        assert.equal(result.data.remaining, 1);
        assert.equal(
          (
            await pool.query("SELECT status FROM enquiries WHERE id=$1", [
              appointment,
            ])
          ).rows[0].status,
          "new",
        );
      },
    );
    await t.test(
      "optional interested customer may be marked not needed; history remains and Home clears only when finished",
      async () => {
        const result = await action(interest, {
          action: "complete",
          expectedRevision: 0,
          outcome: "not_needed",
          note: "Duplicate phone conversation already recorded.",
        });
        assert.equal(result.status, 200);
        assert.equal(result.data.remaining, 0);
        assert.equal((await call("GET", "")).data.total, 0);
        assert.equal(
          (
            await pool.query("SELECT status FROM enquiries WHERE id=$1", [
              interest,
            ])
          ).rows[0].status,
          "new",
        );
      },
    );
    await t.test(
      "existing sold cars are not backfilled and never generate outreach from an old history",
      async () => {
        await fixture();
        await pool.query(
          "UPDATE vehicles SET inventory_status='sold',audit_metadata=$2::jsonb WHERE id=$1",
          [carId, JSON.stringify({ saleWorkspaceId: sale.id })],
        );
        assert.equal((await detail()).data.customers.length, 0);
        assert.equal((await call("GET", "")).data.total, 0);
      },
    );
    await t.test(
      "same shared contact with a different name is not incorrectly excluded as buyer",
      async () => {
        await fixture();
        const family = await addEnquiry({
          customerName: "Different Family Member",
          email: "buyer@example.test",
          type: "viewing",
          appointmentAt: future,
        });
        await persist();
        assert.ok(
          (await detail()).data.customers.some(
            (c: any) => c.enquiryId === family,
          ),
        );
      },
    );
    await t.test(
      "transaction rollback leaves no partial sold follow-up records",
      async () => {
        await fixture();
        await pool.query("BEGIN");
        await createSoldVehicleFollowUps(pool, a, sale, "Fictional staff");
        await pool.query("ROLLBACK");
        assert.equal(
          (await pool.query("SELECT * FROM sold_vehicle_follow_ups")).rows
            .length,
          0,
        );
      },
    );
    await t.test(
      "reservation buyer is excluded through the linked lead even when staff formatted their name differently",
      async () => {
        await fixture();
        const reservationId = randomUUID();
        await pool.query(
          "UPDATE enquiries SET customer_name='Buyer original full name' WHERE id=$1",
          [buyer],
        );
        await pool.query(
          "INSERT INTO leads(id,dealer_id,enquiry_id,vehicle_id,customer_name,email,source,stage) VALUES($1,$2,$3,$4,'Original reservation name','buyer@example.test','website_form','reserved')",
          [reservationId, a, buyer, carId],
        );
        delete sale.draft.sourceEnquiryId;
        sale.draft.sourceReservationId = reservationId;
        sale.draft.customer = "B. Name";
        await pool.query(
          "UPDATE sale_workspace SET state=$2::jsonb WHERE id=$1",
          [sale.id, JSON.stringify(sale)],
        );
        await persist();
        assert.ok(
          !(await detail()).data.customers.some((c: any) =>
            c.relatedEnquiryIds.includes(buyer),
          ),
        );
      },
    );
    await t.test(
      "moved and merged enquiries are never cancelled from an outdated sold-car task",
      async () => {
        await fixture();
        await persist();
        const newCar = (
          await db
            .insert(vehiclesTable)
            .values({
              dealerId: a,
              source: "autotrader",
              advertId: randomUUID(),
              title: "Different car",
            })
            .returning()
        )[0].id;
        await pool.query(
          "UPDATE enquiries SET vehicle_id=$2::uuid WHERE id=$1::uuid",
          [appointment, newCar],
        );
        assert.equal(
          (
            await action(appointment, {
              action: "cancel_appointment",
              expectedRevision: 0,
              expectedAppointments: [
                { enquiryId: appointment, expectedRevision: 0 },
                { enquiryId: secondAppointment, expectedRevision: 0 },
              ],
            })
          ).status,
          409,
        );
        assert.ok(
          (await detail()).data.customers.find(
            (c: any) => c.enquiryId === appointment,
          ).blockedReason,
        );
        assert.equal(
          (await detail()).data.customers.find(
            (c: any) => c.enquiryId === appointment,
          ).email,
          null,
        );
        assert.equal(
          (
            await pool.query(
              "SELECT appointment_cancelled_at FROM enquiries WHERE id=$1",
              [appointment],
            )
          ).rows[0].appointment_cancelled_at,
          null,
        );
        await pool.query(
          "UPDATE enquiries SET merged_into_id=$2::uuid WHERE id=$1::uuid",
          [interest, duplicate],
        );
        assert.equal(
          (
            await action(interest, {
              action: "complete",
              expectedRevision: 0,
              outcome: "phone",
            })
          ).status,
          409,
        );
      },
    );
    await t.test(
      "cancelled appointments stay urgent until customer contact and cannot be dismissed as not needed",
      async () => {
        await fixture();
        await persist();
        const result = await action(appointment, {
          action: "cancel_appointment",
          expectedRevision: 0,
          expectedAppointments: [
            { enquiryId: appointment, expectedRevision: 0 },
            { enquiryId: secondAppointment, expectedRevision: 0 },
          ],
        });
        assert.equal(result.status, 200);
        assert.equal(
          result.data.customers.find((c: any) => c.enquiryId === appointment)
            .urgent,
          true,
        );
        assert.equal(
          (
            await action(appointment, {
              action: "complete",
              expectedRevision: 1,
              outcome: "not_needed",
            })
          ).status,
          409,
        );
        assert.equal(
          (await call("GET", "")).data.tasks[0].customers.find(
            (c: any) => c.enquiryId === appointment,
          ).urgent,
          true,
        );
      },
    );
    await t.test(
      "a sent email later marked unknown reopens Home even without a delivery-check row",
      async () => {
        await fixture();
        await persist();
        const id = randomUUID();
        await db.insert(enquiryEmailsTable).values({
          id,
          dealerId: a,
          enquiryId: interest,
          requestId: (await detail()).data.customers.find(
            (c: any) => c.enquiryId === interest,
          ).emailRequestId,
          requestHash: "fictional",
          status: "sent",
          recipient: "sam@example.test",
          subject: "Fictional update",
          message: "Reviewed update",
          createdBy: "Fictional staff",
          createdAt: new Date(Date.now() + 1000),
        });
        assert.equal(
          (
            await action(interest, {
              action: "complete",
              expectedRevision: 0,
              outcome: "email",
              emailId: id,
            })
          ).status,
          200,
        );
        await pool.query(
          "UPDATE enquiry_emails SET status='unknown' WHERE id=$1",
          [id],
        );
        assert.equal(
          (await detail()).data.customers.find(
            (c: any) => c.enquiryId === interest,
          ).status,
          "pending",
        );
        assert.equal(
          (await call("GET", "")).data.tasks[0].customers.find(
            (c: any) => c.enquiryId === interest,
          ).status,
          "pending",
        );
      },
    );
    await t.test(
      "an unrelated recent email cannot complete the sold-car update, and its durable send key survives refresh",
      async () => {
        await fixture();
        await persist();
        const first = (await detail()).data.customers.find(
          (c: any) => c.enquiryId === interest,
        ).emailRequestId;
        assert.ok(first);
        assert.equal(
          (await detail()).data.customers.find(
            (c: any) => c.enquiryId === interest,
          ).emailRequestId,
          first,
        );
        await db.insert(enquiryEmailsTable).values({
          id: randomUUID(),
          dealerId: a,
          enquiryId: interest,
          requestId: randomUUID(),
          requestHash: "fictional",
          status: "sent",
          recipient: "sam@example.test",
          subject: "Unrelated recent email",
          message: "Not the reviewed update",
          createdBy: "Fictional staff",
          createdAt: new Date(Date.now() + 1000),
        });
        assert.equal(
          (
            await action(interest, {
              action: "complete",
              expectedRevision: 0,
              outcome: "email",
            })
          ).status,
          409,
        );
      },
    );
    await t.test(
      "appointments without any contact details can be explicitly recorded unreachable without pretending contact",
      async () => {
        await fixture();
        await pool.query(
          "UPDATE enquiries SET email=NULL,phone=NULL WHERE id=ANY($1::uuid[])",
          [[appointment, duplicate, secondAppointment]],
        );
        await persist();
        const result = await action(appointment, {
          action: "cancel_appointment",
          expectedRevision: 0,
          expectedAppointmentRevision: 0,
        });
        assert.equal(result.status, 200);
        assert.equal(
          (
            await action(appointment, {
              action: "complete",
              expectedRevision: 1,
              outcome: "not_needed",
            })
          ).status,
          409,
        );
        const finished = await action(appointment, {
          action: "complete",
          expectedRevision: 1,
          outcome: "not_needed",
          note: "Unable to contact: no email or telephone was supplied.",
        });
        assert.equal(finished.status, 200);
        const customer = finished.data.customers.find(
          (c: any) => c.enquiryId === appointment,
        );
        assert.equal(customer.status, "not_needed");
        assert.equal(customer.contactedAt, null);
      },
    );
    await t.test(
      "blocked follow-ups remain on Home until their original booking is handled and a meaningful note is recorded",
      async () => {
        await fixture();
        await persist();
        const newCar = (
          await db
            .insert(vehiclesTable)
            .values({
              dealerId: a,
              source: "autotrader",
              advertId: randomUUID(),
              title: "Alternative",
            })
            .returning()
        )[0].id;
        await pool.query(
          "UPDATE enquiries SET vehicle_id=$2::uuid WHERE id=ANY($1::uuid[])",
          [[appointment, duplicate, secondAppointment], newCar],
        );
        assert.ok(
          (await call("GET", "")).data.tasks[0].customers.find(
            (c: any) => c.enquiryId === appointment,
          ).blockedReason,
        );
        assert.equal(
          (
            await action(appointment, {
              action: "complete",
              expectedRevision: 0,
              outcome: "not_needed",
            })
          ).status,
          409,
        );
        const resolved = await action(appointment, {
          action: "complete",
          expectedRevision: 0,
          outcome: "not_needed",
          note: "Customer agreed a replacement vehicle and booking was moved.",
        });
        assert.equal(resolved.status, 200);
        assert.equal(
          (
            await pool.query(
              "SELECT appointment_cancelled_at FROM enquiries WHERE id=$1",
              [appointment],
            )
          ).rows[0].appointment_cancelled_at,
          null,
        );
        assert.equal(
          resolved.data.customers.find((c: any) => c.enquiryId === appointment)
            .status,
          "not_needed",
        );
      },
    );
    await t.test(
      "Home applies appointment urgency before the 100-sale cap",
      async () => {
        await fixture();
        const newest = randomUUID(),
          time = new Date();
        for (let i = 0; i < 101; i++) {
          const vehicle = randomUUID(),
            id = i === 100 ? newest : randomUUID(),
            enquiry = randomUUID();
          const state = {
            ...sale,
            id,
            draft: { ...sale.draft, vehicleId: vehicle },
            updatedAt: time.toISOString(),
          };
          await pool.query(
            "INSERT INTO vehicles(id,dealer_id,source,advert_id,title,inventory_status,audit_metadata) VALUES($1,$2,'autotrader',$3,'Fictional scale car','sold',$4::jsonb)",
            [vehicle, a, randomUUID(), JSON.stringify({ saleWorkspaceId: id })],
          );
          await pool.query(
            "INSERT INTO sale_workspace(id,dealer_id,reference,revision,state) VALUES($1,$2,$3,1,$4::jsonb)",
            [id, a, `SCALE-${i}`, JSON.stringify(state)],
          );
          await pool.query(
            "INSERT INTO enquiries(id,dealer_id,vehicle_id,type,customer_name,email,message,appointment_at) VALUES($1,$2,$3,$4,'Fictional scale customer','scale@example.test','Fictional scale test',$5)",
            [
              enquiry,
              a,
              vehicle,
              i === 100 ? "viewing" : "general",
              i === 100 ? future : null,
            ],
          );
          await pool.query(
            "INSERT INTO sold_vehicle_follow_ups(dealer_id,sale_id,vehicle_id,enquiry_id,related_enquiry_ids,kind,updated_by,created_at) VALUES($1,$2,$3,$4,$5::jsonb,$6,'Fictional staff',$7)",
            [
              a,
              id,
              vehicle,
              enquiry,
              JSON.stringify([enquiry]),
              i === 100 ? "appointment" : "interest",
              new Date(time.getTime() + i),
            ],
          );
        }
        const result = await call("GET", "");
        assert.equal(result.status, 200);
        assert.equal(result.data.tasks.length, 100);
        assert.equal(result.data.tasks[0].saleId, newest);
      },
    );
    await t.test(
      "an accepted email is recoverable after the browser closes before follow-up completion",
      async () => {
        await fixture();
        await persist();
        const customer = (await detail()).data.customers.find(
            (c: any) => c.enquiryId === interest,
          ),
          id = randomUUID();
        await db.insert(enquiryEmailsTable).values({
          id,
          dealerId: a,
          enquiryId: interest,
          requestId: customer.emailRequestId,
          requestHash: "fictional",
          status: "sent",
          recipient: "corrected.sam@example.test",
          subject: "Approved update",
          message: "Fictional reviewed message",
          providerId: "fictional-recovery-provider",
          createdBy: "Fictional staff",
          createdAt: new Date(Date.now() + 1000),
        });
        const reopened = (await detail()).data.customers.find(
          (c: any) => c.enquiryId === interest,
        );
        assert.equal(reopened.status, "pending");
        assert.equal(reopened.emailStatus, "sent");
        assert.equal(reopened.emailRequestId, customer.emailRequestId);
        const finished = await action(interest, {
          action: "complete",
          expectedRevision: reopened.revision,
          outcome: "email",
        });
        assert.equal(finished.status, 200);
        assert.equal(
          finished.data.customers.find((c: any) => c.enquiryId === interest)
            .status,
          "contacted",
        );
        const event = (
          await pool.query(
            "SELECT detail FROM enquiry_events WHERE enquiry_id=$1 AND kind='conversation_logged'",
            [interest],
          )
        ).rows[0];
        assert.equal(event.detail.emailRecipient, "corrected.sam@example.test");
        assert.equal(
          (await pool.query("SELECT * FROM enquiry_emails")).rows.length,
          1,
        );
        assert.equal(outbound, 0);
      },
    );
    await t.test(
      "two staff sending the shared task UUID through the real email route produce one provider submission",
      async () => {
        await fixture();
        await persist();
        const customer = (await detail()).data.customers.find(
            (c: any) => c.enquiryId === interest,
          ),
          base = `/api/staff/enquiries/${interest}`;
        const draft = {
          to: "sam@example.test",
          subject: "Approved sold update",
          message: "This car has sold. We can help with another car.",
          includeVehicle: false,
          includeAppointment: false,
          photoIds: [],
          documentIds: [],
          expectedRevision: 0,
        };
        const preview = await call("POST", base + "/email-preview", draft);
        assert.equal(preview.status, 200);
        const payload = {
          ...draft,
          requestId: customer.emailRequestId,
          previewHash: preview.data.previewHash,
        };
        const before = fakeProviderSends,
          pair = await Promise.all([
            call("POST", base + "/email", payload),
            call("POST", base + "/email", payload),
          ]);
        assert.deepEqual(pair.map((r) => r.status).sort(), [200, 201]);
        assert.equal(fakeProviderSends, before + 1);
        assert.equal(
          (await call("POST", base + "/email", payload)).data.replayed,
          true,
        );
        assert.equal(
          (
            await call("POST", base + "/email", {
              ...payload,
              message: "Another staff member changed the message.",
            })
          ).status,
          409,
        );
        assert.equal(fakeProviderSends, before + 1);
        assert.equal(
          (
            await action(interest, {
              action: "complete",
              expectedRevision: customer.revision,
              outcome: "email",
            })
          ).status,
          200,
        );
        assert.equal(
          (await pool.query("SELECT * FROM enquiry_emails")).rows.length,
          1,
        );
        assert.equal(outbound, 0);
      },
    );
    assert.equal(outbound, 0);
  } finally {
    globalThis.fetch = originalFetch;
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
    await engine.close();
  }
});
