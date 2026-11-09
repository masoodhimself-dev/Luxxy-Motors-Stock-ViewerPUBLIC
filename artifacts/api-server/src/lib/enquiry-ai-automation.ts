export type EnquiryAutomationProvider = "cazoo" | "autotrader";
export type EnquiryAiOptIn = {
  provider: EnquiryAutomationProvider;
  enabled: boolean;
};
export type EnquiryAiAutomationBlocker =
  | "dealer_unavailable"
  | "not_enabled"
  | "ai_unavailable"
  | "provider_unavailable"
  | "stock_not_connected"
  | "mailbox_not_connected";
export type CazooAutomaticReplyBlocker =
  | "automatic_reply_not_enabled"
  | "automatic_reply_delivery_unavailable";

const dealerIdPattern = /^[a-z0-9][a-z0-9-]{0,99}$/;

/** Owner-managed opt-ins. A marketplace stock connection never implies consent. */
export function enquiryAiAutomationOptIns(
  env: Record<string, string | undefined> = process.env,
): Record<string, EnquiryAiOptIn> {
  const source = env.AI_ENQUIRY_AUTOMATION;
  if (!source || source.length > 64 * 1024) return {};
  try {
    const parsed: unknown = JSON.parse(source);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const entries = Object.entries(parsed);
    if (entries.length > 1000) return {};
    for (const [dealer, raw] of entries) {
      if (!dealerIdPattern.test(dealer)) return {};
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
      const value = raw as Record<string, unknown>;
      if (
        Object.keys(value).some((key) => key !== "provider" && key !== "enabled") ||
        (value.provider !== "cazoo" && value.provider !== "autotrader") ||
        typeof value.enabled !== "boolean"
      ) return {};
    }
    return Object.fromEntries(entries) as Record<string, EnquiryAiOptIn>;
  } catch {
    return {};
  }
}

/** Only receipts received after this dealership's explicit activation can auto-send. */
export function cazooAutomaticReplyOptedIn(
  dealer: string,
  env: Record<string, string | undefined> = process.env,
  receivedAt?: Date,
): boolean {
  const source = env.AI_CAZOO_AUTOMATIC_REPLY_DEALERS;
  if (!source || source.length > 64 * 1024 || !dealerIdPattern.test(dealer)) return false;
  try {
    const parsed: unknown = JSON.parse(source);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return false;
    const entries = Object.entries(parsed);
    if (entries.length > 1000 || entries.some(([id, value]) =>
      !dealerIdPattern.test(id) || typeof value !== "string" ||
      new Date(value).toISOString() !== value)) return false;
    const activation = entries.find(([id]) => id === dealer)?.[1];
    if (typeof activation !== "string") return false;
    const startedAt = Date.parse(activation);
    return startedAt <= Date.now() && (receivedAt === undefined || receivedAt.getTime() >= startedAt);
  } catch {
    return false;
  }
}

type AutomationEvidence = {
  dealerActive: boolean;
  demo: boolean;
  provider: EnquiryAutomationProvider;
  optIn: EnquiryAiOptIn | undefined;
  aiAvailable: boolean;
  automaticReplyOptIn?: boolean;
  automaticReplyDeliveryAvailable?: boolean;
  stock: {
    provider: string | null;
    enabled: boolean | null;
    verified: boolean;
  };
  dedicatedMailbox: { provider: EnquiryAutomationProvider; connected: boolean };
};

/**
 * Background drafts and automatic first replies have separate gates. Reply
 * readiness is checked again per enquiry before a send is prepared.
 */
export function enquiryAiAutomationEligibility(input: AutomationEvidence) {
  const blockers: EnquiryAiAutomationBlocker[] = [];
  if (!input.dealerActive || input.demo) blockers.push("dealer_unavailable");
  if (input.optIn?.enabled !== true || input.optIn.provider !== input.provider)
    blockers.push("not_enabled");
  if (!input.aiAvailable) blockers.push("ai_unavailable");
  if (input.provider !== "cazoo") blockers.push("provider_unavailable");
  if (
    input.stock.provider !== input.provider ||
    input.stock.enabled !== true ||
    input.stock.verified !== true
  ) blockers.push("stock_not_connected");
  if (
    input.dedicatedMailbox.provider !== input.provider ||
    input.dedicatedMailbox.connected !== true
  ) blockers.push("mailbox_not_connected");
  const replyBlockers: CazooAutomaticReplyBlocker[] = [];
  if (input.automaticReplyOptIn !== true) replyBlockers.push("automatic_reply_not_enabled");
  if (input.automaticReplyDeliveryAvailable !== true) replyBlockers.push("automatic_reply_delivery_unavailable");
  const automaticDraftsEnabled = blockers.length === 0;
  const automaticRepliesEnabled = automaticDraftsEnabled && replyBlockers.length === 0;
  return {
    provider: input.provider,
    automaticDraftsEnabled,
    automaticRepliesEnabled,
    mode: automaticRepliesEnabled ? "automatic_reply" as const : automaticDraftsEnabled ? "draft_only" as const : "manual" as const,
    blockers,
    replyBlockers,
  };
}
