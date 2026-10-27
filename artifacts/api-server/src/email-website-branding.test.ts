import test from "node:test";
import assert from "node:assert/strict";
import { createCipheriv } from "node:crypto";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  defaultEmailAppearance,
  renderEmailTemplate,
} from "@workspace/vehicle-meta";
import {
  emailWebsiteBranding,
  publishedEmailAppearance,
} from "./lib/email-website-branding";
import { DealerIntegrationsStore } from "./lib/dealer-integrations-store";
import { previewEmailTemplate } from "./lib/email-template-preview";

const custom = {
  ...defaultEmailAppearance,
  logoUrl: "https://custom.example.test/logo.png",
  brandColour: "#224466",
  heading: "Old private heading",
  footer: "Old private footer",
};
const website = {
  logoUrl: "https://dealer.example.test/logo.svg",
  brandColour: "#CC8800",
};
async function fixture(
  work: (
    store: DealerIntegrationsStore,
    filename: string,
    setWebsite: (next: typeof website) => void,
    calls: () => number,
  ) => Promise<void>,
) {
  const dir = await mkdtemp(join(tmpdir(), "luxxy-branding-")),
    filename = join(dir, "settings.json");
  let current = website,
    calls = 0;
  const store = new DealerIntegrationsStore({
    filename,
    production: false,
    readWebsiteBranding: async () => {
      calls++;
      return current;
    },
  });
  try {
    await work(
      store,
      filename,
      (next) => {
        current = next;
      },
      () => calls,
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
const resend = { enabled: false, apiKey: "", from: "", replyTo: "" };
async function legacySettings(
  store: DealerIntegrationsStore,
  filename: string,
) {
  await store.update({ expectedRevision: 0, resend });
  const state = JSON.parse(await readFile(filename, "utf8"));
  state.appearance = custom;
  state.useWebsiteBranding = false;
  state.templates.customer_access_link = {
    subject: "Old access subject",
    body: "Old private body",
  };
  await writeFile(filename, JSON.stringify(state));
  return state;
}
test("website branding uses the single published primary colour and resolves relative logos", () => {
  assert.deepEqual(
    emailWebsiteBranding(
      {
        identity: {
          logoAsset: "/api/demo-logo",
          brandColors: { primaryHsl: "40 100% 50%", accentHsl: "120 100% 25%" },
        },
      },
      "https://dealer.example.test",
    ),
    {
      logoUrl: "https://dealer.example.test/api/demo-logo",
      brandColour: "#FFAA00",
    },
  );
  assert.equal(
    emailWebsiteBranding(
      { identity: { brandColors: { accentHsl: "120 100% 25%" } } },
      "https://dealer.example.test",
    ).brandColour,
    "#008000",
  );
  assert.equal(
    emailWebsiteBranding(
      { identity: { brandColors: { primaryHsl: "invalid" } } },
      "https://dealer.example.test",
    ).brandColour,
    "#172033",
  );
});
test("unsafe logos never become email markup and absent website branding uses fixed defaults", () => {
  for (const asset of [
    "javascript:alert(1)",
    "data:image/png;base64,abc",
    "https://user:pass@example.test/logo.svg",
    "http://example.test/a.svg",
  ])
    assert.equal(
      emailWebsiteBranding(
        { identity: { logoAsset: asset } },
        "https://dealer.example.test",
      ).logoUrl,
      "",
    );
  assert.deepEqual(publishedEmailAppearance(website), {
    ...defaultEmailAppearance,
    ...website,
  });
  assert.deepEqual(publishedEmailAppearance(), defaultEmailAppearance);
});
test("new configurations always inherit the published brand without exposing spare appearance editing", async () =>
  fixture(async (store, _filename, setWebsite) => {
    const first = await store.listTemplates();
    assert.deepEqual(first.appearance, {
      ...defaultEmailAppearance,
      ...website,
    });
    assert.ok(!("customAppearance" in first));
    assert.ok(!("useWebsiteBranding" in first));
    assert.equal(
      typeof (store as unknown as Record<string, unknown>).updateAppearance,
      "undefined",
    );
    setWebsite({ ...website, brandColour: "#557799" });
    assert.equal((await store.readPrivate()).appearance.brandColour, "#557799");
  }));
test("legacy private appearance cannot override new emails and reading never rewrites stored settings", async () =>
  fixture(async (store, filename, setWebsite) => {
    await legacySettings(store, filename);
    const before = await readFile(filename, "utf8");
    const saved = await store.listTemplates();
    const template = saved.templates.find((t) => t.id === "invoice")!;
    const rendered = renderEmailTemplate(
      template,
      {
        dealer_name: "Example Motors",
        customer_name: "Alex",
        vehicle_title: "Ford Focus",
      },
      [],
      saved.appearance,
      { templateId: "invoice" },
    );
    assert.match(rendered.html, /https:\/\/dealer\.example\.test\/logo\.svg/);
    assert.match(rendered.html, /#CC8800/);
    assert.doesNotMatch(rendered.html, /custom\.example|Old private|#224466/);
    setWebsite({
      ...website,
      logoUrl: "https://dealer.example.test/new-logo.svg",
    });
    assert.equal(
      (await store.readPrivate()).appearance.logoUrl,
      "https://dealer.example.test/new-logo.svg",
    );
    assert.equal(await readFile(filename, "utf8"), before);
  }));
test("plain wording saves preserve encrypted legacy overrides and retired template records without making them usable", async () => {
  const dir = await mkdtemp(join(tmpdir(), "luxxy-encrypted-branding-")),
    filename = join(dir, "settings.json"),
    key = Buffer.alloc(32, 7);
  try {
    const initial = new DealerIntegrationsStore({
      filename,
      production: false,
    });
    await initial.update({ expectedRevision: 0, resend });
    const state = JSON.parse(await readFile(filename, "utf8"));
    state.appearance = custom;
    state.useWebsiteBranding = false;
    state.templates.customer_access_link = {
      subject: "Old subject",
      body: "Historical body",
    };
    const iv = Buffer.alloc(12, 9),
      cipher = createCipheriv("aes-256-gcm", key, iv),
      data = Buffer.concat([
        cipher.update(JSON.stringify(state), "utf8"),
        cipher.final(),
      ]);
    await writeFile(
      filename,
      JSON.stringify({
        encrypted: true,
        iv: iv.toString("base64"),
        tag: cipher.getAuthTag().toString("base64"),
        data: data.toString("base64"),
      }),
    );
    const store = new DealerIntegrationsStore({
      filename,
      production: true,
      encryptionKey: key.toString("base64"),
      readWebsiteBranding: async () => website,
    });
    const result = await store.updateTemplate({
      expectedRevision: 1,
      id: "enquiry_message",
      subject: "A question",
      body: "Can we help?",
    });
    assert.deepEqual(result.appearance, {
      ...defaultEmailAppearance,
      ...website,
    });
    const raw = await readFile(filename, "utf8");
    assert.equal(JSON.parse(raw).encrypted, true);
    assert.ok(!raw.includes("Historical body"));
    const preserved = store.readPrivateSnapshot(JSON.parse(raw));
    assert.deepEqual(preserved.appearance, custom);
    assert.equal(preserved.useWebsiteBranding, false);
    assert.deepEqual(
      preserved.templates.customer_access_link,
      state.templates.customer_access_link,
    );
    assert.equal(
      result.templates.find((t) => t.id === "enquiry_message")?.body,
      "Can we help?",
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
test("retired reservation and private-access templates cannot be listed, saved or previewed", async () =>
  fixture(async (store) => {
    const retired = [
      "reservation_confirmation",
      "reservation_payment",
      "reservation_refund",
      "customer_access_link",
    ];
    const response = await store.listTemplates();
    for (const id of retired) {
      assert.ok(!response.templates.some((t) => t.id === id));
      await assert.rejects(
        store.updateTemplate({
          expectedRevision: 0,
          id,
          subject: "Test",
          body: "Test",
        }),
        /supported email template/,
      );
      assert.throws(
        () => previewEmailTemplate(id, { subject: "Test", body: "Test" }),
        /not found/,
      );
    }
  }));
test("preview uses server-published branding even if a retired client submits an appearance override", () => {
  const result = previewEmailTemplate(
    "invoice",
    { subject: "Invoice", body: "Your invoice", appearance: custom },
    publishedEmailAppearance(website),
  );
  assert.match(result.html, /dealer\.example\.test\/logo\.svg/);
  assert.doesNotMatch(result.html, /custom\.example|Old private/);
  assert.equal(result.sent, false);
  assert.equal(result.sample, true);
});
test("stock, readiness and transactional raw reads never acquire a separate branding connection", async () =>
  fixture(async (store, _filename, _set, calls) => {
    await store.readStockConnection({});
    await store.readMasked();
    await store.readPrivate({});
    assert.equal(calls(), 0);
    await store.listTemplates();
    assert.equal(calls(), 1);
  }));

test("sale paperwork reuses the held transaction client and decrypts only that dealer without a branding checkout", async () => {
  const dir = await mkdtemp(join(tmpdir(), "luxxy-paperwork-client-")),
    filename = join(dir, "settings.json"),
    key = Buffer.alloc(32, 7);
  try {
    const initial = new DealerIntegrationsStore({
      filename,
      production: false,
    });
    await initial.update({ expectedRevision: 0, resend });
    const state = JSON.parse(await readFile(filename, "utf8"));
    state.salesPaperwork = {
      saleTerms: "Approved dealer A sale terms",
      reservationTerms: "Approved deposit terms",
      invoiceSettings: { referencePrefix: "MCM", startingSequence: 99 },
    };
    const iv = Buffer.alloc(12, 10),
      cipher = createCipheriv("aes-256-gcm", key, iv),
      data = Buffer.concat([
        cipher.update(JSON.stringify(state), "utf8"),
        cipher.final(),
      ]);
    const encrypted = {
      encrypted: true,
      iv: iv.toString("base64"),
      tag: cipher.getAuthTag().toString("base64"),
      data: data.toString("base64"),
    };
    const calls: Array<[string, any[] | undefined]> = [];
    const client = {
      query: async (sql: string, parameters?: any[]) => {
        calls.push([sql, parameters]);
        return { rows: [{ encrypted_payload: encrypted }] };
      },
    };
    const store = new DealerIntegrationsStore({
      dealerId: "dealer-a",
      databaseBacked: true,
      production: true,
      encryptionKey: key.toString("base64"),
      readWebsiteBranding: async () => {
        throw new Error("No second connection allowed");
      },
    });
    const result = await store.readSalesPaperwork(client);
    assert.deepEqual(calls, [
      [
        "SELECT encrypted_payload FROM dealer_private_settings WHERE dealer_id = $1",
        ["dealer-a"],
      ],
    ]);
    assert.equal(result.saleTerms, state.salesPaperwork.saleTerms);
    assert.equal(
      result.reservationTerms,
      state.salesPaperwork.reservationTerms,
    );
    assert.equal(result.invoiceSettings.referencePrefix, "MCM");
    assert.equal(result.invoiceSettings.startingSequence, 99);
    const defaults = await store.readSalesPaperwork({
      query: async () => ({ rows: [] }),
    });
    assert.equal(defaults.saleTerms, "");
    await assert.rejects(
      store.readSalesPaperwork({
        query: async () => ({
          rows: [
            {
              encrypted_payload: {
                ...encrypted,
                tag: Buffer.alloc(16, 1).toString("base64"),
              },
            },
          ],
        }),
      }),
      /could not be decrypted/,
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
