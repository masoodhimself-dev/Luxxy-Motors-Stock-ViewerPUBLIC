import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { buildEnquiryAiContext, enquiryAiContextHash, enquiryNeedsMot } from "./lib/enquiry-ai-context";
import { publicAiCar } from "./lib/ai-public-facts";
import { aiPrompt } from "./lib/ai-assistance";
import type { MotHistory } from "@workspace/vehicle-meta";

const now = new Date("2026-11-03T12:00:00Z");
const history = (): MotHistory => ({
  registration: "AB12CDE", make: "Fictional", model: "Example", checkedAt: "2026-11-03T11:00:00Z", recall: "Unknown", tests: [
    { completedDate: "2026-10-01", result: "FAILED", expiryDate: null, mileage: "60000", mileageUnit: "MI", defects: [{ text: "Front brake has a dangerous defect", type: "DANGEROUS", dangerous: true }, { text: "Tyre worn", type: "ADVISORY", dangerous: false }] },
    { completedDate: "2025-10-01", result: "PASSED", expiryDate: "2026-10-15", mileage: "50000", mileageUnit: "MI", defects: [{ text: "Rear tyre worn", type: "ADVISORY", dangerous: false }] },
  ],
});
const input = (message: string) => ({ enquiry: { id: randomUUID(), type: "general", customerName: "Jane Example", message }, car: { id: randomUUID(), registration: "AB12 CDE", make: "Fictional", model: "Example", inventoryStatus: "available", price: 5000, features: [], specifications: { features: ["Heated seats"] }, sourceExtras: { featureList: ["Rear camera", "Heated seats"] } }, config: { identity: { name: "Fictional Motors" }, presentation: { includedItems: ["6 months warranty"] } }, now: () => now });

function verifiedMot(context: Awaited<ReturnType<typeof buildEnquiryAiContext>>) {
  const mot = context.facts.cars[0].mot;
  assert.ok("latest" in mot, "Expected a verified MOT result");
  return mot;
}

test("published feature sources merge when an earlier source is empty", () => {
  assert.deepEqual(publicAiCar({ features: [], specifications: { features: ["Heated seats"] }, sourceExtras: { features: ["Bluetooth"], featureList: ["Heated seats", "Rear camera"] } }).features, ["Heated seats", "Bluetooth", "Rear camera"]);
  assert.equal(publicAiCar({ vrm: "", plate: "12 reg", registration: "AB12 CDE" }).registration, "AB12 CDE");
});
test("question-led context makes one selected-car MOT lookup and retains relevant failures/history", async () => {
  let calls = 0;
  const context = await buildEnquiryAiContext({ ...input("Jane Example jane@example.test 07700900123 asks: What is the MOT expiry and history? Does it have heated seats? What warranty is included?"), lookupMot: async (registration) => { calls++; assert.equal(registration, "AB12CDE"); return history(); } });
  assert.equal(calls, 1);
  assert.equal(verifiedMot(context).latest?.result, "FAILED");
  assert.equal(verifiedMot(context).latestPass?.expiryDate, "2026-10-15");
  assert.equal(verifiedMot(context).latest?.defects[0].dangerous, true);
  assert.equal(verifiedMot(context).failedTests, 1);
  assert.equal(verifiedMot(context).history.length, 2);
  assert.ok(context.contextAudit.questions.some((check) => check.topic === "mot" && check.outcome === "verified"));
  assert.ok(context.contextAudit.questions.some((check) => check.topic === "equipment"));
  assert.deepEqual(context.facts.dealer.includedItems, ["6 months warranty"]);
  assert.equal(context.contextAudit.lookups[0].sourceCheckedAt, history().checkedAt);
  assert.ok(!JSON.stringify(context).includes("jane@example.test"));
  assert.ok(!JSON.stringify(context).includes("07700900123"));
  assert.ok(!JSON.stringify(context).includes("Jane Example"));
});
test("MOT failure is explicit and cannot masquerade as verified advert information", async () => {
  const data = input("When does the MOT expire?");
  data.car = { ...data.car, description: "MOT until 2028" } as typeof data.car;
  const context = await buildEnquiryAiContext({ ...data, lookupMot: async () => { throw Object.assign(new Error("secret credential must not leak"), { code: "busy" }); } });
  assert.deepEqual(context.contextAudit.lookups[0], { kind: "mot", status: "unavailable", source: "DVSA MOT history", checkedAt: now.toISOString(), errorCode: "busy" });
  assert.equal(context.contextAudit.questions[0].outcome, "unavailable");
  const unavailable = context.facts.cars[0].mot;
  assert.ok("status" in unavailable);
  assert.equal(unavailable.status, "unavailable");
  assert.ok(!JSON.stringify(context).includes("secret credential"));
});
test("unrelated service/warranty/equipment questions make no MOT request", async () => {
  let calls = 0;
  const context = await buildEnquiryAiContext({ ...input("What service history and heated seats are listed? When does the warranty expire?"), lookupMot: async () => { calls++; return history(); } });
  assert.equal(calls, 0);
  assert.equal(context.contextAudit.lookups[0].status, "not_requested");
  assert.equal(enquiryNeedsMot("Can I see the previous MOT failures?"), true);
});
test("archive and missing server-selected registration prevent lookup; customer registration/URL cannot route it", async () => {
  let calls = 0;
  const data = input("Check MOT for ZZ99ZZZ at https://untrusted.example.test instead");
  const lookupMot = async (registration: string) => { calls++; assert.equal(registration, "AB12CDE"); return history(); };
  await assert.rejects(buildEnquiryAiContext({ ...data, enquiry: { ...data.enquiry, archivedAt: now }, lookupMot }), { code: "enquiry_archived" });
  assert.equal(calls, 0);
  await buildEnquiryAiContext({ ...data, lookupMot });
  assert.equal(calls, 1);
  const missing = await buildEnquiryAiContext({ ...data, car: { ...data.car, registration: "" }, lookupMot });
  assert.equal(calls, 1);
  assert.equal(missing.contextAudit.lookups[0].errorCode, "registration_missing");
});
test("part exchange context includes supplied facts without the trade-in registration or condition text", async () => {
  const data = input("Could you value my part exchange CD34 EFG? I also wrote CD34EFG.");
  const context = await buildEnquiryAiContext({ ...data, enquiry: {
    ...data.enquiry, type: "part_exchange", partExchangeRegistration: "CD34 EFG", partExchangeMileage: 53000,
    partExchangeCondition: "Private description of the customer's car",
  } });
  assert.deepEqual(context.facts.enquiry.partExchange, {
    registrationSupplied: true, customerReportedMileage: 53000, conditionSupplied: true, valuation: null,
  });
  const payload = JSON.stringify(context);
  assert.doesNotMatch(payload, /CD34[ -]?EFG|Private description/i);
  assert.equal(context.contextAudit.lookups[0].status, "not_requested");
});
test("a labelled trade-in plate is removed from Part-Ex messages without a saved plate", async () => {
  const data = input("Can you check the MOT for VRM: CD34 EFG? Can you also check the MOT for VRM: AB12 CDE?");
  const requested: string[] = [];
  const context = await buildEnquiryAiContext({ ...data, enquiry: { ...data.enquiry, type: "part_exchange" }, lookupMot: async (registration) => { requested.push(registration); return history(); } });
  assert.doesNotMatch(JSON.stringify(context), /CD34 EFG/i);
  assert.equal(context.facts.enquiry.partExchange?.registrationSupplied, true);
  assert.deepEqual(requested, ["AB12CDE"]);
  assert.deepEqual(context.contextAudit.questions[0].details, { vehicle: "part_exchange", errorCode: "part_exchange_mot_not_checked" });
  assert.equal(context.contextAudit.questions[1].outcome, "verified");
});
test("MOT context keeps trade-in, unclear and explicitly advertised questions separate", async () => {
  const data = input("When does the MOT expire?");
  const enquiry = { ...data.enquiry, type: "part_exchange", partExchangeRegistration: "CD34 EFG" };
  const requested: string[] = [];
  const lookupMot = async (registration: string) => { requested.push(registration); return history(); };
  const unclear = await buildEnquiryAiContext({ ...data, enquiry, lookupMot });
  assert.equal(unclear.contextAudit.lookups[0].status, "not_requested");
  assert.deepEqual(unclear.contextAudit.questions[0].details, { vehicle: "unclear", errorCode: "mot_vehicle_unclear" });
  const tradeIn = await buildEnquiryAiContext({ ...data, enquiry: { ...enquiry, message: "When does the MOT expire for CD34 EFG?" }, lookupMot });
  assert.deepEqual(tradeIn.contextAudit.questions[0].details, { vehicle: "part_exchange", errorCode: "part_exchange_mot_not_checked" });
  assert.deepEqual(requested, []);

  const mixed = await buildEnquiryAiContext({ ...data, enquiry: {
    ...enquiry, message: "Does the advertised car have a current MOT? Can you check my part exchange's MOT history?",
  }, lookupMot });
  assert.deepEqual(requested, ["AB12CDE"]);
  assert.deepEqual(mixed.contextAudit.questions.map((check) => [check.topic, check.outcome]), [["mot", "verified"], ["mot", "unavailable"]]);
  assert.equal(verifiedMot(mixed).history.length, 0, "Trade-in history must not expand the advertised vehicle lookup facts");
  const byPlate = await buildEnquiryAiContext({ ...data, enquiry: { ...enquiry, message: "When does AB12 CDE's MOT expire?" }, lookupMot });
  assert.equal(byPlate.contextAudit.questions[0].outcome, "verified");
  const tradeInRegistration = await buildEnquiryAiContext({ ...data, enquiry: { ...enquiry, message: "What's the registration on my part exchange?" }, lookupMot });
  assert.deepEqual(tradeInRegistration.contextAudit.questions[0].details, { vehicle: "part_exchange", registrationSupplied: true });
});
test("mismatched and stale MOT records are rejected instead of being labelled verified", async () => {
  for (const result of [{ ...history(), registration: "ZZ99ZZZ" }, { ...history(), checkedAt: "2026-10-01T11:00:00Z" }]) {
    const context = await buildEnquiryAiContext({ ...input("What is the MOT history?"), lookupMot: async () => result });
    assert.equal(context.contextAudit.lookups[0].status, "unavailable");
  }
});
test("Honda wording and typo still check MOT, parking sensors and registration", async () => {
  const data = input("Does it have pqrking sensors, what is reg? When does the MOT run out and are there advisories?");
  const context = await buildEnquiryAiContext({ ...data, lookupMot: async () => history() });
  assert.ok(context.contextAudit.questions.some((check) => check.topic === "registration" && check.outcome === "verified"));
  assert.ok(context.contextAudit.questions.some((check) => check.topic === "equipment" && check.outcome === "not_recorded"));
  assert.ok(context.contextAudit.questions.some((check) => check.topic === "mot" && check.outcome === "verified"));
  const noRecord = await buildEnquiryAiContext({ ...data, lookupMot: async () => { throw Object.assign(new Error("not found"), { code: "not_found" }); } });
  assert.equal(noRecord.contextAudit.lookups[0].errorCode, "not_found");
  assert.ok(noRecord.contextAudit.questions.some((check) => check.topic === "mot" && check.outcome === "unavailable"));
});
test("future or impossible tests cannot override recorded tests and a latest failure is explicit", async () => {
  const record = history();
  record.tests.unshift({ ...record.tests[1], completedDate: "2027-01-01", expiryDate: "2028-01-01" });
  record.tests.unshift({ ...record.tests[1], completedDate: "2026-02-30", expiryDate: "2027-02-28" });
  const context = await buildEnquiryAiContext({ ...input("What is the MOT expiry and history?"), lookupMot: async () => record });
  const mot = verifiedMot(context);
  assert.equal(mot.latest?.result, "FAILED");
  assert.equal(mot.latestTestFailed, true);
  assert.equal(mot.currentExpiryDate, null);
  assert.equal(mot.ignoredTests, 2);
  assert.equal((context.contextAudit.questions[0].details as any).expiryDate, null);
  const conflict = history();
  conflict.tests.push({ ...conflict.tests[0], result: "PASSED", expiryDate: "2027-10-01" });
  const sameTime = await buildEnquiryAiContext({ ...input("What is the latest MOT result?"), lookupMot: async () => conflict });
  assert.equal(verifiedMot(sameTime).latest?.result, "FAILED");
});
test("retries keep a stable facts hash while changed facts change the hash", async () => {
  const data = input("Is it still available?");
  const first = await buildEnquiryAiContext(data);
  const second = await buildEnquiryAiContext({ ...data, now: () => new Date(now.getTime() + 1000) });
  const changed = await buildEnquiryAiContext({ ...data, car: { ...data.car, price: 6000 } });
  assert.equal(enquiryAiContextHash(first), enquiryAiContextHash(second));
  assert.notEqual(enquiryAiContextHash(first), enquiryAiContextHash(changed));
});
test("a fresh provider check completed after the request started is accepted", async () => {
  let clock = new Date(now);
  const context = await buildEnquiryAiContext({ ...input("What is the MOT expiry?"), now: () => clock, lookupMot: async () => { clock = new Date(now.getTime() + 1000); return { ...history(), checkedAt: clock.toISOString() }; } });
  assert.equal(context.contextAudit.lookups[0].status, "verified");
  assert.equal(context.contextAudit.lookups[0].sourceCheckedAt, clock.toISOString());
});
test("large recorded histories keep complete counts, bounded details and truncation warnings", async () => {
  const record = history();
  record.tests = Array.from({ length: 30 }, (_, index) => ({ ...record.tests[0], completedDate: `2026-10-${String(30 - index).padStart(2, "0")}`, defects: Array.from({ length: 40 }, (_, defect) => ({ text: `Recorded defect ${defect} ` + "x".repeat(600), type: "ADVISORY", dangerous: defect === 39 })) }));
  const context = await buildEnquiryAiContext({ ...input("What is the MOT history? Any advisories? Any dangerous defects? When did it last fail?"), lookupMot: async () => record });
  const mot = verifiedMot(context);
  assert.equal(mot.totalTests, 30);
  assert.equal(mot.history.length, 12);
  assert.equal(mot.historyTruncated, true);
  assert.equal(mot.latestDefectCount, 40);
  assert.equal(mot.latestDangerousCount, 1);
  assert.equal(mot.latest?.defects[0].dangerous, true);
  assert.equal(mot.latest?.defectsTruncated, true);
  assert.ok(Buffer.byteLength(JSON.stringify(context.facts)) < 40000);
});
test("rich listing and repeated multi-topic questions fit the actual model and private audit limits", async () => {
  const data = input(Array.from({ length: 12 }, (_, index) => `Question ${index}: MOT history advisories service history owners warranty available reg price book delivery heated seats parking sensors camera sat nav carplay android auto sunroof bluetooth isofix cruise control air conditioning climate control leather towbar?`).join("\n"));
  const equipment = "Heated seats parking sensors camera sat nav carplay android auto sunroof bluetooth isofix cruise control air conditioning climate control leather towbar. ";
  const car = { ...data.car, description: (equipment + "Vehicle listing detail. ").repeat(70), serviceHistory: "Recorded service information. ".repeat(100), features: Array.from({ length: 70 }, (_, index) => `${equipment} Feature ${index}`) };
  const config = { ...data.config, warranty: { summary: "Warranty information. ".repeat(40) }, delivery: { summary: "Delivery information. ".repeat(40) }, presentation: { includedItems: Array.from({ length: 12 }, (_, index) => `Included item ${index} ` + "x".repeat(140)) } };
  const record = history();
  record.tests = Array.from({ length: 30 }, (_, index) => ({ ...record.tests[0], completedDate: `2026-10-${String(30 - index).padStart(2, "0")}`, defects: Array.from({ length: 40 }, (_, defect) => ({ text: `Recorded defect ${defect} ` + "x".repeat(600), type: "ADVISORY", dangerous: defect === 39 })) }));
  const context = await buildEnquiryAiContext({ ...data, car, config, lookupMot: async () => record });
  const promptBytes = Buffer.byteLength(JSON.stringify(aiPrompt("reply", context.question, context.facts)));
  const auditBytes = Buffer.byteLength(JSON.stringify(context.contextAudit));
  assert.ok(promptBytes < 48000, `Model payload was ${promptBytes} bytes`);
  assert.ok(auditBytes < 64000, `Private audit was ${auditBytes} bytes`);
  assert.equal(new Set(context.contextAudit.equipment!.map((check) => check.term)).size, context.contextAudit.equipment!.length);
  assert.ok(context.contextAudit.equipment!.every((check) => check.evidence.every((source) => source.startsWith("car."))));
  assert.equal(context.facts.verification.checksTruncated, true);
  assert.equal(verifiedMot(context).totalTests, 30);
});
