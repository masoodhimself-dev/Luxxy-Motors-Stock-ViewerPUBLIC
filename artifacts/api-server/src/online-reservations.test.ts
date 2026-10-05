import assert from "node:assert/strict";
import { test } from "node:test";
import {
  assertReservationCanBeCancelled, createOnlineReservation, onlineReservationSettings,
  parseOnlineReservationInput, ReservationError, reservationView,
  type ReservationContext, type ReservationRecord, type ReservationRepository,
  type ReservationTransaction, type ReservationVehicle,
} from "./lib/online-reservations";

// These tests intentionally import no database package, app bootstrap or env
// loader. The memory adapter exercises the same service used by the SQL route.
const vehicleId = "de88ba86-2f35-450d-ac2c-3fb5e2f3cde2";
const context: ReservationContext = { dealerId: "dealer-a", paymentMode: "simulated", nodeEnv: "test", missingHideThreshold: 2 };
const settings = { enabled: true, depositPence: 10_000, terms: "Contact the dealership to arrange collection. No money is collected in this payment preview." };
const request = {
  vehicleId, idempotencyKey: "926c3d03-50cd-441f-b901-2a2682937731",
  customerName: "Test Customer", email: "buyer@example.test", phone: "+447700900123",
  expectedPricePence: 2_000_000, expectedDepositPence: 10_000,
  termsAccepted: true, terms: settings.terms,
};

class MemoryRepository implements ReservationRepository {
  settings: unknown = { ...settings };
  vehicle: ReservationVehicle | undefined = {
    id: vehicleId, dealerId: "dealer-a", source: "autotrader", inventoryStatus: "available", sourceStatus: "live",
    missingCount: 0, currency: "GBP", sourcePrice: 20_000, websitePriceOverride: null, title: "Example Estate",
  };
  records: ReservationRecord[] = [];
  activeSale = false;
  competingReservation = false;
  writeFailure = false;
  calls: string[] = [];
  private queue: Promise<void> = Promise.resolve();

  async transaction<T>(run: (tx: ReservationTransaction) => Promise<T>): Promise<T> {
    const previous = this.queue;
    let release!: () => void;
    this.queue = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    const before = structuredClone({ records: this.records, vehicle: this.vehicle });
    const tx: ReservationTransaction = {
      lockRequest: async () => { this.calls.push("lockRequest"); },
      findByIdempotencyKey: async (key) => {
        this.calls.push("findByIdempotencyKey");
        return this.records.find((record) => record.idempotencyKey === key);
      },
      getSettings: async () => { this.calls.push("getSettings"); return this.settings; },
      lockVehicle: async () => { this.calls.push("lockVehicle"); },
      getVehicle: async () => { this.calls.push("getVehicle"); return this.vehicle; },
      hasActiveSale: async () => this.activeSale,
      hasCompetingReservation: async () => this.competingReservation,
      create: async (record) => {
        this.records.push(record);
        this.vehicle!.inventoryStatus = "reserved";
        if (this.writeFailure) throw new Error("Simulated transaction failure");
      },
    };
    try { return await run(tx); }
    catch (error) {
      this.records = before.records;
      this.vehicle = before.vehicle;
      throw error;
    } finally { release(); }
  }
}

async function rejectReservation(repo: MemoryRepository, input: unknown = request, status = 409, runtime = context) {
  await assert.rejects(createOnlineReservation(input, runtime, repo), (error) => error instanceof ReservationError && error.status === status);
  assert.equal(repo.records.length, 0);
}

test("simulated payment creates a real reservation without claiming money was received", async () => {
  const repo = new MemoryRepository();
  const result = await createOnlineReservation({ ...request, partExchange: { registration: "ab12 cde", mileage: 45_000 } }, context, repo);
  assert.equal(result.replayed, false);
  assert.equal(repo.vehicle!.inventoryStatus, "reserved");
  assert.equal(result.reservation.status, "reserved");
  assert.equal(result.reservation.amountReceivedPence, 0);
  assert.equal(result.reservation.paymentStatus, "simulated");
  assert.equal(result.reservation.depositPence, 10_000);
  assert.equal(repo.records[0].terms, settings.terms);
  assert.equal(repo.records[0].partExchange?.registration, "AB12 CDE");
  assert.deepEqual(repo.calls.slice(0, 5), ["lockRequest", "findByIdempotencyKey", "getSettings", "lockVehicle", "getVehicle"]);
  for (const privateKey of ["email", "phone", "customerName", "idempotencyKey", "requestFingerprint", "partExchange", "terms"]) {
    assert.equal(privateKey in result.reservation, false);
  }
});

test("same request is safely replayed, including after reservations are switched off", async () => {
  const repo = new MemoryRepository();
  const first = await createOnlineReservation(request, context, repo);
  repo.settings = { ...settings, enabled: false };
  const second = await createOnlineReservation(request, context, repo);
  assert.equal(second.replayed, true);
  assert.deepEqual(second.reservation, first.reservation);
  assert.equal(repo.records.length, 1);
});

test("new reservations snapshot the supplied plate before VRM or registration year labels", async () => {
  const cases = [
    { fields: { plate: " ab12 cde ", vrm: "XY34 ZZZ", registration: "2019 (19 reg)", registrationBand: "19" }, expected: "AB12 CDE" },
    { fields: { plate: "  ", vrm: " xy34 zzz ", registration: "2019 (19 reg)" }, expected: "XY34 ZZZ" },
    { fields: { plate: null, vrm: null, registration: " ab12 cde ", registrationBand: "19" }, expected: "AB12 CDE" },
    { fields: { registration: "2019 (19 reg)", registrationBand: "19" }, expected: "2019 (19 reg)" },
    { fields: { registration: null, registrationBand: "19" }, expected: "19" },
    { fields: { registration: null, registrationBand: null, year: 2019 }, expected: "2019" },
  ];
  for (const { fields, expected } of cases) {
    const repo = new MemoryRepository();
    Object.assign(repo.vehicle!, fields);
    const created = await createOnlineReservation(request, context, repo);
    assert.equal(repo.records[0].vehicleRegistration, expected);
    assert.equal(created.reservation.vehicleRegistration, expected);
    Object.assign(repo.vehicle!, { plate: "ZZ99 ZZZ", registration: "Different stock label" });
    await createOnlineReservation(request, context, repo);
    assert.equal(repo.records[0].vehicleRegistration, expected, "a retry preserves the original vehicle snapshot");
  }
});

test("replaying an existing reservation does not add or rewrite its registration snapshot", async () => {
  const repo = new MemoryRepository();
  await createOnlineReservation(request, context, repo);
  delete repo.records[0].vehicleRegistration;
  const before = structuredClone(repo.records[0]);
  repo.vehicle!.plate = "AB12 CDE";
  const replay = await createOnlineReservation(request, context, repo);
  assert.equal(replay.replayed, true);
  assert.equal("vehicleRegistration" in replay.reservation, false);
  assert.deepEqual(repo.records[0], before);
});

test("a reused request key with changed contact, car, price, terms or part exchange is rejected", async () => {
  for (const patch of [
    { customerName: "Other Customer" }, { email: "other@example.test" }, { phone: "07700900124" },
    { vehicleId: "d4b9b0e8-fbe6-4b2e-8e74-9d38ef27cb64" }, { expectedPricePence: 3_000_000 },
    { terms: "Different terms" }, { partExchange: { registration: "AB12CDE", mileage: 200 } },
  ]) {
    const repo = new MemoryRepository();
    await createOnlineReservation(request, context, repo);
    await assert.rejects(createOnlineReservation({ ...request, ...patch }, context, repo), (error) => error instanceof ReservationError && error.status === 409);
    assert.equal(repo.records.length, 1);
  }
});

test("concurrent retries create one record; competing buyers cannot reserve the same car", async () => {
  const repo = new MemoryRepository();
  const retries = await Promise.all([createOnlineReservation(request, context, repo), createOnlineReservation(request, context, repo)]);
  assert.equal(repo.records.length, 1);
  assert.deepEqual(retries.map((item) => item.replayed), [false, true]);
  const second = new MemoryRepository();
  const competing = await Promise.allSettled([
    createOnlineReservation(request, context, second),
    createOnlineReservation({ ...request, idempotencyKey: "d4b9b0e8-fbe6-4b2e-8e74-9d38ef27cb64", email: "other@example.test" }, context, second),
  ]);
  assert.equal(competing.filter((item) => item.status === "fulfilled").length, 1);
  assert.equal(second.records.length, 1);
});

test("cancelled requests replay as cancelled without reserving the car again", async () => {
  const repo = new MemoryRepository();
  await createOnlineReservation(request, context, repo);
  repo.records[0].status = "cancelled";
  repo.vehicle!.inventoryStatus = "available";
  assert.equal((await createOnlineReservation(request, context, repo)).reservation.status, "cancelled");
  assert.equal(repo.vehicle!.inventoryStatus, "available");
});

test("disabled, missing, invalid or incomplete settings cannot enable reservations", async () => {
  for (const value of [undefined, {}, { ...settings, enabled: false }, { ...settings, terms: "" }, { ...settings, depositPence: -1 }, { ...settings, depositPence: 1.5 }]) {
    const repo = new MemoryRepository(); repo.settings = value;
    await rejectReservation(repo);
  }
  assert.deepEqual(onlineReservationSettings(undefined), { enabled: false, depositPence: 10_000, terms: "" });
});

test("payment mode must be explicit and simulated payments fail closed in production", async () => {
  for (const runtime of [
    { ...context, paymentMode: undefined }, { ...context, paymentMode: "stripe" },
    { ...context, nodeEnv: "production" },
  ]) {
    const repo = new MemoryRepository();
    await rejectReservation(repo, request, 503, runtime);
    assert.deepEqual(repo.calls, []);
  }
});

test("validation rejects tampering, invalid contacts, missing consent and oversized data before storage", async () => {
  for (const input of [
    { ...request, vehicleId: "preview-1" }, { ...request, idempotencyKey: "not-a-uuid" },
    { ...request, termsAccepted: false }, { ...request, termsAccepted: undefined },
    { ...request, email: "not-an-email" }, { ...request, phone: "call me" },
    { ...request, amountReceivedPence: 10_000 }, { ...request, expectedPricePence: 0 },
    { ...request, expectedDepositPence: 0.5 }, { ...request, terms: "x".repeat(4_001) },
    { ...request, customerName: "x".repeat(121) },
    { ...request, partExchange: { registration: "AB12 CDE", mileage: -1 } },
  ]) {
    const repo = new MemoryRepository();
    await rejectReservation(repo, input, 400);
    assert.deepEqual(repo.calls, []);
  }
});

test("contacts and registration are normalised before fingerprinting", () => {
  const parsed = parseOnlineReservationInput({
    ...request, customerName: " Test Customer ", email: " BUYER@example.test ", phone: "+44 (7700) 900-123",
    partExchange: { registration: " ab12 cde ", mileage: 0 },
  });
  assert.equal(parsed.customerName, request.customerName);
  assert.equal(parsed.email, request.email);
  assert.equal(parsed.phone, request.phone);
  assert.equal(parsed.partExchange?.registration, "AB12 CDE");
});

test("a missing, foreign, hidden, archived, reserved, sold or stale vehicle cannot be reserved", async () => {
  const missing = new MemoryRepository(); missing.vehicle = undefined; await rejectReservation(missing);
  for (const patch of [
    { dealerId: "dealer-b" }, { id: "d4b9b0e8-fbe6-4b2e-8e74-9d38ef27cb64" },
    ...["reserved", "sold", "hidden", "archived"].map((inventoryStatus) => ({ inventoryStatus })),
    { sourceStatus: "missing" }, { source: "unpublished" }, { missingCount: 2 }, { currency: "USD" }, { sourcePrice: null }, { sourcePrice: 0 },
  ]) {
    const repo = new MemoryRepository(); Object.assign(repo.vehicle!, patch); await rejectReservation(repo);
  }
});

test("price, deposit and accepted terms must match current server values", async () => {
  for (const patch of [{ expectedPricePence: 1_999_900 }, { expectedDepositPence: 20_000 }, { terms: "Old terms" }]) {
    await rejectReservation(new MemoryRepository(), { ...request, ...patch });
  }
  const repo = new MemoryRepository(); repo.vehicle!.websitePriceOverride = 19_000;
  await rejectReservation(repo);
  const result = await createOnlineReservation({ ...request, expectedPricePence: 1_900_000 }, context, repo);
  assert.equal(result.reservation.status, "reserved");
});

test("deposit larger than the advertised car price is rejected", async () => {
  const repo = new MemoryRepository(); repo.vehicle!.sourcePrice = 50;
  await rejectReservation(repo, { ...request, expectedPricePence: 5_000 });
});

test("active sales and existing reserved leads block reservations even when stock says available", async () => {
  const sale = new MemoryRepository(); sale.activeSale = true; await rejectReservation(sale);
  const lead = new MemoryRepository(); lead.competingReservation = true; await rejectReservation(lead);
});

test("a failed write rolls back both the lead reservation and inventory status", async () => {
  const repo = new MemoryRepository(); repo.writeFailure = true;
  await assert.rejects(createOnlineReservation(request, context, repo), /Simulated transaction failure/);
  assert.equal(repo.records.length, 0);
  assert.equal(repo.vehicle!.inventoryStatus, "available");
  repo.writeFailure = false;
  assert.equal((await createOnlineReservation(request, context, repo)).replayed, false);
});

test("staff cancellation cannot release a sold car, changed lead, competing sale or real deposit", () => {
  const state = { inventoryStatus: "reserved", leadStage: "reserved", depositPence: 0, hasActiveSale: false, hasCompetingReservation: false };
  assert.doesNotThrow(() => assertReservationCanBeCancelled(state));
  for (const patch of [
    ...["sold", "hidden", "archived", "available"].map((inventoryStatus) => ({ inventoryStatus })),
    ...["sale_agreed", "collected", "won", "lost", "qualifying"].map((leadStage) => ({ leadStage })),
    { depositPence: 10_000 }, { hasActiveSale: true }, { hasCompetingReservation: true },
  ]) {
    assert.throws(() => assertReservationCanBeCancelled({ ...state, ...patch }), (error) => error instanceof ReservationError && error.status === 409);
  }
});

test("public serializer omits all customer and internal fields even when record is extended", async () => {
  const repo = new MemoryRepository(); await createOnlineReservation(request, context, repo);
  Object.assign(repo.records[0], { vehicleRegistration: "AB12 CDE", internalNote: "Private" });
  assert.equal(reservationView(repo.records[0]).vehicleRegistration, "AB12 CDE");
  assert.deepEqual(Object.keys(reservationView(repo.records[0])).sort(), [
    "id", "reference", "vehicleId", "vehicleTitle", "vehicleRegistration", "depositPence", "amountReceivedPence", "paymentStatus", "status", "createdAt",
  ].sort());
  delete repo.records[0].vehicleRegistration;
  assert.equal("vehicleRegistration" in reservationView(repo.records[0]), false);
});
