import { createHash, randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { currentDealerId, currentTenant } from "./tenant-context";
import {
  AiDraftError,
  AiProviderError,
  aiDraftModel,
  aiDraftRequest,
  aiDraftReservedMicroUsd,
  createAiDraftProvider,
  type AiDraftInput,
  type AiDraftProvider,
  type AiSuggestion,
} from "./ai-draft-provider";
export { AiDraftError } from "./ai-draft-provider";

type Executor = Pick<typeof db, "execute">;
export const aiDraftLimits = {
  daily: 20,
  monthly: 500,
  dealerMonthlyMicroUsd: 2_000_000,
  globalMonthlyMicroUsd: 10_000_000,
} as const;
export function aiDraftFeature() {
  const dealers = (process.env.AI_DRAFTS_DEALER_IDS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const enabled =
    process.env.AI_DRAFTS_ENABLED === "true" &&
    dealers.includes(currentDealerId()) &&
    !currentTenant()?.demo;
  const configured = Boolean(process.env.OPENAI_API_KEY?.trim());
  return { enabled, configured, available: enabled && configured };
}
export function aiDraftPeriod(now = new Date()) {
  const date = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
  return { day: date, month: date.slice(0, 7) };
}
async function scrubExpiredResults(executor: Executor) {
  // Suggestions expire after a day. Keep accounting metadata even after a case is deleted.
  await executor.execute(
    sql`UPDATE staff_ai_draft_generations g SET result=NULL WHERE result IS NOT NULL AND (created_at<now()-interval '24 hours' OR NOT EXISTS(SELECT 1 FROM enquiries e WHERE e.id=g.enquiry_id AND e.dealer_id=g.dealer_id))`,
  );
}
async function usage(executor: Executor, dealer: string) {
  const period = aiDraftPeriod();
  const row = (
    await executor.execute(
      sql`SELECT count(*) FILTER(WHERE dealer_id=${dealer} AND day_key=${period.day})::int AS daily,count(*) FILTER(WHERE dealer_id=${dealer} AND month_key=${period.month})::int AS monthly,coalesce(sum(reserved_micro_usd) FILTER(WHERE dealer_id=${dealer} AND month_key=${period.month}),0)::int AS dealer_spend,coalesce(sum(reserved_micro_usd) FILTER(WHERE month_key=${period.month}),0)::int AS global_spend,count(*) FILTER(WHERE dealer_id=${dealer} AND status='reserved')::int AS in_flight FROM staff_ai_draft_generations WHERE month_key=${period.month} OR (dealer_id=${dealer} AND status='reserved')`,
    )
  ).rows[0]!;
  return {
    daily: Number(row.daily),
    monthly: Number(row.monthly),
    dealerSpend: Number(row.dealer_spend),
    globalSpend: Number(row.global_spend),
    inFlight: Number(row.in_flight),
  };
}
function quotaReason(value: Awaited<ReturnType<typeof usage>>) {
  if (value.daily >= aiDraftLimits.daily)
    return "Today’s AI draft limit has been reached. You can still write and send replies yourself.";
  if (
    value.monthly >= aiDraftLimits.monthly ||
    value.dealerSpend + aiDraftReservedMicroUsd >
      aiDraftLimits.dealerMonthlyMicroUsd
  )
    return "This dealership’s monthly AI limit has been reached. Manual replies are still available.";
  if (
    value.globalSpend + aiDraftReservedMicroUsd >
    aiDraftLimits.globalMonthlyMicroUsd
  )
    return "AI drafts have reached the platform’s monthly budget. Manual replies are still available.";
  return null;
}
export async function aiDraftConfig() {
  const feature = aiDraftFeature();
  const empty = {
    enabled: feature.enabled,
    available: false,
    reason: !feature.enabled
      ? "AI drafts are not enabled for this dealership."
      : "Your platform administrator needs to connect the AI service.",
    model: aiDraftModel,
    dailyLimit: aiDraftLimits.daily,
    monthlyLimit: aiDraftLimits.monthly,
    dailyUsed: 0,
    monthlyUsed: 0,
  };
  if (!feature.available) return empty;
  await scrubExpiredResults(db);
  const used = await usage(db, currentDealerId()),
    reason = quotaReason(used);
  return {
    ...empty,
    available: !reason,
    reason,
    dailyUsed: used.daily,
    monthlyUsed: used.monthly,
  };
}
const text = (value: unknown, maximum: number) =>
  typeof value === "string"
    ? value
        .replace(/[\u0000-\u001f\u007f]/g, " ")
        .trim()
        .slice(0, maximum)
    : "";
function redactMessage(message: string, contacts: unknown[]) {
  let safe = message;
  for (const value of contacts)
    if (typeof value === "string" && value.trim().length > 1)
      safe = safe.replace(
        new RegExp(value.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi"),
        "[customer]",
      );
  return safe
    .replace(/[^\s@]+@[^\s@]+\.[^\s@]+/g, "[email removed]")
    .replace(/https?:\/\/\S+|www\.\S+/gi, "[link removed]")
    .replace(/\+?\d[\d\s()./-]{5,}\d/g, "[phone removed]")
    .replace(
      /\b(?:my|our) (?:home |postal |delivery )?address(?: is|:)?.*$/gim,
      "[address removed]",
    );
}
async function context(
  executor: Executor,
  dealer: string,
  enquiryId: string,
  revision: number,
  draftVersion: number,
  lock = false,
) {
  const entry = (
    await executor.execute(
      sql`SELECT workspace_revision,appointment_revision,follow_up_revision,merged_into_id,type,message,customer_name,email,phone,vehicle_id FROM enquiries WHERE dealer_id=${dealer} AND id=${enquiryId}::uuid ${lock ? sql`FOR UPDATE` : sql``}`,
    )
  ).rows[0];
  if (!entry || entry.merged_into_id)
    throw new AiDraftError(
      "Enquiry not found or merged. Open the current customer record.",
      404,
    );
  if (Number(entry.workspace_revision) !== revision)
    throw new AiDraftError(
      "The enquiry changed. Reopen the email before generating a suggestion.",
      409,
    );
  const draft = (
    await executor.execute(
      sql`SELECT version,status FROM enquiry_email_drafts WHERE dealer_id=${dealer} AND enquiry_id=${enquiryId}::uuid`,
    )
  ).rows[0];
  if (
    Number(draft?.version ?? 0) !== draftVersion ||
    (draft && ["sending", "unknown"].includes(String(draft.status)))
  )
    throw new AiDraftError(
      "The draft changed or has an unresolved send. Reopen it and check email history.",
      409,
    );
  const configRow = (
    await executor.execute(
      sql`SELECT config FROM dealer_settings WHERE dealer_id=${dealer}`,
    )
  ).rows[0];
  const config = (configRow?.config ?? {}) as {
    identity?: { name?: unknown };
    address?: { city?: unknown };
    hours?: Array<{ days?: unknown; times?: unknown }>;
  };
  const registered = (
    await executor.execute(sql`SELECT name FROM dealerships WHERE id=${dealer}`)
  ).rows[0];
  const vehicle = entry.vehicle_id
    ? (
        await executor.execute(
          sql`SELECT title,website_title_override,year,source_price,website_price_override,mileage,fuel,transmission,body_type,engine_size,colour,inventory_status,source_status,source,missing_count,price_review_required,archived_at FROM vehicles WHERE dealer_id=${dealer} AND id=${String(entry.vehicle_id)}::uuid`,
        )
      ).rows[0]
    : null;
  const configuredThreshold = Number(process.env.STOCK_MISSING_HIDE_THRESHOLD),
    threshold = Number.isFinite(configuredThreshold) ? configuredThreshold : 2;
  const platform =
    currentTenant()?.platform ?? process.env.STOCK_PLATFORM ?? "autotrader";
  if (
    entry.vehicle_id &&
    (!vehicle ||
      !["available", "reserved"].includes(String(vehicle.inventory_status)) ||
      vehicle.archived_at != null ||
      vehicle.source !== platform ||
      Number(vehicle.missing_count) >= threshold ||
      (vehicle.price_review_required &&
        vehicle.source_price == null &&
        vehicle.website_price_override == null))
  )
    throw new AiDraftError(
      "This car’s published details are no longer available. Write the reply yourself or refresh the stock first.",
      409,
    );
  if (typeof entry.message !== "string" || entry.message.length > 4000)
    throw new AiDraftError(
      "This enquiry is too long for an AI suggestion. Write the reply yourself.",
    );
  const input: AiDraftInput = {
    enquiry: {
      type: text(entry.type, 30),
      message: redactMessage(entry.message, [
        entry.customer_name,
        entry.email,
        entry.phone,
      ]),
    },
    dealer: {
      name:
        text(config.identity?.name ?? registered?.name, 120) || "The showroom",
      town: text(config.address?.city, 80),
      openingHours: Array.isArray(config.hours)
        ? config.hours
            .slice(0, 7)
            .map((row) => ({
              days: text(row.days, 40),
              times: text(row.times, 80),
            }))
        : [],
    },
    vehicle: vehicle
      ? {
          title: text(vehicle.website_title_override || vehicle.title, 180),
          year: vehicle.year == null ? null : Number(vehicle.year),
          priceGbp:
            vehicle.website_price_override == null &&
            vehicle.source_price == null
              ? null
              : Number(vehicle.website_price_override ?? vehicle.source_price),
          mileage: vehicle.mileage == null ? null : Number(vehicle.mileage),
          fuel: text(vehicle.fuel, 40),
          transmission: text(vehicle.transmission, 40),
          bodyType: text(vehicle.body_type, 40),
          engineSize: text(vehicle.engine_size, 40),
          colour: text(vehicle.colour, 40),
          status:
            vehicle.source_status === "missing"
              ? "availability_unconfirmed"
              : text(vehicle.inventory_status, 20),
        }
      : null,
  };
  aiDraftRequest(input); // Validate the full UTF-8 request bound before reserving any budget.
  const factsHash = createHash("sha256")
    .update(
      JSON.stringify({
        input,
        originalMessageHash: createHash("sha256")
          .update(entry.message)
          .digest("hex"),
        revision: entry.workspace_revision,
        appointmentRevision: entry.appointment_revision,
        followUpRevision: entry.follow_up_revision,
        sourceStatus: vehicle?.source_status,
      }),
    )
    .digest("hex");
  return { input, factsHash };
}
export type GenerateAiDraftInput = {
  requestId: string;
  expectedRevision: number;
  expectedVersion: number;
};
type GenerationRow = {
  id: string;
  dealer_id: string;
  enquiry_id: string;
  auth_user_id: string;
  base_revision: number;
  base_draft_version: number;
  facts_hash: string;
  status: string;
  result: AiSuggestion | null;
  created_at: Date | string;
};
export async function generateAiDraft(
  enquiryId: string,
  actor: string,
  input: GenerateAiDraftInput,
  provider: AiDraftProvider = createAiDraftProvider(),
) {
  const dealer = currentDealerId(),
    feature = aiDraftFeature();
  if (!feature.enabled)
    throw new AiDraftError(
      "AI drafts are not enabled for this dealership.",
      403,
    );
  if (!feature.configured)
    throw new AiDraftError(
      "Your platform administrator needs to connect the AI service.",
      503,
    );
  const reservation = await db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtext('staff-ai-drafts:budget'))`,
    );
    await scrubExpiredResults(tx);
    await tx.execute(
      sql`UPDATE staff_ai_draft_generations SET status='unknown',finished_at=now(),failure_code='interrupted' WHERE status='reserved' AND created_at<now()-interval '2 minutes'`,
    );
    const existing = (
      await tx.execute(
        sql`SELECT * FROM staff_ai_draft_generations WHERE dealer_id=${dealer} AND request_id=${input.requestId}::uuid`,
      )
    ).rows[0] as GenerationRow | undefined;
    if (
      existing &&
      (existing.enquiry_id !== enquiryId ||
        existing.auth_user_id !== actor ||
        Number(existing.base_revision) !== input.expectedRevision ||
        Number(existing.base_draft_version) !== input.expectedVersion)
    )
      throw new AiDraftError(
        "This AI request was already used for another draft. Reopen the email.",
        409,
      );
    if (existing && existing.status !== "succeeded")
      throw new AiDraftError(
        existing.status === "reserved"
          ? "This suggestion is still being prepared. Wait a moment before checking again."
          : "That AI request did not finish safely. It will not be repeated automatically; write the reply yourself or start a new suggestion.",
        409,
      );
    const current = await context(
      tx,
      dealer,
      enquiryId,
      input.expectedRevision,
      input.expectedVersion,
      true,
    );
    if (existing) {
      if (
        existing.facts_hash !== current.factsHash ||
        Date.now() - new Date(existing.created_at).getTime() > 86400000
      )
        throw new AiDraftError(
          "The details changed or this suggestion expired. Generate a fresh suggestion.",
          409,
        );
      return { replay: { generationId: existing.id, ...existing.result! } };
    }
    const used = await usage(tx, dealer),
      reason = quotaReason(used);
    if (reason) throw new AiDraftError(reason, 429);
    if (used.inFlight >= 1)
      throw new AiDraftError(
        "Another AI draft is being prepared for this dealership. Please wait a moment.",
        429,
      );
    const id = randomUUID(),
      period = aiDraftPeriod();
    await tx.execute(
      sql`INSERT INTO staff_ai_draft_generations(id,dealer_id,enquiry_id,auth_user_id,request_id,base_revision,base_draft_version,facts_hash,model,reserved_micro_usd,day_key,month_key) VALUES(${id}::uuid,${dealer},${enquiryId}::uuid,${actor},${input.requestId}::uuid,${input.expectedRevision},${input.expectedVersion},${current.factsHash},${aiDraftModel},${aiDraftReservedMicroUsd},${period.day},${period.month})`,
    );
    return { id, ...current };
  });
  if ("replay" in reservation) return reservation.replay;
  let suggestion: AiSuggestion;
  try {
    suggestion = await provider(reservation.input!);
  } catch (error) {
    const uncertain = !(error instanceof AiProviderError) || error.uncertain;
    await db.execute(
      sql`UPDATE staff_ai_draft_generations SET status=${uncertain ? "unknown" : "failed"},finished_at=now(),failure_code=${uncertain ? "unconfirmed" : "unusable"} WHERE id=${reservation.id!}::uuid AND dealer_id=${dealer} AND status='reserved'`,
    );
    throw new AiDraftError(
      uncertain
        ? "The AI request could not be confirmed. We won’t repeat it automatically. Your original draft is unchanged."
        : "AI could not prepare a safe suggestion. Your original draft is unchanged; please write the reply yourself.",
      502,
    );
  }
  let stale = false;
  await db.transaction(async (tx) => {
    try {
      const current = await context(
        tx,
        dealer,
        enquiryId,
        input.expectedRevision,
        input.expectedVersion,
        true,
      );
      stale = current.factsHash !== reservation.factsHash;
    } catch (error) {
      if (!(error instanceof AiDraftError)) throw error;
      stale = true;
    }
    const changed = await tx.execute(
      sql`UPDATE staff_ai_draft_generations SET status=${stale ? "stale" : "succeeded"},result=${stale ? null : JSON.stringify(suggestion)}::jsonb,finished_at=now(),failure_code=${stale ? "facts_changed" : null} WHERE id=${reservation.id!}::uuid AND dealer_id=${dealer} AND status='reserved' RETURNING id`,
    );
    if (!changed.rows.length) stale = true;
  });
  if (stale)
    throw new AiDraftError(
      "The enquiry, draft or vehicle changed while AI was working. Your draft is unchanged. Reopen it before trying again.",
      409,
    );
  return { generationId: reservation.id!, ...suggestion };
}

/** Called inside the explicit draft save; never trusts a client-supplied source label. */
export async function checkAiGenerationForSave(
  executor: Executor,
  dealer: string,
  enquiryId: string,
  generationId: string,
  actor: string,
  revision: number,
  version: number,
) {
  const generation = (
    await executor.execute(
      sql`SELECT * FROM staff_ai_draft_generations WHERE dealer_id=${dealer} AND enquiry_id=${enquiryId}::uuid AND id=${generationId}::uuid`,
    )
  ).rows[0] as GenerationRow | undefined;
  if (
    !generation ||
    generation.auth_user_id !== actor ||
    generation.status !== "succeeded" ||
    Number(generation.base_revision) !== revision ||
    Number(generation.base_draft_version) !== version ||
    Date.now() - new Date(generation.created_at).getTime() > 86400000
  )
    throw new AiDraftError(
      "This AI suggestion no longer matches your draft. Generate a new suggestion.",
      409,
    );
  const current = await context(executor, dealer, enquiryId, revision, version);
  if (current.factsHash !== generation.facts_hash)
    throw new AiDraftError(
      "The enquiry or vehicle details changed. Generate a new suggestion before saving.",
      409,
    );
}
/** Existing reviewed email flow must not carry AI claims across a later stock change. */
export async function checkSavedAiDraftFresh(
  executor: Executor,
  dealer: string,
  enquiryId: string,
  draft: { version: number; savedDraft: Record<string, unknown> | null },
) {
  const saved = draft.savedDraft;
  if (saved?.source !== "ai") return;
  if (!saved.aiGenerationId)
    throw new AiDraftError(
      "This AI draft needs a fresh suggestion before sending.",
      409,
    );
  const generation = (
    await executor.execute(
      sql`SELECT * FROM staff_ai_draft_generations WHERE dealer_id=${dealer} AND enquiry_id=${enquiryId}::uuid AND id=${String(saved.aiGenerationId)}::uuid`,
    )
  ).rows[0] as GenerationRow | undefined;
  if (
    !generation ||
    generation.status !== "succeeded" ||
    Date.now() - new Date(generation.created_at).getTime() > 86400000
  )
    throw new AiDraftError(
      "This AI suggestion expired. Generate a fresh suggestion or start a new draft.",
      409,
    );
  const current = await context(
    executor,
    dealer,
    enquiryId,
    Number(generation.base_revision),
    draft.version,
  );
  if (current.factsHash !== generation.facts_hash)
    throw new AiDraftError(
      "The enquiry or vehicle details changed. Generate a fresh suggestion or start a new draft before sending.",
      409,
    );
}
