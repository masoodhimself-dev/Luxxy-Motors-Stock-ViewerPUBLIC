import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, readdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import express from "express";
import { createServer, request } from "node:http";
import { engine, pool } from "./test/tenant-test-db";
import { runWithTenant } from "./lib/tenant-context";
import { permissionsForRole } from "./lib/staff-permissions";
import watchRouter from "./routes/vehicle-watches";
import {
  requestVehicleWatch,
  readVehicleWatches,
  verifyVehicleWatch,
  stopVehicleWatch,
  readVehicleWatchTasks,
  previewVehicleWatchTask,
  sendVehicleWatchTask,
  saveVehicleWatchSettings,
  readVehicleWatchSettings,
  readVehicleWatchCounts,
  requestWatchManageLink,
  allowWatchRequest,
  watchTokenHash,
} from "./lib/vehicle-watches";
import {
  acceptReplyEvent,
  processCustomerReplies,
} from "./lib/customer-email-replies";
process.env.MULTI_TENANT_ENABLED = "false";
process.env.SESSION_SECRET = "fictional-watch-preview-secret";
process.env.RESEND_ENABLED = "true";
process.env.RESEND_API_KEY = "re_fictional";
process.env.RESEND_FROM_EMAIL = "Fictional dealer <sales@example.test>";
process.env.RESEND_REPLY_TO_EMAIL = "sales@example.test";
process.env.EMAIL_REPLIES_ENABLED = "true";
process.env.RESEND_RECEIVING_API_KEY = "re_fictional_receiving";
process.env.RESEND_RECEIVING_WEBHOOK_SECRET = "whsec_fictional";
process.env.EMAIL_REPLY_DOMAINS = JSON.stringify({
  "watch-a": "replies.example.test",
});
globalThis.fetch = async () => {
  throw new Error("External requests forbidden.");
};
const tenant = (id = "watch-a") => ({
  dealerId: id,
  canonicalOrigin: `https://${id}.example.test`,
  platform: "autotrader" as const,
  retailerId: "fictional",
  sourceUrl: "https://www.autotrader.co.uk/fictional",
  kind: "website" as const,
});
const sent: any[] = [];
let mode: "success" | "unknown" | "refused" = "success";
const transport: typeof fetch = async (_url, options) => {
  const body = JSON.parse(String(options?.body));
  sent.push(body);
  if (mode === "unknown") throw new Error("Fictional lost acknowledgement");
  if (mode === "refused")
    return new Response(JSON.stringify({ name: "validation_error" }), {
      status: 422,
    });
  return new Response(JSON.stringify({ id: randomUUID() }), { status: 200 });
};
const tokenFrom = (mail: any) =>
  String(mail.text).match(/\/watch#([A-Za-z0-9_-]{43})/)![1]!;
test("verified vehicle watches, manual messages and replies are tenant isolated and financial-safe", async (t) => {
  await engine.waitReady;
  for (const name of (await readdir("../../lib/db/drizzle"))
    .filter((n) => /^\d.*\.sql$/.test(n))
    .sort())
    await engine.exec(await readFile("../../lib/db/drizzle/" + name, "utf8"));
  const dir = await mkdtemp(join(tmpdir(), "luxxy-watch-test-"));
  process.env.INTEGRATIONS_PRIVATE_DIR = dir;
  const car = randomUUID(),
    other = randomUUID();
  for (const id of ["watch-a", "watch-b"])
    await pool.query(
      "INSERT INTO dealerships(id,name,status,canonical_origin,stock_platform,retailer_id,source_url) VALUES($1,$2,'active',$3,'autotrader','fictional','https://www.autotrader.co.uk/fictional')",
      [id, "Fictional dealer", tenant(id).canonicalOrigin],
    );
  await pool.query(
    "INSERT INTO vehicles(id,dealer_id,source,advert_id,title,source_price,currency) VALUES($1,'watch-a','autotrader','fictional-a','Ford Focus',8495,'GBP'),($2,'watch-b','autotrader','fictional-b','Other car',7000,'GBP')",
    [car, other],
  );
  let verification = "",
    manageToken = "",
    watch = "",
    event = "";
  try {
    await runWithTenant(tenant(), async () => {
      await t.test(
        "signup emails confirmation only, keeps token hashes and creates no enquiry",
        async () => {
          await requestVehicleWatch(car, "customer@example.test", transport);
          verification = tokenFrom(sent.at(-1));
          assert.equal(sent.length, 1);
          assert.match(sent[0].subject, /Confirm/);
          assert.equal(
            (await pool.query("SELECT count(*) FROM enquiries")).rows[0].count,
            0,
          );
          const row = (await pool.query("SELECT * FROM vehicle_watch_tokens"))
            .rows[0];
          assert.equal(row.token_hash, watchTokenHash(verification));
          assert.equal(JSON.stringify(row).includes(verification), false);
          assert.equal(
            (await readVehicleWatches(verification)).verificationRequired,
            true,
          );
          assert.equal(
            (await pool.query("SELECT status FROM vehicle_watches")).rows[0]
              .status,
            "pending",
          );
        },
      );
      await t.test(
        "only explicit confirmation activates watch and issues limited manage capability",
        async () => {
          const result: any = await verifyVehicleWatch(verification);
          manageToken = result.token;
          watch = result.watches[0].id;
          assert.equal(result.verified, true);
          assert.equal(result.watches[0].status, "active");
          assert.equal(result.watches[0].vehicleId, car);
          assert.match(result.emailHint, /c…@/);
          assert.equal((await readVehicleWatchCounts()).counts[0]!.count, 1);
          await assert.rejects(
            () => verifyVehicleWatch(verification),
            /invalid or has expired/,
          );
          await assert.rejects(
            () => readVehicleWatches("bad"),
            /invalid or has expired/,
          );
        },
      );
      await t.test("tokens cannot cross dealership boundaries", async () => {
        await runWithTenant(tenant("watch-b"), () =>
          assert.rejects(
            () => readVehicleWatches(manageToken),
            /invalid or has expired/,
          ),
        );
      });
      await t.test(
        "preview identifies one verified watcher and sends nothing",
        async () => {
          await pool.query(
            "UPDATE vehicle_watches SET email_verified_at=now()-interval '1 day' WHERE id=$1",
            [watch],
          );
          event = randomUUID();
          await pool.query(
            "INSERT INTO vehicle_watch_events(id,dealer_id,vehicle_id,kind,change_key,previous_price,current_price,current_status) VALUES($1,'watch-a',$2,'price_drop','fictional-drop',8995,8495,'available')",
            [event, car],
          );
          const task = (await readVehicleWatchTasks()).tasks[0]!;
          assert.equal(task.pendingCount, 1);
          assert.equal(task.recipients[0].id, watch);
          assert.match(task.message, /8,995/);
          const before = sent.length;
          const p = await previewVehicleWatchTask(event, {
            subject: task.subject,
            message: task.message,
            expectedRevision: 0,
            watchIds: [watch],
          });
          assert.equal(p.ready, true);
          assert.match(p.previewHash, /^[a-f0-9]{64}$/);
          assert.equal(sent.length, before);
        },
      );
      await t.test(
        "unverified watchers and watchers subscribed after event do not receive historical alerts",
        async () => {
          await pool.query(
            "INSERT INTO vehicle_watches(dealer_id,vehicle_id,email,status,email_verified_at) VALUES('watch-a',$1,'unconfirmed@example.test','pending',NULL),('watch-a',$1,'late@example.test','active',now()+interval '1 minute')",
            [car],
          );
          const task = (await readVehicleWatchTasks()).tasks[0]!;
          assert.equal(task.pendingCount, 1);
          assert.equal(task.totalCount, 1);
        },
      );
      await t.test(
        "changed wording, revision, recipients or price invalidate approval",
        async () => {
          const input = {
              subject: "Price update",
              message: "Your car has a new price.",
              expectedRevision: 0,
              watchIds: [watch],
            },
            p = await previewVehicleWatchTask(event, input);
          const count = sent.length;
          await assert.rejects(
            () =>
              sendVehicleWatchTask(
                event,
                {
                  ...input,
                  message: "Unreviewed edit",
                  previewHash: p.previewHash,
                  requestId: randomUUID(),
                },
                "Fictional owner",
                transport,
              ),
            /Review this message again/,
          );
          await pool.query(
            "UPDATE vehicles SET source_price=7995 WHERE id=$1",
            [car],
          );
          await assert.rejects(
            () => previewVehicleWatchTask(event, input),
            /changed/,
          );
          await pool.query(
            "UPDATE vehicles SET source_price=8495 WHERE id=$1",
            [car],
          );
          assert.equal(sent.length, count);
        },
      );
      await t.test(
        "manual send adds canonical car and stop links, preserves one receipt, no signup enquiry",
        async () => {
          const input = {
              subject: "A price update",
              message: "Hello, the Ford Focus is now £8,495.",
              expectedRevision: 0,
              watchIds: [watch],
            },
            p = await previewVehicleWatchTask(event, input),
            requestId = randomUUID();
          const result = await sendVehicleWatchTask(
            event,
            { ...input, previewHash: p.previewHash, requestId },
            "Fictional owner",
            transport,
          );
          assert.equal(result.sentCount, 1);
          const outgoing = sent.at(-1);
          assert.match(outgoing.text, new RegExp(`/vehicle/${car}`));
          assert.match(outgoing.text, /Manage updates or stop watching/);
          assert.match(outgoing.reply_to, /^w-/);
          assert.equal(
            (await pool.query("SELECT count(*) FROM enquiries")).rows[0].count,
            0,
          );
          const before = sent.length;
          const replay = await sendVehicleWatchTask(
            event,
            { ...input, previewHash: p.previewHash, requestId },
            "Fictional owner",
            transport,
          );
          assert.equal(replay.sentCount, 1);
          assert.equal(sent.length, before);
          assert.equal((await readVehicleWatchTasks()).tasks.length, 0);
        },
      );
      await t.test(
        "actual validated reply creates correct enquiry, outbound and incoming history once",
        async () => {
          const address = sent.at(-1).reply_to,
            provider = randomUUID();
          await acceptReplyEvent({
            type: "email.received",
            data: { email_id: provider, to: [address] },
          });
          assert.equal(
            (await pool.query("SELECT count(*) FROM enquiries")).rows[0].count,
            0,
          );
          const incoming: typeof fetch = async () =>
            new Response(
              JSON.stringify({
                id: provider,
                to: [address],
                from: "customer@example.test",
                subject: "Re: Price update",
                text: "Can I visit tomorrow?",
                message_id: "<fictional-watch@example.test>",
                authentication: { dmarc: "pass" },
                attachments: [],
              }),
              { status: 200 },
            );
          await processCustomerReplies({ warn() {} }, incoming);
          const enq = (await pool.query("SELECT * FROM enquiries")).rows[0];
          assert.equal(enq.dealer_id, "watch-a");
          assert.equal(enq.vehicle_id, car);
          assert.equal(enq.email, "customer@example.test");
          const history = (
            await pool.query(
              "SELECT * FROM enquiry_events WHERE enquiry_id=$1",
              [enq.id],
            )
          ).rows;
          assert.equal(history.length, 2);
          assert.ok(
            history.some((h) => h.summary === "Customer email received"),
          );
          assert.ok(
            history.some((h) => h.summary === "Car watch update emailed"),
          );
          await acceptReplyEvent({
            type: "email.received",
            data: { email_id: provider, to: [address] },
          });
          await processCustomerReplies({ warn() {} }, incoming);
          assert.equal(
            (await pool.query("SELECT count(*) FROM enquiries")).rows[0].count,
            1,
          );
          const delivery = (
            await pool.query(
              "SELECT * FROM vehicle_watch_deliveries WHERE event_id=$1",
              [event],
            )
          ).rows[0];
          await sendVehicleWatchTask(
            event,
            {
              subject: delivery.subject,
              message: delivery.message,
              expectedRevision: 0,
              watchIds: [watch],
              previewHash: "0".repeat(64),
              requestId: delivery.request_id,
            },
            "Fictional owner",
            transport,
          );
          assert.equal(
            (
              await pool.query(
                "SELECT count(*) FROM enquiry_events WHERE enquiry_id=$1",
                [enq.id],
              )
            ).rows[0].count,
            2,
          );
        },
      );

      await t.test(
        "price watch and enquiry follow-up share one confirmed contact, without duplicate alert",
        async () => {
          await pool.query(
            "UPDATE vehicles SET source_price=7995 WHERE id=$1",
            [car],
          );
          const next = randomUUID(),
            task = randomUUID(),
            enq = (await pool.query("SELECT id FROM enquiries LIMIT 1")).rows[0]
              .id;
          await pool.query(
            "INSERT INTO stock_change_tasks(id,dealer_id,vehicle_id,kind,change_key,previous_price,current_price) VALUES($1,'watch-a',$2,'price_drop','watch-duplicate',8495,7995)",
            [task, car],
          );
          await pool.query(
            "INSERT INTO vehicle_watch_events(id,dealer_id,vehicle_id,kind,change_key,previous_price,current_price,current_status) VALUES($1,'watch-a',$2,'price_drop','watch-duplicate',8495,7995,'available')",
            [next, car],
          );
          const input = {
              subject: "Updated car price",
              message: "The car is now £7,995.",
              expectedRevision: 0,
              watchIds: [watch],
            },
            p = await previewVehicleWatchTask(next, input);
          assert.equal(
            (
              await sendVehicleWatchTask(
                next,
                {
                  ...input,
                  previewHash: p.previewHash,
                  requestId: randomUUID(),
                },
                "Fictional owner",
                transport,
              )
            ).sentCount,
            1,
          );
          assert.equal(
            (
              await pool.query(
                "SELECT status FROM stock_change_customer_outcomes WHERE task_id=$1 AND enquiry_id=$2",
                [task, enq],
              )
            ).rows[0].status,
            "contacted",
          );
          assert.equal(
            (
              await pool.query(
                "SELECT count(*) FROM stock_change_contact_events WHERE task_id=$1",
                [task],
              )
            ).rows[0].count,
            1,
          );
          assert.equal(
            (await readVehicleWatchTasks()).tasks.some((t) => t.id === next),
            false,
          );
        },
      );
      await t.test(
        "uncertain provider acceptance cannot be resent through a new request",
        async () => {
          const late = (
            await pool.query(
              "SELECT id FROM vehicle_watches WHERE email='late@example.test'",
            )
          ).rows[0].id;
          await pool.query(
            "UPDATE vehicle_watches SET email_verified_at=now()-interval '1 day' WHERE id=$1",
            [late],
          );
          await pool.query(
            "UPDATE vehicles SET source_price=7495 WHERE id=$1",
            [car],
          );
          const next = randomUUID();
          await pool.query(
            "INSERT INTO vehicle_watch_events(id,dealer_id,vehicle_id,kind,change_key,previous_price,current_price,current_status) VALUES($1,'watch-a',$2,'price_drop','uncertain',7995,7495,'available')",
            [next, car],
          );
          const input = {
              subject: "Price reduced",
              message: "The car is now £7,495.",
              expectedRevision: 0,
              watchIds: [late],
            },
            p = await previewVehicleWatchTask(next, input),
            requestId = randomUUID();
          mode = "unknown";
          const r = await sendVehicleWatchTask(
            next,
            { ...input, previewHash: p.previewHash, requestId },
            "Fictional owner",
            transport,
          );
          assert.equal(r.uncertainCount, 1);
          const before = sent.length;
          assert.equal(
            (
              await sendVehicleWatchTask(
                next,
                { ...input, previewHash: p.previewHash, requestId },
                "Fictional owner",
                transport,
              )
            ).uncertainCount,
            1,
          );
          await assert.rejects(
            () => previewVehicleWatchTask(next, input),
            /customer list changed/,
          );
          assert.equal(sent.length, before);
          mode = "success";
        },
      );
      await t.test(
        "known provider refusal requires a new reviewed manual request, then preserves reply routing",
        async () => {
          const person = (
            await pool.query(
              "UPDATE vehicle_watches SET status='active',email_verified_at=now()-interval '1 day' WHERE email='unconfirmed@example.test' RETURNING id",
            )
          ).rows[0].id;
          const next = randomUUID();
          await pool.query(
            "INSERT INTO vehicle_watch_events(id,dealer_id,vehicle_id,kind,change_key,previous_price,current_price,current_status) VALUES($1,'watch-a',$2,'price_drop','refused',7995,7495,'available')",
            [next, car],
          );
          const input = {
              subject: "Price reduced",
              message: "The car is now £7,495.",
              expectedRevision: 0,
              watchIds: [person],
            },
            p = await previewVehicleWatchTask(next, input);
          mode = "refused";
          const r = await sendVehicleWatchTask(
            next,
            { ...input, previewHash: p.previewHash, requestId: randomUUID() },
            "Fictional owner",
            transport,
          );
          assert.equal(r.failedCount, 1);
          mode = "success";
          const fresh = await previewVehicleWatchTask(next, input);
          assert.equal(
            (
              await sendVehicleWatchTask(
                next,
                {
                  ...input,
                  previewHash: fresh.previewHash,
                  requestId: randomUUID(),
                },
                "Fictional owner",
                transport,
              )
            ).sentCount,
            1,
          );
          assert.equal(
            sent.at(-1).reply_to,
            (
              await pool.query(
                "SELECT reply_address FROM vehicle_watch_reply_routes WHERE recipient=$1",
                ["unconfirmed@example.test"],
              )
            ).rows[0].reply_address,
          );
        },
      );
      await t.test(
        "mixed watch and enquiry reply capabilities never route to either case",
        async () => {
          const watchAddress = (
            await pool.query(
              "SELECT reply_address FROM vehicle_watch_reply_routes WHERE recipient='unconfirmed@example.test'",
            )
          ).rows[0].reply_address;
          const standard = (
            await pool.query(
              "SELECT reply_address FROM enquiry_email_reply_routes LIMIT 1",
            )
          ).rows[0].reply_address;
          const provider = randomUUID();
          await acceptReplyEvent({
            type: "email.received",
            data: { email_id: provider, to: [watchAddress, standard] },
          });
          assert.equal(
            (
              await pool.query(
                "SELECT count(*) FROM enquiry_email_replies WHERE provider_id=$1",
                [provider],
              )
            ).rows[0].count,
            0,
          );
          assert.equal(
            (
              await pool.query(
                "SELECT count(*) FROM vehicle_watch_reply_receipts WHERE provider_id=$1",
                [provider],
              )
            ).rows[0].count,
            0,
          );
        },
      );
      await t.test(
        "stop is idempotent, stays scoped and does not modify customer records or car",
        async () => {
          const before = JSON.stringify(
            (await pool.query("SELECT id,email,message FROM enquiries")).rows,
          );
          await stopVehicleWatch(manageToken, watch);
          await stopVehicleWatch(manageToken, watch);
          assert.equal(
            (await readVehicleWatchCounts()).counts[0]?.count ?? 0,
            2,
          );
          assert.equal(
            JSON.stringify(
              (await pool.query("SELECT id,email,message FROM enquiries")).rows,
            ),
            before,
          );
          assert.equal(
            (
              await pool.query(
                "SELECT inventory_status FROM vehicles WHERE id=$1",
                [car],
              )
            ).rows[0].inventory_status,
            "available",
          );
        },
      );
      await t.test(
        "manage-link requests do not enumerate unregistered addresses",
        async () => {
          const before = sent.length;
          await requestWatchManageLink("nobody@example.test", transport);
          assert.equal(sent.length, before);
          await requestWatchManageLink("customer@example.test", transport);
          assert.equal(sent.length, before + 1);
          assert.equal(
            (await readVehicleWatches(tokenFrom(sent.at(-1))))
              .verificationRequired,
            false,
          );
        },
      );
      await t.test(
        "shared rate limits and disable settings are durable",
        async () => {
          for (let n = 0; n < 5; n++)
            assert.equal(
              await allowWatchRequest("ratelimit@example.test", "fictional-ip"),
              true,
            );
          assert.equal(
            await allowWatchRequest("ratelimit@example.test", "fictional-ip"),
            false,
          );
          for (let n = 0; n < 60; n++)
            assert.equal(
              await allowWatchRequest(
                `network-${n}@example.test`,
                "fictional-network",
              ),
              true,
            );
          assert.equal(
            await allowWatchRequest(
              "network-last@example.test",
              "fictional-network",
            ),
            false,
          );

          const before = sent.length;
          await saveVehicleWatchSettings(false, 0);
          await requestVehicleWatch(car, "disabled@example.test", transport);
          assert.equal(sent.length, before);
          assert.equal((await readVehicleWatchSettings()).enabled, false);
          await assert.rejects(
            () => saveVehicleWatchSettings(true, 0),
            /settings changed/,
          );
          await saveVehicleWatchSettings(true, 1);
        },
      );
      await t.test(
        "stopping one watch cannot revoke another customer confirmation",
        async () => {
          await requestVehicleWatch(car, "separate@example.test", transport);
          const token = tokenFrom(sent.at(-1));
          const target = (
            await pool.query(
              "SELECT id FROM vehicle_watches WHERE email='separate@example.test'",
            )
          ).rows[0].id;
          await stopVehicleWatch(manageToken, target);
          assert.equal(
            (await readVehicleWatches(token)).verificationRequired,
            true,
          );
        },
      );
      await t.test(
        "confirmation refuses a car that sold before email verification",
        async () => {
          const id = randomUUID();
          await pool.query(
            "INSERT INTO vehicles(id,dealer_id,source,advert_id,title,source_price) VALUES($1,'watch-a','autotrader',$2,'Fictional sold car',5000)",
            [id, randomUUID()],
          );
          await requestVehicleWatch(
            id,
            "sold-before-confirm@example.test",
            transport,
          );
          const token = tokenFrom(sent.at(-1));
          await pool.query(
            "UPDATE vehicles SET inventory_status='sold' WHERE id=$1",
            [id],
          );
          await assert.rejects(
            () => verifyVehicleWatch(token),
            /no longer available/,
          );
          assert.equal(
            (
              await pool.query(
                "SELECT status FROM vehicle_watches WHERE vehicle_id=$1",
                [id],
              )
            ).rows[0].status,
            "pending",
          );
        },
      );
      await t.test(
        "completed tasks cannot hide older pending work beyond the first hundred",
        async () => {
          const id = randomUUID(),
            watchId = randomUUID(),
            pending = randomUUID();
          await pool.query(
            "INSERT INTO vehicles(id,dealer_id,source,advert_id,title,source_price) VALUES($1,'watch-a','autotrader',$2,'Fictional queue car',8495)",
            [id, randomUUID()],
          );
          await pool.query(
            "INSERT INTO vehicle_watches(id,dealer_id,vehicle_id,email,status,email_verified_at) VALUES($1,'watch-a',$2,'queue@example.test','active',now()-interval '3 days')",
            [watchId, id],
          );
          await pool.query(
            "INSERT INTO vehicle_watch_events(dealer_id,vehicle_id,kind,change_key,previous_price,current_price,current_status) SELECT 'watch-a',$1,'price_drop','completed-queue-'||n::text,8995,8495,'available' FROM generate_series(1,100) n",
            [id],
          );
          await pool.query(
            "INSERT INTO vehicle_watch_deliveries(dealer_id,event_id,watch_id,request_id,status,subject,message,sent_at) SELECT 'watch-a',id,$2,gen_random_uuid(),'sent','Done','Done',now() FROM vehicle_watch_events WHERE vehicle_id=$1",
            [id, watchId],
          );
          await pool.query(
            "INSERT INTO vehicle_watch_events(id,dealer_id,vehicle_id,kind,change_key,previous_price,current_price,current_status,occurred_at,created_at) VALUES($1,'watch-a',$2,'price_drop','old-pending-queue',8995,8495,'available',now()-interval '1 day',now()-interval '1 day')",
            [pending, id],
          );
          assert.ok(
            (await readVehicleWatchTasks()).tasks.some(
              (task) => task.id === pending,
            ),
          );
        },
      );
      await t.test(
        "a dealer switch-off during a batch stops the next provider call",
        async () => {
          const id = randomUUID(),
            first = randomUUID(),
            second = randomUUID(),
            alert = randomUUID();
          await pool.query(
            "INSERT INTO vehicles(id,dealer_id,source,advert_id,title,source_price) VALUES($1,'watch-a','autotrader',$2,'Fictional batch car',5000)",
            [id, randomUUID()],
          );
          await pool.query(
            "INSERT INTO vehicle_watches(id,dealer_id,vehicle_id,email,status,email_verified_at) VALUES($1,'watch-a',$3,'first-batch@example.test','active',now()-interval '1 day'),($2,'watch-a',$3,'second-batch@example.test','active',now()-interval '1 day')",
            [first, second, id],
          );
          await pool.query(
            "INSERT INTO vehicle_watch_events(id,dealer_id,vehicle_id,kind,change_key,previous_price,current_price,current_status) VALUES($1,'watch-a',$2,'price_drop','switch-off-batch',5500,5000,'available')",
            [alert, id],
          );
          const input = {
              subject: "Batch price update",
              message: "The car is now £5,000.",
              expectedRevision: 0,
              watchIds: [first, second],
            },
            review = await previewVehicleWatchTask(alert, input);
          let calls = 0;
          const stopAfterFirst: typeof fetch = async () => {
            calls++;
            await pool.query(
              "UPDATE vehicle_watch_settings SET enabled=false WHERE dealer_id='watch-a'",
            );
            return new Response(JSON.stringify({ id: randomUUID() }), {
              status: 200,
            });
          };
          const result = await sendVehicleWatchTask(
            alert,
            {
              ...input,
              previewHash: review.previewHash,
              requestId: randomUUID(),
            },
            "Fictional owner",
            stopAfterFirst,
          );
          assert.equal(calls, 1);
          assert.equal(result.sentCount, 1);
          assert.equal(result.failedCount, 1);
          await pool.query(
            "UPDATE vehicle_watch_settings SET enabled=true WHERE dealer_id='watch-a'",
          );
        },
      );
      await t.test(
        "spoofed replies create no enquiry and disabled dealers are not processed",
        async () => {
          const route = (
            await pool.query(
              "SELECT * FROM vehicle_watch_reply_routes WHERE recipient='unconfirmed@example.test'",
            )
          ).rows[0];
          const provider = randomUUID(),
            before = (await pool.query("SELECT count(*) FROM enquiries"))
              .rows[0].count;
          await acceptReplyEvent({
            type: "email.received",
            data: { email_id: provider, to: [route.reply_address] },
          });
          const spoofed: typeof fetch = async () =>
            new Response(
              JSON.stringify({
                id: provider,
                to: [route.reply_address],
                from: "intruder@example.test",
                subject: "Spoof",
                text: "Wrong sender",
                authentication: { dmarc: "pass" },
                attachments: [],
              }),
              { status: 200 },
            );
          await processCustomerReplies({ warn() {} }, spoofed);
          assert.equal(
            (await pool.query("SELECT count(*) FROM enquiries")).rows[0].count,
            before,
          );
          assert.equal(
            (
              await pool.query(
                "SELECT status FROM vehicle_watch_reply_receipts WHERE provider_id=$1",
                [provider],
              )
            ).rows[0].status,
            "review",
          );
          const disabled = randomUUID();
          await acceptReplyEvent({
            type: "email.received",
            data: { email_id: disabled, to: [route.reply_address] },
          });
          await pool.query(
            "UPDATE dealerships SET status='suspended' WHERE id='watch-a'",
          );
          let calls = 0;
          await processCustomerReplies({ warn() {} }, async () => {
            calls++;
            throw new Error("Disabled dealer must not fetch.");
          });
          assert.equal(calls, 0);
          await pool.query(
            "UPDATE dealerships SET status='active' WHERE id='watch-a'",
          );
          await pool.query(
            "UPDATE vehicle_watch_reply_receipts SET status='processing',attempts=8,lease_until=now()-interval '1 minute' WHERE provider_id=$1",
            [disabled],
          );
          await processCustomerReplies({ warn() {} }, async () => {
            throw new Error("Exhausted receipt must not fetch.");
          });
          assert.equal(
            (
              await pool.query(
                "SELECT status FROM vehicle_watch_reply_receipts WHERE provider_id=$1",
                [disabled],
              )
            ).rows[0].status,
            "review",
          );
        },
      );
      await t.test(
        "expired private links are rejected without altering subscriptions",
        async () => {
          const active: any = await readVehicleWatches(manageToken);
          assert.equal(active.watches[0].status, "stopped");
          await pool.query(
            "UPDATE vehicle_watch_tokens SET expires_at=now()-interval '1 minute' WHERE token_hash=$1",
            [watchTokenHash(manageToken)],
          );
          await assert.rejects(
            () => readVehicleWatches(manageToken),
            /expired/,
          );
        },
      );
    });
    await t.test(
      "public origin, honeypot and staff role boundaries reject writes before delivery",
      async () => {
        const app = express();
        app.use(express.json());
        app.use((req, _res, next) => {
          req.log = { warn() {}, error() {} } as any;
          if (req.get("x-test-role"))
            req.staff = {
              authUserId: "fictional",
              email: "staff@example.test",
              name: "Fictional staff",
              role: req.get("x-test-role") as any,
              permissions: permissionsForRole(req.get("x-test-role") as any),
            };
          runWithTenant(tenant(), next);
        });
        app.use("/api", watchRouter);
        const server = createServer(app);
        await new Promise<void>((resolve, reject) => {
          server.once("error", reject);
          server.listen(0, "127.0.0.1", resolve);
        });
        const port = (server.address() as { port: number }).port;
        const call = (
          path: string,
          body: unknown,
          headers: Record<string, string> = {},
        ) =>
          new Promise<{ status: number; body: any }>((resolve, reject) => {
            const req = request(
              {
                host: "127.0.0.1",
                port,
                path: "/api" + path,
                method: "POST",
                headers: { "content-type": "application/json", ...headers },
              },
              (res) => {
                let raw = "";
                res.on("data", (c) => (raw += c));
                res.on("end", () =>
                  resolve({ status: res.statusCode!, body: JSON.parse(raw) }),
                );
              },
            );
            req.on("error", reject);
            req.end(JSON.stringify(body));
          });
        try {
          assert.equal(
            (
              await call(
                "/vehicle-watches",
                { vehicleId: car, email: "x@example.test" },
                { origin: "https://evil.example.test" },
              )
            ).status,
            403,
          );
          const trap = await call("/vehicle-watches", {
            vehicleId: car,
            email: "x@example.test",
            website: "bot",
          });
          assert.equal(trap.status, 202);
          assert.equal(trap.body.accepted, true);
          assert.equal(
            (
              await call(
                `/staff/vehicle-watch-tasks/${event}/preview`,
                {
                  subject: "Example",
                  message: "Example",
                  expectedRevision: 0,
                  watchIds: [watch],
                },
                { "x-test-role": "accounts" },
              )
            ).status,
            403,
          );
        } finally {
          await new Promise<void>((resolve) => server.close(() => resolve()));
        }
      },
    );
  } finally {
    await engine.close();
    await rm(dir, { recursive: true, force: true });
  }
});
