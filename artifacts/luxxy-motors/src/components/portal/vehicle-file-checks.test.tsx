import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ComponentProps } from "react";
import type { MotHistory } from "@workspace/vehicle-meta";
import { beforeEach, expect, it, vi } from "vitest";
import { VehicleFileChecks } from "./vehicle-file-checks";

const state = vi.hoisted(() => ({ fetch: vi.fn() }));
vi.mock("@workspace/api-client-react", () => ({ customFetch: (...args: unknown[]) => state.fetch(...args) }));

const history: MotHistory = {
  registration: "AB12CDE",
  make: "Ford",
  model: "Focus",
  checkedAt: "2026-11-12T10:00:00Z",
  recall: "No",
  tests: [
    { completedDate: "2026-11-01", result: "PASSED", expiryDate: "2027-10-31", mileage: "21000", mileageUnit: "MI", defects: [] },
    { completedDate: "2025-11-01", result: "PASSED", expiryDate: "2026-10-31", mileage: "15000", mileageUnit: "MI", defects: [] },
  ],
};
const props = {
  vehicleId: "car-one",
  registration: "AB12 CDE",
  canManage: true,
  mot: { state: "current", tone: "green", label: "MOT until", date: "2027-10-31", lastMileage: "21,000 miles", checkedAt: history.checkedAt },
  tax: { status: "Taxed", dueDate: "2027-04-01", checkedAt: history.checkedAt },
} as const;

function mount(extra: Partial<ComponentProps<typeof VehicleFileChecks>> = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={client}><VehicleFileChecks {...props} {...extra} /></QueryClientProvider>);
}

beforeEach(() => {
  state.fetch.mockReset();
  state.fetch.mockResolvedValue({ status: "available", history });
});

it("shows saved DVSA history and tax status without making external checks", async () => {
  mount();
  const mot = screen.getByRole("region", { name: "DVSA MOT history" });
  expect(await within(mot).findByRole("heading", { name: "Mileage history" })).toBeVisible();
  expect(within(mot).getByRole("heading", { name: "MOT tests" })).toBeVisible();
  expect(screen.getByText("Taxed")).toBeVisible();
  expect(state.fetch).toHaveBeenCalledExactlyOnceWith("/api/staff/vehicles/car-one/mot-history?cacheOnly=true", { signal: expect.any(AbortSignal) });
});

it("keeps check permissions and displays only stock summaries to read-only staff", () => {
  mount({ canManage: false });
  expect(screen.getByText("Taxed")).toBeVisible();
  expect(screen.getByText(/^MOT until/)).toBeVisible();
  expect(screen.queryByRole("button")).toBeNull();
  expect(state.fetch).not.toHaveBeenCalled();
});

it("runs DVLA and MOT independently and retains the saved record if either fails", async () => {
  const onDvlaChecked = vi.fn();
  const onMotHistory = vi.fn();
  state.fetch.mockImplementation((url) => {
    if (url.endsWith("vehicle-check"))
      return Promise.resolve({ registration: "AB12CDE", checkedAt: history.checkedAt, fuelType: "Petrol", taxStatus: "Taxed" });
    return Promise.resolve({ status: "available", history });
  });
  mount({ onDvlaChecked, onMotHistory });
  const mot = screen.getByRole("region", { name: "DVSA MOT history" });
  const dvla = screen.getByRole("region", { name: "DVLA vehicle record" });
  fireEvent.click(within(dvla).getByRole("button", { name: "Check DVLA" }));
  expect(await within(dvla).findByText("Petrol")).toBeVisible();
  expect(state.fetch).toHaveBeenCalledWith("/api/staff/dvla/vehicle-check", expect.objectContaining({
    method: "POST",
    body: JSON.stringify({ registration: "AB12CDE", vehicleId: "car-one" }),
  }));
  expect(onDvlaChecked).toHaveBeenCalledOnce();

  const motButton = await within(mot).findByRole("button", { name: "Check MOT again" });
  fireEvent.click(motButton);
  await waitFor(() => expect(onMotHistory).toHaveBeenCalledWith(history));
  expect(state.fetch).toHaveBeenCalledWith("/api/staff/vehicles/car-one/mot-history");
  await waitFor(() => expect(motButton).toBeEnabled());
  state.fetch.mockRejectedValueOnce({ data: { code: "busy" } });
  fireEvent.click(motButton);
  expect(await within(mot).findByRole("alert")).toHaveTextContent("The MOT check is busy");
  expect(within(mot).getByRole("heading", { name: "MOT tests" })).toBeVisible();

  state.fetch.mockRejectedValueOnce({ data: { code: "busy" } });
  fireEvent.click(within(dvla).getByRole("button", { name: "Check DVLA again" }));
  expect(await within(dvla).findByRole("alert")).toHaveTextContent("The DVLA check is busy");
  expect(within(dvla).getByText("Petrol")).toBeVisible();
});
