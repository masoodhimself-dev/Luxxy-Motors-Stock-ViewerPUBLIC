import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID, createHash } from "node:crypto";
import { inspect } from "node:util";
import { readFile, readdir } from "node:fs/promises";
import { eq, sql } from "drizzle-orm";
import type { Logger } from "pino";
import {
  db,
  engine,
  dealershipsTable,
  enquiriesTable,
  enquiryEmailsTable,
  dealerSettingsTable,
  dealerDemosTable,
} from "./test/tenant-test-db";
import { runWithTenant, type TenantContext } from "./lib/tenant-context";
import {
  enqueueEmailOutbox,
  deliverEmailOutbox,
  readEmailOutbox,
  recoverEmailOutbox,
  emailRetryWindowMs,
  findDueEmailDealers,
  recoverExpiredEmailOutboxes,
  purgeTerminalEmailPayloads,
  type EmailOutbox,
} from "./lib/email-outbox";
import {
  EmailProviderError,
  classifyEmailFailure,
  emailRetryAfter,
  sendEmailWithSettings,
  type EmailRequest,
} from "./lib/email-provider";
import {
  dealerIntegrationsStore,
  type ResendSettings,
} from "./lib/dealer-integrations-store";
import {
  rebuildAutomaticOutboxEmail,
  processDueNotifications,
  deliverEnquiryNotifications,
} from "./lib/enquiry-notifications";
import { withEmailPreparation } from "./lib/email-preparation";
import {
  previewEnquiryEmail,
  rebuildStaffOutboxEmail,
} from "./routes/enquiry-emails";
import { dealerProfile } from "./lib/enquiry-notifications";

process.env.MULTI_TENANT_ENABLED = "true";
process.env.NODE_ENV = "test";
process.env.INTEGRATIONS_ENCRYPTION_KEY = Buffer.alloc(32, 27).toString(
  "base64",
);
process.env.SESSION_SECRET = "fictional-outbox-management-key";
const a: TenantContext = {
  dealerId: "a",
  canonicalOrigin: "https://a.example.test",
  platform: "autotrader",
  retailerId: "a",
  sourceUrl: "https://source.example.test/a",
};
const b: TenantContext = {
  ...a,
  dealerId: "b",
  canonicalOrigin: "https://b.example.test",
  retailerId: "b",
};
const settings = (name: string): ResendSettings => ({
  enabled: true,
  apiKey: `re_fictional_${name}`,
  from: "Showroom <sales@example.test>",
  replyTo: "reply@example.test",
});
const quiet = { info() {}, warn() {}, error() {} } as unknown as Logger;
let external = 0;
const originalFetch = globalThis.fetch;
globalThis.fetch = async () => {
  external++;
  throw Error("Real provider transport is prohibited in this test");
};

test("provider error policy distinguishes temporary rejection from unknown acceptance and never exposes response bodies", async () => {
  assert.equal(
    classifyEmailFailure(new EmailProviderError(429, 120)).kind,
    "retryable",
  );
  assert.equal(
    classifyEmailFailure(new EmailProviderError(503)).kind,
    "retryable",
  );
  assert.equal(
    classifyEmailFailure(new EmailProviderError(422)).kind,
    "permanent",
  );
  assert.equal(
    classifyEmailFailure(
      new EmailProviderError(409, null, "concurrent_idempotent_requests"),
    ).kind,
    "retryable",
  );
  assert.equal(
    classifyEmailFailure(
      new EmailProviderError(409, null, "invalid_idempotent_request"),
    ).kind,
    "unknown",
  );
  assert.equal(
    classifyEmailFailure(new Error("network timeout")).kind,
    "unknown",
  );
  assert.equal(emailRetryAfter("120"), 120);
  assert.equal(emailRetryAfter("garbage"), null);
  assert.equal(emailRetryAfter(new Date(120000).toUTCString(), 0), 120);
  const previous = process.env.MULTI_TENANT_ENABLED;
  process.env.MULTI_TENANT_ENABLED = "false";
  try {
    await assert.rejects(
      sendEmailWithSettings(
        settings("typed_error"),
        {
          to: "buyer@example.test",
          subject: "Fixture",
          html: "<p>Fixture</p>",
          idempotencyKey: "fixture-error",
        },
        async () =>
          new Response(
            JSON.stringify({
              name: "concurrent_idempotent_requests",
              message: "private provider details",
            }),
            { status: 409, headers: { "Retry-After": "70" } },
          ),
      ),
      (error) => {
        assert.ok(error instanceof EmailProviderError);
        assert.equal(error.providerCode, "concurrent_idempotent_requests");
        assert.equal(error.retryAfterSeconds, 70);
        assert.doesNotMatch(error.message, /private/);
        return true;
      },
    );
  } finally {
    process.env.MULTI_TENANT_ENABLED = previous;
  }
});

test("durable immutable email outbox: retry, restart, ownership, freshness, bounded attempts and tenant isolation", async (t) => {
  try {
    for (const name of (await readdir("../../lib/db/drizzle"))
      .filter((n) => /^\d.*\.sql$/.test(n))
      .sort())
      await engine.exec(await readFile("../../lib/db/drizzle/" + name, "utf8"));
    for (const tenant of [a, b]) {
      await db.insert(dealershipsTable).values({
        id: tenant.dealerId,
        name: tenant.dealerId,
        status: "active",
        canonicalOrigin: tenant.canonicalOrigin,
        stockPlatform: tenant.platform,
        retailerId: tenant.retailerId,
        sourceUrl: tenant.sourceUrl,
      });
      await db.insert(dealerSettingsTable).values({
        dealerId: tenant.dealerId,
        config: {
          identity: { name: `Showroom ${tenant.dealerId}` },
          contact: { email: "sales@example.test" },
        },
      });
    }
    async function fixture(
      label: string,
      kind: "customer" | "staff" = "customer",
    ) {
      const id = randomUUID(),
        requestId = randomUUID(),
        deliveryId = kind === "staff" ? randomUUID() : undefined,
        config = settings(label);
      await db.insert(enquiriesTable).values({
        id,
        dealerId: "a",
        type: "general",
        customerName: "Fictional customer",
        email: "buyer@example.test",
        message: "Fixture only",
        customerNotificationStatus:
          kind === "customer" ? "sending" : "not_sent",
        customerNotificationAttemptedAt: new Date(),
      });
      if (deliveryId)
        await db.insert(enquiryEmailsTable).values({
          id: deliveryId,
          dealerId: "a",
          enquiryId: id,
          requestId,
          requestHash: "fixture-hash",
          status: "sending",
          recipient: "buyer@example.test",
          subject: "Approved subject",
          message: "Approved message",
          createdBy: "fixture",
        });
      const request: EmailRequest = {
        to: "buyer@example.test",
        subject: "Approved subject",
        html: "<p>Approved message</p>",
        text: "Approved message",
        idempotencyKey: `fixture-${label}`,
        attachments: [
          {
            filename: "fixture.txt",
            content: Buffer.from("Original bytes").toString("base64"),
          },
        ],
      };
      const now = new Date();
      const row = await enqueueEmailOutbox({
        enquiryId: id,
        deliveryId,
        kind,
        config,
        request,
        validation: { appointmentRevision: 0 },
        now,
      });
      return {
        id,
        deliveryId,
        config,
        request,
        row,
        now,
        options: { settings: async () => config, rebuild: async () => request },
      };
    }
    await runWithTenant(a, async () => {
      await t.test(
        "429 honors Retry-After and reuses identical payload/key after a restart-equivalent invocation",
        async () => {
          const f = await fixture("rate_limit"),
            sent: Array<{ body: string; key: string }> = [];
          const first = await deliverEmailOutbox(f.row.id, {
            ...f.options,
            now: f.now,
            send: async (_config, body, key) => {
              sent.push({ body, key });
              throw new EmailProviderError(429, 120);
            },
          });
          assert.equal(first!.status, "queued");
          assert.equal(first!.attempts, 1);
          assert.equal(
            new Date(first!.next_attempt_at).getTime(),
            f.now.getTime() + 120000,
          );
          await deliverEmailOutbox(f.row.id, {
            ...f.options,
            now: new Date(f.now.getTime() + 119000),
            send: async () => assert.fail("Retry-After not reached"),
          });
          const second = await deliverEmailOutbox(f.row.id, {
            ...f.options,
            now: new Date(f.now.getTime() + 121000),
            send: async (_config, body, key) => {
              sent.push({ body, key });
              return "provider_fixture";
            },
          });
          assert.equal(second!.status, "sent");
          assert.equal(second!.attempts, 2);
          assert.deepEqual(sent[0], sent[1]);
          await deliverEmailOutbox(f.row.id, {
            ...f.options,
            now: new Date(f.now.getTime() + 122000),
            send: async () => assert.fail("Completed send must not repeat"),
          });
          assert.ok(!first!.payload!.includes(f.config.apiKey));
        },
      );
      await t.test("503 retries are bounded to three attempts", async () => {
        const f = await fixture("server_limit");
        let calls = 0;
        const send = async () => {
          calls++;
          throw new EmailProviderError(503);
        };
        let row = await deliverEmailOutbox(f.row.id, {
          ...f.options,
          now: f.now,
          send,
        });
        assert.equal(row!.status, "queued");
        row = await deliverEmailOutbox(f.row.id, {
          ...f.options,
          now: new Date(f.now.getTime() + 61000),
          send,
        });
        assert.equal(row!.status, "queued");
        row = await deliverEmailOutbox(f.row.id, {
          ...f.options,
          now: new Date(f.now.getTime() + 362000),
          send,
        });
        assert.equal(row!.status, "unknown");
        assert.equal(calls, 3);
      });
      await t.test(
        "exhausted concurrent409 stays unknown because another same-key send may have been accepted",
        async () => {
          const f = await fixture("concurrent_exhausted");
          await db.execute(
            sql`UPDATE email_outbox SET attempts=2 WHERE id=${f.row.id}::uuid`,
          );
          const row = await deliverEmailOutbox(f.row.id, {
            ...f.options,
            now: f.now,
            send: async () => {
              throw new EmailProviderError(
                409,
                null,
                "concurrent_idempotent_requests",
              );
            },
          });
          assert.equal(row!.status, "unknown");
          assert.equal(row!.attempts, 3);
        },
      );
      await t.test(
        "Retry-After starts when the rejection is received, not when a slow call began",
        async () => {
          const f = await fixture("receipt_clock");
          let clock = f.now;
          const row = await deliverEmailOutbox(f.row.id, {
            ...f.options,
            clock: () => clock,
            send: async () => {
              clock = new Date(f.now.getTime() + 15000);
              throw new EmailProviderError(429, 60);
            },
          });
          assert.equal(
            new Date(row!.next_attempt_at).getTime(),
            f.now.getTime() + 75000,
          );
        },
      );
      await t.test(
        "preparation is globally bounded and local capacity consumes no provider attempt",
        async () => {
          const f = await fixture("preparation_bound");
          let finish!: () => void;
          const gate = new Promise<void>((resolve) => {
            finish = resolve;
          });
          const first = withEmailPreparation(() => gate),
            second = withEmailPreparation(() => gate);
          const deferred = await deliverEmailOutbox(f.row.id, {
            ...f.options,
            now: f.now,
            send: async () => assert.fail("No preparation slot"),
          });
          assert.equal(deferred!.status, "queued");
          assert.equal(deferred!.attempts, 0);
          finish();
          await Promise.all([first, second]);
          const local = await fixture("local_provider_bound");
          await db.execute(
            sql`UPDATE email_outbox SET attempts=2 WHERE id=${local.row.id}::uuid`,
          );
          const row = await deliverEmailOutbox(local.row.id, {
            ...local.options,
            now: local.now,
            send: async () => {
              throw new EmailProviderError(503, 15, "local_capacity", false);
            },
          });
          assert.equal(row!.status, "queued");
          assert.equal(row!.attempts, 2);
        },
      );
      await t.test(
        "calendar metadata can change during validation but transport retains the original attachment bytes",
        async () => {
          const f = await fixture("calendar_bytes");
          await db.execute(
            sql`DELETE FROM email_outbox WHERE id=${f.row.id}::uuid`,
          );
          const attachment = (stamp: string) => [
            {
              filename: "viewing.ics",
              content: Buffer.from(
                `BEGIN:VEVENT\r\nDTSTAMP:${stamp}\r\nSUMMARY:Same booking\r\nEND:VEVENT\r\n`,
              ).toString("base64"),
            },
          ];
          const original = {
            ...f.request,
            attachments: attachment("20260101T000000Z"),
          };
          const row = await enqueueEmailOutbox({
            enquiryId: f.id,
            kind: "customer",
            config: f.config,
            request: original,
            validation: { appointmentRevision: 0 },
            now: f.now,
          });
          const result = await deliverEmailOutbox(row.id, {
            settings: f.options.settings,
            rebuild: async () => ({
              ...original,
              attachments: attachment("20260102T000000Z"),
            }),
            now: f.now,
            send: async (_config, body) => {
              assert.equal(
                JSON.parse(body).attachments[0].content,
                original.attachments[0]!.content,
              );
              return "provider_calendar";
            },
          });
          assert.equal(result!.status, "sent");
        },
      );
      await t.test(
        "unknown acceptance and permanent rejection never automatically resend",
        async () => {
          for (const [label, error, status] of [
            ["timeout", new Error("provider connection timed out"), "unknown"],
            ["permanent", new EmailProviderError(422), "failed"],
          ] as const) {
            const f = await fixture(label);
            let calls = 0;
            let row = await deliverEmailOutbox(f.row.id, {
              ...f.options,
              now: f.now,
              send: async () => {
                calls++;
                throw error;
              },
            });
            assert.equal(row!.status, status);
            row = await deliverEmailOutbox(f.row.id, {
              ...f.options,
              now: new Date(f.now.getTime() + 600000),
              send: async () => {
                calls++;
                return "unexpected";
              },
            });
            assert.equal(calls, 1);
            assert.equal(row!.status, status);
          }
        },
      );
      await t.test(
        "two concurrent callers produce one lease and one send",
        async () => {
          const f = await fixture("parallel");
          let finish!: () => void,
            calls = 0;
          const gate = new Promise<void>((resolve) => {
            finish = resolve;
          });
          const send = async () => {
            calls++;
            await gate;
            return "provider_parallel";
          };
          const first = deliverEmailOutbox(f.row.id, {
            ...f.options,
            now: f.now,
            send,
          });
          while (calls === 0) await new Promise((r) => setImmediate(r));
          const duplicate = await deliverEmailOutbox(f.row.id, {
            ...f.options,
            now: f.now,
            send,
          });
          assert.equal(duplicate!.status, "sending");
          assert.equal(calls, 1);
          finish();
          assert.equal((await first)!.status, "sent");
        },
      );
      await t.test(
        "expired lease and pre-migration staff sending become unknown without a provider call",
        async () => {
          const f = await fixture("killed", "staff");
          await db.execute(
            sql`UPDATE email_outbox SET status='sending',attempts=1,lease_token=${randomUUID()}::uuid,lease_until=${new Date(f.now.getTime() - 1)} WHERE id=${f.row.id}::uuid`,
          );
          await recoverEmailOutbox(f.now);
          assert.equal((await readEmailOutbox(f.row.id))!.status, "unknown");
          assert.equal(
            (
              await db
                .select()
                .from(enquiryEmailsTable)
                .where(eq(enquiryEmailsTable.id, f.deliveryId!))
            )[0]!.status,
            "unknown",
          );
          const legacy = await fixture("legacy", "staff");
          await db.execute(
            sql`DELETE FROM email_outbox WHERE id=${legacy.row.id}::uuid`,
          );
          await db
            .update(enquiryEmailsTable)
            .set({ createdAt: new Date(f.now.getTime() - 6 * 60000) })
            .where(eq(enquiryEmailsTable.id, legacy.deliveryId!));
          await recoverEmailOutbox(f.now);
          assert.equal(
            (
              await db
                .select()
                .from(enquiryEmailsTable)
                .where(eq(enquiryEmailsTable.id, legacy.deliveryId!))
            )[0]!.status,
            "unknown",
          );
        },
      );
      await t.test(
        "changed payload, credentials, sender or facts stop retry instead of mutating approved content",
        async () => {
          const f = await fixture("changed");
          const payload = f.row.payload;
          const changed = await enqueueEmailOutbox({
            enquiryId: f.id,
            kind: "customer",
            config: f.config,
            request: { ...f.request, html: "<p>Different content</p>" },
            validation: { appointmentRevision: 0 },
            now: f.now,
          });
          assert.equal(changed.status, "unknown");
          assert.equal(changed.payload, payload);
          for (const [label, configChange, requestChange] of [
            ["account", { apiKey: "re_fictional_other_account" }, {}],
            ["sender", { from: "other@example.test" }, {}],
            ["facts", {}, { subject: "Changed facts" }],
          ] as const) {
            const item = await fixture(label);
            let calls = 0;
            const row = await deliverEmailOutbox(item.row.id, {
              now: item.now,
              settings: async () => ({ ...item.config, ...configChange }),
              rebuild: async () => ({ ...item.request, ...requestChange }),
              send: async () => {
                calls++;
                return "unexpected";
              },
            });
            assert.equal(row!.status, "unknown");
            assert.equal(calls, 0);
          }
        },
      );
      await t.test(
        "retry window expires before Resend forgets its24-hour idempotency key",
        async () => {
          const f = await fixture("expired");
          let calls = 0;
          const row = await deliverEmailOutbox(f.row.id, {
            ...f.options,
            now: new Date(f.now.getTime() + emailRetryWindowMs + 1),
            send: async () => {
              calls++;
              return "unexpected";
            },
          });
          assert.equal(row!.status, "unknown");
          assert.equal(calls, 0);
        },
      );
      await t.test(
        "real automatic validator blocks a changed customer or appointment before retry",
        async () => {
          const config = settings("automatic");
          await dealerIntegrationsStore.update({
            expectedRevision: 0,
            resend: config,
          });
          const [enquiry] = await db
            .insert(enquiriesTable)
            .values({
              dealerId: "a",
              type: "general",
              customerName: "Original customer",
              email: "buyer@example.test",
              message: "Fixture",
              customerNotificationStatus: "sending",
              customerNotificationAttemptedAt: new Date(),
            })
            .returning();
          const fake = {
            kind: "customer",
            dealer_id: "a",
            enquiry_id: enquiry!.id,
            send_key: "automatic_facts",
            validation: {
              workspaceRevision: 0,
              appointmentRevision: 0,
              version: "received-0-0",
            },
          } as unknown as EmailOutbox;
          const request = await rebuildAutomaticOutboxEmail(fake);
          const now = new Date();
          const row = await enqueueEmailOutbox({
            enquiryId: enquiry!.id,
            kind: "customer",
            config,
            request,
            validation: fake.validation,
            now,
          });
          let calls = 0;
          await deliverEmailOutbox(row.id, {
            now,
            send: async () => {
              calls++;
              throw new EmailProviderError(429);
            },
          });
          await db
            .update(enquiriesTable)
            .set({ customerName: "Changed customer", workspaceRevision: 1 })
            .where(eq(enquiriesTable.id, enquiry!.id));
          const stopped = await deliverEmailOutbox(row.id, {
            now: new Date(now.getTime() + 61000),
            send: async () => {
              calls++;
              return "unexpected";
            },
          });
          assert.equal(stopped!.status, "unknown");
          assert.equal(calls, 1);
        },
      );
      await t.test(
        "legacy failed notifications are not replayed on deployment and another dealer cannot read or deliver",
        async () => {
          const f = await fixture("isolation");
          await runWithTenant(b, async () => {
            assert.equal(await readEmailOutbox(f.row.id), undefined);
            assert.equal(
              await deliverEmailOutbox(f.row.id, {
                ...f.options,
                send: async () => assert.fail("Cross-dealer send"),
              }),
              undefined,
            );
          });
          await db.execute(
            sql`UPDATE email_outbox SET status='unknown' WHERE id=${f.row.id}::uuid`,
          );
          const [old] = await db
            .insert(enquiriesTable)
            .values({
              dealerId: "a",
              type: "general",
              customerName: "Legacy fixture",
              message: "Old failure",
              customerNotificationStatus: "failed",
              customerNotificationError: "Original failed record",
            })
            .returning();
          await processDueNotifications(quiet);
          assert.equal(
            (
              await db
                .select()
                .from(enquiriesTable)
                .where(eq(enquiriesTable.id, old!.id))
            )[0]!.customerNotificationStatus,
            "failed",
          );
          assert.equal(external, 0);
        },
      );
      await t.test(
        "old and new queued layouts validate and transport the exact approved bytes across the upgrade",
        async () => {
          const config = (await dealerIntegrationsStore.readPrivate()).resend;
          const outputs: string[] = [];
          for (const layoutVersion of [
            undefined,
            "correspondence-v1",
          ] as const) {
            const [enquiry] = await db
              .insert(enquiriesTable)
              .values({
                dealerId: "a",
                type: "general",
                customerName: "Layout customer",
                email: "buyer@example.test",
                message: "Keep the approved message",
                customerNotificationStatus: "sending",
                customerNotificationAttemptedAt: new Date(),
              })
              .returning();
            const fake = {
              kind: "customer",
              dealer_id: "a",
              enquiry_id: enquiry!.id,
              send_key: `layout-${layoutVersion ?? "legacy"}`,
              validation: {
                workspaceRevision: 0,
                appointmentRevision: 0,
                version: "received-0-0",
                ...(layoutVersion ? { layoutVersion } : {}),
              },
            } as unknown as EmailOutbox;
            const request = await rebuildAutomaticOutboxEmail(fake);
            outputs.push(request.html);
            const row = await enqueueEmailOutbox({
              enquiryId: enquiry!.id,
              kind: "customer",
              config,
              request,
              validation: fake.validation,
            });
            let sentBody = "";
            const delivered = await deliverEmailOutbox(row.id, {
              // Earlier fault scenarios intentionally leave an account cooldown.
              now: new Date(Date.now() + (5 + outputs.length) * 60_000),
              send: async (_config, body) => {
                sentBody = body;
                return "fictional-layout-provider-id";
              },
            });
            assert.equal(delivered!.status, "sent");
            assert.equal(sentBody, row.payload);
            assert.equal(JSON.parse(sentBody).html, request.html);
          }
          assert.notEqual(outputs[0], outputs[1]);
          assert.match(outputs[0]!, /class="email-pad"/);
          assert.match(outputs[1]!, /class="content"/);
        },
      );
      await t.test(
        "single-dealer machine approvals remain valid only while that exact token is configured",
        async () => {
          const f = await fixture("machine", "staff"),
            config = await dealerIntegrationsStore.readPrivate();
          config.resend = f.config;
          await db
            .update(enquiryEmailsTable)
            .set({ createdBy: "machine" })
            .where(eq(enquiryEmailsTable.id, f.deliveryId!));
          const input = {
            to: f.request.to,
            subject: f.request.subject,
            message: "Approved message",
            includeVehicle: false,
            includeAppointment: false,
            photoIds: [],
            documentIds: [],
            expectedRevision: 0,
          };
          const prepared = await previewEnquiryEmail(
            f.id,
            input,
            config,
            await dealerProfile(),
          );
          const row = {
            ...f.row,
            validation: {
              input,
              previewHash: prepared.previewHash,
              layoutVersion: "correspondence-v1",
              machineTokenHash: createHash("sha256")
                .update("fictional_machine_token")
                .digest("hex"),
            },
          };
          const previous = process.env.PORTAL_API_TOKEN;
          process.env.MULTI_TENANT_ENABLED = "false";
          process.env.PORTAL_API_TOKEN = "fictional_machine_token";
          try {
            assert.equal(
              (await rebuildStaffOutboxEmail(row, config)).to,
              input.to,
            );
            const legacy = await previewEnquiryEmail(
              f.id,
              input,
              config,
              await dealerProfile(),
              db as any,
              "legacy-v1",
            );
            const legacyRow = {
              ...row,
              validation: {
                ...row.validation,
                layoutVersion: undefined,
                previewHash: legacy.previewHash,
              },
            };
            assert.equal(
              (await rebuildStaffOutboxEmail(legacyRow, config)).html,
              legacy.rendered.html,
            );
            assert.notEqual(legacy.rendered.html, prepared.rendered.html);
            process.env.PORTAL_API_TOKEN = "rotated_machine_token";
            await assert.rejects(
              rebuildStaffOutboxEmail(row, config),
              /no longer authorised/,
            );
            process.env.PORTAL_API_TOKEN = "fictional_machine_token";
            process.env.MULTI_TENANT_ENABLED = "true";
            await assert.rejects(
              rebuildStaffOutboxEmail(row, config),
              /no longer authorised/,
            );
          } finally {
            process.env.MULTI_TENANT_ENABLED = "true";
            if (previous === undefined) delete process.env.PORTAL_API_TOKEN;
            else process.env.PORTAL_API_TOKEN = previous;
          }
        },
      );
      await t.test(
        "terminal transport payloads expire while durable audit identity survives",
        async () => {
          const f = await fixture("purge", "staff");
          await deliverEmailOutbox(f.row.id, {
            ...f.options,
            now: f.now,
            send: async () => "provider_purge",
          });
          await recoverEmailOutbox(new Date(f.now.getTime() + 49 * 3600000));
          const retained = await readEmailOutbox(f.row.id);
          assert.equal(retained!.payload, null);
          assert.equal(retained!.payload_hash, f.row.payload_hash);
          assert.equal(retained!.status, "sent");
          assert.equal(
            (
              await db
                .select()
                .from(enquiryEmailsTable)
                .where(eq(enquiryEmailsTable.id, f.deliveryId!))
            )[0]!.message,
            "Approved message",
          );
        },
      );
      await t.test(
        "targeted discovery excludes demos and suspended dealers while expiry housekeeping still purges their payloads",
        async () => {
          await fixture("discovery");
          const [other] = await db
            .insert(enquiriesTable)
            .values({
              dealerId: "b",
              type: "general",
              customerName: "Other fixture",
              message: "Fixture",
            })
            .returning();
          const now = new Date();
          const demo = await runWithTenant(b, () =>
            enqueueEmailOutbox({
              enquiryId: other!.id,
              kind: "customer",
              config: settings("discovery_demo"),
              request: {
                to: "buyer@example.test",
                subject: "Fixture",
                html: "<p>Fixture</p>",
                idempotencyKey: "fixture_discovery_demo",
              },
              validation: { appointmentRevision: 0 },
              now,
            }),
          );
          await db.insert(dealerDemosTable).values({
            dealerId: "b",
            recipient: "operator@example.test",
            expiresAt: new Date(now.getTime() + 86400000),
            updatedBy: "fixture",
          });
          let eligible = await findDueEmailDealers();
          assert.ok(eligible.some((row) => row.id === "a"));
          assert.ok(!eligible.some((row) => row.id === "b"));
          await db
            .update(dealerDemosTable)
            .set({ convertedAt: now })
            .where(eq(dealerDemosTable.dealerId, "b"));
          eligible = await findDueEmailDealers();
          assert.ok(eligible.some((row) => row.id === "b"));
          await db
            .update(dealershipsTable)
            .set({ status: "suspended" })
            .where(eq(dealershipsTable.id, "b"));
          eligible = await findDueEmailDealers();
          assert.ok(!eligible.some((row) => row.id === "b"));
          const later = new Date(now.getTime() + 49 * 3600000);
          await recoverExpiredEmailOutboxes(later);
          await purgeTerminalEmailPayloads(later);
          await runWithTenant(b, async () => {
            const retained = await readEmailOutbox(demo.id);
            assert.equal(retained!.status, "unknown");
            assert.equal(retained!.payload, null);
          });
          assert.equal(external, 0);
        },
      );
      await t.test(
        "an outbox SQL failure never logs its private payload or credentials",
        async (sub) => {
          const [enquiry] = await db
            .insert(enquiriesTable)
            .values({
              dealerId: "a",
              type: "general",
              customerName: "Private fixture",
              email: "private@example.test",
              message: "Private message",
              customerNotificationStatus: "pending",
              dealerNotificationStatus: "not_sent",
            })
            .returning();
          const captured: unknown[] = [];
          const logger = {
            info: (...args: unknown[]) => captured.push(args),
            warn: (...args: unknown[]) => captured.push(args),
            error: (...args: unknown[]) => captured.push(args),
          } as unknown as Logger;
          const failure = new Error(
            "Failed query INSERT email_outbox params DO_NOT_LOG_CUSTOMER DO_NOT_LOG_ATTACHMENT DO_NOT_LOG_SECRET",
            {
              cause: {
                params: [
                  "DO_NOT_LOG_CUSTOMER",
                  "DO_NOT_LOG_ATTACHMENT",
                  "DO_NOT_LOG_SECRET",
                ],
              },
            },
          );
          const mocked = sub.mock.method(db, "execute", async () => {
            throw failure;
          });
          try {
            const result = await deliverEnquiryNotifications(enquiry!, logger);
            assert.equal(result.customerNotificationStatus, "unknown");
          } finally {
            mocked.mock.restore();
          }
          assert.ok(captured.length > 0);
          assert.doesNotMatch(
            inspect(captured, { depth: 8 }),
            /DO_NOT_LOG_|private@example/,
          );
          assert.match(inspect(captured), /email_queue_unavailable/);
          assert.equal(external, 0);
        },
      );
    });
    assert.equal(external, 0);
  } finally {
    globalThis.fetch = originalFetch;
    await engine.close();
  }
});
