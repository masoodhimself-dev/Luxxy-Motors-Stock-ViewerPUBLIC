import { fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { it, expect, vi, afterEach } from "vitest";
import { ContextHistoryDialog } from "./history-links";
const clients: QueryClient[] = [];
afterEach(() => {
  clients.splice(0).forEach((client) => client.clear());
  vi.unstubAllGlobals();
  window.history.replaceState({}, "", "/");
});
it("shows only the selected record history and returns to the same sale without writes", async () => {
  window.history.replaceState(
    {},
    "",
    "/portal?section=sales&saleId=s1&contextHistory=customer&historyRecord=sale:s1",
  );
  const activity = {
    id: "p1",
    kind: "payment",
    recordType: "sale",
    recordId: "s1",
    reference: "SALE-1",
    title: "Deposit received",
    description: "Bank transfer",
    status: "confirmed",
    occurredAt: "2026-10-25T10:00:00Z",
    amountPence: 20000,
  };
  const fetch = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
    Response.json({
      vehicles: [],
      customers: [
        {
          id: "c1",
          name: "Sam",
          email: "correct@example.com",
          phone: null,
          recordKeys: ["sale:s1"],
          activities: [activity],
        },
        {
          id: "c2",
          name: "Sam",
          email: "other@example.com",
          recordKeys: ["sale:s2"],
          activities: [],
        },
      ],
    }),
  );
  vi.stubGlobal("fetch", fetch);
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  clients.push(client);
  render(
    <QueryClientProvider client={client}>
      <ContextHistoryDialog />
    </QueryClientProvider>,
  );
  await screen.findByText("Deposit received");
  expect(screen.getByText("correct@example.com")).toBeVisible();
  expect(screen.queryByText("other@example.com")).not.toBeInTheDocument();
  expect(screen.getByText(/£200.00/)).toBeVisible();
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(fetch.mock.calls[0][0]).toBe("/api/staff/relationships");
  fireEvent.click(screen.getByRole("button", { name: "Close" }));
  expect(window.location.search).toBe("?section=sales&saleId=s1");
});
