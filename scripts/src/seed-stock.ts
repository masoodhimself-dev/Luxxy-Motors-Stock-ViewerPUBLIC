import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

const [fileArgument, originArgument] = process.argv.slice(2);

if (!fileArgument || !originArgument) {
  throw new Error(
    "Usage: pnpm --filter @workspace/scripts seed:stock -- <full-stock.json> <origin>",
  );
}

const importSecret = process.env.STOCK_IMPORT_SECRET;
const retailerId = process.env.STOCK_RETAILER_ID;

if (!importSecret) {
  throw new Error("STOCK_IMPORT_SECRET must be configured");
}

if (!retailerId) {
  throw new Error("STOCK_RETAILER_ID must be configured");
}

const filePath = path.resolve(fileArgument);
const raw = await readFile(filePath, "utf8");
const parsed: unknown = JSON.parse(raw);

if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
  throw new Error("Expected a wrapped stock object");
}

const stock = parsed as Record<string, unknown>;
if (!Array.isArray(stock.cars) || stock.cars.length === 0) {
  throw new Error('Expected a non-empty "cars" array');
}

const nullableFields = [
  "title",
  "variant",
  "make",
  "model",
  "trim",
  "year",
  "price",
  "priceType",
  "currency",
  "mileage",
  "mileageText",
  "registration",
  "registrationBand",
  "plate",
  "vrm",
  "vrmVerified",
  "fuel",
  "transmission",
  "bodyType",
  "engineSize",
  "engineCC",
  "doors",
  "seats",
  "colour",
  "emissionClass",
  "drivetrain",
  "owners",
  "writeOffCategory",
  "advertUrl",
  "dealerName",
  "dealerLocation",
  "imageCount",
  "heroImage",
  "specifications",
] as const;
const originalScrapedAt =
  typeof stock.scrapedAt === "string" ? stock.scrapedAt : null;

function nullableInteger(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.trunc(value);
  }
  if (typeof value === "string") {
    const parsed = Number(value.replace(/[^\d.-]/g, ""));
    return Number.isFinite(parsed) ? Math.trunc(parsed) : null;
  }
  return null;
}

function writeOffCategory(value: unknown): "S" | "N" | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toUpperCase();
  if (normalized === "S" || /\bCAT(?:EGORY)?\s*S\b/.test(normalized)) return "S";
  if (normalized === "N" || /\bCAT(?:EGORY)?\s*N\b/.test(normalized)) return "N";
  return null;
}

const cars = stock.cars.map((candidate, index) => {
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
    throw new Error(`cars[${index}] must be an object`);
  }

  const source = candidate as Record<string, unknown>;
  if (typeof source.advertId !== "string" || !source.advertId.trim()) {
    throw new Error(`cars[${index}].advertId is required`);
  }

  const normalized: Record<string, unknown> = {
    advertId: source.advertId,
    images: Array.isArray(source.images)
      ? source.images.map((image) =>
          typeof image === "string"
            ? { url: image, caption: null }
            : {
                url:
                  image && typeof image === "object"
                    ? ((image as Record<string, unknown>).url ?? "")
                    : "",
                caption:
                  image && typeof image === "object"
                    ? ((image as Record<string, unknown>).caption ?? null)
                    : null,
              },
        )
      : [],
    sourceExtras: {
      ...source,
      baselineOriginalScrapedAt: originalScrapedAt,
    },
  };

  for (const field of nullableFields) {
    normalized[field] = source[field] ?? null;
  }
  for (const field of [
    "year",
    "price",
    "mileage",
    "engineCC",
    "doors",
    "seats",
    "owners",
    "imageCount",
  ] as const) {
    normalized[field] = nullableInteger(source[field]);
  }
  normalized.writeOffCategory = writeOffCategory(source.writeOffCategory);
  normalized.vrmVerified =
    typeof source.vrmVerified === "boolean" ? source.vrmVerified : null;

  return normalized;
});

const runHash = createHash("sha256").update(raw).digest("hex").slice(0, 24);
const payload = {
  schemaVersion: 1,
  runId: `baseline-${runHash}`,
  source: "autotrader",
  retailerId,
  dealerName:
    typeof stock.dealerName === "string" ? stock.dealerName : "Luxxy Motors",
  // A baseline is received now, even when the source export was archived. The
  // source timestamp is retained verbatim in each raw source record above.
  scrapedAt: new Date().toISOString(),
  complete: true,
  expectedAdvertCount: cars.length,
  count: cars.length,
  failedAdvertIds: [],
  errors: [],
  cars,
};

const origin = originArgument.replace(/\/+$/, "");
const response = await fetch(`${origin}/api/stock/imports/autotrader`, {
  method: "POST",
  headers: {
    "content-type": "application/json",
    "x-stock-import-secret": importSecret,
  },
  body: JSON.stringify(payload),
});

const responseText = await response.text();
if (!response.ok) {
  throw new Error(`Baseline import failed (${response.status}): ${responseText}`);
}

console.info(
  `Baseline import accepted (${response.status}) for ${cars.length} vehicles.`,
);