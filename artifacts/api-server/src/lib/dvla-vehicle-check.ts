import { isUKNumberPlate, stockTaxStatuses } from "@workspace/vehicle-meta";
import { z } from "zod/v4";

const vehicleEnquiryUrl = "https://driver-vehicle-licensing.api.gov.uk/vehicle-enquiry/v1/vehicles";
const minimumRequestIntervalMs = 500;
const maximumResponseBytes = 16 * 1024;
const providerRetryDefaultSeconds = 30;

export class DvlaVehicleCheckError extends Error {
  constructor(
    readonly code: "invalid_registration" | "not_found" | "busy" | "not_configured" | "unavailable",
    message: string,
    readonly status: number,
    readonly retryAfter?: number,
  ) {
    super(message);
  }
}

const unavailable = () => new DvlaVehicleCheckError("unavailable", "DVLA vehicle checks are temporarily unavailable. Try again later.", 503);
const busy = (retryAfter: number) => new DvlaVehicleCheckError("busy", "DVLA vehicle checks are busy. Try again shortly.", 429, retryAfter);
export const invalidDvlaRegistration = () => new DvlaVehicleCheckError("invalid_registration", "Enter a complete UK registration number.", 400);

function registrationNumber(value: string) {
  if (value.length > 20 || !isUKNumberPlate(value)) throw invalidDvlaRegistration();
  return value.toUpperCase().replace(/[\s-]/g, "");
}

const optionalText = z.string().trim().min(1).max(100).regex(/^[^\p{Cc}\p{Cf}]+$/u).optional().catch(undefined);
const optionalDate = z.iso.date().optional().catch(undefined);
const optionalMeasure = z.number().int().min(0).max(2_147_483_647).optional().catch(undefined);
const optionalFlag = z.boolean().optional().catch(undefined);
const vehicleRecord = z.object({
  registrationNumber: z.string().max(20),
  make: optionalText,
  colour: optionalText,
  fuelType: optionalText,
  yearOfManufacture: z.number().int().min(1886).max(2200).optional().catch(undefined),
  engineCapacity: optionalMeasure,
  co2Emissions: optionalMeasure,
  euroStatus: optionalText,
  taxStatus: z.enum(stockTaxStatuses).optional().catch(undefined),
  taxDueDate: optionalDate,
  dateOfLastV5CIssued: optionalDate,
  motStatus: z.enum(["No details held by DVLA", "No results returned", "Valid", "Not valid"]).optional().catch(undefined),
  motExpiry: optionalDate,
  markedAsScrapped: optionalFlag,
  markedForExport: optionalFlag,
});

function retryAfterSeconds(value: string | null, now: number) {
  const raw = value?.trim() ?? "";
  const seconds = /^\d+$/.test(raw) ? Number(raw) : (Date.parse(raw) - now) / 1000;
  return Number.isFinite(seconds) ? Math.max(1, Math.min(120, Math.ceil(seconds))) : providerRetryDefaultSeconds;
}

async function readVehicleRecord(response: Response): Promise<unknown> {
  const reader = response.body?.getReader();
  if (!reader) throw unavailable();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.length;
      if (length > maximumResponseBytes) throw unavailable();
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } finally {
    await reader.cancel().catch(() => {});
  }
}

export function createDvlaVehicleCheck(options: {
  apiKey: () => string | undefined;
  transport?: typeof fetch;
  now?: () => number;
  timeoutMs?: number;
}) {
  const transport = options.transport ?? fetch;
  const now = options.now ?? Date.now;
  let nextRequestAt = -Infinity;

  return async function lookup(value: string) {
    const registration = registrationNumber(value);
    const apiKey = options.apiKey()?.trim();
    if (!apiKey) throw new DvlaVehicleCheckError("not_configured", "DVLA vehicle checks are not connected yet.", 503);
    const startAt = now();
    if (startAt < nextRequestAt) throw busy(Math.ceil((nextRequestAt - startAt) / 1000));
    nextRequestAt = startAt + minimumRequestIntervalMs;

    try {
      const response = await transport(vehicleEnquiryUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json", "x-api-key": apiKey },
        body: JSON.stringify({ registrationNumber: registration }),
        redirect: "error",
        signal: AbortSignal.timeout(options.timeoutMs ?? 5000),
      });
      if (!response.ok) {
        await response.body?.cancel().catch(() => {});
        if (response.status === 404)
          throw new DvlaVehicleCheckError("not_found", "DVLA could not find a vehicle with that registration.", 404);
        if (response.status === 429) {
          const retryAfter = retryAfterSeconds(response.headers.get("Retry-After"), now());
          nextRequestAt = Math.max(nextRequestAt, now() + retryAfter * 1000);
          throw busy(retryAfter);
        }
        throw unavailable();
      }
      const parsed = vehicleRecord.safeParse(await readVehicleRecord(response));
      if (!parsed.success || parsed.data.registrationNumber !== registration) throw unavailable();
      const { registrationNumber: _, ...details } = parsed.data;
      return { registration, checkedAt: new Date(now()).toISOString(), ...details };
    } catch (error) {
      if (error instanceof DvlaVehicleCheckError) throw error;
      throw unavailable();
    }
  };
}

// One credential and request allowance are shared by every dealership in this web process.
export const lookupDvlaVehicle = createDvlaVehicleCheck({ apiKey: () => process.env.DVLA_VES_API_KEY });
