import { createHash } from "node:crypto";

/** Stable JSON for idempotency: JSONB does not preserve object insertion order. */
export function canonicalJson(value: unknown): string {
  if (value === null) return "null";
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).filter(key => record[key] !== undefined).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`;
  }
  if (typeof value === "number" && !Number.isFinite(value)) return "null";
  if (typeof value === "undefined") return "null";
  return JSON.stringify(value);
}

export const stockPayloadHash = (value: unknown) => createHash("sha256").update(canonicalJson(value)).digest("hex");

/** Legacy full snapshots remain replayable before the opt-in retention backfill. */
export function retainedStockPayloadHash(run: { payloadHash?: string | null; rawSnapshot: unknown; rawSnapshotCompactedAt?: Date | null }): string | null {
  if (run.payloadHash && /^[a-f0-9]{64}$/.test(run.payloadHash)) return run.payloadHash;
  if (run.rawSnapshotCompactedAt || run.rawSnapshot == null) return null;
  return stockPayloadHash(run.rawSnapshot);
}
