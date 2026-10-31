import { renderHook, act, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { expect, it, vi, beforeEach } from "vitest";
const state = vi.hoisted(() => ({ fetch: vi.fn() }));
vi.mock("@workspace/api-client-react", () => ({
  customFetch: (...args: unknown[]) => state.fetch(...args),
}));
import { useAiAssistance, aiRequestId } from "./ai-assistance";
function wrapper({ children }: { children: React.ReactNode }) {
  return (
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      {children}
    </QueryClientProvider>
  );
}
beforeEach(() => {
  state.fetch.mockReset();
});
it("creates valid unique request IDs without secure-context randomUUID", () => {
  const previous = crypto.randomUUID;
  Object.defineProperty(crypto, "randomUUID", {
    configurable: true,
    value: undefined,
  });
  try {
    const id = aiRequestId();
    expect(id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(aiRequestId()).not.toBe(id);
  } finally {
    Object.defineProperty(crypto, "randomUUID", {
      configurable: true,
      value: previous,
    });
  }
});
it("uncertain retry reuses its request ID and never automatically retries", async () => {
  state.fetch.mockImplementation((url: string) =>
    url.endsWith("/status")
      ? Promise.resolve({ enabled: true, remaining: 10 })
      : Promise.reject(Error("network")),
  );
  const { result } = renderHook(() => useAiAssistance(), { wrapper });
  await waitFor(() => expect(result.current.enabled).toBe(true));
  await act(async () => {
    await result.current.run("question", { vehicleId: "a", text: "MOT?" });
  });
  expect(state.fetch).toHaveBeenCalledTimes(2);
  await act(async () => {
    await result.current.run("question", { vehicleId: "a", text: "MOT?" });
  });
  const posts = state.fetch.mock.calls.filter((c) => c[1]?.method === "POST");
  expect(JSON.parse(posts[0][1].body).requestId).toBe(
    JSON.parse(posts[1][1].body).requestId,
  );
  expect(result.current.error).toContain("temporarily unavailable");
});
it("budget denial exhausts the UI allowance while leaving normal functions available", async () => {
  state.fetch.mockImplementation((url: string) =>
    url.endsWith("/status")
      ? Promise.resolve({ enabled: true, remaining: 10 })
      : Promise.reject({
          data: { code: "budget_limit", error: "Monthly allowance reached" },
        }),
  );
  const { result } = renderHook(() => useAiAssistance(), { wrapper });
  await waitFor(() => expect(result.current.enabled).toBe(true));
  await act(async () => {
    await result.current.run("finder", { text: "automatic" });
  });
  expect(result.current.remaining).toBe(0);
  expect(result.current.error).toBe("Monthly allowance reached");
});
