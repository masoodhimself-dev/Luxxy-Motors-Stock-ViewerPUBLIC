import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ fetch: vi.fn() }));
vi.mock("@workspace/api-client-react", () => ({ customFetch: (...args: unknown[]) => state.fetch(...args) }));
import { DealerReports } from "./dealer-reports";

const example = {
  period: "30d", from: "2026-09-27T12:00:00Z", to: "2026-10-27T12:00:00Z",
  enquiries: { received: 12, newNow: 2 }, bookings: { scheduled: 5, pending: 1 },
  sales: { completed: 3 },
  popularVehicles: [{ vehicleId: "v1", title: "Ford Focus", enquiries: 4 }],
};
function show() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><DealerReports scope="owner-1" /></QueryClientProvider>);
}
beforeEach(() => { state.fetch.mockReset(); });
it("shows accurate labels and ranges from existing records", async () => {
  state.fetch.mockResolvedValue(example);
  show();
  expect(await screen.findByRole("heading", { name: "Reports" })).toBeVisible();
  expect(await screen.findByText("Ford Focus")).toBeVisible();
  expect(screen.getByText("4 enquiries")).toBeVisible();
  expect(screen.getByText(/Confirmed appointments scheduled in this period/)).toBeVisible();
  expect(screen.getByText(/currently marked new · all dates/)).toBeVisible();
  expect(screen.getByText("Sales completed in this period.")).toBeVisible();
  expect(screen.queryByText(/£/)).not.toBeInTheDocument();
  expect(state.fetch).toHaveBeenCalledWith("/api/dealer-reports?period=30d", expect.objectContaining({ signal: expect.any(AbortSignal) }));
  expect(screen.queryByText(/website views/i)).not.toBeInTheDocument();
});
it("loads the selected period without reusing another period's values", async () => {
  state.fetch.mockImplementation((path: string) => Promise.resolve(path.includes("90d") ? { ...example, period: "90d", enquiries: { received: 27, newNow: 2 } } : example));
  show();
  expect(await screen.findByText("Ford Focus")).toBeVisible();
  fireEvent.change(screen.getByLabelText("Report period"), { target: { value: "90d" } });
  expect(await screen.findByText("27")).toBeVisible();
  expect(state.fetch).toHaveBeenLastCalledWith("/api/dealer-reports?period=90d", expect.objectContaining({ signal: expect.any(AbortSignal) }));
});
it("handles no activity and hides financial metrics when unavailable", async () => {
  state.fetch.mockResolvedValue({ ...example, enquiries: { received: 0, newNow: 0 }, bookings: { scheduled: 0, pending: 0 }, sales: null, popularVehicles: [] });
  show();
  expect(await screen.findByText("No enquiries linked to a car in this period.")).toBeVisible();
  expect(screen.queryByRole("heading", { name: "Completed sales" })).not.toBeInTheDocument();
  expect(screen.queryByText(/£/)).not.toBeInTheDocument();
});
it("shows an error and can retry without inventing zero totals", async () => {
  state.fetch.mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce(example);
  show();
  expect(await screen.findByRole("alert")).toHaveTextContent("couldn’t load");
  expect(screen.queryByText("12")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Try again" }));
  expect(await screen.findByText("Ford Focus")).toBeVisible();
  await waitFor(() => expect(state.fetch).toHaveBeenCalledTimes(2));
});
it("does not reuse a previous staff member's report", async () => {
  state.fetch.mockResolvedValueOnce(example).mockResolvedValueOnce({ ...example, enquiries: { received: 4, newNow: 1 }, sales: null });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const { rerender } = render(<QueryClientProvider client={client}><DealerReports scope="owner" /></QueryClientProvider>);
  expect(await screen.findByText("12")).toBeVisible();
  rerender(<QueryClientProvider client={client}><DealerReports scope="other-staff" /></QueryClientProvider>);
  expect(screen.queryByText("12")).not.toBeInTheDocument();
  expect(await screen.findByText("4")).toBeVisible();
  expect(screen.queryByRole("heading", { name: "Completed sales" })).not.toBeInTheDocument();
});

it("does not show a misleading sales count when completion dates need review", async () => {
  state.fetch.mockResolvedValue({ ...example, sales: { completed: null } });
  show();
  expect(await screen.findByText(/Sales total unavailable/)).toBeVisible();
  expect(screen.queryByText("Sales completed in this period.")).not.toBeInTheDocument();
});
