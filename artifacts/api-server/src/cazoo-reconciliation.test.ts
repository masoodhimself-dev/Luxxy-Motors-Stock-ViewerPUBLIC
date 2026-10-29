import assert from "node:assert/strict";
import test from "node:test";
import { observedCazooPhotoFamilies, planCazooReconciliation, type CazooExistingVehicle, type CazooIdentityCar } from "./lib/cazoo-reconciliation";

const photo = (id = "AETV123", index = 1, query = "") => `https://cdn.images.autoexposure.co.uk/AETA22820/${id}_${index}.jpg${query}`;
function incoming(overrides: Partial<CazooIdentityCar> & Record<string, unknown> = {}) {
  return { advertId: "AETV123", make: "Ford", model: "Mondeo", year: 2019, registration: "AB19 CDE", plate: "AB19CDE", vrm: "AB19CDE", heroImage: photo(), images: [{ url: photo(), caption: null }],
    price: 9990, specifications: null, sourceExtras: { sourcePlatform: "cazoo", officialFeed: true, description: "Official description" }, ...overrides };
}
function existing(overrides: Partial<CazooExistingVehicle> = {}): CazooExistingVehicle {
  return { id: "uuid-1", dealerId: "multi-choice", source: "cazoo", advertId: "80238245", inventoryStatus: "available", sourceStatus: "live", make: "Ford", model: "Mondeo", year: 2019,
    registration: null, vrm: null, plate: null, sourceHeroImage: photo(), images: [{ id: "photo-1", url: photo(), origin: "source", isActive: true }], sourcePrice: 10900, ...overrides };
}
function plan(cars = [incoming()], stock = [existing()], complete = true) {
  return planCazooReconciliation({ dealerId: "multi-choice", inventoryIncludesAllStatuses: complete, incoming: cars, existing: stock });
}
function codes(result: ReturnType<typeof plan>) { return result.issues.map(issue => issue.code); }

test("matches the exact observed photo identity and retains UUID and numeric advert ID", () => {
  const result = plan();
  assert.equal(result.status, "preview_ready");
  assert.deepEqual(result.matches.map(item => ({ vehicleId: item.vehicleId, advertId: item.advertId, method: item.method })), [{ vehicleId: "uuid-1", advertId: "80238245", method: "photo_identity" }]);
  assert.equal(result.candidateCars?.[0].advertId, "80238245");
  assert.deepEqual(result.matches[0].identityAliasToRecord, { vehicleId: "uuid-1", officialCazooVehicleId: "AETV123" });
  assert.deepEqual(result.missing, []);
});

test("photo identities use observed HTTPS source URLs and ignore timestamp queries", () => {
  assert.deepEqual(observedCazooPhotoFamilies([photo("AETV123", 1, "?t=20261029101200"), photo("AETV123", 2), "https://other.invalid/AETA22820/AETV456_1.jpg", "http://cdn.images.autoexposure.co.uk/AETA22820/AETV999_1.jpg", "https://cdn.images.autoexposure.co.uk.evil.invalid/AETA22820/AETV999_1.jpg", "https://user:secret@cdn.images.autoexposure.co.uk/AETA22820/AETV999_1.jpg", "not a url"]), ["AETA22820/AETV123"]);
});

test("matches a trusted explicit official alias when the observed gallery has been replaced", () => {
  const result = plan([incoming({ images: [], heroImage: null })], [existing({ officialCazooVehicleId: "AETV123", images: [], sourceHeroImage: null })]);
  assert.equal(result.status, "preview_ready");
  assert.equal(result.matches[0].method, "official_id");
  assert.equal(result.candidateCars?.[0].advertId, "80238245");
});

test("matches an established AETV advert ID directly without inventing a new vehicle", () => {
  const result = plan([incoming()], [existing({ advertId: "AETV123" })]);
  assert.equal(result.matches[0].method, "official_id");
  assert.deepEqual(result.creates, []);
});

test("unique registration needs corroborating make, model and year when no photo identity is available", () => {
  const result = plan([incoming({ images: [], heroImage: null })], [existing({ registration: "AB19 CDE", images: [], sourceHeroImage: null })]);
  assert.equal(result.status, "preview_ready");
  assert.equal(result.matches[0].method, "registration");
  assert.equal(plan([incoming({ images: [], heroImage: null })], [existing({ registration: "AB19 CDE", year: null, images: [], sourceHeroImage: null })]).status, "blocked");
});

test("equivalent punctuation and case in make and model corroborates identity", () => {
  const result = plan([incoming({ make: "Mercedes-Benz", model: "C Class" })], [existing({ make: "mercedes benz", model: "C-Class" })]);
  assert.equal(result.status, "preview_ready");
});

test("public inventory is diagnostic only, even when every observed car matches", () => {
  const result = plan(undefined, undefined, false);
  assert.equal(result.status, "blocked");
  assert.ok(codes(result).includes("incomplete_inventory"));
  assert.equal(result.matches.length, 1);
  assert.equal(result.candidateCars, null);
});

test("all identity matching is restricted to the selected dealership and Cazoo source", () => {
  const result = plan([incoming()], [existing({ dealerId: "another-dealer" }), existing({ id: "uuid-2", source: "autotrader" })]);
  assert.equal(result.status, "preview_ready");
  assert.equal(result.ignoredInventoryCount, 2);
  assert.equal(result.matches.length, 0);
  assert.equal(result.creates[0].advertId, "AETV123");
  assert.deepEqual(result.missing, []);
});

test("an unknown official car is proposed as new, retaining only its supplied AETV identity", () => {
  const result = plan([incoming()], []);
  assert.equal(result.status, "preview_ready");
  assert.deepEqual(result.creates, [{ incomingIndex: 0, officialVehicleId: "AETV123", advertId: "AETV123" }]);
  assert.equal(result.candidateCars?.[0].advertId, "AETV123");
});

test("matching title, make, model, price and mileage alone never identifies an existing vehicle", () => {
  const result = plan([incoming({ title: "2019 Ford Mondeo", mileage: 50000, images: [], heroImage: null })], [existing({ title: "2019 Ford Mondeo", mileage: 50000, sourcePrice: 9990, images: [], sourceHeroImage: null })]);
  assert.equal(result.matches.length, 0);
  assert.equal(result.creates.length, 1);
  assert.equal(result.missing[0].action, "mark_source_missing");
});

test("a registration disagreement blocks even an exact photo match", () => {
  const result = plan([incoming()], [existing({ registration: "ZZ19 ZZZ" })]);
  assert.ok(codes(result).includes("registration_conflict"));
  assert.equal(result.status, "blocked");
  assert.equal(result.candidateCars, null);
});

test("registration cannot override a conflicting observed photo identity", () => {
  const result = plan([incoming()], [existing({ registration: "AB19 CDE", sourceHeroImage: photo("AETV999"), images: [{ url: photo("AETV999") }] })]);
  assert.ok(codes(result).includes("photo_identity_conflict"));
  assert.equal(result.candidateCars, null);
});

test("contradictory make, model or year blocks a direct official ID match", () => {
  for (const facts of [{ make: "BMW" }, { model: "Focus" }, { year: 2020 }]) {
    const result = plan([incoming()], [existing({ officialCazooVehicleId: "AETV123", ...facts })]);
    assert.ok(codes(result).includes("vehicle_facts_conflict"));
    assert.equal(result.candidateCars, null);
  }
});

test("missing corroborating facts cannot support a photo-only identity", () => {
  assert.ok(codes(plan([incoming()], [existing({ model: null })])).includes("vehicle_facts_conflict"));
});

test("duplicate feed IDs, registrations, or photo claims block the entire candidate", () => {
  const duplicateId = plan([incoming(), incoming()], []);
  assert.ok(codes(duplicateId).includes("duplicate_incoming_identity"));
  assert.equal(duplicateId.candidateCars, null);
  const duplicatePlate = plan([incoming(), incoming({ advertId: "AETV999", images: [{ url: photo("AETV999") }], heroImage: photo("AETV999") })], []);
  assert.ok(codes(duplicatePlate).includes("duplicate_incoming_registration"));
  assert.equal(duplicatePlate.candidateCars, null);
  const duplicatePhoto = plan([incoming(), incoming({ advertId: "AETV999", registration: "BB19 BBB", plate: "BB19BBB", vrm: "BB19BBB" })], []);
  assert.ok(codes(duplicatePhoto).includes("duplicate_incoming_photo_identity"));
  assert.equal(duplicatePhoto.candidateCars, null);
});

test("duplicate stored official aliases, including another record's advert ID, block the candidate", () => {
  const result = plan([incoming()], [existing({ officialCazooVehicleId: "AETV123" }), existing({ id: "uuid-2", advertId: "AETV123", sourceHeroImage: null, images: [] })]);
  assert.ok(codes(result).includes("duplicate_official_identity"));
  assert.equal(result.candidateCars, null);
});

test("duplicate stored photo identities are not resolved by first-match order", () => {
  const stock = [existing(), existing({ id: "uuid-2", advertId: "another" })];
  for (const records of [stock, [...stock].reverse()]) {
    const result = plan([incoming()], records);
    assert.ok(codes(result).includes("duplicate_photo_identity"));
    assert.equal(result.matches.length, 0);
    assert.equal(result.candidateCars, null);
  }
});

test("ambiguous registration across historical records blocks a candidate", () => {
  const stock = [existing({ registration: "AB19 CDE", images: [], sourceHeroImage: null }), existing({ id: "sold-uuid", advertId: "old-sold", inventoryStatus: "sold", registration: "AB19 CDE", images: [], sourceHeroImage: null })];
  const result = plan([incoming({ images: [], heroImage: null })], stock);
  assert.ok(codes(result).includes("ambiguous_identity"));
  assert.equal(result.candidateCars, null);
});

test("official ID and photo evidence pointing to different records blocks both", () => {
  const result = plan([incoming()], [existing({ officialCazooVehicleId: "AETV123", sourceHeroImage: null, images: [] }), existing({ id: "uuid-2", advertId: "different" })]);
  assert.ok(codes(result).includes("conflicting_identity_evidence"));
  assert.equal(result.candidateCars, null);
});

test("mixed source-photo families are blocked rather than used as multiple aliases", () => {
  assert.ok(codes(plan([incoming({ images: [{ url: photo() }, { url: photo("AETV999") }] })], [])).includes("mixed_incoming_photo_identity"));
  assert.ok(codes(plan([incoming()], [existing({ images: [{ url: photo() }, { url: photo("AETV999") }] })])).includes("mixed_existing_photo_identity"));
});

test("a feed photo ID must agree with its supplied Vehicle_ID", () => {
  const result = plan([incoming({ advertId: "AETV999" })], []);
  assert.ok(codes(result).includes("incoming_photo_id_conflict"));
  assert.equal(result.candidateCars, null);
});

test("manual photographs are never used to link official stock records", () => {
  const result = plan([incoming()], [existing({ sourceHeroImage: null, images: [{ id: "manual-1", url: photo(), origin: "manual", isActive: true }] })]);
  assert.equal(result.matches.length, 0);
  assert.equal(result.creates.length, 1);
});

test("protected sold, hidden and archived records are matched without resurrection", () => {
  for (const inventoryStatus of ["sold", "hidden", "archived"]) {
    const result = plan([incoming()], [existing({ inventoryStatus, archivedAt: inventoryStatus === "archived" ? "2026-10-01" : null })]);
    assert.equal(result.status, "preview_ready");
    assert.equal(result.matches[0].preserveInventoryStatus, inventoryStatus);
    assert.deepEqual(result.protectedTerminals, [{ vehicleId: "uuid-1", advertId: "80238245", inventoryStatus, includedInFeed: true }]);
    assert.equal(result.candidateCars?.[0].advertId, "80238245");
    assert.equal(Object.hasOwn(result.candidateCars![0], "inventoryStatus"), false);
  }
});

test("reserved inventory state is preserved independently from official catalogue facts", () => {
  const result = plan([incoming()], [existing({ inventoryStatus: "reserved", auditMetadata: { saleReservation: { saleId: "sale-1" } } })]);
  assert.equal(result.matches[0].preserveInventoryStatus, "reserved");
  assert.deepEqual(result.protectedTerminals, []);
  assert.equal(Object.hasOwn(result.candidateCars![0], "auditMetadata"), false);
});

test("absent records become a missing-source proposal, never a sold or delete operation", () => {
  const result = plan([], [existing(), existing({ id: "already-missing", advertId: "old-missing", sourceStatus: "missing", images: [], sourceHeroImage: null }), existing({ id: "sold", advertId: "sold-advert", inventoryStatus: "sold", images: [], sourceHeroImage: null })]);
  assert.deepEqual(result.missing.map(item => [item.vehicleId, item.action]), [["uuid-1", "mark_source_missing"], ["already-missing", "remain_missing"], ["sold", "preserve_protected_record"]]);
  assert.deepEqual(result.protectedTerminals, [{ vehicleId: "sold", advertId: "sold-advert", inventoryStatus: "sold", includedInFeed: false }]);
});

test("official candidate clears old browser-only facts instead of falling back to them", () => {
  const old = existing({ rawSourceData: { specifications: { CO2: "108 g/km" }, sourceExtras: { features: ["Old feature"], sourceReport: { checks: "All passed" } } } });
  const result = plan([incoming({ specifications: null, sourceExtras: { sourcePlatform: "cazoo", officialFeed: true } })], [old]);
  assert.equal(result.candidateCars?.[0].specifications, null);
  assert.deepEqual(result.candidateCars?.[0].sourceExtras, { sourcePlatform: "cazoo", officialFeed: true });
  assert.ok(result.matches[0].catalogueChanges.some(change => change.field === "specifications" && change.after === null));
  assert.deepEqual(result.matches[0].catalogueChanges.find(change => change.field === "price"), { field: "price", before: 10900, after: 9990 });
});

test("catalogue override cleanup is only a preview and excludes manual featured choices", () => {
  const old = existing({ websitePriceOverride: 11900, websiteTitleOverride: "Staff title", websiteDescription: "Old published text", websiteHeroImageOverride: "https://example.test/old.jpg", websiteFeatured: true,
    auditMetadata: { plateCorrection: { plate: "AB19CDE" }, saleReservation: { saleId: "sale-1" } }, images: [{ url: photo(), id: "source-1", origin: "source" }, { url: "https://example.test/manual.jpg", id: "manual-1", origin: "manual", isActive: true }, { url: "https://example.test/inactive.jpg", id: "manual-2", origin: "manual", isActive: false }] });
  const result = plan([incoming()], [old]);
  assert.deepEqual(result.overrideCleanup, [{ vehicleId: "uuid-1", clearFields: ["websitePriceOverride", "websiteTitleOverride", "websiteDescription", "websiteHeroImageOverride"], clearPlateCorrection: true, deactivateManualPhotoIds: ["manual-1"] }]);
  assert.equal(old.websitePriceOverride, 11900);
  assert.equal(old.websiteFeatured, true);
  assert.deepEqual(old.auditMetadata?.saleReservation, { saleId: "sale-1" });
});

test("reconciliation does not mutate either input or expose shared nested candidate references", () => {
  const cars = [incoming()], stock = [existing()], beforeCars = structuredClone(cars), beforeStock = structuredClone(stock);
  const result = plan(cars, stock);
  assert.deepEqual(cars, beforeCars);
  assert.deepEqual(stock, beforeStock);
  result.candidateCars![0].sourceExtras.description = "Changed preview";
  result.candidateCars![0].images[0].url = "https://example.test/new.jpg";
  assert.deepEqual(cars, beforeCars);
  assert.deepEqual(plan(cars, stock), plan(cars, stock));
});

test("invalid existing states, aliases and duplicate UUID records fail closed", () => {
  assert.ok(codes(plan([incoming()], [existing({ inventoryStatus: "unknown" })])).includes("invalid_existing_identity"));
  assert.ok(codes(plan([incoming()], [existing({ officialCazooVehicleId: "not-a-feed-id" })])).includes("invalid_official_alias"));
  assert.ok(codes(plan([incoming()], [existing(), existing({ advertId: "another", images: [], sourceHeroImage: null })])).includes("duplicate_inventory_record"));
});

test("disagreeing registration aliases are explicitly blocked", () => {
  assert.ok(codes(plan([incoming({ vrm: "CC19CCC" })], [])).includes("conflicting_incoming_registrations"));
  assert.ok(codes(plan([incoming()], [existing({ registration: "AB19 CDE", vrm: "CC19 CCC" })])).includes("conflicting_existing_registrations"));
});

test("incoming catalogue data cannot introduce inventory state, UUIDs or staff overrides", () => {
  for (const field of ["id", "dealerId", "inventoryStatus", "auditMetadata", "websitePriceOverride"]) {
    const result = plan([incoming({ [field]: "untrusted" })], []);
    assert.ok(codes(result).includes("business_state_in_candidate"));
    assert.equal(result.candidateCars, null);
  }
});
