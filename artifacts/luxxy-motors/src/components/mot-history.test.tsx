import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { beforeEach, it, expect, vi } from "vitest";
const state = vi.hoisted(() => ({ fetch: vi.fn() }));
vi.mock("@workspace/api-client-react", () => ({
  customFetch: (...args: unknown[]) => state.fetch(...args),
}));
import {
  MotHistoryPanel,
  MotHistoryResults,
  PartExchangeMotCheck,
  StaffMotLookupDialog,
} from "./mot-history";
const history = {
  registration: "AB12CDE",
  make: "FORD",
  model: "FOCUS",
  checkedAt: "2026-10-28T10:00:00Z",
  recall: "Yes" as const,
  tests: [
    {
      completedDate: "2026-10-01T10:00:00Z",
      result: "FAILED" as const,
      expiryDate: null,
      mileage: "12345",
      mileageUnit: "KM" as const,
      defects: [
        { text: "Brake pipe leaking", type: "DANGEROUS", dangerous: true },
      ],
    },
  ],
};
beforeEach(() => {
  state.fetch.mockReset();
  state.fetch.mockResolvedValue({ status: "available", history });
});
it("does not poll or request MOT data until asked and displays the actual result and units", async () => {
  render(<MotHistoryPanel vehicleId="car-a" />);
  expect(state.fetch).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "View MOT history" }));
  await screen.findByText("Latest test: Failed");
  expect(state.fetch.mock.calls[0][0]).toBe("/api/vehicles/car-a/mot-history");
  expect(screen.getByText(/12,345 km/)).toBeVisible();
  expect(screen.getByText("Brake pipe leaking")).toBeVisible();
  expect(screen.getByText(/outstanding safety recall/)).toBeVisible();
});
it("shows a useful missing-registration state without inventing a pass", async () => {
  state.fetch.mockResolvedValue({
    status: "registration_missing",
    message: "Ask the dealership for the registration to check MOT history.",
  });
  render(<MotHistoryPanel vehicleId="cazoo-no-plate" />);
  fireEvent.click(screen.getByRole("button"));
  await screen.findByText(/Ask the dealership for the registration/);
  expect(screen.queryByText(/Latest test:/)).toBeNull();
});
it("does not imply exemption or recall clearance when tests are absent", () => {
  render(
    <MotHistoryResults
      history={{ ...history, recall: "Unknown", tests: [] }}
    />,
  );
  expect(screen.getByText(/does not confirm exemption/)).toBeVisible();
  expect(screen.queryByText(/Latest test:/)).toBeNull();
  expect(screen.queryByText(/recall is recorded/)).toBeNull();
});
it("part exchange opens a prefilled pop-up, reads only MOT data and retains the parent invoice form", async () => {
  render(
    <div>
      <input aria-label="Part-exchange allowance" defaultValue="1500" />
      <PartExchangeMotCheck registration="AB12 CDE" />
    </div>,
  );
  // Tapping a button in Safari leaves the previous form input focused.
  screen.getByLabelText("Part-exchange allowance").focus();
  fireEvent.click(
    screen.getByRole("button", { name: "Check part-exchange MOT" }),
  );
  expect(
    screen.getByRole("textbox", { name: "Registration number" }),
  ).toHaveValue("AB12 CDE");
  expect(state.fetch).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Check MOT" }));
  await screen.findByText("Latest test: Failed");
  expect(state.fetch.mock.calls[0][0]).toBe(
    "/api/staff/mot-history?registration=AB12%20CDE",
  );
  fireEvent.click(screen.getByRole("button", { name: "Close" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(screen.getByLabelText("Part-exchange allowance")).toHaveValue("1500");
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: "Check part-exchange MOT" }),
    ).toHaveFocus(),
  );
  expect(state.fetch).toHaveBeenCalledTimes(1);
});
it("ignores late results after changing the registration", async () => {
  let resolve: (value: unknown) => void = () => {};
  state.fetch.mockImplementation(() => new Promise((r) => (resolve = r)));
  render(
    <StaffMotLookupDialog initialRegistration="AB12CDE" onClose={() => {}} />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Check MOT" }));
  fireEvent.change(
    screen.getByRole("textbox", { name: "Registration number" }),
    { target: { value: "ZZ99ABC" } },
  );
  resolve({ status: "available", history });
  await waitFor(() =>
    expect(screen.queryByText("Latest test: Failed")).toBeNull(),
  );
  expect(screen.getByRole("button", { name: "Check MOT" })).toBeEnabled();
});
it("uses the staff vehicle route and clears old results when vehicle changes", async () => {
  const { rerender } = render(<MotHistoryPanel vehicleId="a" staff />);
  fireEvent.click(screen.getByRole("button"));
  await screen.findByText("Latest test: Failed");
  expect(state.fetch.mock.calls[0][0]).toBe(
    "/api/staff/vehicles/a/mot-history",
  );
  rerender(<MotHistoryPanel vehicleId="b" staff />);
  await screen.findByRole("button", { name: "View MOT history" });
  expect(screen.queryByText("Latest test: Failed")).toBeNull();
});
it("displays retryable provider failures rather than fabricated history", async () => {
  state.fetch.mockRejectedValue({ data: { code: "unavailable" } });
  render(<MotHistoryPanel vehicleId="a" />);
  fireEvent.click(screen.getByRole("button"));
  await screen.findByRole("alert");
  expect(
    screen.getByRole("button", { name: "View MOT history" }),
  ).toBeEnabled();
  expect(screen.queryByText("Latest test: Passed")).toBeNull();
});
