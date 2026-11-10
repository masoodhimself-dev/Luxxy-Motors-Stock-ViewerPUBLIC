import assert from "node:assert/strict";
import test from "node:test";
import { readFile, readdir } from "node:fs/promises";
import { randomBytes, randomUUID } from "node:crypto";
import express from "express";
import { Webhook } from "svix";
import { engine, db } from "./test/tenant-test-db";
import { PgDialect } from "drizzle-orm/pg-core";
import { runWithTenant } from "./lib/tenant-context";
import {
  routeCustomerReply,
  acceptReplyEvent,
  processCustomerReplies,
  mailbox,
  safeMessageId,
} from "./lib/customer-email-replies";
import { createCustomerEmailWebhook } from "./routes/customer-email-webhook";
import { createStaffEmailRouter } from "./routes/staff-email";
import { createStaffNotificationsRouter } from "./routes/staff-notifications";
import { enqueueEmailOutbox, deliverEmailOutbox } from "./lib/email-outbox";
import { enqueueStaffPush } from "./lib/staff-push";
process.env.MULTI_TENANT_ENABLED = "true";
process.env.EMAIL_REPLIES_ENABLED = "true";
process.env.EMAIL_REPLY_DOMAINS = JSON.stringify({
  "reply-a": "replies.a.example.test",
  "reply-b": "replies.b.example.test",
  "reply-cazoo": "replies.cazoo.example.test",
});
process.env.RESEND_RECEIVING_API_KEY = "re_fictional_receiver";
process.env.RESEND_RECEIVING_WEBHOOK_SECRET =
  "whsec_" + randomBytes(32).toString("base64");
const cazooMailbox = "leads@cazoo.example.test";
process.env.CAZOO_LEADS_ENABLED = "true";
process.env.CAZOO_LEAD_MAILBOXES = JSON.stringify({ "reply-cazoo": cazooMailbox });
const a = randomUUID(),
  a2 = randomUUID(),
  b = randomUUID();
const tenant = (dealer = "reply-a") => ({
  dealerId: dealer,
  canonicalOrigin: `https://${dealer === "reply-a" ? "a" : "b"}.example.test`,
  platform: "autotrader" as const,
  retailerId: "fake",
  sourceUrl: "https://www.autotrader.co.uk/fake",
});
const request = {
  to: "customer@example.test",
  subject: "Your car",
  html: "<p>Hello</p>",
  text: "Hello",
  idempotencyKey: "reply-test-1",
};
const log = { warn: () => {} };
let apiCalls = 0;
let payload: any;
const transport: typeof fetch = async (url, options) => {
  apiCalls++;
  assert.ok(String(url).startsWith("https://api.resend.com/emails/receiving/"));
  assert.equal(options?.redirect, "error");
  return new Response(JSON.stringify(payload), { status: 200 });
};
async function event(address: string, provider = randomUUID()) {
  await acceptReplyEvent({
    type: "email.received",
    data: { email_id: provider, to: [address] },
  });
  return provider;
}
async function row(provider: string) {
  return (
    await engine.query<any>(
      "SELECT * FROM enquiry_email_replies WHERE provider_id=$1",
      [provider],
    )
  ).rows[0];
}
function incoming(
  id: string,
  address: string,
  extra: Record<string, unknown> = {},
) {
  return {
    id,
    to: [address],
    from: "Customer <customer@example.test>",
    subject: "Re: Your car",
    text: "Can I come tomorrow?\n\n> Original message",
    message_id: "<reply@example.test>",
    authentication: { dmarc: "pass", dkim: "pass" },
    attachments: [],
    ...extra,
  };
}
test.after(() => engine.close());
test("receiving routes and enquiry history are durable, tenant isolated and never parse marketplace leads", async (t) => {
  for (const file of (await readdir("../../lib/db/drizzle"))
    .filter((f) => /^\d+.*\.sql$/.test(f))
    .sort())
    await engine.exec(await readFile("../../lib/db/drizzle/" + file, "utf8"));
  await engine.exec(
    "INSERT INTO dealerships(id,name,status,canonical_origin,stock_platform,retailer_id,source_url) VALUES('reply-a','Fictional A','active','https://a.example.test','autotrader','fake','https://www.autotrader.co.uk/fake'),('reply-b','Fictional B','active','https://b.example.test','autotrader','fake','https://www.autotrader.co.uk/fake')",
  );
  for (const [id, dealer] of [
    [a, "reply-a"],
    [a2, "reply-a"],
    [b, "reply-b"],
  ])
    await engine.query(
      "INSERT INTO enquiries(id,dealer_id,type,customer_name,message,status) VALUES($1,$2,'general','Test customer','Original','contacted')",
      [id, dealer],
    );
  let address = "";
  await t.test(
    "one private route per immutable send, separate routes for same customer and other dealers",
    async () => {
      await runWithTenant(tenant(), async () => {
        const first = await routeCustomerReply(request, a);
        address = first.replyTo!;
        assert.match(address, /^r-[0-9a-f]{48}@replies\.a\.example\.test$/);
        assert.equal((await routeCustomerReply(request, a)).replyTo, address);
        assert.notEqual(
          (
            await routeCustomerReply(
              { ...request, idempotencyKey: "other-car" },
              a2,
            )
          ).replyTo,
          address,
        );
      });
      await runWithTenant(tenant("reply-b"), async () =>
        assert.notEqual(
          (await routeCustomerReply(request, b)).replyTo,
          address,
        ),
      );
      process.env.EMAIL_REPLIES_ENABLED = "false";
      await runWithTenant(tenant(), async () => {
        assert.equal((await routeCustomerReply(request, a)).replyTo, address);
        assert.equal(
          (
            await routeCustomerReply(
              { ...request, idempotencyKey: "disabled" },
              a,
            )
          ).replyTo,
          undefined,
        );
      });
      process.env.EMAIL_REPLIES_ENABLED = "true";
      assert.equal(
        mailbox("Name <CUSTOMER@example.test>"),
        "customer@example.test",
      );
      assert.equal(mailbox("customer@example.test\r\nBcc:bad"), null);
      assert.equal(safeMessageId("<id>\r\nX:bad"), null);
    },
  );
  await t.test(
    "signed webhook rejects forgery, changed bytes and expired signatures; accepts duplicates once",
    async () => {
      const app = express();
      app.use("/hook", createCustomerEmailWebhook());
      const server = app.listen(0, "127.0.0.1");
      await new Promise<void>((r) => server.once("listening", r));
      const port = (server.address() as any).port;
      try {
        const id = randomUUID(),
          body = JSON.stringify({
            type: "email.received",
            data: { email_id: id, to: [address] },
          }),
          timestamp = new Date(),
          svixId = "msg_test";
        const signature = new Webhook(
          process.env.RESEND_RECEIVING_WEBHOOK_SECRET!,
        ).sign(svixId, timestamp, body);
        const headers = {
          "content-type": "application/json",
          "svix-id": svixId,
          "svix-timestamp": String(Math.floor(timestamp.getTime() / 1000)),
          "svix-signature": signature,
        };
        assert.equal(
          (
            await fetch(`http://127.0.0.1:${port}/hook`, {
              method: "POST",
              headers: { ...headers, "svix-signature": "v1,invalid" },
              body,
            })
          ).status,
          401,
        );
        assert.equal(
          (
            await fetch(`http://127.0.0.1:${port}/hook`, {
              method: "POST",
              headers,
              body: body + " ",
            })
          ).status,
          401,
        );
        assert.equal(
          (
            await fetch(`http://127.0.0.1:${port}/hook`, {
              method: "POST",
              headers: { ...headers, "svix-timestamp": "1" },
              body,
            })
          ).status,
          401,
        );
        for (let i = 0; i < 2; i++)
          assert.equal(
            (
              await fetch(`http://127.0.0.1:${port}/hook`, {
                method: "POST",
                headers,
                body,
              })
            ).status,
            200,
          );
        assert.ok(
          await row(id),
          "Signed webhook must persist receipt before acknowledging",
        );
        payload = incoming(id, address);
        await processCustomerReplies(log, transport);
        assert.equal((await row(id)).status, "received");
      } finally {
        await new Promise<void>((r) => server.close(() => r()));
      }
    },
  );
  await t.test(
    "same recipient with several cars attaches only to issued route and records one history event on replay",
    async () => {
      const id = await event(address);
      await event(address, id);
      payload = incoming(id, address);
      await processCustomerReplies(log, transport);
      await processCustomerReplies(log, transport);
      assert.equal((await row(id)).enquiry_id, a);
      const count = (
        await engine.query<any>(
          "SELECT count(*)::int AS n FROM enquiry_events WHERE detail->>'replyId'=$1",
          [(await row(id)).id],
        )
      ).rows[0];
      assert.equal(count.n, 1);
      await runWithTenant(tenant(), async () => {
        const reply = await routeCustomerReply(
          { ...request, idempotencyKey: "answer" },
          a,
        );
        assert.equal(
          reply.replyHeaders?.["In-Reply-To"],
          "<reply@example.test>",
        );
      });
    },
  );
  await t.test(
    "unknown marketplace email does not create a lead, case or provider retrieval",
    async () => {
      const count = apiCalls;
      await event("sales@a.example.test");
      await processCustomerReplies(log, transport);
      assert.equal(apiCalls, count);
      assert.equal(
        (await engine.query<any>("SELECT count(*)::int AS n FROM enquiries"))
          .rows[0].n,
        3,
      );
    },
  );
  await t.test(
    "forged sender, failed authentication and cross-route recipients stay out of customer history",
    async () => {
      for (const extra of [
        { from: "wrong@example.test" },
        { authentication: { dmarc: "fail" } },
        { to: ["sales@a.example.test"] },
      ]) {
        const id = await event(address);
        payload = incoming(id, address, extra);
        await processCustomerReplies(log, transport);
        const receipt = await row(id);
        assert.equal(receipt.status, "review");
        assert.equal(
          (
            await engine.query<any>(
              "SELECT count(*)::int AS n FROM enquiry_events WHERE detail->>'replyId'=$1",
              [receipt.id],
            )
          ).rows[0].n,
          0,
        );
      }
    },
  );
  await t.test(
    "HTML is converted to inert text, attachments are noted and no remote content is fetched",
    async () => {
      const id = await event(address);
      payload = incoming(id, address, {
        text: null,
        html: '<p>Hello <b>there</b></p><img src="https://tracking.invalid/pixel"><script>bad()</script>',
        attachments: [{ filename: "document.pdf" }],
      });
      await processCustomerReplies(log, transport);
      const receipt = await row(id);
      assert.match(receipt.message, /Hello there/);
      assert.ok(!receipt.message.includes("<img"));
      assert.deepEqual(receipt.attachment_names, ["document.pdf"]);
    },
  );
  await t.test(
    "provider outages retry safely after restart; exhausted leases become visible review tasks",
    async () => {
      const id = await event(address);
      await processCustomerReplies(
        log,
        async () => new Response("", { status: 503 }),
      );
      assert.equal((await row(id)).status, "pending");
      await engine.query(
        "UPDATE enquiry_email_replies SET next_attempt_at=now()-interval '1 second' WHERE provider_id=$1",
        [id],
      );
      payload = incoming(id, address);
      await processCustomerReplies(log, transport);
      assert.equal((await row(id)).status, "received");
      const stuck = await event(address);
      await engine.query(
        "UPDATE enquiry_email_replies SET status='processing',attempts=8,lease_until=now()-interval '1 minute' WHERE provider_id=$1",
        [stuck],
      );
      await processCustomerReplies(log, transport);
      assert.equal((await row(stuck)).status, "review");
    },
  );
  await t.test(
    "merged enquiries route to the surviving same-dealer conversation without changing sales/bookings",
    async () => {
      const route = await runWithTenant(tenant(), () =>
        routeCustomerReply({ ...request, idempotencyKey: "merge" }, a2),
      );
      await engine.query("UPDATE enquiries SET merged_into_id=$1 WHERE id=$2", [
        a,
        a2,
      ]);
      const id = await event(route.replyTo!);
      payload = incoming(id, route.replyTo!);
      await processCustomerReplies(log, transport);
      assert.equal((await row(id)).enquiry_id, a);
      assert.equal(
        (
          await engine.query<any>(
            "SELECT status,appointment_at FROM enquiries WHERE id=$1",
            [a],
          )
        ).rows[0].status,
        "contacted",
      );
    },
  );
  await t.test(
    "staff sends keep the reply address stable, resolve only that recipient, and leave newer replies outstanding",
    async () => {
      await runWithTenant(tenant(), async () => {
        const delivery = randomUUID(),
          req = { ...request, idempotencyKey: "staff-answer" },
          config = {
            enabled: true,
            apiKey: "re_fictional_reply_test_only",
            from: "Showroom <sales@a.example.test>",
            replyTo: "",
          };
        await engine.query(
          "INSERT INTO enquiry_emails(id,dealer_id,enquiry_id,recipient,subject,message,status,request_id,request_hash,created_by) VALUES($1,'reply-a',$2,'customer@example.test','Reply','Hello','sending',gen_random_uuid(),'fixture-hash','fictional-owner')",
          [delivery, a],
        );
        const outbox = await enqueueEmailOutbox({
          enquiryId: a,
          deliveryId: delivery,
          kind: "staff",
          request: req,
          config,
          validation: {},
        });
        const sentBody = JSON.parse(outbox.payload!);
        assert.match(sentBody.reply_to, /@replies.a.example.test$/);
        const future = await event(address);
        payload = incoming(future, address);
        await processCustomerReplies(log, transport);
        await engine.query(
          "UPDATE enquiry_email_replies SET received_at=now()+interval '1 minute' WHERE provider_id=$1",
          [future],
        );
        await deliverEmailOutbox(outbox.id, {
          settings: async () => config,
          rebuild: async () => req,
          send: async (_, body) => {
            assert.equal(JSON.parse(body).reply_to, sentBody.reply_to);
            return randomUUID();
          },
        });
        assert.equal((await row(future)).resolved_at, null);
        assert.ok(
          (
            await engine.query<any>(
              "SELECT count(*)::int AS n FROM enquiry_email_replies WHERE enquiry_id=$1 AND status='received' AND resolved_at IS NOT NULL",
              [a],
            )
          ).rows[0].n > 0,
        );
      });
    },
  );
  await t.test(
    "ambiguous recipient routes are rejected rather than matched by name or subject",
    async () => {
      const other = await runWithTenant(tenant("reply-b"), () =>
        routeCustomerReply({ ...request, idempotencyKey: "ambiguous" }, b),
      );
      const id = randomUUID();
      await acceptReplyEvent({
        type: "email.received",
        data: { email_id: id, to: [address, other.replyTo] },
      });
      assert.equal(await row(id), undefined);
    },
  );
  await t.test(
    "staff history, Home and push tasks stay dealer-scoped; opening does not resolve; staff can mark handled",
    async () => {
      const app = express();
      app.use(express.json());
      app.use((req, res, next) =>
        runWithTenant(tenant(req.get("x-dealer") || "reply-a"), () => {
          req.staff = {
            authUserId: "owner",
            name: "Test Owner",
            role: "owner",
            permissions: ["sales.manage", "enquiries.manage"],
          } as any;
          next();
        }),
      );
      // Auth middleware still checks Clerk; the fixture supplies a matching owner membership.
      await engine.exec(
        "INSERT INTO portal_users(dealer_id,auth_user_id,email,name,role) VALUES('reply-a','owner','owner@example.test','Test Owner','owner'),('reply-b','owner','owner@example.test','Test Owner','owner')",
      );
      app.use(
        "/api",
        createStaffEmailRouter(fetch, async () => ({
          enabled: true,
          apiKey: "re_fictional_reply_test_only",
          from: "sales@a.example.test",
          replyTo: "",
        })),
      );
      app.use("/api", createStaffNotificationsRouter());
      const server = app.listen(0, "127.0.0.1");
      await new Promise<void>((r) => server.once("listening", r));
      const base = `http://127.0.0.1:${(server.address() as any).port}`;
      const call = (path: string, options: any = {}) =>
        fetch(base + path, {
          ...options,
          headers: { "x-test-user": "owner", ...(options.headers || {}) },
        });
      try {
        let response = await call(
          `/api/staff/email?includeBody=true&enquiryId=${a}`,
        );
        assert.equal(response.status, 200);
        const history = (await response.json()) as any;
        assert.ok(history.messages.some((m: any) => m.kind === "reply"));
        assert.ok(!JSON.stringify(history).includes(address));
        const receipt = history.messages.find(
          (m: any) => m.kind === "reply" && m.status === "reply_needed",
        );
        assert.ok(receipt);
        assert.equal(
          (
            await call(
              `/api/staff/email/message/${encodeURIComponent(receipt.key)}`,
              { headers: { "x-dealer": "reply-b" } },
            )
          ).status,
          404,
        );
        response = await call('/api/staff/email/reply-attention');
        assert.equal(response.status, 200);
        const attention = (await response.json()) as any;
        assert.ok(attention.enquiries.some((row: any) => row.enquiryId === a && row.pending > 0));
        assert.ok(attention.enquiries.every((row: any) => row.enquiryId !== b));
        const foreignAttention = await call('/api/staff/email/reply-attention', {headers:{'x-dealer':'reply-b'}});
        assert.ok(!JSON.stringify(await foreignAttention.json()).includes(a));
        response = await call("/api/staff/notifications");
        assert.equal(response.status, 200);
        assert.ok(
          ((await response.json()) as any).items.some(
            (i: any) => i.detail === "Incoming reply needs review",
          ),
        );
        assert.equal(
          (
            await call(
              `/api/staff/email/replies/${receipt.key.slice(6)}/handled`,
              { method: "POST", headers: { origin: "https://evil.invalid" } },
            )
          ).status,
          403,
        );
        assert.equal(
          (
            await call(
              `/api/staff/email/replies/${receipt.key.slice(6)}/handled`,
              { method: "POST" },
            )
          ).status,
          200,
        );
        await engine.exec(
          "INSERT INTO staff_push_subscriptions(dealer_id,auth_user_id,origin,endpoint,endpoint_hash,p256dh,auth,device_label,created_at) VALUES('reply-a','owner','https://a.example.test','https://fcm.googleapis.com/fake','reply-endpoint','fake','fake','Fictional test',now()-interval '1 day')",
        );
        await runWithTenant(tenant(), () => enqueueStaffPush());
        await runWithTenant(tenant(), () => enqueueStaffPush());
        const pushes = (
          await engine.query<any>(
            "SELECT event_key,count(*)::int AS n FROM staff_push_deliveries WHERE event_key LIKE 'reply:%' GROUP BY event_key",
          )
        ).rows;
        assert.ok(pushes.length > 0);
        assert.ok(pushes.every((p) => p.n === 1));
      } finally {
        await new Promise<void>((r) => server.close(() => r()));
      }
    },
  );
  await t.test('a verified customer reply restores an archived enquiry and puts it back in the active queue', async () => {
    const id = randomUUID();
    await engine.query("INSERT INTO enquiries(id,dealer_id,type,customer_name,message,status,archived_at,archive_delete_at)VALUES($1,'reply-a','general','Fictional buyer','Original','closed',now(),now()+interval '30 days')", [id]);
    await runWithTenant(tenant(), async () => {
      const replyAddress = (await routeCustomerReply({ ...request, idempotencyKey: randomUUID() }, id)).replyTo!;
      const provider = await event(replyAddress);
      payload = incoming(provider, replyAddress, { text: 'Can I visit tomorrow?' });
      await processCustomerReplies(log, transport);
      const restored = (await engine.query<any>('SELECT archived_at,archive_delete_at,archive_hold_reason,status,workspace_revision FROM enquiries WHERE id=$1', [id])).rows[0];
      assert.equal(restored.archived_at, null); assert.equal(restored.archive_delete_at, null); assert.equal(restored.archive_hold_reason, null);
      assert.equal(restored.status, 'new'); assert.equal(restored.workspace_revision, 1); assert.equal((await row(provider)).status, 'received');
    });
  });

  await t.test('reply processing locks case membership and enquiry rows before the receipt, matching archive/deletion order', async () => {
    const source = randomUUID(), primary = randomUUID();
    for (const id of [source, primary]) await engine.query("INSERT INTO enquiries(id,dealer_id,type,customer_name,message,status)VALUES($1,'reply-a','general','Fictional buyer','Original','contacted')", [id]);
    await engine.query('UPDATE enquiries SET merged_into_id=$2 WHERE id=$1', [source, primary]);
    await runWithTenant(tenant(), async () => {
      const replyAddress = (await routeCustomerReply({ ...request, idempotencyKey: randomUUID() }, source)).replyTo!;
      const provider = await event(replyAddress);
      payload = incoming(provider, replyAddress, { text: 'Please check this for me' });
      const originalTransaction = db.transaction, dialect = new PgDialect();
      const trace: { sql: string; params: unknown[] }[] = [];
      (db as any).transaction = (work: (tx: any) => Promise<unknown>) => originalTransaction.call(db, async (tx) => {
        const execute = tx.execute.bind(tx);
        (tx as any).execute = (query: any) => { trace.push(dialect.sqlToQuery(query)); return execute(query); };
        return work(tx);
      });
      try { await processCustomerReplies(log, transport); }
      finally { (db as any).transaction = originalTransaction; }
      const locks = trace.filter(query => /FOR UPDATE/i.test(query.sql));
      assert.equal(locks.length, 3);
      assert.match(locks[0].sql, /FROM enquiries WHERE dealer_id=/);
      assert.ok(locks[0].params.includes('reply-a')); assert.ok(locks[0].params.includes(source));
      assert.match(locks[1].sql, /FROM enquiries WHERE dealer_id=/);
      assert.ok(locks[1].params.includes(primary));
      assert.match(locks[2].sql, /FROM enquiry_email_replies m/);
      assert.match(locks[2].sql, /m\.dealer_id=/); assert.match(locks[2].sql, /m\.lease_until=/);
      assert.deepEqual(trace.filter(query => /pg_advisory_xact_lock/.test(query.sql)).map(query => query.params[0]), [`sale-workspace:reply-a`, `enquiry-merge:reply-a`, `enquiry-email:reply-a:${source}`]);
      assert.equal((await row(provider)).status, 'received'); assert.equal((await row(provider)).enquiry_id, primary);
    });
  });

  await t.test("a reply to a portal-sent Cazoo email stays with the original enquiry", async () => {
    const dealerId = "reply-cazoo";
    const enquiryId = randomUUID();
    const otherEnquiry = randomUUID();
    const originalLead = randomUUID();
    const ownerMailbox = "owner@cazoo.example.test";
    await engine.exec("INSERT INTO dealerships(id,name,status,canonical_origin,stock_platform,retailer_id,source_url) VALUES('reply-cazoo','Fictional Cazoo dealer','active','https://cazoo.example.test','cazoo','fixture','https://www.cazoo.co.uk/fixture')");
    for (const [id, source] of [[enquiryId, "cazoo"], [otherEnquiry, "website"]]) {
      await engine.query("INSERT INTO enquiries(id,dealer_id,source,type,customer_name,email,message,status) VALUES($1,$2,$3,'part_exchange','Fictional customer',$4,'Original enquiry','contacted')", [id, dealerId, source, request.to]);
    }
    await engine.query("INSERT INTO cazoo_lead_receipts(provider_id,dealer_id,mailbox,enquiry_id,status,draft_status) VALUES($1,$2,$3,$4,'imported','skipped')", [originalLead, dealerId, cazooMailbox, enquiryId]);
    await engine.query("INSERT INTO cazoo_lead_forwarding_settings(dealer_id,recipient,enabled,updated_by) VALUES($1,$2,true,'fictional-owner')", [dealerId, ownerMailbox]);
    const initialSettings = (await engine.query<any>("SELECT forward_replies FROM cazoo_lead_forwarding_settings WHERE dealer_id=$1", [dealerId])).rows[0];
    assert.equal(initialSettings.forward_replies, false);

    const cazooTenant = { ...tenant(), dealerId, canonicalOrigin: "https://cazoo.example.test", platform: "cazoo" as const };
    const config = { enabled: true, apiKey: "re_fictional_cazoo_lineage_only", from: "Showroom <sales@cazoo.example.test>", replyTo: "" };
    const send = { ...request, subject: "Your Cazoo enquiry", idempotencyKey: "cazoo-staff-reply" };
    const outbox = await runWithTenant(cazooTenant, () => enqueueEmailOutbox({
      enquiryId, kind: "staff", request: send, config, validation: {},
    }));
    const replyAddress = JSON.parse(outbox.payload!).reply_to;
    assert.match(replyAddress, /^r-[0-9a-f]{48}@replies\.cazoo\.example\.test$/);

    const app = express();
    app.use("/hook", createCustomerEmailWebhook());
    const server = app.listen(0, "127.0.0.1");
    await new Promise<void>((resolve) => server.once("listening", resolve));
    const port = (server.address() as { port: number }).port;
    async function receive(id: string, to: string[]) {
      const body = JSON.stringify({ type: "email.received", data: { email_id: id, to } });
      const time = new Date();
      const webhookId = `msg_${id}`;
      const signature = new Webhook(process.env.RESEND_RECEIVING_WEBHOOK_SECRET!).sign(webhookId, time, body);
      const response = await fetch(`http://127.0.0.1:${port}/hook`, {
        method: "POST", body, headers: { "content-type": "application/json", "svix-id": webhookId,
          "svix-timestamp": String(Math.floor(time.getTime() / 1000)), "svix-signature": signature },
      });
      assert.equal(response.status, 200);
    }

    try {
      const optedOutId = randomUUID();
      await receive(optedOutId, [replyAddress]);
      payload = incoming(optedOutId, replyAddress);
      await processCustomerReplies(log, transport);
      assert.equal((await row(optedOutId)).status, "received");
      assert.equal((await engine.query("SELECT 1 FROM cazoo_customer_reply_forwards WHERE dealer_id=$1", [dealerId])).rows.length, 0);

      await engine.query("UPDATE cazoo_lead_forwarding_settings SET forward_replies=true WHERE dealer_id=$1", [dealerId]);
      const providerId = randomUUID();
      await receive(providerId, [replyAddress]);
      await receive(providerId, [replyAddress]);
      payload = incoming(providerId, replyAddress, {
        subject: "Re: Your Cazoo enquiry", text: "Can I bring my part exchange on Saturday?",
        message_id: "<cazoo-customer-followup@example.test>", authentication: null,
      });
      await processCustomerReplies(log, transport);
      const reply = await row(providerId);
      assert.equal(reply.status, "received");
      assert.equal(reply.enquiry_id, enquiryId);
      assert.equal(reply.dealer_id, dealerId);
      const events = (await engine.query<any>("SELECT enquiry_id,dealer_id,detail FROM enquiry_events WHERE detail->>'replyId'=$1", [reply.id])).rows;
      assert.deepEqual(events.map((event) => [event.enquiry_id, event.dealer_id, event.detail.direction]), [[enquiryId, dealerId, "inbound"]]);
      const copies = (await engine.query<any>("SELECT q.reply_id,q.recipient,q.status,l.provider_id AS lead_provider_id FROM cazoo_customer_reply_forwards q JOIN cazoo_lead_receipts l ON l.id=q.lead_receipt_id AND l.dealer_id=q.dealer_id WHERE q.dealer_id=$1", [dealerId])).rows;
      assert.deepEqual(copies, [{ reply_id: reply.id, recipient: ownerMailbox, status: "pending", lead_provider_id: originalLead }]);

      const unrelatedAddress = await runWithTenant(cazooTenant, async () => {
        const followUp = await routeCustomerReply({ ...send, idempotencyKey: "cazoo-follow-up" }, enquiryId);
        assert.equal(followUp.replyHeaders?.["In-Reply-To"], "<cazoo-customer-followup@example.test>");
        const separateThread = await routeCustomerReply({ ...send, idempotencyKey: "cazoo-other-enquiry" }, otherEnquiry);
        assert.equal(separateThread.replyHeaders?.["In-Reply-To"], undefined);
        return separateThread.replyTo!;
      });

      await engine.query("UPDATE enquiries SET merged_into_id=$2 WHERE id=$1", [enquiryId, otherEnquiry]);
      const deliveryId = randomUUID();
      await engine.query("INSERT INTO enquiry_emails(id,dealer_id,enquiry_id,recipient,subject,message,status,request_id,request_hash,created_by) VALUES($1,$2,$3,$4,'Reply','Thanks','sending',gen_random_uuid(),'fixture-hash','fictional-owner')", [deliveryId, dealerId, otherEnquiry, request.to]);
      const targetedSend = { ...send, idempotencyKey: `enquiry-${deliveryId}` };
      const targeted = await runWithTenant(cazooTenant, async () => {
        const outbox = await enqueueEmailOutbox({ enquiryId: otherEnquiry, deliveryId, kind: "staff", request: targetedSend, config, validation: { enquiryReplyId: reply.id } });
        const sent = await deliverEmailOutbox(outbox.id, { settings: async () => config, rebuild: async () => targetedSend, send: async () => randomUUID() });
        assert.equal(sent?.status, "sent");
        return JSON.parse(outbox.payload!);
      });
      assert.equal(targeted.headers?.["In-Reply-To"], "<cazoo-customer-followup@example.test>");
      const continuationId = randomUUID();
      await receive(continuationId, [targeted.reply_to]);
      payload = incoming(continuationId, targeted.reply_to, { text: "Saturday works for me." });
      await processCustomerReplies(log, transport);
      const continuation = await row(continuationId);
      assert.equal(continuation.enquiry_id, otherEnquiry);
      const continuationCopy = (await engine.query<any>("SELECT q.recipient,l.provider_id AS lead_provider_id FROM cazoo_customer_reply_forwards q JOIN cazoo_lead_receipts l ON l.id=q.lead_receipt_id AND l.dealer_id=q.dealer_id WHERE q.reply_id=$1", [continuation.id])).rows[0];
      assert.deepEqual(continuationCopy, { recipient: ownerMailbox, lead_provider_id: originalLead });

      const unrelatedId = randomUUID();
      await receive(unrelatedId, [unrelatedAddress]);
      payload = incoming(unrelatedId, unrelatedAddress, { text: "Replying to my original website enquiry." });
      await processCustomerReplies(log, transport);
      const unrelated = await row(unrelatedId);
      assert.equal(unrelated.status, "received");
      assert.equal((await engine.query("SELECT 1 FROM cazoo_customer_reply_forwards WHERE reply_id=$1", [unrelated.id])).rows.length, 0);

      const loopId = randomUUID();
      await receive(loopId, [replyAddress, cazooMailbox]);
      payload = incoming(loopId, replyAddress, { from: "Cazoo <dealerleads@info.cazoo.co.uk>", to: [replyAddress, cazooMailbox] });
      await processCustomerReplies(log, transport);
      const loop = await row(loopId);
      assert.equal(loop.status, "review");
      assert.equal(loop.error_code, "sender_mismatch");
      assert.equal((await engine.query("SELECT 1 FROM enquiry_events WHERE detail->>'replyId'=$1", [loop.id])).rows.length, 0);
      assert.equal((await engine.query("SELECT 1 FROM cazoo_lead_receipts WHERE dealer_id=$1", [dealerId])).rows.length, 1);
      assert.equal((await engine.query("SELECT 1 FROM cazoo_customer_reply_forwards WHERE dealer_id=$1", [dealerId])).rows.length, 2);
      assert.equal((await engine.query("SELECT 1 FROM email_outbox WHERE dealer_id=$1", [dealerId])).rows.length, 2);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

});
