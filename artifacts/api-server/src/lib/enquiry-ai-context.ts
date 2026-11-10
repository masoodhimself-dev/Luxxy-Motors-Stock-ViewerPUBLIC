import { AI_MODEL, AiError, aiHash, redactAiText } from "./ai-assistance";
import { publicAiCar, publicAiDealer } from "./ai-public-facts";
import { normaliseMotRegistration } from "./mot-history";
import { motVehicleDetails } from "./mot-vehicle-details";
import { isUKNumberPlate, type MotHistory, type MotTest } from "@workspace/vehicle-meta";

type LookupStatus = "verified" | "unavailable" | "not_requested";
type CheckOutcome = "verified" | "listing_only" | "not_recorded" | "unavailable";
type QuestionCheck = { question: string; topic: string; outcome: CheckOutcome; source: string; checkedAt: string; details: unknown };
export type EnquiryAiAudit = {
  version: 1;
  enquiryId: string;
  vehicleId: string | null;
  model: string;
  checkedAt: string;
  questions: QuestionCheck[];
  checksTruncated?: boolean;
  equipment?: { term: string; outcome: "listing_only" | "not_recorded"; evidence: string[] }[];
  lookups: { kind: "mot"; status: LookupStatus; source: string; checkedAt: string; sourceCheckedAt?: string; errorCode?: string }[];
  vehicleFacts: unknown;
};
export const enquiryIsArchived = (enquiry: Record<string, any>) => Boolean(enquiry.archivedAt || enquiry.archiveDeleteAt || enquiry.archived_at || enquiry.archive_delete_at);
/** Observation times are audit metadata, not changes to the customer question/facts. */
export function enquiryAiContextHash(context: { question: string; facts: unknown }) {
  const stable = (value: any): any => Array.isArray(value) ? value.map(stable) : value && typeof value === "object"
    ? Object.fromEntries(Object.entries(value).filter(([key]) => key !== "checkedAt" && key !== "sourceCheckedAt").map(([key, item]) => [key, stable(item)])) : value;
  return aiHash({ version: 2, task: "reply", question: context.question, facts: stable(context.facts) });
}
const normalQuestion = (value: string) => value.replace(/\bm\.?o\.?t\.?\b/gi, "MOT").replace(/\bpqrking\b/gi, "parking");
const partExchangeMention = /\b(?:part[ -]?ex(?:change)?|p[ \t]*\/[ \t]*x|px|trade[ -]?in)\b/i;
const customerVehicleMention = /\b(?:(?:my|our)\s+(?:(?:current|old|own|existing)\s+)?(?:car|vehicle|MOT)|mine)\b/i;
const advertisedVehicleMention = /\b(?:(?:this|your|advertised|listed|stock)\s+(?:car|vehicle)|(?:car|vehicle)\s+(?:in (?:the|your) (?:ad|advert|listing)|you(?:'re| are) (?:selling|advertising)))\b/i;
function registrationMention(registration: unknown, flags: string) {
  if (typeof registration !== "string" || !isUKNumberPlate(registration)) return undefined;
  const plate = registration.replace(/[\s-]/g, "");
  return new RegExp(`\\b${[...plate].join("[ \\t\\u00a0\\u202f-]*")}\\b`, flags);
}
function vehicleSubject(question: string, partExchange: boolean, advertisedRegistration?: RegExp) {
  const tradeIn = partExchangeMention.test(question) || customerVehicleMention.test(question);
  const advertised = advertisedVehicleMention.test(question) || advertisedRegistration?.test(question);
  if (tradeIn && advertised) return "unclear";
  if (tradeIn) return "part_exchange";
  return advertised || !partExchange ? "advertised" : "unclear";
}
export function enquiryNeedsMot(question: string) {
  const value = normalQuestion(question);
  return /\b(?:MOT|advis(?:ory|ories)|test history|MOT history|mileage history|roadworthiness)\b/i.test(value) ||
    (/\b(?:history|expir(?:e|es|y|ation)|runs? out|due date)\b/i.test(value) && !/\b(?:service|warranty|cover|insurance|quote|finance)\b/i.test(value));
}
const trimText = (value: unknown, max = 500) => typeof value === "string" ? value.trim().slice(0, max) : "";
const recordedDay = (value: unknown) => {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}(?:$|[T ])/.test(value)) return null;
  const day = value.slice(0, 10), date = new Date(day + "T12:00:00Z");
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === day ? day : null;
};
const motFailureCode = (error: unknown) => {
  const code = (error as { code?: unknown })?.code;
  return typeof code === "string" && ["invalid_registration", "not_found", "unavailable", "not_configured", "busy"].includes(code) ? code : "unavailable";
};

/** Summarise every verified test; bound the detailed excerpts without concealing truncation. */
export function replyMotFacts(history: MotHistory, registration: string, question: string, now: Date) {
  if (!history || history.registration?.replace(/[\s-]/g, "").toUpperCase() !== registration ||
    !Number.isFinite(Date.parse(history.checkedAt)) || Date.parse(history.checkedAt) > now.getTime() ||
    Date.parse(history.checkedAt) <= now.getTime() - 86400000 || !Array.isArray(history.tests) || history.tests.length > 500 ||
    history.tests.some((test) => !Number.isFinite(Date.parse(test.completedDate)) || !["PASSED", "FAILED"].includes(test.result) || !Array.isArray(test.defects)))
    throw new Error("Unverified MOT result");
  const tests = history.tests.filter((test) => {
    const day = test.completedDate.slice(0, 10), date = new Date(day + "T12:00:00Z");
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === day && Date.parse(test.completedDate) <= now.getTime();
  }).sort((a, b) => Date.parse(b.completedDate) - Date.parse(a.completedDate) || (a.result === b.result ? 0 : a.result === "FAILED" ? -1 : 1));
  if (history.tests.length && !tests.length) throw new Error("No verified recorded tests");
  const metadata = motVehicleDetails({ ...history, tests }, now).mot;
  const latest = tests[0], latestPass = tests.find((test) => test.result === "PASSED");
  const detail = (test: MotTest, maxDefects: number, maxText: number) => ({
    completedDate: test.completedDate,
    result: test.result,
    expiryDate: recordedDay(test.expiryDate) && recordedDay(test.expiryDate)! >= test.completedDate.slice(0, 10) ? recordedDay(test.expiryDate) : null,
    mileage: test.mileage,
    mileageUnit: test.mileageUnit,
    defects: [...test.defects].sort((a, b) => Number(b.dangerous === true || b.type === "DANGEROUS") - Number(a.dangerous === true || a.type === "DANGEROUS")).slice(0, maxDefects).map((defect) => ({ text: trimText(defect.text, maxText), textTruncated: typeof defect.text === "string" && defect.text.trim().length > maxText, type: trimText(defect.type, 40), dangerous: defect.dangerous === true })),
    defectsTruncated: test.defects.length > maxDefects,
  });
  const includeHistory = /\b(?:history|previous|past|failed|failures|issues|defects|advis(?:ory|ories))\b/i.test(question);
  return {
    source: "DVSA MOT history",
    registration,
    checkedAt: history.checkedAt,
    firstMotDueDate: metadata.firstTest ? metadata.dueDate : null,
    recall: history.recall,
    totalTests: tests.length,
    ignoredTests: history.tests.length - tests.length,
    passedTests: tests.filter((test) => test.result === "PASSED").length,
    failedTests: tests.filter((test) => test.result === "FAILED").length,
    firstTestDate: tests.at(-1)?.completedDate ?? null,
    latest: latest ? detail(latest, 12, 300) : null,
    latestDefectCount: latest?.defects.length ?? 0,
    latestAdvisoryCount: latest?.defects.filter((defect) => defect.type === "ADVISORY").length ?? 0,
    latestDangerousCount: latest?.defects.filter((defect) => defect.dangerous || defect.type === "DANGEROUS").length ?? 0,
    latestPass: latestPass ? { completedDate: metadata.lastPassedDate, expiryDate: metadata.dueDate } : null,
    currentExpiryDate: latest?.result === "FAILED" ? null : metadata.dueDate,
    latestTestFailed: metadata.latestTestResult === "FAILED",
    history: includeHistory ? tests.slice(0, 12).map((test) => detail(test, 2, 160)) : [],
    historyTruncated: includeHistory && tests.length > 12,
    interpretation: "A previous defect is a recorded observation, not proof of a current fault or completed repair. A later pass does not independently prove each historic repair. An MOT is not a mechanical inspection or service record. A latest failed test must not be hidden by an older pass.",
  };
}

/** Only the server-selected stock registration can leave the server for a lookup. */
export async function buildEnquiryAiContext(input: {
  enquiry: Record<string, any>;
  car: Record<string, any> | null;
  config: Record<string, any>;
  lookupMot?: (registration: string) => Promise<MotHistory>;
  now?: () => Date;
}) {
  if (enquiryIsArchived(input.enquiry)) throw new AiError("enquiry_archived", "Restore this enquiry before preparing an AI reply.", 409);
  const now = input.now?.() ?? new Date(), checkedAt = now.toISOString();
  const projectedCar = input.car ? publicAiCar(input.car) : null, dealer = publicAiDealer(input.config);
  const rawMessage = String(input.enquiry.message ?? "");
  const tradeInRegistration = registrationMention(input.enquiry.partExchangeRegistration, "gi");
  const mileage = input.enquiry.partExchangeMileage;
  const recordedMileage = typeof mileage === "number" && Number.isSafeInteger(mileage) && mileage >= 0 && mileage <= 9_999_999 ? mileage : null;
  const conditionSupplied = typeof input.enquiry.partExchangeCondition === "string" && Boolean(input.enquiry.partExchangeCondition.trim());
  const advertisedRegistration = registrationMention(projectedCar?.registration, "i");
  const partExchangeRequested = input.enquiry.type === "part_exchange" || Boolean(tradeInRegistration) || recordedMileage !== null || conditionSupplied || partExchangeMention.test(rawMessage);
  const tradeInPlatePlaceholder = "[part-exchange plate removed]";
  let registrationSupplied = Boolean(tradeInRegistration);
  let message = tradeInRegistration ? rawMessage.replace(tradeInRegistration, tradeInPlatePlaceholder) : rawMessage;
  if (partExchangeRequested && !tradeInRegistration) {
    // Some older enquiries have a labelled plate in the message only.
    message = message.replace(/\bVRM[ \t]*:[ \t]*([A-Z0-9]{2,7}(?:[ \t\u00a0\u202f-]+[A-Z0-9]{1,4})?)[ \t]*(?=$|[\r\n.!?,;])/gi, (match, plate: string) => {
      if (!isUKNumberPlate(plate) || advertisedRegistration?.test(plate)) return match;
      registrationSupplied = true;
      return tradeInPlatePlaceholder;
    });
  }
  const partExchange = partExchangeRequested
    ? { registrationSupplied, customerReportedMileage: recordedMileage, conditionSupplied, valuation: null }
    : null;
  const question = redactAiText(message, [String(input.enquiry.customerName ?? "")]);
  const questions = question.split(/\?(?:\s+|$)|[\r\n]+/).map((value) => value.trim()).filter(Boolean);
  const questionChecks = (questions.length ? questions : [question]).map((asked) => ({
    asked, vehicle: vehicleSubject(asked, Boolean(partExchange), advertisedRegistration), motRequested: enquiryNeedsMot(asked),
  }));
  const advertisedMotQuestions = questionChecks.filter((check) => check.motRequested && check.vehicle === "advertised");
  // Keep a useful listing beside the verified history without allowing a rich
  // advert to consume the whole request. Requested equipment is prioritised.
  const equipmentTerms: string[] = normalQuestion(question).match(/\b(?:heated seats|parking sensors|camera|sat[ -]?nav|carplay|android auto|sunroof|bluetooth|isofix|cruise control|air conditioning|climate control|leather|towbar)\b/gi) ?? [];
  const prioritizedFeatures = projectedCar ? [...projectedCar.features].sort((a, b) => Number(equipmentTerms.some((term) => b.toLowerCase().includes(term.toLowerCase()))) - Number(equipmentTerms.some((term) => a.toLowerCase().includes(term.toLowerCase())))) : [];
  const car = projectedCar ? { ...projectedCar, description: projectedCar.description?.slice(0, 4500) ?? null, serviceHistory: projectedCar.serviceHistory?.slice(0, 1000) ?? null, features: prioritizedFeatures.slice(0, 50), listingDetailsTruncated: Boolean((projectedCar.description?.length ?? 0) > 4500 || (projectedCar.serviceHistory?.length ?? 0) > 1000 || prioritizedFeatures.length > 50) } : null;
  const audit: EnquiryAiAudit = { version: 1, enquiryId: String(input.enquiry.id ?? ""), vehicleId: car?.id ?? null, model: AI_MODEL, checkedAt, questions: [], lookups: [], vehicleFacts: car };
  let mot: ReturnType<typeof replyMotFacts> | null = null;
  if (advertisedMotQuestions.length) {
    let errorCode = "registration_missing";
    try {
      if (!car?.registration) throw new Error("Registration missing");
      const registration = normaliseMotRegistration(String(car.registration));
      errorCode = "unavailable";
      const lookup = input.lookupMot ?? (await import("./mot-storage")).motService.lookup;
      // motService owns the shared 24-hour cache, in-flight deduplication,
      // credential/host restrictions, timeout and durable provider quota.
      const history = await lookup(registration);
      mot = replyMotFacts(history, registration, advertisedMotQuestions.map(({ asked }) => asked).join("\n"), input.now?.() ?? new Date());
      audit.lookups.push({ kind: "mot", status: "verified", source: "DVSA MOT history", checkedAt, sourceCheckedAt: mot.checkedAt });
    } catch (error) {
      errorCode = car?.registration ? motFailureCode(error) : errorCode;
      audit.lookups.push({ kind: "mot", status: "unavailable", source: "DVSA MOT history", checkedAt, errorCode });
    }
  } else audit.lookups.push({ kind: "mot", status: "not_requested", source: "Not requested", checkedAt });
  const motLookup = audit.lookups[0];
  // Evidence text is already present once in the car projection. Refer to that
  // source rather than repeating whole advert paragraphs for every question.
  const equipmentByTerm = new Map<string, number>();
  let checkBytes = 0;
  for (const { asked, vehicle, motRequested } of questionChecks.slice(0, 12)) {
    const normalizedAsked = normalQuestion(asked);
    const add = (topic: string, outcome: CheckOutcome, source: string, details: unknown) => {
      const check = { question: asked.slice(0, 180), topic, outcome, source, checkedAt: source === "DVSA MOT history" && mot ? mot.checkedAt : checkedAt, details };
      const size = Buffer.byteLength(JSON.stringify(check));
      if (checkBytes + size > 7500) { audit.checksTruncated = true; return; }
      checkBytes += size;
      audit.questions.push(check);
    };
    const before = audit.questions.length;
    if (motRequested && vehicle === "advertised") add("mot", mot ? "verified" : "unavailable", "DVSA MOT history", mot
      ? { latestTestDate: mot.latest?.completedDate ?? null, latestResult: mot.latest?.result ?? null, expiryDate: mot.currentExpiryDate, lastPassedExpiryDate: mot.latestPass?.expiryDate ?? null, totalTests: mot.totalTests, failedTests: mot.failedTests, latestDefectCount: mot.latestDefectCount, latestAdvisoryCount: mot.latestAdvisoryCount, latestDangerousCount: mot.latestDangerousCount, defectDetails: "Supplied vehicle MOT facts", historyTruncated: mot.historyTruncated, ignoredTests: mot.ignoredTests }
      : { errorCode: motLookup?.errorCode ?? "unavailable", message: "MOT details could not be verified; do not replace this with an advert claim." });
    if (motRequested && vehicle !== "advertised") add("mot", "unavailable", "MOT not checked", {
      vehicle,
      errorCode: vehicle === "part_exchange" ? "part_exchange_mot_not_checked" : "mot_vehicle_unclear",
    });
    if (/\b(?:service|servicing|maintenance|stamp|receipt)\b/i.test(asked)) add("service_history", car?.serviceHistory || /\bservic(?:e|ing)\b/i.test(car?.description ?? "") ? "listing_only" : "not_recorded", "Published vehicle listing", { evidence: "car.serviceHistory and car.description", independentServiceCheck: false });
    if (/\b(?:owner|owners|keeper|keepers)\b/i.test(asked)) add("ownership", car?.owners != null || /\bowner|keeper\b/i.test(car?.description ?? "") ? "listing_only" : "not_recorded", "Published vehicle listing", { owners: car?.owners ?? null });
    if (/\b(?:warranty|cover)\b/i.test(asked)) add("warranty", dealer.warranty || dealer.includedItems.length ? "listing_only" : "not_recorded", "Dealer settings", { evidence: "dealer.warranty and dealer.includedItems" });
    if (/\b(?:available|availability|sold|reserved)\b/i.test(asked)) add("availability", car ? "verified" : "not_recorded", "Current dealer stock", { inventoryStatus: car?.inventoryStatus ?? null });
    if (/\b(?:reg|registration|number plate|numberplate)\b/i.test(asked)) {
      if (vehicle === "advertised") add("registration", car?.registration ? "verified" : "not_recorded", "Current dealer stock", { registration: car?.registration ?? null });
      else add("registration", "unavailable", "Customer enquiry", { vehicle, registrationSupplied: Boolean(partExchange?.registrationSupplied) });
    }
    if (/\b(?:price|offer|cash|discount)|£\s*\d/i.test(asked)) add("price", car?.price != null ? "verified" : "not_recorded", "Current dealer stock", { askingPrice: car?.price ?? null, negotiationAuthority: "No authorised discount or accepted offer supplied" });
    if (/\b(?:book|booking|appointment|viewing|test drive|visit|tomorrow|today)\b/i.test(asked)) add("appointment", "not_recorded", "Dealer booking policy only", { liveCalendarChecked: false, evidence: "dealer.testDriveBooking", instruction: "Do not confirm a slot, booking, or that staff have been notified." });
    if (/\bdeliver(?:y)?\b/i.test(asked)) add("delivery", dealer.delivery ? "listing_only" : "not_recorded", "Dealer settings", { evidence: "dealer.delivery", quotedRouteChecked: false });
    const equipment = /\b(?:heated seats|parking sensors|camera|sat[ -]?nav|carplay|android auto|sunroof|bluetooth|isofix|cruise control|air conditioning|climate control|leather|towbar)\b/gi;
    const terms = [...new Set(normalizedAsked.match(equipment)?.map((value) => value.toLowerCase()) ?? [])];
    if (terms.length) {
      const listed = [{ text: car?.description ?? "", source: "car.description" }, ...(car?.features ?? []).map((text, index) => ({ text, source: `car.features[${index}]` }))];
      const equipmentRefs = terms.map((term) => {
        if (!equipmentByTerm.has(term)) {
          const evidence = listed.filter((value) => value.text.toLowerCase().includes(term)).slice(0, 3).map((value) => value.source);
          audit.equipment ??= [];
          equipmentByTerm.set(term, audit.equipment.length);
          audit.equipment.push({ term, outcome: evidence.length ? "listing_only" : "not_recorded", evidence });
        }
        return equipmentByTerm.get(term)!;
      });
      add("equipment", equipmentRefs.every((index) => audit.equipment![index].evidence.length) ? "listing_only" : "not_recorded", "Published vehicle listing", { equipmentRefs, independentlyInspected: false, instruction: "Use the referenced verification.equipment listing facts, including negatives; unstated equipment needs confirmation." });
    }
    if (before === audit.questions.length) add("other", "not_recorded", "Supplied dealership and vehicle facts only", { instruction: "Answer only supported details; identify any missing answer clearly." });
  }
  const facts = { dealer, cars: car ? [{ ...car, mot: mot ?? { status: motLookup?.status, errorCode: motLookup?.errorCode ?? null } }] : [], enquiry: { type: input.enquiry.type, ...(partExchange && { partExchange }) }, verification: { checkedAt, questions: audit.questions, lookups: audit.lookups, equipment: audit.equipment ?? [], checksTruncated: Boolean(audit.checksTruncated) } };
  audit.vehicleFacts = facts.cars[0] ?? null;
  return { question, facts, contextAudit: audit };
}
