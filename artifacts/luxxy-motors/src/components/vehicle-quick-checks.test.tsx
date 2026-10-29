import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { it, expect, vi, beforeEach } from "vitest";
const state = vi.hoisted(() => ({
  fetch: vi.fn(),
  settings: {
    delivery: { enabled: true },
    deliveryPricing: { enabled: true, basePrice: "50", pricePerMile: "1.50" },
    address: { postcode: "HA2 7LU" },
  },
}));
vi.mock("@workspace/api-client-react", () => ({
  customFetch: (...args: unknown[]) => state.fetch(...args),
}));
vi.mock("@/lib/dealer-settings-context", () => ({
  useDealerSettings: () => ({ settings: state.settings }),
}));
vi.mock("./postcode-field", () => ({
  PostcodeField: ({ label, value, onChange }: any) => (
    <label>
      {label}
      <input value={value} onChange={(e) => onChange(e.target.value)} />
    </label>
  ),
}));
import { VehicleQuickChecks } from "./vehicle-quick-checks";
const history = {
  registration: "AB12CDE",
  make: "FORD",
  model: "FOCUS",
  checkedAt: new Date().toISOString(),
  recall: "Unknown",
  tests: [
    {
      completedDate: new Date().toISOString(),
      result: "PASSED",
      expiryDate: new Date(Date.now() + 330 * 86400000)
        .toISOString()
        .slice(0, 10),
      mileage: "42000",
      mileageUnit: "MI",
      defects: [],
    },
  ],
};
beforeEach(() => {
  state.settings.delivery.enabled = true;
  state.settings.deliveryPricing.enabled = true;
  state.fetch.mockReset();
  state.fetch.mockImplementation((url: string) =>
    Promise.resolve(
      url.includes("delivery-estimate")
        ? {
            postcode: "SW1A 1AA",
            roadMiles: 23.4,
            basePricePence: 5000,
            pricePerMilePence: 150,
            mileageChargePence: 3510,
            totalPence: 8510,
            distanceBasis: "driving",
            estimated: true,
          }
        : { status: "available", history },
    ),
  );
});
it("requests only cached data on arrival and loads actual MOT history when tapped", async () => {
  render(<VehicleQuickChecks vehicleId="car-a" />);
  await screen.findByRole("button", { name: /Long MOT/ });
  expect(state.fetch).toHaveBeenCalledTimes(1);
  expect(state.fetch.mock.calls[0][0]).toBe(
    "/api/vehicles/car-a/mot-history?cacheOnly=true",
  );
  fireEvent.click(screen.getByRole("button", { name: "MOT history" }));
  await screen.findByText("Latest test: Passed");
  expect(state.fetch.mock.calls[1][0]).toBe("/api/vehicles/car-a/mot-history");
  expect(screen.getByRole("dialog")).toBeVisible();
});
it("retains the delivery quote when closed and reopened and never books or charges", async () => {
  render(<VehicleQuickChecks vehicleId="car-a" />);
  fireEvent.click(screen.getByRole("button", { name: "Delivery estimate" }));
  fireEvent.change(screen.getByLabelText("Delivery postcode"), {
    target: { value: "SW1A1AA" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Calculate delivery" }));
  await screen.findByText("£85.10");
  fireEvent.click(screen.getByRole("button", { name: "Close" }));
  await waitFor(() =>
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Delivery · est. £85.10" }),
  );
  await screen.findByText("£85.10");
  expect(screen.getByLabelText("Delivery postcode")).toHaveValue("SW1A 1AA");
  expect(
    state.fetch.mock.calls.filter(([url]) => url.includes("delivery-estimate")),
  ).toHaveLength(1);
  expect(screen.getByText(/Nothing is booked or charged/)).toBeVisible();
});
it("omits unavailable badges and disabled delivery without breaking MOT", async () => {
  state.settings.delivery.enabled = false;
  state.fetch.mockResolvedValue({ status: "uncached" });
  render(<VehicleQuickChecks vehicleId="no-plate" />);
  await waitFor(() => expect(state.fetch).toHaveBeenCalledTimes(1));
  expect(screen.queryByRole("button", { name: /Long MOT/ })).toBeNull();
  expect(
    screen.queryByRole("button", { name: "Delivery estimate" }),
  ).toBeNull();
  expect(screen.getByRole("button", { name: "MOT history" })).toBeVisible();
});
it("shows the first due date for a new car using the recorded DVSA date", async () => {
  state.fetch.mockResolvedValue({
    status: "available",
    history: { ...history, tests: [], firstMotDueDate: "2028-05-20" },
  });
  render(<VehicleQuickChecks vehicleId="new-car" />);
  await screen.findByRole("button", { name: "First MOT due · 20 May 2028" });
  fireEvent.click(screen.getByRole("button", { name: "MOT history" }));
  await screen.findByText(/No MOT required before this date/);
  expect(screen.queryByText(/No MOT tests were returned/)).toBeNull();
});
