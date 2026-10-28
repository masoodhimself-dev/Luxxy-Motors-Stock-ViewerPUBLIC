import { isUKNumberPlate } from "@workspace/vehicle-meta";
import type { MotHistory, MotTest } from "@workspace/vehicle-meta";

export class MotError extends Error {
  constructor(
    public code:
      | "invalid_registration"
      | "not_found"
      | "unavailable"
      | "not_configured"
      | "busy",
    message: string,
    public status = 503,
  ) {
    super(message);
  }
}
export function normaliseMotRegistration(value: string): string {
  if (value.length > 20 || !isUKNumberPlate(value))
    throw new MotError(
      "invalid_registration",
      "Enter a complete UK registration number.",
      400,
    );
  return value.toUpperCase().replace(/[\s-]/g, "");
}
const text = (value: unknown, max = 500): string | null =>
  typeof value === "string" && value.trim() ? value.trim().slice(0, max) : null;
const date = (value: unknown): string | null =>
  typeof value === "string" &&
  /^\d{4}-\d{2}-\d{2}(?:T| |$)/.test(value) &&
  Number.isFinite(Date.parse(value))
    ? value
    : null;
export function normaliseMotHistory(
  raw: unknown,
  registration: string,
  checkedAt: string,
): MotHistory {
  if (!raw || typeof raw !== "object" || Array.isArray(raw))
    throw new MotError(
      "unavailable",
      "MOT history is temporarily unavailable. Please try again later.",
    );
  const record = raw as Record<string, unknown>;
  if (
    typeof record.registration !== "string" ||
    normaliseMotRegistration(record.registration) !== registration ||
    !Array.isArray(record.motTests) ||
    record.motTests.length > 500
  )
    throw new MotError(
      "unavailable",
      "MOT history could not be verified. Please try again later.",
    );
  const tests: MotTest[] = record.motTests
    .map((value: unknown) => {
      if (!value || typeof value !== "object")
        throw new MotError(
          "unavailable",
          "MOT history is temporarily unavailable.",
        );
      const test = value as Record<string, unknown>,
        completedDate = date(test.completedDate);
      if (
        !completedDate ||
        !["PASSED", "FAILED"].includes(String(test.testResult))
      )
        throw new MotError("unavailable", "MOT history could not be verified.");
      return {
        completedDate,
        result: test.testResult as MotTest["result"],
        expiryDate: date(test.expiryDate),
        mileage:
          test.odometerResultType === "READ" &&
          /^\d+(?:\.\d+)?$/.test(String(test.odometerValue))
            ? String(test.odometerValue).slice(0, 12)
            : null,
        mileageUnit: ["MI", "KM"].includes(
          String(test.odometerUnit).toUpperCase(),
        )
          ? (String(test.odometerUnit).toUpperCase() as "MI" | "KM")
          : null,
        defects: Array.isArray(test.defects)
          ? test.defects.slice(0, 200).flatMap((value: unknown) => {
              if (!value || typeof value !== "object") return [];
              const defect = value as Record<string, unknown>,
                wording = text(defect.text, 2000);
              return wording
                ? [
                    {
                      text: wording,
                      type: text(defect.type, 40) ?? "RECORDED",
                      dangerous: defect.dangerous === true,
                    },
                  ]
                : [];
            })
          : [],
      };
    })
    .sort((a, b) => Date.parse(b.completedDate) - Date.parse(a.completedDate));
  return {
    registration,
    make: text(record.make, 100),
    model: text(record.model, 100),
    checkedAt,
    recall: ["Yes", "No", "Unknown", "Unavailable"].includes(
      String(record.hasOutstandingRecall),
    )
      ? (record.hasOutstandingRecall as MotHistory["recall"])
      : "Unknown",
    tests,
  };
}
export interface MotCache {
  read(registration: string): Promise<MotHistory | null>;
  write(record: MotHistory): Promise<void>;
}
export interface MotCredentials {
  clientId: string;
  clientSecret: string;
  apiKey: string;
  tokenUrl: string;
}
export function createMotService(options: {
  credentials: () => MotCredentials | null;
  transport?: typeof fetch;
  cache?: MotCache;
  now?: () => number;
  timeoutMs?: number;
  reserve?: () => Promise<boolean>;
}) {
  const transport = options.transport ?? fetch,
    now = options.now ?? Date.now;
  const memory = new Map<
      string,
      { expires: number; value?: MotHistory; error?: MotError }
    >(),
    pending = new Map<string, Promise<MotHistory>>();
  let token: { value: string; expires: number } | null = null,
    tokenWork: Promise<string> | null = null,
    cooldown = 0;
  function remember(
    registration: string,
    entry: { expires: number; value?: MotHistory; error?: MotError },
  ) {
    if (memory.size >= 500) memory.delete(memory.keys().next().value!);
    memory.set(registration, entry);
  }
  async function request(url: string, init: RequestInit) {
    const controller = new AbortController(),
      timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 8000);
    try {
      const response = await transport(url, {
        ...init,
        redirect: "error",
        signal: controller.signal,
      });
      const body = response.ok ? await response.json() : null;
      return { status: response.status, body };
    } finally {
      clearTimeout(timer);
    }
  }
  async function accessToken(credentials: MotCredentials): Promise<string> {
    if (token && token.expires > now()) return token.value;
    if (tokenWork) return tokenWork;
    tokenWork = (async () => {
      // Fixed Microsoft issuer shape prevents a misconfigured credential destination.
      if (
        !/^https:\/\/login\.microsoftonline\.com\/[0-9a-f-]{36}\/oauth2\/v2\.0\/token$/i.test(
          credentials.tokenUrl,
        )
      )
        throw new MotError(
          "not_configured",
          "MOT history is not connected yet.",
        );
      const result = await request(credentials.tokenUrl, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "client_credentials",
          client_id: credentials.clientId,
          client_secret: credentials.clientSecret,
          scope: "https://tapi.dvsa.gov.uk/.default",
        }),
      });
      const body = result.body as {
        access_token?: unknown;
        expires_in?: unknown;
      } | null;
      if (
        result.status !== 200 ||
        typeof body?.access_token !== "string" ||
        !Number.isFinite(Number(body.expires_in)) ||
        Number(body.expires_in) <= 60
      )
        throw new MotError(
          "unavailable",
          "MOT history is temporarily unavailable. Please try again later.",
        );
      token = {
        value: body.access_token,
        expires: now() + Math.min(Number(body.expires_in) - 60, 3540) * 1000,
      };
      return token.value;
    })();
    try {
      return await tokenWork;
    } finally {
      tokenWork = null;
    }
  }
  async function lookup(value: string): Promise<MotHistory> {
    const registration = normaliseMotRegistration(value),
      cached = memory.get(registration);
    if (cached && cached.expires > now()) {
      if (cached.error) throw cached.error;
      return cached.value!;
    }
    if (pending.has(registration)) return pending.get(registration)!;
    if (pending.size >= 4 || cooldown > now())
      throw new MotError(
        "busy",
        "MOT checks are temporarily busy. Please try again shortly.",
      );
    const work = (async () => {
      try {
        let stored: MotHistory | null = null;
        try {
          stored = (await options.cache?.read(registration)) ?? null;
        } catch {
          /* Provider access still requires the durable quota reservation. */
        }
        if (
          stored &&
          stored.registration === registration &&
          Date.parse(stored.checkedAt) <= now() &&
          Date.parse(stored.checkedAt) > now() - 86400000
        ) {
          remember(registration, {
            expires: Date.parse(stored.checkedAt) + 86400000,
            value: stored,
          });
          return stored;
        }
        const credentials = options.credentials();
        if (!credentials)
          throw new MotError(
            "not_configured",
            "MOT history is not connected yet. Please ask the dealership.",
          );
        let result: { status: number; body: unknown } | undefined;
        for (let attempt = 0; attempt < 2; attempt++) {
          const bearer = await accessToken(credentials);
          if (options.reserve && !(await options.reserve()))
            throw new MotError(
              "busy",
              "MOT checks are temporarily busy. Please try again shortly.",
            );
          result = await request(
            `https://history.mot.api.gov.uk/v1/trade/vehicles/registration/${encodeURIComponent(registration)}`,
            {
              headers: {
                Authorization: `Bearer ${bearer}`,
                "X-API-Key": credentials.apiKey,
                Accept: "application/json",
              },
            },
          );
          if (result.status !== 401 || attempt === 1) break;
          token = null;
        }
        if (result!.status === 404)
          throw new MotError(
            "not_found",
            "No MOT history was found for this registration. This does not confirm exemption.",
            404,
          );
        if (result!.status !== 200)
          throw new MotError(
            "unavailable",
            "MOT history is temporarily unavailable. Please try again later.",
          );
        const record = normaliseMotHistory(
          result!.body,
          registration,
          new Date(now()).toISOString(),
        );
        try {
          await options.cache?.write(record);
        } catch {
          /* A cache write failure must not discard a verified response. */
        }
        remember(registration, { expires: now() + 86400000, value: record });
        return record;
      } catch (cause) {
        const error =
          cause instanceof MotError
            ? cause
            : new MotError(
                "unavailable",
                "MOT history is temporarily unavailable. Please try again later.",
              );
        if (error.code !== "not_found") cooldown = now() + 30000;
        remember(registration, {
          expires: now() + (error.code === "not_found" ? 900000 : 30000),
          error,
        });
        throw error;
      }
    })();
    pending.set(registration, work);
    try {
      return await work;
    } finally {
      pending.delete(registration);
    }
  }
  return { lookup };
}
