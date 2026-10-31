import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
// randomUUID requires HTTPS; getRandomValues also works in the HTTP LAN preview.
export function aiRequestId() {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 15) | 64;
  bytes[8] = (bytes[8] & 63) | 128;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join(
    "",
  );
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
export type AiReply = {
  answer: string;
  vehicleIds: string[];
  questions: { question: string; answer: string }[];
  evidence: string[];
  remaining: number;
  cached: boolean;
};
export function useAiAssistance(scope: "public" | "staff" = "public") {
  const cache = useQueryClient();
  const status = useQuery({
    queryKey: ["ai-assistance-status", scope],
    queryFn: () =>
      customFetch<{ enabled: boolean; remaining: number; limit: number }>(
        scope === "staff" ? "/api/staff/ai/status" : "/api/ai/status",
      ),
    retry: false,
    staleTime: 60000,
    refetchOnWindowFocus: false,
  });
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const pending = useRef<{ fingerprint: string; requestId: string } | null>(
    null,
  );
  async function run(
    kind: "question" | "finder" | "faqs" | "explain" | "reply",
    input: { text?: string; vehicleId?: string; enquiryId?: string },
  ): Promise<AiReply | null> {
    if (busy) return null;
    setBusy(true);
    setError("");
    const fingerprint = JSON.stringify({ kind, ...input });
    if (pending.current?.fingerprint !== fingerprint)
      pending.current = { fingerprint, requestId: aiRequestId() };
    try {
      const result = await customFetch<AiReply>(
        kind === "reply" ? "/api/staff/ai/reply" : "/api/ai/assist",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            kind,
            ...input,
            requestId: pending.current.requestId,
          }),
          signal: AbortSignal.timeout(20000),
        },
      );
      cache.setQueryData(["ai-assistance-status", scope], {
        enabled: true,
        remaining: result.remaining,
        limit: 10,
      });
      pending.current = null;
      return result;
    } catch (cause) {
      const value = cause as {
        data?: { error?: string; code?: string };
        message?: string;
      };
      setError(
        value.data?.error ||
          "AI is temporarily unavailable. You can still use saved answers, normal search and manual replies.",
      );
      if (
        ["session_limit", "daily_limit", "budget_limit"].includes(
          value.data?.code ?? "",
        )
      )
        cache.setQueryData(["ai-assistance-status", scope], {
          enabled: true,
          remaining: 0,
          limit: 10,
        });
      return null;
    } finally {
      setBusy(false);
    }
  }
  return {
    enabled: status.data?.enabled === true,
    remaining: status.data?.remaining ?? 10,
    busy,
    error,
    run,
  };
}
