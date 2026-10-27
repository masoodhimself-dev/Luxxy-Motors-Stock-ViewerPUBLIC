import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { engine, pool } from "./test/tenant-test-db";
import { runWithTenant } from "./lib/tenant-context";
import {
  approveSaleDocumentEmail,
  saleEmailIdentity,
} from "./lib/sale-document-email";
import { deliverEmailOutbox } from "./lib/email-outbox";
import {
  acceptReplyEvent,
  processCustomerReplies,
} from "./lib/customer-email-replies";
import { archiveSaleDocument } from "./lib/sale-document-pdf";
import { EmailProviderError } from "./lib/email-provider";
import {
  createSaleWorkspace,
  changeSaleWorkspace,
  saleWorkspaceTotals,
  defaultEmailAppearance,
  type SaleWorkspaceRecord,
  type SaleWorkspaceDraft,
  type SaleWorkspaceContext,
} from "@workspace/vehicle-meta";
import type { PrivateDealerSettings } from "./lib/dealer-integrations-store";

process.env.MULTI_TENANT_ENABLED = "true";
process.env.EMAIL_REPLIES_ENABLED = "true";
process.env.RESEND_RECEIVING_API_KEY = "re_fictional_receiver";
process.env.RESEND_RECEIVING_WEBHOOK_SECRET = "whsec_fictional_receiver";
process.env.EMAIL_REPLY_DOMAINS = JSON.stringify({
  "invoice-a": "replies.a.example.test",
  "invoice-b": "replies.b.example.test",
});
const tenant = (id = "invoice-a") => ({
  dealerId: id,
  canonicalOrigin: `https://${id}.example.test`,
  platform: "autotrader" as const,
  retailerId: "fictional",
  sourceUrl: "https://www.autotrader.co.uk/fictional",
});
const config: PrivateDealerSettings = {
  version: 1,
  revision: 0,
  updatedAt: null,
  resend: {
    enabled: true,
    apiKey: "re_fictional_sender",
    from: "Fictional Motors <sales@example.test>",
    replyTo: "",
  },
  stripe: {
    enabled: false,
    mode: "test",
    secretKey: "",
    webhookSecret: "",
    publishableKey: "",
  },
  templates: {},
  appearance: defaultEmailAppearance,
};
const car = randomUUID(),
  otherCar = randomUUID(),
  originalEnquiry = randomUUID(),
  sameEmailOtherEnquiry = randomUUID(),
  foreignEnquiry = randomUUID();
const onTenant = <T>(work: () => T, id = "invoice-a") =>
  runWithTenant(tenant(id), work);
const render = async (
  _sale: SaleWorkspaceRecord,
  document: SaleWorkspaceRecord["documents"][number],
  content: string,
) => ({
  to: document.snapshot.draft.email,
  subject: `Invoice ${document.number}`,
  html: "<p>Your approved invoice.</p>",
  text: "Your approved invoice.",
  bodyText: "Your approved invoice.",
  idempotencyKey: "",
  attachments: [{ filename: document.number + ".pdf", content }],
});
const request = (sale: SaleWorkspaceRecord) => ({
  saleId: sale.id,
  documentId: sale.documents[0]!.id,
  requestId: randomUUID(),
  expectedRevision: sale.revision,
  actorId: "test-accounts",
  actorName: "Fictional Accounts",
});
async function record(
  sourceEnquiryId: string | undefined = originalEnquiry,
  vehicleId = car,
) {
  const now = new Date().toISOString();
  let sequence = 0;
  const context: SaleWorkspaceContext = {
    now,
    actor: "Fictional Staff",
    nextId: randomUUID,
    nextNumber: (type) => `${type.toUpperCase()}-${++sequence}`,
    branding: {
      identity: { name: "Fictional Motors", logoAsset: "", logoText: "TEST" },
      contact: { phone: "", email: "sales@example.test" },
      address: { street: "", city: "", region: "", postcode: "" },
      legal: { companyName: "", companyNumber: "", vatNumber: "" },
    },
  };
  const draft: SaleWorkspaceDraft = {
    id: "",
    customer: "Fictional Buyer",
    email: "buyer@example.test",
    phone: "07700900123",
    address: "Fictional supplied address",
    vehicleId,
    vehicle: "Fictional vehicle",
    registration: "TEST",
    price: "10000",
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
    ...(sourceEnquiryId ? { sourceEnquiryId } : {}),
  };
  let sale = createSaleWorkspace(
    { draft, requestId: randomUUID() },
    context,
    "SALE-" + randomUUID(),
  ).sale;
  sale = changeSaleWorkspace(
    sale,
    { action: "issue-invoice", kind: "full", acknowledge: true },
    { requestId: randomUUID(), expectedRevision: sale.revision },
    context,
  ).sale;
  sale.documentArchives = {
    [sale.documents[0]!.id]: archiveSaleDocument(sale.documents[0]!),
  };
  await pool.query(
    "INSERT INTO sale_workspace(id,dealer_id,reference,revision,state) VALUES($1::uuid,$2,$3,$4,$5::jsonb)",
    [sale.id, "invoice-a", sale.reference, sale.revision, JSON.stringify(sale)],
  );
  return sale;
}
const rawSale = async (id: string) =>
  (
    await pool.query(
      "SELECT state FROM sale_workspace WHERE dealer_id=$1 AND id=$2::uuid",
      ["invoice-a", id],
    )
  ).rows[0]!.state as SaleWorkspaceRecord;
const outboxFor = async (sale: SaleWorkspaceRecord) =>
  (
    await pool.query(
      "SELECT * FROM email_outbox WHERE dealer_id='invoice-a' AND validation#>>'{saleDocument,saleId}'=$1",
      [sale.id],
    )
  ).rows[0]!;
async function resetThrottle() {
  await pool.query("DELETE FROM email_account_throttle");
}

test.after(() => engine.close());
test("manual invoice emails use exact customer cases, durable reply routes and frozen outbox delivery", async (t) => {
  globalThis.fetch = async () => {
    throw new Error(
      "External network calls are forbidden in invoice integration tests.",
    );
  };
  for (const file of (await readdir("../../lib/db/drizzle"))
    .filter((name) => /^\d.*\.sql$/.test(name))
    .sort())
    await engine.exec(await readFile("../../lib/db/drizzle/" + file, "utf8"));
  for (const id of ["invoice-a", "invoice-b"]) {
    await pool.query(
      "INSERT INTO dealerships(id,name,status,canonical_origin,stock_platform,retailer_id,source_url) VALUES($1,'Fictional Motors','active',$2,'autotrader','fictional','https://www.autotrader.co.uk/fictional')",
      [id, tenant(id).canonicalOrigin],
    );
    await pool.query(
      "INSERT INTO portal_users(dealer_id,auth_user_id,role) VALUES($1,'test-accounts','accounts')",
      [id],
    );
  }
  for (const [id, dealer] of [
    [car, "invoice-a"],
    [otherCar, "invoice-a"],
  ])
    await pool.query(
      "INSERT INTO vehicles(id,dealer_id,source,advert_id,title,source_price) VALUES($1::uuid,$2,'autotrader',$1,'Fictional vehicle',10000)",
      [id, dealer],
    );
  for (const [id, dealer, vehicle] of [
    [originalEnquiry, "invoice-a", car],
    [sameEmailOtherEnquiry, "invoice-a", otherCar],
    [foreignEnquiry, "invoice-b", null],
  ])
    await pool.query(
      "INSERT INTO enquiries(id,dealer_id,type,status,customer_name,email,phone,vehicle_id,message) VALUES($1::uuid,$2,'general','contacted','Fictional Buyer','buyer@example.test','07700900123',$3::uuid,'Fictional request')",
      [id, dealer, vehicle],
    );
  await t.test(
    "manual send records outgoing invoice under its exact enquiry and a customer reply returns there, even with same-contact cases",
    async () => {
      const sale = await record(),
        input = request(sale),
        frozen = JSON.parse(JSON.stringify(sale.documents)),
        payments = structuredClone(sale.payments),
        archives = structuredClone(sale.documentArchives),
        sent: string[] = [];
      await resetThrottle();
      const result = await onTenant(() =>
        approveSaleDocumentEmail(input, {
          config,
          render,
          attempt: (id) =>
            deliverEmailOutbox(id, {
              settings: async () => config.resend,
              send: async (_settings, body) => {
                sent.push(body);
                return randomUUID();
              },
            }),
        }),
      );
      assert.equal(sent.length, 1);
      assert.equal(result.sale.emailDeliveries?.[0]?.status, "sent");
      const envelope = JSON.parse(sent[0]!);
      assert.equal(envelope.to[0], "buyer@example.test");
      assert.match(
        envelope.reply_to,
        /^r-[a-f0-9]{48}@replies\.a\.example\.test$/,
      );
      assert.equal(envelope.attachments.length, 1);
      assert.equal(
        envelope.attachments[0].content,
        sale.documentArchives![sale.documents[0]!.id]!.content,
      );
      const journal = (
        await pool.query(
          "SELECT * FROM enquiry_emails WHERE dealer_id='invoice-a' AND document_ids ? $1",
          [`${sale.id}:${sale.documents[0]!.id}`],
        )
      ).rows[0]!;
      assert.equal(journal.enquiry_id, originalEnquiry);
      assert.equal(journal.status, "sent");
      assert.equal(journal.message, "Your approved invoice.");
      const replyId = randomUUID();
      await acceptReplyEvent({
        type: "email.received",
        data: { email_id: replyId, to: [envelope.reply_to] },
      });
      const pending = (
        await pool.query(
          "SELECT * FROM enquiry_email_replies WHERE provider_id=$1::uuid",
          [replyId],
        )
      ).rows[0]!;
      assert.equal(pending.enquiry_id, originalEnquiry);
      await processCustomerReplies({ warn() {} }, async () =>
        Response.json({
          id: replyId,
          to: [envelope.reply_to],
          from: "Buyer <buyer@example.test>",
          subject: "Re: Invoice",
          text: "Thank you. When can I collect?",
          message_id: "<invoice-reply@example.test>",
          authentication: { dkim: "pass", dmarc: "pass" },
          attachments: [],
        }),
      );
      const incoming = (
        await pool.query(
          "SELECT * FROM enquiry_email_replies WHERE provider_id=$1::uuid",
          [replyId],
        )
      ).rows[0]!;
      assert.equal(incoming.enquiry_id, originalEnquiry);
      assert.equal(incoming.status, "received");
      assert.equal(
        Number(
          (
            await pool.query(
              "SELECT count(*) FROM enquiry_emails WHERE enquiry_id=$1::uuid",
              [sameEmailOtherEnquiry],
            )
          ).rows[0]!.count,
        ),
        0,
      );
      const replay = await onTenant(() =>
        approveSaleDocumentEmail(input, {
          config,
          render,
          attempt: async () => {
            throw new Error("Replay must not send.");
          },
        }),
      );
      assert.equal(replay.replayed, true);
      assert.equal(sent.length, 1);
      assert.deepEqual((await rawSale(sale.id)).documents, frozen);
      assert.deepEqual((await rawSale(sale.id)).payments, payments);
      assert.deepEqual((await rawSale(sale.id)).documentArchives, archives);
    },
  );
  await t.test(
    "an exact merged source resolves to its canonical enquiry without using contact matching",
    async () => {
      const source = randomUUID(),
        canonical = randomUUID();
      for (const id of [source, canonical])
        await pool.query(
          "INSERT INTO enquiries(id,dealer_id,type,status,customer_name,email,vehicle_id,message) VALUES($1::uuid,'invoice-a','general','contacted','Merged Buyer','buyer@example.test',$2::uuid,'Fictional merge case')",
          [id, car],
        );
      await pool.query(
        "UPDATE enquiries SET merged_into_id=$2::uuid WHERE id=$1::uuid",
        [source, canonical],
      );
      const sale = await record(source);
      await onTenant(() =>
        approveSaleDocumentEmail(request(sale), {
          config,
          render,
          attempt: async () => undefined,
        }),
      );
      const queued = await outboxFor(sale);
      assert.equal(queued.enquiry_id, canonical);
      assert.equal(
        (
          await pool.query(
            "SELECT enquiry_id FROM enquiry_emails WHERE id=$1::uuid",
            [queued.delivery_id],
          )
        ).rows[0]!.enquiry_id,
        canonical,
      );
    },
  );
  await t.test(
    "cross-tenant IDs and a source enquiry for another car fail without a new message or financial change",
    async () => {
      const sale = await record(foreignEnquiry),
        before = JSON.stringify(await rawSale(sale.id));
      await assert.rejects(
        onTenant(() =>
          approveSaleDocumentEmail(request(sale), {
            config,
            render,
            attempt: async () => {
              throw new Error("Must not send");
            },
          }),
        ),
        /customer enquiry is unavailable/,
      );
      assert.equal(JSON.stringify(await rawSale(sale.id)), before);
      await assert.rejects(
        onTenant(
          () => approveSaleDocumentEmail(request(sale), { config, render }),
          "invoice-b",
        ),
        /Sale not found/,
      );
      const wrongCar = await record(sameEmailOtherEnquiry);
      await assert.rejects(
        onTenant(() =>
          approveSaleDocumentEmail(request(wrongCar), { config, render }),
        ),
        /different vehicles/,
      );
      assert.equal(
        Number(
          (
            await pool.query(
              "SELECT count(*) FROM email_outbox WHERE validation#>>'{saleDocument,saleId}' IN ($1,$2)",
              [sale.id, wrongCar.id],
            )
          ).rows[0]!.count,
        ),
        0,
      );
    },
  );
  await t.test(
    "a stale sales screen cannot approve a new invoice email",
    async () => {
      const sale = await record(),
        before = await rawSale(sale.id);
      await assert.rejects(
        onTenant(() =>
          approveSaleDocumentEmail(
            { ...request(sale), expectedRevision: sale.revision - 1 },
            {
              config,
              render,
              attempt: async () => {
                throw new Error("Must not send");
              },
            },
          ),
        ),
        /sale changed/,
      );
      assert.deepEqual(await rawSale(sale.id), before);
      assert.equal(await outboxFor(sale), undefined);
    },
  );
  await t.test(
    "walk-in sales receive distinct deterministic threads rather than adopting a customer with the same name/email",
    async () => {
      const a = await record(undefined),
        b = await record(undefined);
      // Explicitly remove default source references for the walk-in fixtures.
      for (const sale of [a, b]) {
        delete sale.draft.sourceEnquiryId;
        delete sale.documents[0]!.snapshot.draft.sourceEnquiryId;
        sale.documentArchives![sale.documents[0]!.id] = archiveSaleDocument(
          sale.documents[0]!,
        );
        await pool.query(
          "UPDATE sale_workspace SET state=$2::jsonb WHERE id=$1::uuid",
          [sale.id, JSON.stringify(sale)],
        );
      }
      for (const sale of [a, b])
        await onTenant(() =>
          approveSaleDocumentEmail(request(sale), {
            config,
            render,
            attempt: async () => undefined,
          }),
        );
      const aBox = await outboxFor(a),
        bBox = await outboxFor(b);
      assert.notEqual(aBox.enquiry_id, bBox.enquiry_id);
      assert.notEqual(aBox.enquiry_id, originalEnquiry);
      assert.equal(
        aBox.enquiry_id,
        saleEmailIdentity(`sale-customer-thread:invoice-a:${a.id}`),
      );
      const thread = (
        await pool.query("SELECT * FROM enquiries WHERE id=$1::uuid", [
          aBox.enquiry_id,
        ])
      ).rows[0]!;
      assert.equal(thread.source, "sale_document");
      assert.equal(thread.reference, a.reference);
    },
  );
  await t.test(
    "accepted email merges its status into a concurrently changed ledger without reverting payment or invoice bytes",
    async () => {
      const sale = await record(),
        invoice = JSON.parse(JSON.stringify(sale.documents)),
        archives = structuredClone(sale.documentArchives),
        input = request(sale);
      await resetThrottle();
      const result = await onTenant(() =>
        approveSaleDocumentEmail(input, {
          config,
          render,
          attempt: (id) =>
            deliverEmailOutbox(id, {
              settings: async () => config.resend,
              send: async () => {
                const current = await rawSale(sale.id),
                  context: SaleWorkspaceContext = {
                    now: new Date().toISOString(),
                    actor: "Other Staff",
                    nextId: randomUUID,
                    nextNumber: () => {
                      throw Error("No extra document");
                    },
                    branding: current.documents[0]!.snapshot.branding,
                  };
                const paid = changeSaleWorkspace(
                  current,
                  {
                    action: "invoice-payment",
                    payment: {
                      kind: "part-payment",
                      status: "confirmed",
                      method: "Cash",
                      amount: "200",
                      date: new Date().toISOString().slice(0, 10),
                      reference: "Fictional concurrent payment",
                    },
                  },
                  {
                    expectedRevision: current.revision,
                    requestId: randomUUID(),
                  },
                  context,
                ).sale;
                await pool.query(
                  "UPDATE sale_workspace SET state=$2::jsonb,revision=$3 WHERE id=$1::uuid",
                  [sale.id, JSON.stringify(paid), paid.revision],
                );
                return randomUUID();
              },
            }),
        }),
      );
      assert.equal(result.sale.payments.length, 1);
      assert.equal(
        saleWorkspaceTotals(result.sale.draft, result.sale.payments)
          .confirmedPaid,
        20000,
      );
      assert.equal(result.sale.emailDeliveries?.[0]?.status, "sent");
      assert.deepEqual(result.sale.documents, invoice);
      assert.deepEqual((await rawSale(sale.id)).documentArchives, archives);
    },
  );
  await t.test(
    "walk-in invoice, delivery WhatsApp and internal email preparation share one case; lookup alone creates nothing",
    async () => {
      const { default: express } = await import("express");
      const { createServer, request: requestHttp } = await import("node:http");
      const { whatsappConfirmationRouter } =
        await import("./lib/whatsapp-confirmation");
      const { customerEmailPreparationRouter } =
        await import("./lib/customer-email-preparation");
      const sale = await record();
      delete sale.draft.sourceEnquiryId;
      delete sale.documents[0]!.snapshot.draft.sourceEnquiryId;
      sale.documentArchives![sale.documents[0]!.id] = archiveSaleDocument(
        sale.documents[0]!,
      );
      await pool.query(
        "UPDATE sale_workspace SET state=$2::jsonb WHERE id=$1::uuid",
        [sale.id, JSON.stringify(sale)],
      );
      const before = await rawSale(sale.id),
        threadId = saleEmailIdentity(
          `sale-customer-thread:invoice-a:${sale.id}`,
        );
      const app = express();
      app.use(express.json());
      app.use((req, _res, next) => {
        req.staff = {
          authUserId: "test-owner",
          name: "Fictional Owner",
          email: "owner@example.test",
          role: "owner",
        };
        runWithTenant(tenant(req.get("x-test-dealer") || "invoice-a"), next);
      });
      app.use(
        "/wa",
        whatsappConfirmationRouter(),
        customerEmailPreparationRouter(),
      );
      const server = createServer(app);
      await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", resolve);
      });
      const port = (server.address() as { port: number }).port;
      const call = (path: string, body?: unknown, dealer = "invoice-a") =>
        new Promise<{ status: number; data: any }>((resolve, reject) => {
          const r = requestHttp(
            {
              hostname: "127.0.0.1",
              port,
              path: "/wa" + path,
              method: body ? "POST" : "GET",
              headers: {
                "content-type": "application/json",
                "x-test-dealer": dealer,
              },
            },
            (res) => {
              let out = "";
              res.on("data", (c) => (out += c));
              res.on("end", () =>
                resolve({ status: res.statusCode!, data: JSON.parse(out) }),
              );
            },
          );
          r.on("error", reject);
          if (body) r.write(JSON.stringify(body));
          r.end();
        });
      try {
        const initial = await call("/enquiries?saleId=" + sale.id);
        assert.equal(initial.status, 200);
        assert.deepEqual(initial.data.enquiries, []);
        assert.equal(initial.data.saleCustomer.phone, sale.draft.phone);
        assert.equal(
          Number(
            (
              await pool.query(
                "SELECT count(*) FROM enquiries WHERE id=$1::uuid",
                [threadId],
              )
            ).rows[0]!.count,
          ),
          0,
        );
        assert.equal(
          (await call("/enquiries?saleId=" + sale.id, undefined, "invoice-b"))
            .status,
          404,
        );
        const sent = await call("/confirm-whatsapp", {
          requestId: randomUUID(),
          saleId: sale.id,
          phone: sale.draft.phone,
          message: "Your delivery is arranged.",
          confirmed: true,
        });
        assert.equal(sent.status, 201);
        assert.equal(sent.data.enquiryId, threadId);
        const email = await call("/email-enquiry", {
          requestId: randomUUID(),
          saleId: sale.id,
          email: sale.draft.email,
        });
        assert.equal(email.status, 201);
        assert.equal(email.data.enquiry.id, threadId);
        await onTenant(() =>
          approveSaleDocumentEmail(request(sale), {
            config,
            render,
            attempt: async () => undefined,
          }),
        );
        assert.equal((await outboxFor(sale)).enquiry_id, threadId);
        const final = await call("/enquiries?saleId=" + sale.id);
        assert.equal(final.data.enquiries.length, 1);
        assert.equal(final.data.enquiries[0].id, threadId);
        assert.equal(
          (
            await call("/confirm-whatsapp", {
              requestId: randomUUID(),
              saleId: sale.id,
              enquiryId: originalEnquiry,
              phone: sale.draft.phone,
              message: "Mixed target",
              confirmed: true,
            })
          ).status,
          400,
        );
        const after = await rawSale(sale.id);
        assert.deepEqual(after.documents, before.documents);
        assert.deepEqual(after.payments, before.payments);
        assert.deepEqual(after.documentArchives, before.documentArchives);
      } finally {
        server.closeAllConnections();
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }
    },
  );
  await t.test(
    "historic issued documents without saved archives keep the deterministic PDF fallback without rewriting history",
    async () => {
      const sale = await record();
      delete sale.documentArchives;
      await pool.query(
        "UPDATE sale_workspace SET state=$2::jsonb WHERE id=$1::uuid",
        [sale.id, JSON.stringify(sale)],
      );
      const before = await rawSale(sale.id),
        payloads: string[] = [];
      await resetThrottle();
      await onTenant(() =>
        approveSaleDocumentEmail(request(sale), {
          config,
          render,
          attempt: (id) =>
            deliverEmailOutbox(id, {
              settings: async () => config.resend,
              send: async (_settings, body) => {
                payloads.push(body);
                return randomUUID();
              },
            }),
        }),
      );
      assert.equal(payloads.length, 1);
      assert.equal(
        JSON.parse(payloads[0]!).attachments[0].content,
        archiveSaleDocument(sale.documents[0]!).content,
      );
      const after = await rawSale(sale.id);
      assert.deepEqual(after.documents, before.documents);
      assert.deepEqual(after.payments, before.payments);
      assert.equal(after.documentArchives, undefined);
    },
  );
  await t.test(
    "a fresh request cannot duplicate an already queued or uncertain invoice email",
    async () => {
      for (const status of ["sending", "unknown"] as const) {
        const sale = await record();
        await onTenant(() =>
          approveSaleDocumentEmail(request(sale), {
            config,
            render,
            attempt: async () => undefined,
          }),
        );
        const current = await rawSale(sale.id);
        if (status === "unknown") {
          current.emailDeliveries![0]!.status = "unknown";
          await pool.query(
            "UPDATE sale_workspace SET state=$2::jsonb WHERE id=$1::uuid",
            [sale.id, JSON.stringify(current)],
          );
        }
        await assert.rejects(
          onTenant(() =>
            approveSaleDocumentEmail(request(current), {
              config,
              render,
              attempt: async () => {
                throw new Error("Must not send another copy");
              },
            }),
          ),
          /approved copy.*unconfirmed/,
        );
        assert.equal(
          Number(
            (
              await pool.query(
                "SELECT count(*) FROM email_outbox WHERE validation#>>'{saleDocument,saleId}'=$1",
                [sale.id],
              )
            ).rows[0]!.count,
          ),
          1,
        );
      }
    },
  );
  await t.test(
    "bounded retry sends the exact approved payload and reply address, never newly rendered wording",
    async () => {
      const sale = await record(),
        bodies: string[] = [];
      await resetThrottle();
      await onTenant(() =>
        approveSaleDocumentEmail(request(sale), {
          config,
          render,
          attempt: (id) =>
            deliverEmailOutbox(id, {
              settings: async () => config.resend,
              send: async (_settings, body) => {
                bodies.push(body);
                throw new EmailProviderError(429, 1);
              },
            }),
        }),
      );
      const queued = await outboxFor(sale);
      assert.equal(queued.status, "queued");
      assert.equal(
        (await rawSale(sale.id)).emailDeliveries?.[0]?.status,
        "sending",
      );
      await onTenant(() =>
        deliverEmailOutbox(queued.id, {
          now: new Date(Date.now() + 120000),
          settings: async () => config.resend,
          send: async (_settings, body) => {
            bodies.push(body);
            return randomUUID();
          },
        }),
      );
      assert.equal(bodies.length, 2);
      assert.equal(bodies[1], bodies[0]);
      assert.equal(
        (await rawSale(sale.id)).emailDeliveries?.[0]?.status,
        "sent",
      );
    },
  );
});
