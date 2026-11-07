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
  render(<MotHistoryPanel vehicleId="car-a" staff />);
  expect(state.fetch).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "View MOT history" }));
  await screen.findByText("Latest test: Failed");
  expect(state.fetch.mock.calls[0][0]).toBe("/api/staff/vehicles/car-a/mot-history");
  expect(screen.getByText("12,345 km")).toBeVisible();
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
    screen.getByRole("button", { name: "Try again" }),
  ).toBeEnabled();
  expect(screen.getByRole("link", { name: "View full MOT history on GOV.UK" })).toHaveAttribute("href", "https://www.gov.uk/check-mot-history");
  expect(screen.queryByText("Latest test: Passed")).toBeNull();
});

it("keeps public results compact without recalls or advisory details, while staff retain the full record", () => {
  const pass = { ...history.tests[0], result: 'PASSED' as const, completedDate: '2026-10-02T10:00:00Z', expiryDate: '2027-10-01', defects: [{text: 'Tyre worn close to limit', type: 'ADVISORY', dangerous: false}] };
  const combined = { ...history, tests: [history.tests[0], pass] };
  const view = render(<MotHistoryResults history={combined} />);
  expect(screen.getByText('Latest test: Passed')).toBeVisible();
  expect(screen.queryByText('Latest test: Failed')).toBeNull();
  expect(screen.getByText('Failed')).toBeVisible();
  expect(screen.queryByText('Brake pipe leaking')).toBeNull();
  expect(screen.queryByText('Tyre worn close to limit')).toBeNull();
  expect(screen.queryByText('Advisory')).toBeNull();
  expect(screen.queryByText(/outstanding safety recall/)).toBeNull();
  expect(screen.queryByText(/Recorded expiry:/)).toBeNull();
  expect(screen.queryByText('1 note')).toBeNull();
  expect(document.querySelector('.mot-test-history details')).toBeNull();
  expect(document.querySelectorAll('.mot-test-row-public')).toHaveLength(2);
  expect(screen.getByText('MOT expiry')).toBeVisible();
  expect(screen.getByRole('link', { name: 'View full MOT history on GOV.UK' })).toHaveAttribute('href', 'https://www.gov.uk/check-mot-history');
  view.unmount();
  render(<MotHistoryResults history={combined} staff />);
  expect(screen.getByText(/outstanding safety recall/)).toBeVisible();
  expect(screen.getByText('Tyre worn close to limit')).toBeVisible();
  expect(screen.getByText('Advisory')).toBeVisible();
  expect(screen.getByText('Brake pipe leaking')).toBeInTheDocument();
  expect(document.querySelectorAll('.mot-test-history details')).toHaveLength(2);
});
it("does not present an old pass as current after a newer failure", () => {
  const pass = { ...history.tests[0], completedDate: '2026-09-01', result: 'PASSED' as const, expiryDate: '2027-09-01', defects: [] };
  render(<MotHistoryResults history={{ ...history, recall: 'Unknown', tests: [pass, history.tests[0]] }} />);
  expect(screen.getByText('Latest test: Failed')).toBeVisible();
  expect(screen.queryByText('MOT expiry')).toBeNull();
  expect(screen.getByText(/confirm the current MOT details/)).toBeVisible();
  expect(screen.getByRole('heading', { name: 'MOT tests' })).toBeVisible();
  expect(screen.queryByText('Brake pipe leaking')).toBeNull();
  expect(screen.getByText('Failed')).toBeVisible();
});

it('plots real chronological readings, shows decreases and lets a customer inspect a point', () => {
  const test = { ...history.tests[0], result: 'PASSED' as const, mileageUnit: 'MI' as const, defects: [] };
  const records = [
    { ...test, completedDate: '2026-01-01', mileage: '41000' },
    { ...test, completedDate: '2024-01-01', mileage: '30000' },
    { ...test, completedDate: '2025-01-01', mileage: '45000' },
  ];
  render(<MotHistoryResults history={{ ...history, recall: 'Unknown', tests: records }} />);
  expect(screen.getByRole('group', { name: 'Recorded MOT mileage by date' })).toBeVisible();
  expect(screen.getByText(/A later test records lower mileage/)).toBeVisible();
  const earlier = screen.getByRole('button', { name: '1 Jan 2024: 30,000 miles' });
  fireEvent.focus(earlier);
  expect(earlier).toHaveAttribute('aria-pressed', 'true');
  expect(document.querySelector('.mot-mileage-selection')).toHaveTextContent('30,000 miles');
  expect(document.querySelector('.mot-mileage-selection')).toHaveTextContent('1 Jan 2024');
  expect(Array.from(document.querySelectorAll('.mot-test-date')).map(element => element.firstChild?.textContent)).toEqual(['1 Jan 2026', '1 Jan 2025', '1 Jan 2024']);
});

it('shows a single mileage point without inventing a trend or extrapolating to today', () => {
  render(<MotHistoryResults history={{ ...history, recall: 'Unknown' }} />);
  expect(document.querySelectorAll('.mot-mileage-dot')).toHaveLength(1);
  expect(document.querySelectorAll('.mot-mileage-line')).toHaveLength(0);
  expect(screen.getByText(/One recorded reading; a trend cannot be shown yet/)).toBeVisible();
  expect(screen.getByText(/Kilometre readings are converted to miles/)).toBeVisible();
});

it('shows an honest mileage empty state rather than an empty graph or zero mileage', () => {
  render(<MotHistoryResults history={{ ...history, recall: 'Unknown', tests: [{ ...history.tests[0], mileage: null, mileageUnit: null }] }} />);
  expect(screen.getByText('No dated mileage readings are available to plot.')).toBeVisible();
  expect(screen.queryByRole('group', { name: 'Recorded MOT mileage by date' })).toBeNull();
  expect(screen.getByText('Mileage not recorded')).toBeVisible();
});

it('uses a readable chart scale close to the highest mileage reading', () => {
  render(<MotHistoryResults history={{ ...history, recall: 'Unknown', tests: [{ ...history.tests[0], mileage: '134000', mileageUnit: 'MI' }] }} />);
  expect(Array.from(document.querySelectorAll('.mot-mileage-axis span')).map(element => element.textContent)).toEqual(['150,000', '75,000', '0']);
});
