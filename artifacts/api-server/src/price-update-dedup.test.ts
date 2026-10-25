import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import {
  db,
  engine,
  pool,
  dealershipsTable,
  vehiclesTable,
  enquiriesTable,
  stockChangeTasksTable,
} from "./test/tenant-test-db";
import {
  claimPriceUpdate,
  finishPriceUpdate,
  readPriceUpdateClaim,
  stockPriceIdentity,
  watchPriceIdentity,
} from "./lib/price-update-dedup";
import { validateStockChangeMessage } from "./lib/stock-change-message-context";

await engine.waitReady;
globalThis.fetch = async () => {
  throw new Error("External requests are forbidden.");
};
test("Watch and enquiry price emails share one durable recipient claim", async (t) => {
  try {
    for (const name of (await readdir("../../lib/db/drizzle"))
      .filter((n) => /^\d.*\.sql$/.test(n) && !n.startsWith("0056_"))
      .sort())
      await engine.exec(await readFile("../../lib/db/drizzle/" + name, "utf8"));
    const dealer = "dedup-fictional",
      other = "dedup-other";
    for (const id of [dealer, other])
      await db
        .insert(dealershipsTable)
        .values({
          id,
          name: "Fictional dealership",
          status: "active",
          canonicalOrigin: `https://${id}.example.test`,
          stockPlatform: "autotrader",
          retailerId: "fictional",
          sourceUrl:
            "https://www.autotrader.co.uk/cars/retailer/stock?retailerId=fictional",
        });
    async function fixture(id = dealer) {
      const vehicle = randomUUID(),
        enquiry = randomUUID(),
        task = randomUUID(),
        watch = randomUUID(),
        event = randomUUID(),
        changeKey = randomUUID(),
        email = "customer@example.test";
      await db
        .insert(vehiclesTable)
        .values({
          id: vehicle,
          dealerId: id,
          source: "autotrader",
          advertId: vehicle,
          title: "Fictional Ford Focus",
          sourcePrice: 8495,
          inventoryStatus: "available",
        });
      await db
        .insert(enquiriesTable)
        .values({
          id: enquiry,
          dealerId: id,
          type: "general",
          customerName: "Fictional customer",
          email,
          vehicleId: vehicle,
          vehicleTitle: "Fictional Ford Focus",
          message: "Fictional test only.",
        });
      await db
        .insert(stockChangeTasksTable)
        .values({
          id: task,
          dealerId: id,
          vehicleId: vehicle,
          kind: "price_drop",
          changeKey,
          previousPrice: 8995,
          currentPrice: 8495,
        });
      await pool.query(
        "INSERT INTO vehicle_watches(id,dealer_id,vehicle_id,email,status,email_verified_at) VALUES($1,$2,$3,$4,'active',now()-interval '1 day')",
        [watch, id, vehicle, email],
      );
      await pool.query(
        "INSERT INTO vehicle_watch_events(id,dealer_id,vehicle_id,kind,change_key,previous_price,current_price) VALUES($1,$2,$3,'price_drop',$4,8995,8495)",
        [event, id, vehicle, "price:" + changeKey],
      );
      const identity = { dealerId: id, vehicleId: vehicle, changeKey, email },
        context = { taskId: task, revision: 0 },
        target = { dealerId: id, enquiryId: enquiry, email };
      return {
        vehicle,
        enquiry,
        task,
        watch,
        event,
        changeKey,
        email,
        identity,
        context,
        target,
      };
    }
    const query = pool.query.bind(pool),
      reader = { query, activePlatform: "autotrader" };
    await t.test(
      "migration preserves pre-release queued, sent and uncertain approvals without sending anything",
      async () => {
        const states = ["queued", "sent", "unknown", "failed"] as const,
          rows = [];
        for (const status of states) {
          const f = await fixture(),
            delivery = randomUUID();
          await pool.query(
            "INSERT INTO email_outbox(dealer_id,enquiry_id,delivery_id,kind,send_key,payload_hash,validation_hash,validation,account_hash,status,retry_deadline) VALUES($1,$2,$3,'staff',$4,'fictional','fictional',$5::jsonb,'fictional',$6,now()+interval '1 hour')",
            [
              dealer,
              f.enquiry,
              delivery,
              randomUUID(),
              JSON.stringify({
                input: {
                  to: " CUSTOMER@EXAMPLE.TEST ",
                  stockChange: f.context,
                },
              }),
              status,
            ],
          );
          rows.push({ f, delivery, status });
        }
        const watch = await fixture(),
          delivery = randomUUID(),
          request = randomUUID();
        await pool.query(
          "INSERT INTO vehicle_watch_deliveries(id,dealer_id,event_id,watch_id,request_id,status,subject,message) VALUES($1,$2,$3,$4,$5,'sent','Fictional','Fictional')",
          [delivery, dealer, watch.event, watch.watch, request],
        );
        await engine.exec(
          await readFile(
            "../../lib/db/drizzle/0056_price_update_recipient_claims.sql",
            "utf8",
          ),
        );
        for (const { f, delivery, status } of rows) {
          const claim = await readPriceUpdateClaim(query, f.identity);
          if (status === "failed") assert.equal(claim, undefined);
          else {
            assert.equal(claim?.source_key, "enquiry:" + delivery);
            assert.equal(
              claim?.status,
              status === "queued"
                ? "processing"
                : status === "unknown"
                  ? "uncertain"
                  : "sent",
            );
          }
        }
        assert.equal(
          (await readPriceUpdateClaim(query, watch.identity))?.source_key,
          `watch:${delivery}:${request}`,
        );
      },
    );
    await t.test(
      "Watch first blocks an unchanged saved enquiry draft at preview and send validation",
      async () => {
        const f = await fixture(),
          draft = {
            stockChange: f.context,
            message: "Exact reviewed wording £8,495.",
          },
          before = JSON.stringify(draft);
        await validateStockChangeMessage(f.context, f.target, reader);
        const watchSource = "watch:" + randomUUID() + ":" + randomUUID();
        assert.equal(
          await claimPriceUpdate(query, f.identity, watchSource),
          true,
        );
        await assert.rejects(
          () => validateStockChangeMessage(f.context, f.target, reader),
          /already approved/,
        );
        await finishPriceUpdate(query, f.identity, watchSource, "sent");
        await assert.rejects(
          () => validateStockChangeMessage(f.context, f.target, reader),
          /already approved/,
        );
        assert.equal(
          await claimPriceUpdate(query, f.identity, "enquiry:" + randomUUID()),
          false,
        );
        assert.equal(
          JSON.stringify(draft),
          before,
          "Dedupe never rewrites staff wording.",
        );
      },
    );
    await t.test(
      "enquiry first excludes Watch while its own bounded retry keeps the same claim",
      async () => {
        const f = await fixture(),
          enquirySource = "enquiry:" + randomUUID();
        assert.equal(
          await claimPriceUpdate(query, f.identity, enquirySource),
          true,
        );
        await validateStockChangeMessage(
          f.context,
          { ...f.target, priceClaimSource: enquirySource },
          reader,
        );
        assert.equal(
          await claimPriceUpdate(query, f.identity, "watch:" + randomUUID()),
          false,
        );
        assert.equal(
          await claimPriceUpdate(query, f.identity, enquirySource),
          true,
        );
        await finishPriceUpdate(query, f.identity, enquirySource, "sent");
        assert.equal(
          await claimPriceUpdate(query, f.identity, "watch:" + randomUUID()),
          false,
        );
        await assert.rejects(
          () => validateStockChangeMessage(f.context, f.target, reader),
          /already approved/,
        );
      },
    );
    await t.test(
      "simultaneous independent approvals reach only one recording provider",
      async () => {
        const f = await fixture(),
          sent: string[] = [];
        const approve = async (source: string) => {
          if (await claimPriceUpdate(query, f.identity, source)) {
            sent.push(source);
            await finishPriceUpdate(query, f.identity, source, "sent");
          }
        };
        await Promise.all([
          approve("watch:" + randomUUID()),
          approve("enquiry:" + randomUUID()),
        ]);
        assert.equal(sent.length, 1);
        assert.equal(
          (await readPriceUpdateClaim(query, f.identity))?.source_key,
          sent[0],
        );
      },
    );
    await t.test(
      "uncertain acceptance and interrupted processing remain blocked beyond payload retention",
      async () => {
        for (const status of ["processing", "uncertain"] as const) {
          const f = await fixture(),
            source = "watch:" + randomUUID();
          await claimPriceUpdate(query, f.identity, source);
          if (status === "uncertain")
            await finishPriceUpdate(query, f.identity, source, status);
          await pool.query(
            "UPDATE price_update_recipient_claims SET created_at=now()-interval '7 days',updated_at=now()-interval '7 days' WHERE dealer_id=$1 AND vehicle_id=$2",
            [dealer, f.vehicle],
          );
          assert.equal(
            await claimPriceUpdate(
              query,
              f.identity,
              "enquiry:" + randomUUID(),
            ),
            false,
          );
          await assert.rejects(
            () => validateStockChangeMessage(f.context, f.target, reader),
            /already approved/,
          );
        }
      },
    );
    await t.test(
      "proven nonacceptance releases only its own processing claim",
      async () => {
        const f = await fixture(),
          first = "enquiry:" + randomUUID(),
          second = "watch:" + randomUUID();
        await claimPriceUpdate(query, f.identity, first);
        await finishPriceUpdate(query, f.identity, second, "release");
        assert.ok(await readPriceUpdateClaim(query, f.identity));
        await finishPriceUpdate(query, f.identity, first, "release");
        assert.equal(await readPriceUpdateClaim(query, f.identity), undefined);
        assert.equal(await claimPriceUpdate(query, f.identity, second), true);
        await finishPriceUpdate(query, f.identity, second, "uncertain");
        await finishPriceUpdate(query, f.identity, second, "release");
        assert.equal(
          (await readPriceUpdateClaim(query, f.identity))?.status,
          "uncertain",
        );
        await finishPriceUpdate(query, f.identity, second, "sent");
        await finishPriceUpdate(query, f.identity, second, "uncertain");
        assert.equal(
          (await readPriceUpdateClaim(query, f.identity))?.status,
          "sent",
        );
      },
    );
    await t.test(
      "normalized address and actual event isolate duplicates across later price drops and dealers",
      async () => {
        const f = await fixture(),
          otherF = await fixture(other),
          source = "enquiry:" + randomUUID();
        const mapped = watchPriceIdentity(
          {
            dealer_id: dealer,
            vehicle_id: f.vehicle,
            change_key: "price:" + f.changeKey,
          },
          " CUSTOMER@EXAMPLE.TEST ",
        );
        assert.deepEqual(
          mapped,
          await stockPriceIdentity(query, dealer, f.task, f.email),
        );
        await claimPriceUpdate(query, mapped, source);
        assert.equal(
          await claimPriceUpdate(
            query,
            { ...f.identity, email: " Customer@Example.Test " },
            "watch:" + randomUUID(),
          ),
          false,
        );
        assert.equal(
          await claimPriceUpdate(
            query,
            { ...f.identity, changeKey: randomUUID() },
            "watch:" + randomUUID(),
          ),
          true,
        );
        assert.equal(
          await claimPriceUpdate(
            query,
            otherF.identity,
            "watch:" + randomUUID(),
          ),
          true,
        );
        assert.equal(
          await stockPriceIdentity(query, other, f.task, f.email),
          undefined,
        );
      },
    );
    await t.test(
      "legacy Watch processing, sent and uncertain receipts block without a durable claim",
      async () => {
        for (const status of ["processing", "sent", "uncertain"]) {
          const f = await fixture();
          await pool.query(
            "INSERT INTO vehicle_watch_deliveries(dealer_id,event_id,watch_id,request_id,status,subject,message) VALUES($1,$2,$3,$4,$5,'Fictional price update','Fictional reviewed words')",
            [dealer, f.event, f.watch, randomUUID(), status],
          );
          await assert.rejects(
            () => validateStockChangeMessage(f.context, f.target, reader),
            /Watch price update/,
          );
        }
      },
    );
    await t.test("generic email validation stays unchanged", async () => {
      const result = await validateStockChangeMessage(
        undefined,
        {
          dealerId: dealer,
          enquiryId: randomUUID(),
          email: "customer@example.test",
        },
        {
          query: async () => {
            throw new Error("Generic messages must not query price claims.");
          },
          activePlatform: "autotrader",
        },
      );
      assert.equal(result, undefined);
    });
  } finally {
    await engine.close();
  }
});
