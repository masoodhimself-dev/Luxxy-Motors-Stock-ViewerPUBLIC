import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ fetch: vi.fn() }));
vi.mock("@workspace/api-client-react", () => ({
  customFetch: (...args: unknown[]) => state.fetch(...args),
}));
import { PartExchangeMotDetails } from "./part-exchange-mot-details";
const reply = (extra: Record<string, unknown> = {}) => ({
  status: "estimated",
  registration: "AB12CDE",
  vehicle: { make: "FORD", model: "FOCUS", registrationDate: "2012-05-01" },
  estimate: {
    mileage: 88000,
    lastTestDate: "2026-06-01",
    lastTestMileage: 85042,
    annualMiles: 9000,
  },
  mot: {
    dueDate: "2027-06-01",
    firstTest: false,
    lastPassedDate: "2026-06-01",
    lastTestDate: "2026-06-01",
    latestTestResult: "PASSED",
    checkedAt: "2026-11-01T09:00:00Z",
    lastReading: { date: "2026-06-01", mileage: 85042, unit: "MI" },
  },
  ...extra,
});
const flush = async () => {
  await act(async () => {
    await Promise.resolve();
  });
};
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-01T12:00:00Z"));
  state.fetch.mockReset();
  state.fetch.mockResolvedValue(reply());
});
afterEach(() => vi.useRealTimers());
it("does not look up a valid registration until Find my car is clicked", async () => {
  const onDetails = vi.fn();
  render(
    <PartExchangeMotDetails
      registration="ab12 cde"
      onDetails={onDetails}
      onManualEntry={vi.fn()}
    />,
  );
  await act(async () => {
    await vi.advanceTimersByTimeAsync(15000);
  });
  expect(state.fetch).not.toHaveBeenCalled();
  expect(onDetails).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Find my car" }));
  await flush();
  expect(state.fetch.mock.calls[0][0]).toBe(
    "/api/mot-mileage-estimate?registration=AB12CDE&identity=dvla",
  );
  expect(onDetails).toHaveBeenCalledOnce();
  expect(screen.getByText("Ford Focus")).toBeVisible();
  expect(
    screen.getByText(/Last recorded mileage: 85,042 miles/),
  ).toHaveTextContent("1 Jun 2026");
  expect(screen.getByText(/Next MOT due/)).toHaveTextContent("1 Jun 2027");
  expect(screen.getByText(/Estimated mileage/)).toHaveTextContent(
    "88,000",
  );
});
it("identifies a car even when there is insufficient history to estimate mileage", async () => {
  state.fetch.mockResolvedValue(
    reply({ status: "unavailable", estimate: undefined }),
  );
  const onDetails = vi.fn();
  render(
    <PartExchangeMotDetails
      registration="AB12CDE"
      onDetails={onDetails}
      onManualEntry={vi.fn()}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Find my car" }));
  await flush();
  expect(onDetails).toHaveBeenCalledOnce();
  expect(onDetails.mock.calls[0][0].mileage).toBeUndefined();
  expect(screen.getByText(/enter your odometer reading/)).toBeVisible();
  expect(screen.getByText(/Last recorded mileage/)).toBeVisible();
});
it("does not skip identification when the customer already entered mileage", async () => {
  const onDetails = vi.fn();
  render(
    <PartExchangeMotDetails
      registration="AB12CDE"
      mileage="90000"
      mileageEstimated={false}
      onDetails={onDetails}
      onManualEntry={vi.fn()}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Find my car" }));
  await flush();
  expect(onDetails).toHaveBeenCalledOnce();
  expect(screen.getByText("Ford Focus")).toBeVisible();
  expect(
    screen.queryByText(/Estimated mileage/),
  ).not.toBeInTheDocument();
});
it("blocks concurrent clicks but permits a subsequent explicit recheck", async () => {
  let resolve: (value: unknown) => void = () => {};
  state.fetch.mockImplementationOnce(() => new Promise((r) => (resolve = r)));
  const onDetails = vi.fn();
  render(
    <PartExchangeMotDetails
      registration="AB12CDE"
      onDetails={onDetails}
      onManualEntry={vi.fn()}
    />,
  );
  const button = screen.getByRole("button", { name: "Find my car" });
  fireEvent.click(button);
  fireEvent.click(button);
  expect(state.fetch).toHaveBeenCalledTimes(1);
  expect(
    screen.getByRole("button", { name: "Finding your car…" }),
  ).toBeDisabled();
  await act(async () => resolve(reply()));
  expect(onDetails).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByRole("button", { name: "Find my car" }));
  await flush();
  expect(state.fetch).toHaveBeenCalledTimes(2);
  expect(onDetails).toHaveBeenCalledTimes(2);
});
it("supports manual entry without making any request", () => {
  const onManualEntry = vi.fn();
  render(
    <PartExchangeMotDetails
      registration="AB12CDE"
      onDetails={vi.fn()}
      onManualEntry={onManualEntry}
    />,
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Enter details manually" }),
  );
  expect(onManualEntry).toHaveBeenCalledOnce();
  expect(state.fetch).not.toHaveBeenCalled();
});
it("aborts an active lookup when manual entry is chosen and ignores the late result", async () => {
  let resolve: (value: unknown) => void = () => {};
  state.fetch.mockImplementation(() => new Promise((r) => (resolve = r)));
  const onDetails = vi.fn(),
    onManualEntry = vi.fn();
  render(
    <PartExchangeMotDetails
      registration="AB12CDE"
      onDetails={onDetails}
      onManualEntry={onManualEntry}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Find my car" }));
  const signal = state.fetch.mock.calls[0][1].signal;
  fireEvent.click(
    screen.getByRole("button", { name: "Enter details manually" }),
  );
  expect(signal.aborted).toBe(true);
  await act(async () => resolve(reply()));
  expect(onDetails).not.toHaveBeenCalled();
  expect(onManualEntry).toHaveBeenCalledOnce();
});
it("clears result immediately on plate change, never looks up the replacement automatically, and ignores late results", async () => {
  let resolve: (value: unknown) => void = () => {};
  state.fetch.mockImplementation(() => new Promise((r) => (resolve = r)));
  const onDetails = vi.fn();
  const { rerender } = render(
    <PartExchangeMotDetails
      registration="AB12CDE"
      onDetails={onDetails}
      onManualEntry={vi.fn()}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Find my car" }));
  rerender(
    <PartExchangeMotDetails
      registration="XY67ABC"
      onDetails={onDetails}
      onManualEntry={vi.fn()}
    />,
  );
  await act(async () => resolve(reply()));
  expect(onDetails).not.toHaveBeenCalled();
  expect(state.fetch).toHaveBeenCalledTimes(1);
  expect(screen.queryByText("Ford Focus")).not.toBeInTheDocument();
});
it("does not trigger another lookup or remove the result for registration spacing changes", async () => {
  const onDetails = vi.fn();
  const { rerender } = render(
    <PartExchangeMotDetails
      registration="AB12CDE"
      onDetails={onDetails}
      onManualEntry={vi.fn()}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Find my car" }));
  await flush();
  rerender(
    <PartExchangeMotDetails
      registration="ab12 cde"
      onDetails={onDetails}
      onManualEntry={vi.fn()}
    />,
  );
  expect(screen.getByText("Ford Focus")).toBeVisible();
  expect(state.fetch).toHaveBeenCalledTimes(1);
  expect(onDetails).toHaveBeenCalledOnce();
});
it.each([
  reply({ registration: "XY67ABC" }),
  reply({ vehicle: { make: null, model: null } }),
  null,
])(
  "offers manual fallback for missing or mismatched identity %#",
  async (result) => {
    state.fetch.mockResolvedValue(result);
    const onDetails = vi.fn();
    render(
      <PartExchangeMotDetails
        registration="AB12CDE"
        onDetails={onDetails}
        onManualEntry={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Find my car" }));
    await flush();
    expect(onDetails).not.toHaveBeenCalled();
    expect(screen.getByText(/couldn’t find your car/)).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Enter details manually" }),
    ).toBeEnabled();
    expect(screen.getByRole("button", { name: "Find my car" })).toBeEnabled();
  },
);
it("times out after 12 seconds and ignores a late reply", async () => {
  let resolve: (value: unknown) => void = () => {};
  state.fetch.mockImplementation(() => new Promise((r) => (resolve = r)));
  const onDetails = vi.fn();
  render(
    <PartExchangeMotDetails
      registration="AB12CDE"
      onDetails={onDetails}
      onManualEntry={vi.fn()}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Find my car" }));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(12000);
  });
  expect(state.fetch.mock.calls[0][1].signal.aborted).toBe(true);
  expect(screen.getByText(/couldn’t find your car/)).toBeVisible();
  await act(async () => resolve(reply()));
  expect(onDetails).not.toHaveBeenCalled();
});
it("aborts on unmount", () => {
  state.fetch.mockImplementation(() => new Promise(() => {}));
  const { unmount } = render(
    <PartExchangeMotDetails
      registration="AB12CDE"
      onDetails={vi.fn()}
      onManualEntry={vi.fn()}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Find my car" }));
  const signal = state.fetch.mock.calls[0][1].signal;
  unmount();
  expect(signal.aborted).toBe(true);
});
it("allows a failed network lookup to be retried explicitly without trapping manual entry", async () => {
  state.fetch.mockRejectedValueOnce(new Error("Unavailable"));
  const onDetails = vi.fn();
  render(
    <PartExchangeMotDetails
      registration="AB12CDE"
      onDetails={onDetails}
      onManualEntry={vi.fn()}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Find my car" }));
  await flush();
  expect(screen.getByText(/couldn’t find your car/)).toBeVisible();
  expect(
    screen.getByRole("button", { name: "Enter details manually" }),
  ).toBeEnabled();
  fireEvent.click(screen.getByRole("button", { name: "Find my car" }));
  await flush();
  expect(onDetails).toHaveBeenCalledOnce();
  expect(state.fetch).toHaveBeenCalledTimes(2);
});
it("shows a supplied first MOT date without inventing mileage or exemption from the plate", async () => {
  state.fetch.mockResolvedValue(
    reply({
      status: "unavailable",
      estimate: undefined,
      mot: {
        dueDate: "2028-06-01",
        firstTest: true,
        lastPassedDate: null,
        lastTestDate: null,
        latestTestResult: null,
        checkedAt: "2026-11-01T09:00:00Z",
      },
    }),
  );
  render(
    <PartExchangeMotDetails
      registration="AB12CDE"
      onDetails={vi.fn()}
      onManualEntry={vi.fn()}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Find my car" }));
  await flush();
  expect(screen.getByText(/First MOT due/)).toHaveTextContent("1 Jun 2028");
  expect(
    screen.queryByText(/Estimated mileage|Last recorded mileage/),
  ).not.toBeInTheDocument();
});
it("preserves a newer failure as a neutral check and does not expose defects or VINs", async () => {
  state.fetch.mockResolvedValue(
    reply({
      vin: "SECRET",
      tests: [{ defects: ["Private defect"] }],
      mot: {
        dueDate: "2027-06-01",
        firstTest: false,
        lastPassedDate: "2026-06-01",
        lastTestDate: "2026-10-01",
        latestTestResult: "FAILED",
        checkedAt: "2026-11-01T09:00:00Z",
      },
    }),
  );
  const onDetails = vi.fn();
  render(
    <PartExchangeMotDetails
      registration="AB12CDE"
      onDetails={onDetails}
      onManualEntry={vi.fn()}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Find my car" }));
  await flush();
  expect(screen.getByText(/MOT record needs checking/)).toHaveTextContent(
    "Last recorded expiry",
  );
  expect(JSON.stringify(onDetails.mock.calls[0][0])).not.toMatch(
    /SECRET|Private defect/,
  );
  expect(screen.queryByText(/Next MOT due/)).not.toBeInTheDocument();
});


it('supports the older mileage-only API response without inventing MOT dates', async () => {
  state.fetch.mockResolvedValue({status:'estimated',registration:'AB12CDE',vehicle:{make:'FORD',model:'FOCUS'},estimate:{mileage:88000}});
  const onDetails=vi.fn();render(<PartExchangeMotDetails registration="AB12CDE" onDetails={onDetails} onManualEntry={vi.fn()}/>);
  fireEvent.click(screen.getByRole('button',{name:'Find my car'}));await flush();
  expect(onDetails.mock.calls[0][0]).toMatchObject({registration:'AB12CDE',mileage:'88000',mot:null});
  expect(screen.getByText(/MOT date unavailable/)).toBeVisible();expect(screen.queryByText(/Next MOT due|First MOT due|Last recorded mileage/)).not.toBeInTheDocument();
});


it('displays a readable Mercedes identity while preserving the original provider facts', async () => {
  state.fetch.mockResolvedValue(reply({vehicle:{make:'MERCEDES-BENZ',model:'A-CLASS',registrationDate:'2017-10-01'}}));
  const onDetails=vi.fn();render(<PartExchangeMotDetails registration="AB12CDE" onDetails={onDetails} onManualEntry={vi.fn()}/>);fireEvent.click(screen.getByRole('button',{name:'Find my car'}));await flush();
  expect(screen.getByText('Mercedes-Benz A-Class')).toBeVisible();
  expect(onDetails.mock.calls[0][0].vehicle).toMatchObject({make:'MERCEDES-BENZ',model:'A-CLASS'});
});
it('renders a retained matching lookup after remount without fetching or repeating its callback, and never shows it for another plate', async () => {
  const onDetails = vi.fn(), onManualEntry = vi.fn();
  const first = render(<PartExchangeMotDetails registration="AB12CDE" onDetails={onDetails} onManualEntry={onManualEntry} />);
  fireEvent.click(screen.getByRole('button', { name: 'Find my car' })); await flush();
  const verified = onDetails.mock.calls[0][0]; first.unmount();
  const restored = render(<PartExchangeMotDetails registration="ab12 cde" initialResult={verified} mileage="88000" mileageEstimated onDetails={onDetails} onManualEntry={onManualEntry} />);
  expect(screen.getByText(/Next MOT due/)).toHaveTextContent('1 Jun 2027');
  expect(screen.getByText(/Last recorded mileage/)).toHaveTextContent('85,042 miles');
  expect(state.fetch).toHaveBeenCalledTimes(1); expect(onDetails).toHaveBeenCalledTimes(1);
  restored.rerender(<PartExchangeMotDetails registration="XY67ABC" initialResult={verified} onDetails={onDetails} onManualEntry={onManualEntry} />);
  expect(screen.queryByText(/Next MOT due/)).not.toBeInTheDocument();
  expect(screen.queryByText(/Last recorded mileage/)).not.toBeInTheDocument();
  expect(state.fetch).toHaveBeenCalledTimes(1); expect(onDetails).toHaveBeenCalledTimes(1);
});
