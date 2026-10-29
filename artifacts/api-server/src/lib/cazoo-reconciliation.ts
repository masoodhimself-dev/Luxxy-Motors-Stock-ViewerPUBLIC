/**
 * Read-only reconciliation for the change from browser-collected Cazoo stock to
 * Cazoo's official CSV. This module has no database, network or import client.
 * Its candidate is a preview, never permission to apply a stock import.
 */
export interface CazooIdentityCar {
  advertId: string;
  make: string | null;
  model: string | null;
  year: number | null;
  registration?: string | null;
  plate?: string | null;
  vrm?: string | null;
  heroImage?: string | null;
  images: readonly { url: string; caption?: string | null }[];
}

export interface CazooExistingVehicle {
  id: string;
  dealerId: string;
  source: string;
  advertId: string;
  inventoryStatus: string;
  sourceStatus?: string;
  archivedAt?: unknown;
  make: string | null;
  model: string | null;
  year: number | null;
  registration?: string | null;
  plate?: string | null;
  vrm?: string | null;
  /** Trusted alias read from auditMetadata.officialCazooFeed.vehicleId. */
  officialCazooVehicleId?: string | null;
  sourceHeroImage?: string | null;
  images?: readonly {
    id?: string;
    url: string;
    origin?: string;
    isActive?: boolean;
  }[];
  websitePriceOverride?: number | null;
  websiteTitleOverride?: string | null;
  websiteDescription?: string | null;
  websiteHeroImageOverride?: string | null;
  auditMetadata?: Record<string, unknown> | null;
  rawSourceData?: unknown;
  sourcePrice?: number | null;
  [key: string]: unknown;
}

export interface CazooReconciliationIssue {
  code: string;
  message: string;
  incomingVehicleId?: string;
  existingVehicleIds?: string[];
}

export type CazooIdentityMethod = "official_id" | "photo_identity" | "registration";

export interface CazooIdentityMatch {
  incomingIndex: number;
  officialVehicleId: string;
  vehicleId: string;
  advertId: string;
  method: CazooIdentityMethod;
  /** Every inventory status, including reserved and sold, is preserved. */
  preserveInventoryStatus: string;
  identityAliasToRecord: { vehicleId: string; officialCazooVehicleId: string };
  catalogueChanges: { field: string; before: unknown; after: unknown }[];
}

export interface CazooReconciliationPlan<C extends CazooIdentityCar> {
  status: "blocked" | "preview_ready";
  dealerId: string;
  source: "cazoo";
  inventoryIncludesAllStatuses: boolean;
  ignoredInventoryCount: number;
  issues: CazooReconciliationIssue[];
  matches: CazooIdentityMatch[];
  creates: { incomingIndex: number; officialVehicleId: string; advertId: string }[];
  missing: {
    vehicleId: string;
    advertId: string;
    inventoryStatus: string;
    action: "mark_source_missing" | "remain_missing" | "preserve_protected_record";
  }[];
  protectedTerminals: {
    vehicleId: string;
    advertId: string;
    inventoryStatus: string;
    includedInFeed: boolean;
  }[];
  /** Proposed cleanup only. Featured choices and all business state are absent. */
  overrideCleanup: {
    vehicleId: string;
    clearFields: string[];
    clearPlateCorrection: boolean;
    deactivateManualPhotoIds: string[];
  }[];
  /** Incoming facts only, with established advert IDs retained for matches. */
  candidateCars: C[] | null;
}

const terminalStatuses = new Set(["sold", "hidden", "archived"]);
const inventoryStatuses = new Set(["available", "reserved", ...terminalStatuses]);
const overrideFields = ["websitePriceOverride", "websiteTitleOverride", "websiteDescription", "websiteHeroImageOverride"] as const;
const factFields = [
  "title", "variant", "make", "model", "trim", "year", "price", "priceType", "currency", "mileage", "mileageText",
  "registration", "registrationBand", "plate", "vrm", "vrmVerified", "fuel", "transmission", "bodyType", "engineSize",
  "engineCC", "doors", "seats", "colour", "emissionClass", "drivetrain", "owners", "writeOffCategory", "advertUrl",
  "dealerName", "dealerLocation", "imageCount", "heroImage", "images", "specifications", "sourceExtras",
] as const;

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function normalizedFact(value: string | null | undefined): string {
  return (value ?? "").normalize("NFKC").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function registration(value: string | null | undefined): string | null {
  if (!value || !/^[a-z0-9\s-]+$/i.test(value)) return null;
  const result = value.toUpperCase().replace(/[\s-]+/g, "");
  return /^[A-Z0-9]{2,8}$/.test(result) ? result : null;
}

function registrationAliases(car: Pick<CazooIdentityCar, "registration" | "plate" | "vrm">): string[] {
  return [...new Set([car.registration, car.plate, car.vrm].map(registration).filter((v): v is string => v !== null))];
}

/** Exact identity present in an observed URL; no URL is constructed or fetched. */
export function observedCazooPhotoFamilies(urls: readonly string[]): string[] {
  const result = new Set<string>();
  for (const value of urls) {
    try {
      const url = new URL(value);
      if (url.protocol !== "https:" || url.hostname.toLowerCase() !== "cdn.images.autoexposure.co.uk" || url.username || url.password) continue;
      const match = /^\/(AETA\d+)\/(AETV\d+)_\d+\.(?:jpe?g|png|webp)$/i.exec(url.pathname);
      if (match) result.add(`${match[1].toUpperCase()}/${match[2].toUpperCase()}`);
    } catch { /* A malformed/non-source image is not identity evidence. */ }
  }
  return [...result].sort();
}

function incomingFamilies(car: CazooIdentityCar): string[] {
  return observedCazooPhotoFamilies([...car.images.map(image => image.url), ...(car.heroImage ? [car.heroImage] : [])]);
}

function existingFamilies(car: CazooExistingVehicle): string[] {
  // Manual photos are not trusted aliases for official stock identity.
  const urls = (car.images ?? []).filter(image => image.origin !== "manual").map(image => image.url);
  const raw = object(car.rawSourceData);
  if (typeof raw.heroImage === "string") urls.push(raw.heroImage);
  if (car.sourceHeroImage) urls.push(car.sourceHeroImage);
  if (Array.isArray(raw.images)) {
    for (const image of raw.images) if (typeof object(image).url === "string") urls.push(object(image).url as string);
  }
  return observedCazooPhotoFamilies(urls);
}

function corroborates(incoming: CazooIdentityCar, existing: CazooExistingVehicle): boolean {
  return Boolean(normalizedFact(incoming.make) && normalizedFact(incoming.model) && Number.isInteger(incoming.year)) &&
    normalizedFact(incoming.make) === normalizedFact(existing.make) &&
    normalizedFact(incoming.model) === normalizedFact(existing.model) && incoming.year === existing.year;
}

function contradicts(incoming: CazooIdentityCar, existing: CazooExistingVehicle): boolean {
  return (["make", "model"] as const).some(key => Boolean(normalizedFact(incoming[key]) && normalizedFact(existing[key])) && normalizedFact(incoming[key]) !== normalizedFact(existing[key])) ||
    (incoming.year != null && existing.year != null && incoming.year !== existing.year);
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(",")}}`;
  return JSON.stringify(value ?? null);
}

function catalogueChanges(car: CazooIdentityCar, existing: CazooExistingVehicle): CazooIdentityMatch["catalogueChanges"] {
  const raw = object(existing.rawSourceData), next = car as unknown as Record<string, unknown>;
  return factFields.flatMap(field => {
    if (!Object.hasOwn(next, field)) return [];
    const databaseField = field === "price" ? "sourcePrice" : field === "heroImage" ? "sourceHeroImage" : field;
    const before = Object.hasOwn(existing, databaseField) ? existing[databaseField] : raw[field] ?? null;
    const after = next[field];
    return canonical(before) === canonical(after) ? [] : [{ field, before: structuredClone(before ?? null), after: structuredClone(after ?? null) }];
  });
}

/**
 * A complete inventory (including hidden, sold, archived and missing records) is
 * mandatory for a candidate. A public-only inventory may be inspected, but can
 * never establish that an apparently new feed vehicle is safe to create.
 */
export function planCazooReconciliation<C extends CazooIdentityCar>(input: {
  dealerId: string;
  inventoryIncludesAllStatuses: boolean;
  incoming: readonly C[];
  existing: readonly CazooExistingVehicle[];
}): CazooReconciliationPlan<C> {
  const issues: CazooReconciliationIssue[] = [];
  const issueKeys = new Set<string>();
  const addIssue = (code: string, message: string, incomingVehicleId?: string, records?: readonly CazooExistingVehicle[]) => {
    const existingVehicleIds = records ? [...new Set(records.map(record => record.id))].sort() : undefined;
    const key = `${code}:${incomingVehicleId ?? ""}:${existingVehicleIds?.join(",") ?? ""}`;
    if (issueKeys.has(key)) return;
    issueKeys.add(key);
    issues.push({ code, message, ...(incomingVehicleId ? { incomingVehicleId } : {}), ...(existingVehicleIds ? { existingVehicleIds } : {}) });
  };
  if (!input.dealerId.trim()) addIssue("dealer_required", "A dealership identity is required.");
  if (!input.inventoryIncludesAllStatuses) addIssue("incomplete_inventory", "Full dealer inventory, including hidden, sold, archived and missing vehicles, is required before a candidate can be prepared.");
  const scoped = input.existing.filter(record => record.dealerId === input.dealerId && record.source === "cazoo");
  type Index = Map<string, CazooExistingVehicle[]>;
  const byIdentity: Index = new Map(), byPhoto: Index = new Map(), byRegistration: Index = new Map(), byUuid: Index = new Map();
  const index = (map: Index, key: string, record: CazooExistingVehicle) => {
    const items = map.get(key) ?? [];
    if (!items.some(item => item.id === record.id)) items.push(record);
    map.set(key, items);
  };
  for (const record of scoped) {
    if (!record.id.trim() || !record.advertId.trim() || !inventoryStatuses.has(record.inventoryStatus)) addIssue("invalid_existing_identity", "Existing inventory identity or inventory status is incomplete.", undefined, [record]);
    // UUID duplicates must not be hidden by the alias index's record deduplication.
    const sameUuid = byUuid.get(record.id) ?? [];
    sameUuid.push(record); byUuid.set(record.id, sameUuid);
    index(byIdentity, record.advertId, record);
    if (record.officialCazooVehicleId) {
      if (!/^AETV\d+$/.test(record.officialCazooVehicleId)) addIssue("invalid_official_alias", "A stored official-feed alias is malformed.", undefined, [record]);
      index(byIdentity, record.officialCazooVehicleId, record);
    }
    const photos = existingFamilies(record);
    if (photos.length > 1) addIssue("mixed_existing_photo_identity", "Existing source photographs contain more than one official vehicle identity.", undefined, [record]);
    for (const family of photos) index(byPhoto, family, record);
    const registrations = registrationAliases(record);
    if (registrations.length > 1) addIssue("conflicting_existing_registrations", "Existing plate fields disagree.", undefined, [record]);
    for (const value of registrations) index(byRegistration, value, record);
  }
  for (const records of byUuid.values()) if (records.length > 1) addIssue("duplicate_inventory_record", "An inventory UUID occurs more than once.", undefined, records);
  for (const records of byIdentity.values()) if (records.length > 1) addIssue("duplicate_official_identity", "More than one inventory record claims the same advert ID or official-feed alias.", undefined, records);
  for (const records of byPhoto.values()) if (records.length > 1) addIssue("duplicate_photo_identity", "More than one inventory record claims the same observed source-photo identity.", undefined, records);

  const incomingIds = new Set<string>(), incomingPhotos = new Map<string, string>(), incomingRegistrations = new Map<string, string>();
  const matches: CazooIdentityMatch[] = [], creates: CazooReconciliationPlan<C>["creates"] = [];
  const claimed = new Map<string, string>();
  for (const [incomingIndex, car] of input.incoming.entries()) {
    const officialId = car.advertId;
    const forbiddenFields = ["id", "dealerId", "source", "inventoryStatus", "sourceStatus", "archivedAt", "auditMetadata", ...overrideFields];
    if (forbiddenFields.some(field => Object.hasOwn(car, field))) addIssue("business_state_in_candidate", "An incoming catalogue record contains inventory or staff-override state and cannot be used as a normalized import candidate.", officialId);
    if (!/^AETV\d+$/.test(officialId)) addIssue("invalid_incoming_identity", "An official CSV vehicle must have its supplied AETV identity.", officialId);
    if (incomingIds.has(officialId)) addIssue("duplicate_incoming_identity", "The feed contains the same official vehicle ID more than once.", officialId);
    incomingIds.add(officialId);
    const photos = incomingFamilies(car), registrations = registrationAliases(car);
    if (photos.length > 1) addIssue("mixed_incoming_photo_identity", "A feed vehicle's photographs contain more than one official vehicle identity.", officialId);
    if (photos.some(family => family.split("/")[1] !== officialId)) addIssue("incoming_photo_id_conflict", "A feed photograph's observed vehicle identity disagrees with its CSV Vehicle_ID.", officialId);
    if (registrations.length > 1) addIssue("conflicting_incoming_registrations", "A feed vehicle's plate fields disagree.", officialId);
    for (const family of photos) {
      if (incomingPhotos.has(family) && incomingPhotos.get(family) !== officialId) addIssue("duplicate_incoming_photo_identity", "Two feed vehicles claim the same observed photo identity.", officialId);
      incomingPhotos.set(family, officialId);
    }
    for (const value of registrations) {
      if (incomingRegistrations.has(value) && incomingRegistrations.get(value) !== officialId) addIssue("duplicate_incoming_registration", "Two feed vehicles claim the same registration.", officialId);
      incomingRegistrations.set(value, officialId);
    }
    const direct = byIdentity.get(officialId) ?? [];
    const photoMatches = [...new Map(photos.flatMap(family => byPhoto.get(family) ?? []).map(record => [record.id, record])).values()];
    const registrationMatches = [...new Map(registrations.flatMap(value => byRegistration.get(value) ?? []).map(record => [record.id, record])).values()];
    if (direct.length > 1 || photoMatches.length > 1 || registrationMatches.length > 1) {
      addIssue("ambiguous_identity", "Identity evidence matches multiple existing vehicles; a manual reconciliation is required.", officialId, [...direct, ...photoMatches, ...registrationMatches]);
      continue;
    }
    const evidence = [...new Map([...direct, ...photoMatches, ...registrationMatches].map(record => [record.id, record])).values()];
    if (evidence.length > 1) {
      addIssue("conflicting_identity_evidence", "Official ID, photographs or registration point to different existing vehicles.", officialId, evidence);
      continue;
    }
    const matched = evidence[0];
    if (!matched) { creates.push({ incomingIndex, officialVehicleId: officialId, advertId: officialId }); continue; }
    const method: CazooIdentityMethod = direct.length ? "official_id" : photoMatches.length ? "photo_identity" : "registration";
    const oldRegistrations = registrationAliases(matched), oldPhotos = existingFamilies(matched);
    if (registrations.length && oldRegistrations.length && !registrations.some(value => oldRegistrations.includes(value))) {
      addIssue("registration_conflict", "The proposed match has a different registration; it cannot be merged automatically.", officialId, [matched]); continue;
    }
    if (method === "registration" && photos.length && oldPhotos.length && !photos.some(family => oldPhotos.includes(family))) {
      addIssue("photo_identity_conflict", "The registration match has a conflicting observed source-photo identity.", officialId, [matched]); continue;
    }
    if (contradicts(car, matched) || (method !== "official_id" && !corroborates(car, matched))) {
      addIssue("vehicle_facts_conflict", "Make, model and year do not corroborate the proposed identity match.", officialId, [matched]); continue;
    }
    if (claimed.has(matched.id)) {
      addIssue("existing_vehicle_claimed_twice", "Two feed records would update the same existing vehicle.", officialId, [matched]); continue;
    }
    claimed.set(matched.id, officialId);
    matches.push({ incomingIndex, officialVehicleId: officialId, vehicleId: matched.id, advertId: matched.advertId, method, preserveInventoryStatus: matched.inventoryStatus,
      identityAliasToRecord: { vehicleId: matched.id, officialCazooVehicleId: officialId }, catalogueChanges: catalogueChanges(car, matched) });
  }
  const protectedRecord = (record: CazooExistingVehicle) => terminalStatuses.has(record.inventoryStatus) || record.archivedAt != null;
  const missing: CazooReconciliationPlan<C>["missing"] = scoped.filter(record => !claimed.has(record.id)).map(record => ({ vehicleId: record.id, advertId: record.advertId, inventoryStatus: record.inventoryStatus,
    action: protectedRecord(record) ? "preserve_protected_record" : record.sourceStatus === "missing" ? "remain_missing" : "mark_source_missing" }));
  const protectedTerminals = scoped.filter(protectedRecord).map(record => ({ vehicleId: record.id, advertId: record.advertId, inventoryStatus: record.inventoryStatus, includedInFeed: claimed.has(record.id) }));
  const overrideCleanup: CazooReconciliationPlan<C>["overrideCleanup"] = matches.flatMap(match => {
    const record = scoped.find(item => item.id === match.vehicleId)!;
    const clearFields = overrideFields.filter(field => record[field] != null);
    const clearPlateCorrection = Object.hasOwn(record.auditMetadata ?? {}, "plateCorrection");
    const deactivateManualPhotoIds = (record.images ?? []).filter(image => image.origin === "manual" && image.isActive !== false && image.id).map(image => image.id!);
    return clearFields.length || clearPlateCorrection || deactivateManualPhotoIds.length ? [{ vehicleId: record.id, clearFields, clearPlateCorrection, deactivateManualPhotoIds }] : [];
  });
  const advertByIndex = new Map(matches.map(match => [match.incomingIndex, match.advertId]));
  return { status: issues.length ? "blocked" : "preview_ready", dealerId: input.dealerId, source: "cazoo", inventoryIncludesAllStatuses: input.inventoryIncludesAllStatuses,
    ignoredInventoryCount: input.existing.length - scoped.length, issues, matches, creates, missing, protectedTerminals, overrideCleanup,
    candidateCars: issues.length ? null : input.incoming.map((car, index) => ({ ...structuredClone(car), advertId: advertByIndex.get(index) ?? car.advertId })) };
}
