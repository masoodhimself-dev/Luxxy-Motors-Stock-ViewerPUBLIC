/** Collector bookkeeping is not a change to the advertised vehicle. Keep this
 * explicit: descriptions, features, provenance and unknown extras remain facts. */
const checkKeys = new Set([
  "lastCheckedAt",
  "detailCheckedAt",
  "detailFetchedAt",
  "detailFreshness",
  "detailSource",
  "imagesLastCheckedAt",
  "lastImageCheckedAt",
]);
export function stockSourceData(value: unknown): {
  facts: Record<string, unknown>;
  checks: Record<string, unknown>;
} {
  const facts =
    value && typeof value === "object" && !Array.isArray(value)
      ? { ...(value as Record<string, unknown>) }
      : {};
  const checks: Record<string, unknown> = {};
  const extras = facts.sourceExtras;
  if (extras && typeof extras === "object" && !Array.isArray(extras)) {
    const meaningful = { ...(extras as Record<string, unknown>) };
    for (const key of checkKeys)
      if (Object.hasOwn(meaningful, key)) {
        checks[key] = meaningful[key];
        delete meaningful[key];
      }
    facts.sourceExtras = Object.keys(meaningful).length ? meaningful : null;
  }
  return { facts, checks };
}
/** Retain truthful check metadata in the public projection without rewriting
 * the much larger vehicle facts/gallery JSON on each successful source check. */
export function projectedStockSourceData(
  raw: unknown,
  audit: Record<string, unknown> | null,
): Record<string, unknown> {
  const { facts, checks } = stockSourceData(raw);
  const latest =
    audit && Object.hasOwn(audit, "sourceCheckMetadata")
      ? audit.sourceCheckMetadata
      : checks;
  if (
    latest &&
    typeof latest === "object" &&
    !Array.isArray(latest) &&
    Object.keys(latest).length
  ) {
    facts.sourceExtras = {
      ...((facts.sourceExtras as Record<string, unknown>) ?? {}),
      ...latest,
    };
  }
  return facts;
}
