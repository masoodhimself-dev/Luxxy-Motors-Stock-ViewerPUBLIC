import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:http";
import { operationsPreview } from "./operations";
import { previewSettings } from "./settings";
test("local operations enforce roles, require publication revisions and preserve concurrent edits in history", async () => {
  const folder = await mkdtemp(join(tmpdir(), "luxxy-operations-test-"));
  let settings = structuredClone(previewSettings) as unknown as Record<
    string,
    unknown
  >;
  const server = createServer((req, res) => {
    void operationsPreview(
      req,
      res,
      new URL(req.url ?? "/", `http://${req.headers.host}`),
      {
        stateFile: join(folder, "operations.json"),
        readSettings: async () => settings,
        writeSettings: async (config) => {
          settings = config;
        },
        readSales: async () => [],
      },
    ).then((handled) => {
      if (!handled) {
        res.statusCode = 200;
        res.end("allowed");
      }
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const base = `http://127.0.0.1:${address.port}`;
  try {
    // Removed Cars endpoints must fall through without reading or manufacturing data.
    for (const [path, method] of [
      ["/api/staff/inventory", "GET"],
      ["/api/staff/vehicles/example/price", "PATCH"],
      ["/api/staff/stock-health", "GET"],
      ["/api/dealer-operations", "GET"],
    ] as const) {
      const response = await fetch(`${base}${path}`, { method });
      assert.equal(await response.text(), "allowed");
    }
    await assert.rejects(readFile(join(folder, "operations.json")), {
      code: "ENOENT",
    });
    const original = await fetch(`${base}/api/dealer-settings`);
    assert.equal(original.headers.get("x-settings-revision"), "0");
    const config = await original.json();
    const missing = await fetch(`${base}/api/dealer-settings`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(config),
    });
    assert.equal(missing.status, 428);
    const denied = await fetch(`${base}/api/dealer-integrations`, {
      headers: { "x-preview-staff-id": "preview-jamie" },
    });
    assert.equal(denied.status, 403);
    const permissions = await fetch(`${base}/api/staff/access`, {
      headers: { "x-preview-staff-id": "preview-jamie" },
    });
    assert.equal((await permissions.json()).role, "salesperson");
    const a = { ...config, identity: { ...config.identity, name: "Dealer A" } },
      b = { ...config, identity: { ...config.identity, name: "Dealer B" } };
    const [first, second] = await Promise.all(
      [a, b].map((value) =>
        fetch(`${base}/api/dealer-settings`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json", "If-Match": '"0"' },
          body: JSON.stringify(value),
        }),
      ),
    );
    assert.deepEqual([first.status, second.status].sort(), [200, 409]);
    const history = await (
      await fetch(`${base}/api/staff/settings-history`)
    ).json();
    assert.equal(history.revision, 1);
    assert.equal(history.versions.length, 2);
    const restored = await fetch(
      `${base}/api/staff/settings-history/0/restore`,
      { method: "POST", headers: { "If-Match": '"1"' } },
    );
    assert.equal(restored.status, 200);
    assert.equal(restored.headers.get("x-settings-revision"), "2");
    assert.equal(
      (await restored.json()).config.identity.name,
      config.identity.name,
    );
    assert.equal(
      (settings.identity as { name: string }).name,
      config.identity.name,
    );
    const ownerId = "00000000-0000-4000-8000-000000000001";
    const noOwner = await fetch(`${base}/api/staff/team/${ownerId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role: "salesperson" }),
    });
    assert.equal(noOwner.status, 409);
    const csvDenied = await fetch(
      `${base}/api/dealer-operations/payments.csv`,
      { headers: { "x-preview-staff-id": "preview-jamie" } },
    );
    assert.equal(csvDenied.status, 403);
    const add = await fetch(`${base}/api/staff/team`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        authUserId: "preview-finance",
        email: "accounts@example.test",
        role: "accounts",
      }),
    });
    assert.equal(add.status, 201);
    const csv = await fetch(`${base}/api/dealer-operations/payments.csv`, {
      headers: { "x-preview-staff-id": "preview-finance" },
    });
    assert.equal(csv.status, 200);
    assert.match(csv.headers.get("Content-Type") ?? "", /text\/csv/);
    const accountsEdit = await fetch(
      `${base}/api/staff/enquiries/test/workspace`,
      { method: "PATCH", headers: { "x-preview-staff-id": "preview-finance" } },
    );
    assert.equal(accountsEdit.status, 403);
    const crossOrigin = await fetch(`${base}/api/staff/access`, {
      headers: { Origin: "https://untrusted.example" },
    });
    assert.equal(crossOrigin.status, 403);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
    await rm(folder, { recursive: true, force: true });
  }
});

test("narrow preview booking updates disable independently, require revisions and preserve all unrelated settings", async () => {
  const folder = await mkdtemp(join(tmpdir(), "luxxy-preview-bookings-"));
  let settings = {
    ...structuredClone(previewSettings),
    identity: { ...previewSettings.identity, name: "" },
    unrelatedLegacy: { keep: "verbatim" },
    testDriveBooking: {
      ...previewSettings.testDriveBooking,
      weeklyHours: [{ day: "Monday", open: "18:00", close: "09:00" }],
    },
  } as unknown as Record<string, unknown>;
  const original = structuredClone(settings),
    publications: Array<Record<string, unknown>> = [];
  const server = createServer((req, res) => {
    void operationsPreview(
      req,
      res,
      new URL(req.url ?? "/", `http://${req.headers.host}`),
      {
        stateFile: join(folder, "operations.json"),
        readSettings: async () => settings,
        writeSettings: async (config) => {
          settings = config;
          publications.push(config);
        },
      },
    ).then((handled) => {
      if (!handled) {
        res.statusCode = 404;
        res.end();
      }
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const base = `http://127.0.0.1:${address.port}`;
  const patch = (body: unknown, revision?: string, staff?: string) =>
    fetch(`${base}/api/dealer-settings/bookings`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        ...(revision ? { "If-Match": revision } : {}),
        ...(staff ? { "x-preview-staff-id": staff } : {}),
      },
      body: JSON.stringify(body),
    });
  try {
    const missing = await patch({ testDriveBooking: { enabled: false } });
    assert.equal(missing.status, 428);
    assert.equal(publications.length, 0);
    const denied = await patch(
      { testDriveBooking: { enabled: false } },
      "0",
      "preview-jamie",
    );
    assert.equal(denied.status, 403);
    const disabled = await patch({ testDriveBooking: { enabled: false } }, "0");
    assert.equal(disabled.status, 200);
    assert.equal(disabled.headers.get("x-settings-revision"), "1");
    assert.equal(disabled.headers.get("etag"), '"1"');
    const response = await disabled.json();
    assert.equal(response.revision, 1);
    assert.equal(response.testDriveBooking.enabled, false);
    assert.deepEqual(settings.identity, original.identity);
    assert.deepEqual(settings.unrelatedLegacy, original.unrelatedLegacy);
    assert.deepEqual(
      (settings.testDriveBooking as any).weeklyHours,
      (original.testDriveBooking as any).weeklyHours,
    );
    const stale = await patch({ testDriveBooking: { enabled: true } }, "0");
    assert.equal(stale.status, 409);
    assert.equal(stale.headers.get("x-settings-revision"), "1");
    const invalid = await patch({ testDriveBooking: { enabled: true } }, "1");
    assert.equal(invalid.status, 400);
    assert.equal(publications.length, 1);
    const extra = await patch(
      {
        testDriveBooking: { enabled: false },
        identity: { name: "Unapproved edit" },
      },
      "1",
    );
    assert.equal(extra.status, 400);
    assert.deepEqual(settings.identity, original.identity);
    const enabled = await patch(
      {
        testDriveBooking: {
          ...previewSettings.testDriveBooking,
          enabled: true,
        },
      },
      "1",
    );
    assert.equal(enabled.status, 200);
    assert.equal((await enabled.json()).revision, 2);
    assert.equal(publications.length, 2);
    const published = await fetch(`${base}/api/dealer-settings`);
    assert.equal(published.headers.get("x-settings-revision"), "2");
    assert.equal((await published.json()).testDriveBooking.enabled, true);
    const history = await (
      await fetch(`${base}/api/staff/settings-history`)
    ).json();
    assert.equal(history.revision, 2);
    assert.equal(history.versions.length, 3);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
    await rm(folder, { recursive: true, force: true });
  }
});
