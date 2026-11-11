import assert from "node:assert/strict";
import test from "node:test";
import { once } from "node:events";
import express from "express";
import { createDvlaVehicleCheck } from "./lib/dvla-vehicle-check";
import { permissionsForRole } from "./lib/staff-permissions";
import { runWithTenant } from "./lib/tenant-context";
import { dvlaVehicleCheckRouter } from "./routes/dvla-vehicle-check";

const checkedAt = "2026-11-11T12:00:00.000Z";
const apiKey = () => "fixture-ves-key";
const record = {
  registrationNumber: "AB12CDE", make: "FORD", colour: "BLUE", fuelType: "PETROL",
  yearOfManufacture: 2018, engineCapacity: 999, co2Emissions: 0, euroStatus: "Euro 6",
  taxStatus: "SORN", taxDueDate: "2026-11-30", dateOfLastV5CIssued: "2026-01-15",
  motStatus: "Valid", motExpiry: "2027-10-20", markedAsScrapped: false, markedForExport: true,
};

test("requests the fixed DVLA endpoint with a normalized body and returns only vehicle facts", async () => {
  const lookup = createDvlaVehicleCheck({ apiKey, now: () => Date.parse(checkedAt), transport: async (url, request) => {
    assert.equal(url, "https://driver-vehicle-licensing.api.gov.uk/vehicle-enquiry/v1/vehicles");
    assert.equal(request?.method, "POST");
    assert.equal(request?.redirect, "error");
    assert.equal(new Headers(request?.headers).get("x-api-key"), apiKey());
    assert.deepEqual(JSON.parse(String(request?.body)), { registrationNumber: "AB12CDE" });
    assert.ok(request?.signal instanceof AbortSignal);
    return Response.json({ ...record, unrelated: apiKey(), vin: "not-in-contract" });
  } });
  const { registrationNumber: registration, ...facts } = record;
  assert.deepEqual(await lookup("ab12 cde"), { registration, checkedAt, ...facts });
});

test("rejects invalid inputs, provider mismatches and oversized results without exposing provider details", async () => {
  let calls = 0;
  const missingKey = createDvlaVehicleCheck({ apiKey: () => undefined, transport: async () => { calls++; throw Error(); } });
  for (const invalid of ["", "20 reg", "https://example.test", "AB12/CDE"])
    await assert.rejects(missingKey(invalid), { code: "invalid_registration", status: 400 });
  await assert.rejects(missingKey("AB12 CDE"), { code: "not_configured", status: 503 });
  assert.equal(calls, 0);

  for (const response of [Response.json({ ...record, registrationNumber: "ZZ99ABC" }), Response.json({ ...record, extra: "x".repeat(17_000) }), new Response(apiKey()), new Response(apiKey(), { status: 403 })]) {
    const lookup = createDvlaVehicleCheck({ apiKey, transport: async () => response });
    await assert.rejects(lookup("AB12CDE"), (error: Error) => {
      assert.equal((error as Error & { code: string }).code, "unavailable");
      assert.doesNotMatch(error.message, /fixture-ves-key|AB12CDE/);
      return true;
    });
  }
  const notFound = createDvlaVehicleCheck({ apiKey, transport: async () => new Response(null, { status: 404 }) });
  await assert.rejects(notFound("AB12CDE"), { code: "not_found", status: 404 });

  const sparse = createDvlaVehicleCheck({ apiKey, transport: async () => Response.json({ registrationNumber: "AB12CDE", taxDueDate: "2026-02-29", markedForExport: "false", motStatus: "unknown" }) });
  const checked = await sparse("AB12CDE");
  assert.equal(checked.taxDueDate, undefined);
  assert.equal(checked.markedForExport, undefined);
  assert.equal(checked.motStatus, undefined);
});

test("shares the two-per-second quota and honours a provider cooldown", async () => {
  let now = Date.parse(checkedAt), calls = 0;
  const lookup = createDvlaVehicleCheck({ apiKey, now: () => now, transport: async (_url, request) => {
    if (++calls === 2) return new Response(null, { status: 429, headers: { "Retry-After": "4" } });
    return Response.json(JSON.parse(String(request?.body)));
  } });
  await lookup("AB12CDE");
  now += 499;
  await assert.rejects(lookup("CD34EFG"), { code: "busy", status: 429, retryAfter: 1 });
  now += 1;
  await assert.rejects(lookup("CD34EFG"), { code: "busy", status: 429, retryAfter: 4 });
  now += 3999;
  await assert.rejects(lookup("EF56GHI"), { code: "busy", status: 429, retryAfter: 1 });
  assert.equal(calls, 2);
  now += 1;
  await lookup("EF56GHI");
  assert.equal(calls, 3);
});

test("only same-site sales staff can check a vehicle, with no cache and safe errors", async () => {
  const app = express();
  app.use(express.json());
  const canonicalOrigin = "https://dealer.example.test";
  app.use((req, _res, next) => {
    const role = req.get("x-fixture-role");
    if (role === "salesperson" || role === "accounts") {
      req.staff = { authUserId: "fixture", name: "Fixture", email: null, role, permissions: permissionsForRole(role) };
    }
    runWithTenant({ dealerId: "fixture", canonicalOrigin, platform: "cazoo", retailerId: "fixture", sourceUrl: canonicalOrigin, kind: "website" }, next);
  });
  let calls = 0;
  const lookup = createDvlaVehicleCheck({ apiKey, now: () => Date.parse(checkedAt), transport: async () => {
    calls++;
    return Response.json(record);
  } });
  app.use("/api", dvlaVehicleCheckRouter(lookup));
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address() as { port: number };
  const post = (body: unknown, role = "", origin = canonicalOrigin) => fetch(`http://127.0.0.1:${port}/api/staff/dvla/vehicle-check`, {
    method: "POST", headers: { "Content-Type": "application/json", Origin: origin, "x-fixture-role": role }, body: JSON.stringify(body),
  });
  try {
    const denied = await post({ registration: "AB12CDE" });
    assert.equal(denied.status, 401);
    assert.equal(denied.headers.get("Cache-Control"), "no-store");
    assert.equal((await post({ registration: "AB12CDE" }, "accounts")).status, 403);
    const crossOrigin = await post({ registration: "AB12CDE" }, "salesperson", "https://other-dealer.example.test");
    assert.equal(crossOrigin.status, 403);
    const invalid = await post({ registration: "AB12CDE", dealerId: "different" }, "salesperson");
    assert.equal(invalid.status, 400);
    assert.equal((await invalid.json() as { code: string }).code, "invalid_registration");
    assert.equal(calls, 0);
    const accepted = await post({ registration: "AB12 CDE" }, "salesperson");
    assert.equal(accepted.status, 200);
    assert.equal(accepted.headers.get("Cache-Control"), "no-store");
    const { registrationNumber: registration, ...facts } = record;
    assert.deepEqual(await accepted.json(), { registration, checkedAt, ...facts });
    const limited = await post({ registration: "CD34EFG" }, "salesperson");
    assert.equal(limited.status, 429);
    assert.equal(limited.headers.get("Retry-After"), "1");
    assert.equal(calls, 1);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
