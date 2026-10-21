import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { Router, type Request, type Response } from "express";
import { sql } from "drizzle-orm";
import {
  engine,
  db,
  dealershipsTable,
  dealerSettingsTable,
  enquiriesTable,
  vehiclesTable,
} from "./test/tenant-test-db";
import { runWithTenant } from "./lib/tenant-context";
import { createStaffAiDraftsRouter } from "./routes/staff-ai-drafts";
import { createStaffNotificationsRouter } from "./routes/staff-notifications";
import { createEnquiryEmailRouter } from "./routes/enquiry-emails";
import { aiDraftPeriod, aiDraftLimits } from "./lib/ai-drafts";
import {
  aiDraftRequest,
  aiDraftMaxRequestBytes,
  aiDraftReservedMicroUsd,
  createAiDraftProvider,
  validateAiSuggestion,
  AiProviderError,
  aiProviderFailure,
  type AiDraftInput,
  type AiDraftProvider,
} from "./lib/ai-draft-provider";
import { defaultEmailAppearance } from "@workspace/vehicle-meta";

// Only fictional keys and an in-process PGlite database. Every provider call is a stub.
process.env.MULTI_TENANT_ENABLED = "true";
const sample: AiDraftInput = {
  enquiry: { type: "general", message: "What is the mileage?" },
  dealer: { name: "Fictional Motors", town: "Example", openingHours: [] },
  vehicle: {
    title: "Ford Focus",
    priceGbp: 9000,
    mileage: 40000,
    status: "available",
  },
};
const reply = {
  subject: "About the Ford Focus",
  message:
    "Hello,\n\nThank you for your enquiry. The listed mileage is 40,000 miles.",
  followUpQuestions: ["What else would you like to know?"],
};
const response = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status });
const providerResponse = (value: unknown = reply) => ({
  status: "completed",
  output: [
    {
      type: "message",
      content: [{ type: "output_text", text: JSON.stringify(value) }],
    },
  ],
});

test("AI provider fixes the economical model, bounds, no-store, no-tools, standard tier and no-redirect request", async () => {
  process.env.OPENAI_API_KEY = "sk_fictional_test_only";
  let calls = 0;
  const provider = createAiDraftProvider(async (url, init) => {
    calls++;
    assert.equal(url, "https://api.openai.com/v1/responses");
    assert.equal(init?.redirect, "error");
    assert.ok(init?.signal);
    assert.equal(
      new Headers(init?.headers).get("Authorization"),
      "Bearer sk_fictional_test_only",
    );
    const request = JSON.parse(String(init?.body));
    assert.equal(request.model, "gpt-6-luna");
    assert.equal(request.store, false);
    assert.match(request.instructions, /Never include internal enquiry, booking, reservation, sale or customer reference numbers or record IDs/);
    assert.equal(request.service_tier, "default");
    assert.deepEqual(request.reasoning, { effort: "none" });
    assert.deepEqual(request.tools, []);
    assert.equal(request.max_output_tokens, 800);
    assert.equal(request.text.format.type, "json_schema");
    assert.equal(request.text.format.strict, true);
    assert.ok(Buffer.byteLength(String(init?.body)) <= aiDraftMaxRequestBytes);
    return response(providerResponse());
  });
  const suggestion = await provider(sample);
  assert.equal(calls, 1);
  assert.match(suggestion.message, /What else would you like to know/);
  assert.ok(suggestion.message.endsWith(`\n\n${sample.dealer.name}`));
  assert.ok(
    suggestion.message.indexOf(reply.followUpQuestions[0]!) <
      suggestion.message.lastIndexOf(sample.dealer.name),
  );
  const withoutQuestions = validateAiSuggestion(
    { ...reply, followUpQuestions: [] },
    sample,
  );
  assert.ok(withoutQuestions.message.endsWith(`\n\n${sample.dealer.name}`));
  assert.ok(suggestion.warnings.length);
  // 12,000 UTF-8 bytes + framing at the higher cache-write input rate, plus all output.
  assert.ok(
    (aiDraftMaxRequestBytes + 2048) * 0.125 + 800 * 0.5 <
      aiDraftReservedMicroUsd,
  );
});
test("provider errors, malformed output and unsafe claims never leak bodies or cause retries", async (t) => {
  for (const [name, result] of [
    [
      "rejected",
      () => response({ secret: "provider-body-must-not-leak" }, 429),
    ],
    [
      "redirected",
      () => response({ secret: "provider-body-must-not-leak" }, 302),
    ],
    [
      "refused",
      () =>
        response({
          status: "completed",
          output: [
            {
              type: "message",
              content: [
                { type: "refusal", refusal: "provider-body-must-not-leak" },
              ],
            },
          ],
        }),
    ],
    ["incomplete", () => response({ status: "incomplete", output: [] })],
    [
      "HTML",
      () =>
        response(
          providerResponse({ ...reply, message: "<script>bad()</script>" }),
        ),
    ],
    [
      "header injection",
      () =>
        response(
          providerResponse({
            ...reply,
            subject: "Hello\r\nBcc: bad@example.test",
          }),
        ),
    ],
    [
      "invented price",
      () =>
        response(
          providerResponse({ ...reply, message: "The car costs £12,000." }),
        ),
    ],
    [
      "booking promise",
      () =>
        response(
          providerResponse({
            ...reply,
            message: "Your test drive is confirmed.",
          }),
        ),
    ],
    [
      "warranty promise",
      () =>
        response(
          providerResponse({
            ...reply,
            message: "The car comes with a warranty.",
          }),
        ),
    ],
    [
      "invented contact",
      () =>
        response(
          providerResponse({
            ...reply,
            message: "Email sales-invented@example.test for a discount.",
          }),
        ),
    ],
    [
      "ULEZ promise",
      () =>
        response(
          providerResponse({
            ...reply,
            message: "It is fully ULEZ compliant.",
          }),
        ),
    ],
  ] as const)
    await t.test(name, async () => {
      let calls = 0;
      await assert.rejects(
        createAiDraftProvider(async () => {
          calls++;
          return result();
        })(sample),
        (error: unknown) =>
          error instanceof AiProviderError &&
          !error.message.includes("provider-body"),
      );
      assert.equal(calls, 1);
    });
  let calls = 0;
  await assert.rejects(
    createAiDraftProvider(async () => {
      calls++;
      throw new Error("provider-body-must-not-leak");
    })(sample),
    (error: unknown) =>
      error instanceof AiProviderError &&
      error.uncertain &&
      !error.message.includes("must-not-leak"),
  );
  assert.equal(calls, 1);
  await assert.rejects(
    createAiDraftProvider(async () => new Response("x".repeat(33000)))(sample),
    AiProviderError,
  );
  assert.throws(
    () =>
      aiDraftRequest({
        ...sample,
        enquiry: { type: "general", message: "𠜎".repeat(4000) },
      }),
    /too long/,
  );
  assert.throws(
    () =>
      validateAiSuggestion(
        { ...reply, message: "This car is available now." },
        {
          ...sample,
          vehicle: { ...sample.vehicle, status: "availability_unconfirmed" },
        },
      ),
    AiProviderError,
  );
});
test("provider diagnostics expose only allowlisted codes and HTTP status, with friendly recovery guidance", async () => {
  for (const [code, status, message] of [
    ["invalid_api_key", 401, /authenticate/],
    ["insufficient_quota", 429, /billing/],
    ["model_not_found", 404, /model access/],
    ["unsupported_parameter", 400, /integration/],
    ["rate_limit_exceeded", 429, /request limit/],
  ] as const) {
    const provider = createAiDraftProvider(async () =>
      response(
        {
          error: {
            code,
            message: "sk-private-provider-message",
            param: "private-parameter",
          },
        },
        status,
      ),
    );
    await assert.rejects(provider(sample), (error: unknown) => {
      assert.ok(error instanceof AiProviderError);
      assert.equal(error.failureCode, code);
      assert.equal(error.httpStatus, status);
      const publicError = aiProviderFailure(error);
      assert.match(publicError.message, message);
      assert.deepEqual(publicError.details, {
        code: "generation_failed",
        canStartNew: true,
        providerCode: code,
        providerStatus: status,
      });
      assert.ok(!JSON.stringify(publicError).includes("private"));
      return true;
    });
  }
  await assert.rejects(
    createAiDraftProvider(async () =>
      response(
        { error: { code: "sk-private-error-code", message: "private" } },
        400,
      ),
    )(sample),
    (error: unknown) =>
      error instanceof AiProviderError &&
      error.failureCode === "request_rejected" &&
      error.httpStatus === 400,
  );
});

test("AI usage boundaries use London calendar dates across BST, GMT and month rollover", () => {
  assert.deepEqual(aiDraftPeriod(new Date("2026-07-31T23:30:00Z")), {
    day: "2026-08-01",
    month: "2026-08",
  });
  assert.deepEqual(aiDraftPeriod(new Date("2026-10-25T00:30:00Z")), {
    day: "2026-10-25",
    month: "2026-10",
  });
  assert.deepEqual(aiDraftPeriod(new Date("2026-10-25T01:30:00Z")), {
    day: "2026-10-25",
    month: "2026-10",
  });
  assert.deepEqual(aiDraftPeriod(new Date("2026-11-30T23:30:00Z")), {
    day: "2026-11-30",
    month: "2026-11",
  });
});

test("staff AI drafts: permissions, isolation, durable quotas, idempotency, stale facts and explicit provenance", async (t) => {
  for (const name of (await readdir("../../lib/db/drizzle"))
    .filter((name) => /^\d.*\.sql$/.test(name))
    .sort())
    await engine.exec(await readFile("../../lib/db/drizzle/" + name, "utf8"));
  const carId = randomUUID(),
    enquiryId = randomUUID(),
    otherId = randomUUID();
  for (const dealer of ["a", "b"])
    await db.insert(dealershipsTable).values({
      id: dealer,
      name: `Dealer ${dealer}`,
      status: "active",
      canonicalOrigin: `https://${dealer}.example.test`,
      stockPlatform: "autotrader",
      retailerId: dealer,
      sourceUrl: "https://www.autotrader.co.uk/example",
    });
  await db.insert(vehiclesTable).values({
    id: carId,
    dealerId: "a",
    source: "autotrader",
    advertId: "fictional-car",
    title: "Ford Focus",
    sourcePrice: 9000,
    mileage: 40000,
    year: 2019,
  });
  for (const dealer of ["a", "b"])
    await db.insert(dealerSettingsTable).values({
      dealerId: dealer,
      config: {
        identity: { name: `Dealer ${dealer}` },
        address: { city: "Example Town" },
        hours: [{ days: "Monday", times: "10:00–18:00" }],
        contact: {
          email: "private-do-not-send@example.test",
          phone: "private-do-not-send",
        },
        privateSettings: "never-give-this-to-the-model",
      },
    });
  await db.insert(enquiriesTable).values([
    {
      id: enquiryId,
      dealerId: "a",
      vehicleId: carId,
      customerName: "Fictional Customer",
      email: "buyer-private@example.test",
      phone: "07700900123",
      message:
        "I am Fictional Customer, contact buyer-private@example.test or 07700900123. What is the mileage?",
      type: "general",
    },
    {
      id: otherId,
      dealerId: "b",
      customerName: "Other Customer",
      message: "Other dealer private message",
      type: "general",
    },
  ]);
  const tenant = (dealer = "a") => ({
    dealerId: dealer,
    canonicalOrigin: `https://${dealer}.example.test`,
    platform: "autotrader" as const,
    retailerId: dealer,
    sourceUrl: "https://www.autotrader.co.uk/example",
    kind: "website" as const,
  });
  let calls = 0,
    sent = 0;
  let runProvider: AiDraftProvider = async (input) => {
    calls++;
    const data = JSON.stringify(input);
    for (const privateValue of [
      "Fictional Customer",
      "buyer-private@example.test",
      "07700900123",
      "private-do-not-send",
      "never-give-this",
      "Other dealer private message",
    ])
      assert.ok(!data.includes(privateValue), `input excludes ${privateValue}`);
    return validateAiSuggestion(reply, input);
  };
  const router = Router();
  router.use(
    createStaffAiDraftsRouter({ provider: (input) => runProvider(input) }),
  );
  router.use(createStaffNotificationsRouter());
  router.use(
    createEnquiryEmailRouter({
      settings: async () => ({
        version: 1,
        revision: 0,
        updatedAt: null,
        resend: {
          enabled: true,
          apiKey: "re_fictional_ai_test_key",
          from: "Dealer <sales@example.test>",
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
        appearance: defaultEmailAppearance,
      }),
      send: async () => {
        sent++;
        return "fictional-email";
      },
    }),
  );
  const logs: unknown[] = [];
  const request = (
    method: string,
    path: string,
    body?: unknown,
    options: {
      dealer?: string;
      actor?: string;
      role?: "owner" | "accounts";
      origin?: string | null;
      anonymous?: boolean;
    } = {},
  ) =>
    runWithTenant(
      tenant(options.dealer),
      () =>
        new Promise<{
          status: number;
          data: any;
          headers: Record<string, string>;
        }>((resolve, reject) => {
          let status = 200;
          const headers: Record<string, string> = {};
          const role = options.role ?? "owner",
            dealer = options.dealer ?? "a";
          const origin =
            options.origin === undefined
              ? `https://${dealer}.example.test`
              : options.origin;
          const req = {
            method,
            url: path,
            body,
            headers: {},
            ip: "fictional",
            get: (name: string) =>
              name === "origin"
                ? (origin ?? undefined)
                : name === "host"
                  ? `${dealer}.example.test`
                  : undefined,
            log: {
              warn: (...values: unknown[]) => logs.push(values),
              error: (...values: unknown[]) => logs.push(values),
            },
            ...(options.anonymous
              ? {}
              : {
                  staff: {
                    authUserId: options.actor ?? `user_${dealer}`,
                    name: "Fictional Staff",
                    role,
                    permissions: role === "owner" ? ["sales.manage"] : [],
                  },
                }),
          } as unknown as Request;
          const res = {
            status(value: number) {
              status = value;
              return this;
            },
            set(name: string, value: string) {
              headers[name] = value;
              return this;
            },
            setHeader(name: string, value: string) {
              headers[name] = value;
              return this;
            },
            json(data: unknown) {
              resolve({ status, data, headers });
              return this;
            },
          } as unknown as Response;
          router(req, res, (error) =>
            error
              ? reject(error)
              : reject(new Error("AI test route did not respond")),
          );
        }),
    );
  const generate = (
    input: object = {},
    options: Parameters<typeof request>[3] = {},
  ) =>
    request(
      "POST",
      `/staff/enquiries/${enquiryId}/ai-draft`,
      {
        requestId: randomUUID(),
        expectedRevision: 0,
        expectedVersion: 0,
        ...input,
      },
      options,
    );
  const counts = async () =>
    (
      await db.execute(
        sql`SELECT count(*)::int AS count,coalesce(sum(reserved_micro_usd),0)::int AS spent FROM staff_ai_draft_generations`,
      )
    ).rows[0]!;
  const draftContent = (message = "A staff-reviewed reply") => ({
    to: "approved@example.test",
    subject: "About the Ford Focus",
    message,
    includeVehicle: false,
    includeAppointment: false,
    photoIds: [],
    documentIds: [],
    expectedRevision: 0,
  });
  const save = (
    version: number,
    extra: object = {},
    content = draftContent(),
  ) =>
    request("POST", `/staff/enquiries/${enquiryId}/email-draft`, {
      expectedVersion: version,
      content,
      ...extra,
    });
  const reset = async () => {
    await db.execute(sql`DELETE FROM enquiry_email_drafts`);
    await db.execute(sql`DELETE FROM staff_ai_draft_generations`);
    await db.execute(
      sql`UPDATE enquiries SET workspace_revision=0,merged_into_id=NULL WHERE id=${enquiryId}::uuid`,
    );
    await db.execute(
      sql`UPDATE vehicles SET source_price=9000,inventory_status='available',source_status='live',missing_count=0,archived_at=NULL WHERE id=${carId}::uuid`,
    );
    process.env.AI_DRAFTS_ENABLED = "true";
    process.env.AI_DRAFTS_DEALER_IDS = "a";
    process.env.OPENAI_API_KEY = "sk_fictional_test_only";
    calls = 0;
    logs.length = 0;
    runProvider = async (input) => {
      calls++;
      return validateAiSuggestion(reply, input);
    };
  };
  async function seed(
    count: number,
    cost = aiDraftReservedMicroUsd,
    dealer = "a",
    day = aiDraftPeriod().day,
  ) {
    await db.execute(
      sql`INSERT INTO staff_ai_draft_generations(dealer_id,enquiry_id,auth_user_id,request_id,base_revision,base_draft_version,facts_hash,model,status,reserved_micro_usd,day_key,month_key) SELECT ${dealer},${enquiryId}::uuid,'fixture',gen_random_uuid(),0,0,'fixture','gpt-6-luna','failed',${cost},${day},${aiDraftPeriod().month} FROM generate_series(1,${count})`,
    );
  }
  try {
    await t.test(
      "disabled/missing-key and non-pilot dealers make zero provider calls or reservations",
      async () => {
        await reset();
        delete process.env.AI_DRAFTS_ENABLED;
        assert.equal(
          (await request("GET", "/staff/ai-drafts/config")).data.available,
          false,
        );
        assert.equal((await generate()).status, 403);
        process.env.AI_DRAFTS_ENABLED = "true";
        delete process.env.OPENAI_API_KEY;
        assert.equal((await generate()).status, 503);
        assert.equal(
          (await request("GET", "/staff/ai-drafts/config")).data.enabled,
          true,
        );
        process.env.OPENAI_API_KEY = "sk_fictional_test_only";
        assert.equal((await generate({}, { dealer: "b" })).status, 403);
        assert.equal(calls, 0);
        assert.equal((await counts()).count, 0);
      },
    );
    await t.test(
      "authentication, sales permission, exact origin and body validation precede billing",
      async () => {
        await reset();
        assert.equal((await generate({}, { anonymous: true })).status, 401);
        assert.equal((await generate({}, { role: "accounts" })).status, 403);
        assert.equal(
          (await generate({}, { origin: "https://b.example.test" })).status,
          403,
        );
        assert.equal((await generate({}, { origin: null })).status, 403);
        assert.equal((await generate({ expectedRevision: -1 })).status, 400);
        assert.equal((await generate({ source: "ai" })).status, 400);
        assert.equal((await generate({ expectedVersion: 3 })).status, 409);
        assert.equal((await generate({ expectedRevision: 3 })).status, 409);
        process.env.AI_DRAFTS_DEALER_IDS = "a,b";
        assert.equal(
          (
            await request("POST", `/staff/enquiries/${otherId}/ai-draft`, {
              requestId: randomUUID(),
              expectedRevision: 0,
              expectedVersion: 0,
            })
          ).status,
          404,
        );
        assert.equal(calls, 0);
        assert.equal((await counts()).count, 0);
      },
    );
    await t.test(
      "generation uses only redacted scoped facts, never sends email, and replays once per request",
      async () => {
        await reset();
        const id = randomUUID();
        runProvider = async (input) => {
          calls++;
          const data = JSON.stringify(input);
          for (const value of [
            "Fictional Customer",
            "buyer-private@example.test",
            "07700900123",
            "private-do-not-send",
            "never-give-this",
            "Other dealer private message",
          ])
            assert.ok(!data.includes(value));
          assert.equal(input.vehicle?.mileage, 40000);
          assert.equal(input.dealer.name, "Dealer a");
          return validateAiSuggestion(reply, input);
        };
        const first = await generate({ requestId: id }),
          replayed = await generate({ requestId: id });
        assert.equal(first.status, 200);
        assert.deepEqual(first.data, replayed.data);
        assert.ok(first.data.generationId);
        assert.equal(calls, 1);
        assert.equal(sent, 0);
        assert.equal((await counts()).count, 1);
        assert.equal(
          (
            await db.execute(
              sql`SELECT count(*)::int AS n FROM enquiry_email_drafts`,
            )
          ).rows[0]!.n,
          0,
        );
        assert.equal(
          (await generate({ requestId: id }, { actor: "another_staff" }))
            .status,
          409,
        );
        const config = await request("GET", "/staff/ai-drafts/config");
        assert.equal(config.data.dailyUsed, 1);
        assert.equal(config.data.monthlyUsed, 1);
        assert.equal(config.data.available, true);
        assert.equal(logs.length, 0);
      },
    );
    await t.test(
      "same request in flight cannot call twice, and another request is concurrency-limited",
      async () => {
        await reset();
        let release!: () => void, started!: () => void;
        const active = new Promise<void>((resolve) => {
            started = resolve;
          }),
          wait = new Promise<void>((resolve) => {
            release = resolve;
          });
        runProvider = async (input) => {
          calls++;
          started();
          await wait;
          return validateAiSuggestion(reply, input);
        };
        const id = randomUUID(),
          first = generate({ requestId: id });
        await active;
        assert.equal((await generate({ requestId: id })).status, 409);
        assert.equal((await generate()).status, 429);
        release();
        assert.equal((await first).status, 200);
        assert.equal(calls, 1);
        assert.equal((await counts()).count, 1);
      },
    );
    await t.test(
      "known provider failures return the same safe diagnosis without another charge, and permit explicit new requests",
      async () => {
        await reset();
        runProvider = async () => {
          calls++;
          throw new AiProviderError(false, "insufficient_quota", 429);
        };
        const requestId = randomUUID(),
          first = await generate({ requestId }),
          same = await generate({ requestId });
        assert.equal(first.status, 424);
        assert.equal(same.status, 409);
        for (const result of [first, same]) {
          assert.equal(result.data.code, "generation_failed");
          assert.equal(result.data.canStartNew, true);
          assert.equal(result.data.providerCode, "insufficient_quota");
          assert.equal(result.data.providerStatus, 429);
          assert.match(result.data.error, /billing/);
        }
        assert.equal(calls, 1);
        assert.equal((await counts()).count, 1);
        assert.equal(
          (
            await db.execute(
              sql`SELECT failure_code FROM staff_ai_draft_generations`,
            )
          ).rows[0]!.failure_code,
          "insufficient_quota:429",
        );
        assert.equal(logs.length, 0);
        const explicitNew = await generate();
        assert.equal(explicitNew.status, 424);
        assert.equal(calls, 2);
        assert.equal((await counts()).count, 2);
      },
    );
    await t.test(
      "unknown outcomes retain spend and the same request can never call again",
      async () => {
        await reset();
        runProvider = async () => {
          calls++;
          throw new AiProviderError(true);
        };
        const id = randomUUID();
        assert.equal((await generate({ requestId: id })).status, 424);
        assert.equal((await generate({ requestId: id })).status, 409);
        assert.equal(calls, 1);
        const row = (
          await db.execute(
            sql`SELECT status,reserved_micro_usd FROM staff_ai_draft_generations`,
          )
        ).rows[0]!;
        assert.equal(row.status, "unknown");
        assert.equal(row.reserved_micro_usd, aiDraftReservedMicroUsd);
        assert.equal(logs.length, 0);
      },
    );
    await t.test(
      "interrupted reservations stop blocking concurrency but remain charged",
      async () => {
        await reset();
        await seed(1);
        await db.execute(
          sql`UPDATE staff_ai_draft_generations SET status='reserved',created_at=now()-interval '5 minutes'`,
        );
        assert.equal((await generate()).status, 200);
        assert.equal((await counts()).count, 2);
        assert.equal(
          (
            await db.execute(
              sql`SELECT count(*)::int AS n FROM staff_ai_draft_generations WHERE status='unknown'`,
            )
          ).rows[0]!.n,
          1,
        );
      },
    );
    await t.test(
      "daily, monthly, per-dealer money and shared money ceilings reject before provider",
      async () => {
        for (const scenario of [
          "daily",
          "monthly",
          "dealer-spend",
          "global-spend",
        ]) {
          await reset();
          if (scenario === "daily") await seed(aiDraftLimits.daily);
          if (scenario === "monthly")
            await seed(
              aiDraftLimits.monthly,
              aiDraftReservedMicroUsd,
              "a",
              "2000-01-01",
            );
          if (scenario === "dealer-spend")
            await seed(1, aiDraftLimits.dealerMonthlyMicroUsd);
          if (scenario === "global-spend")
            await seed(1, aiDraftLimits.globalMonthlyMicroUsd, "b");
          const before = await counts();
          assert.equal((await generate()).status, 429, scenario);
          assert.equal(calls, 0);
          assert.deepEqual(await counts(), before);
          assert.equal(
            (await request("GET", "/staff/ai-drafts/config")).data.available,
            false,
          );
          assert.equal(
            (await request("GET", "/staff/notifications")).data.capabilities
              .aiDrafts,
            true,
            "quota is not reported as feature switched off",
          );
        }
      },
    );
    await t.test(
      "vehicle price changes while generating invalidate the result without overwriting a draft",
      async () => {
        await reset();
        await save(0, {}, draftContent("Keep this original draft"));
        runProvider = async (input) => {
          calls++;
          await db.execute(
            sql`UPDATE vehicles SET source_price=9500 WHERE id=${carId}::uuid`,
          );
          return validateAiSuggestion(reply, input);
        };
        assert.equal((await generate({ expectedVersion: 1 })).status, 409);
        const draft = (
          await db.execute(sql`SELECT content FROM enquiry_email_drafts`)
        ).rows[0]!;
        assert.equal(
          (draft.content as any).message,
          "Keep this original draft",
        );
        assert.equal(
          (await db.execute(sql`SELECT status FROM staff_ai_draft_generations`))
            .rows[0]!.status,
          "stale",
        );
        assert.equal((await counts()).count, 1);
      },
    );
    await t.test(
      "a concurrent staff edit and an unresolved draft prevent AI overwrite or extra billing",
      async () => {
        await reset();
        await save(0);
        runProvider = async (input) => {
          calls++;
          assert.equal(
            (await save(1, {}, draftContent("Another staff edit"))).status,
            200,
          );
          return validateAiSuggestion(reply, input);
        };
        assert.equal((await generate({ expectedVersion: 1 })).status, 409);
        assert.equal(
          (
            (await db.execute(sql`SELECT content FROM enquiry_email_drafts`))
              .rows[0]!.content as any
          ).message,
          "Another staff edit",
        );
        await db.execute(sql`UPDATE enquiry_email_drafts SET status='unknown'`);
        assert.equal((await generate({ expectedVersion: 2 })).status, 409);
        assert.equal(calls, 1);
      },
    );
    await t.test(
      "AI provenance is actor/dealer/enquiry bound and stays through edits; templates clear it",
      async () => {
        await reset();
        const generated = await generate();
        assert.equal(generated.status, 200);
        const id = generated.data.generationId;
        const wrongActor = await request(
          "POST",
          `/staff/enquiries/${enquiryId}/email-draft`,
          { expectedVersion: 0, content: draftContent(), aiGenerationId: id },
          { actor: "another_staff" },
        );
        assert.equal(wrongActor.status, 409);
        const wrongDealer = await request(
          "POST",
          `/staff/enquiries/${otherId}/email-draft`,
          { expectedVersion: 0, content: draftContent(), aiGenerationId: id },
          { dealer: "b" },
        );
        assert.equal(
          wrongDealer.status,
          409,
          "another dealership cannot claim the generation",
        );
        const saved = await save(
          0,
          { aiGenerationId: id },
          draftContent("Staff edited the AI suggestion"),
        );
        assert.equal(saved.status, 200);
        assert.equal(saved.data.savedDraft.source, "ai");
        assert.equal(saved.data.savedDraft.aiGenerationId, id);
        const edited = await save(1, {}, draftContent("Further staff edits"));
        assert.equal(edited.status, 200);
        assert.equal(edited.data.savedDraft.source, "ai");
        assert.equal(edited.data.savedDraft.aiGenerationId, id);
        assert.equal(
          (await save(2, { aiGenerationId: id })).status,
          409,
          "an old generation cannot be reclaimed against a later version",
        );
        const template = await save(2, {}, {
          ...draftContent(),
          templateId: "vehicle_details",
        } as any);
        assert.equal(template.status, 200);
        assert.equal(template.data.savedDraft.source, "template");
        assert.equal(template.data.savedDraft.aiGenerationId, null);
        assert.equal(sent, 0);
      },
    );
    await t.test(
      "AI facts are rechecked on saved edits, reviewed preview and send after stock changes",
      async () => {
        await reset();
        const generated = await generate();
        await save(0, { aiGenerationId: generated.data.generationId });
        await db.execute(
          sql`UPDATE vehicles SET source_price=9500 WHERE id=${carId}::uuid`,
        );
        const edit = await save(1);
        assert.equal(edit.status, 409);
        assert.match(edit.data.error, /details changed/);
        const preview = await request(
          "POST",
          `/staff/enquiries/${enquiryId}/email-preview`,
          draftContent(),
        );
        assert.equal(preview.status, 409);
        assert.match(preview.data.error, /details changed/);
        const send = await request(
          "POST",
          `/staff/enquiries/${enquiryId}/email`,
          {
            ...draftContent(),
            savedDraftVersion: 1,
            requestId: randomUUID(),
            previewHash: "0".repeat(64),
          },
        );
        assert.equal(send.status, 409);
        assert.match(send.data.error, /details changed/);
        assert.equal(sent, 0);
      },
    );
    await t.test(
      "an expired AI draft can be explicitly replaced before WhatsApp preparation without weakening AI freshness checks",
      async () => {
        await reset();
        const generated = await generate();
        await save(0, { aiGenerationId: generated.data.generationId });
        await db.execute(
          sql`UPDATE staff_ai_draft_generations SET created_at=now()-interval '2 days' WHERE id=${generated.data.generationId}::uuid`,
        );
        const edit = await save(1, {}, draftContent("Edited AI-assisted copy"));
        assert.equal(edit.status, 409);
        assert.match(edit.data.error, /expired/);
        const replacement = {
          ...draftContent("Here are the vehicle details we discussed."),
          templateId: "vehicle_details",
        };
        // Phone sharing calls the same preparation function as this route. A
        // client template label alone must not skip the saved AI guard.
        const unsaved = await request(
          "POST",
          `/staff/enquiries/${enquiryId}/email-preview`,
          replacement,
        );
        assert.equal(unsaved.status, 409);
        assert.match(unsaved.data.error, /expired/);
        const replaced = await save(1, {}, replacement);
        assert.equal(replaced.status, 200);
        assert.equal(replaced.data.savedDraft.source, "template");
        assert.equal(replaced.data.savedDraft.aiGenerationId, null);
        const preview = await request(
          "POST",
          `/staff/enquiries/${enquiryId}/email-preview`,
          replacement,
        );
        assert.equal(preview.status, 200);
        assert.match(preview.data.text, /vehicle details we discussed/);
        const manual = await save(2, {}, draftContent("A new staff-written reply"));
        assert.equal(manual.status, 200);
        assert.equal(manual.data.savedDraft.source, "manual");
        assert.equal(manual.data.savedDraft.aiGenerationId, null);
        assert.equal(calls, 1);
        assert.equal(sent, 0);
      },
    );
    await t.test(
      "unpublished cars and expired suggestions are refused, while deleting cases does not refund usage",
      async () => {
        await reset();
        await db.execute(
          sql`UPDATE vehicles SET inventory_status='sold' WHERE id=${carId}::uuid`,
        );
        assert.equal((await generate()).status, 409);
        assert.equal(calls, 0);
        await db.execute(
          sql`UPDATE vehicles SET inventory_status='available',source_status='missing' WHERE id=${carId}::uuid`,
        );
        runProvider = async (input) => {
          calls++;
          assert.equal(input.vehicle?.status, "availability_unconfirmed");
          return validateAiSuggestion(reply, input);
        };
        const generated = await generate();
        assert.equal(generated.status, 200);
        await db.execute(
          sql`UPDATE staff_ai_draft_generations SET created_at=now()-interval '25 hours'`,
        );
        assert.equal(
          (await save(0, { aiGenerationId: generated.data.generationId }))
            .status,
          409,
        );
        const before = await counts();
        await db.execute(
          sql`DELETE FROM enquiries WHERE id=${enquiryId}::uuid`,
        );
        assert.deepEqual(await counts(), before);
        assert.equal(sent, 0);
        await request("GET", "/staff/ai-drafts/config");
        assert.equal(
          (await db.execute(sql`SELECT result FROM staff_ai_draft_generations`))
            .rows[0]!.result,
          null,
          "lazy retention removes expired/deleted suggestions without refunding spend",
        );
      },
    );
  } finally {
    await engine.close();
  }
});
