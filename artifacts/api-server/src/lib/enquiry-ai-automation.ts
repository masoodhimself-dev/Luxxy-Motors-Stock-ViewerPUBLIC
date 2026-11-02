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
      if (!/^[a-z0-9][a-z0-9-]{0,99}$/.test(dealer)) return {};
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

type AutomationEvidence = {
  dealerActive: boolean;
  demo: boolean;
  provider: EnquiryAutomationProvider;
  optIn: EnquiryAiOptIn | undefined;
  aiAvailable: boolean;
  stock: {
    provider: string | null;
    enabled: boolean | null;
    verified: boolean;
  };
  dedicatedMailbox: { provider: EnquiryAutomationProvider; connected: boolean };
};

/**
 * Shared prerequisites for background draft creation. This is not permission to
 * send: automatic customer replies have no released conversation/send adapter.
 * Auto Trader can use this contract when its partner adapter is implemented.
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
  return {
    provider: input.provider,
    automaticDraftsEnabled: blockers.length === 0,
    automaticRepliesEnabled: false as const,
    mode: blockers.length === 0 ? "draft_only" as const : "manual" as const,
    blockers,
  };
}
