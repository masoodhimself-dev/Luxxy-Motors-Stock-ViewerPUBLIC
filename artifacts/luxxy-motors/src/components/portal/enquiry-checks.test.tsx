import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Enquiry } from "@workspace/api-client-react";
import type { MotHistory } from "@workspace/vehicle-meta";
import type { Car } from "@/lib/stock-context";

const state = vi.hoisted(() => ({
  fetch: vi.fn(),
  settings: {
    delivery: { enabled: true },
    deliveryPricing: {
      enabled: true,
      basePrice: "40.00",
      pricePerMile: "1.20",
    },
    partExchange: { enabled: true },
    address: { postcode: "HA2 7LU" },
  },
}));
vi.mock("@workspace/api-client-react", () => ({
  customFetch: (...args: unknown[]) => state.fetch(...args),
}));
vi.mock("@/lib/dealer-settings-context", () => ({
  useDealerSettings: () => ({ settings: state.settings }),
}));
vi.mock("../postcode-field", () => ({
  PostcodeField: ({
    label,
    value,
    onChange,
  }: {
    label: string;
    value: string;
    onChange: (value: string) => void;
  }) => (
    <label>
      {label}
      <input value={value} onChange={(event) => onChange(event.target.value)} />
    </label>
  ),
}));
import { EnquiryChecks, enquiryMotSummary } from "./enquiry-checks";

const entry = {
  id: "enquiry-one",
  vehicleId: "car-one",
  vehicleTitle: "Ford Focus",
  vehicleRegistration: "AB12CDE",
  partExchangeRegistration: "CD34EFG",
  partExchangeMileage: 53000,
} as Enquiry;
const car = {
  id: "car-one",
  registration: "AB12CDE",
  title: "Ford Focus",
} as Car;
const history: MotHistory = {
  registration: "AB12CDE",
  make: "FORD",
  model: "FOCUS",
  checkedAt: "2026-10-29T10:00:00Z",
  recall: "Unknown",
  tests: [
    {
      result: "PASSED",
      completedDate: "2026-06-12",
      expiryDate: "2027-06-11",
      mileage: "51000",
      mileageUnit: "MI",
      defects: [],
    },
  ],
};
const quote = {
  postcode: "SW1A 1AA",
  roadMiles: 14.5,
  basePricePence: 4000,
  pricePerMilePence: 120,
  mileageChargePence: 1740,
  totalPence: 5740,
  distanceBasis: "driving",
  estimated: true,
};

beforeEach(() => {
  state.fetch.mockReset();
  state.settings.delivery.enabled = true;
  state.settings.deliveryPricing.enabled = true;
  state.settings.partExchange.enabled = true;
});
afterEach(() => vi.useRealTimers());

it("makes no check requests for the closed tools and respects the existing manage permission", () => {
  const { rerender } = render(
    <EnquiryChecks entry={entry} car={car} canManage />,
  );
  expect(screen.getByRole("button", { name: /MOT history/ })).toHaveAttribute(
    "aria-expanded",
    "false",
  );
  expect(state.fetch).not.toHaveBeenCalled();
  rerender(<EnquiryChecks entry={entry} car={car} canManage={false} />);
  expect(
    screen.queryByRole("group", { name: "Customer enquiry checks" }),
  ).not.toBeInTheDocument();
  expect(state.fetch).not.toHaveBeenCalled();
});

it("checks only the selected stock car and inserts factual text into a draft without sending or saving", async () => {
  state.fetch.mockResolvedValue({ status: "available", history });
  const insert = vi.fn();
  render(
    <EnquiryChecks entry={entry} car={car} canManage onInsertText={insert} />,
  );
  fireEvent.click(screen.getByRole("button", { name: /MOT history/ }));
  await screen.findByRole("button", { name: "Add MOT details to reply" });
  expect(state.fetch.mock.calls[0][0]).toBe(
    "/api/staff/vehicles/car-one/mot-history",
  );
  expect(insert).not.toHaveBeenCalled();
  fireEvent.click(
    screen.getByRole("button", { name: "Add MOT details to reply" }),
  );
  expect(insert).toHaveBeenCalledWith(
    expect.stringContaining("Recorded expiry: 11 Jun 2027"),
  );
  expect(insert).toHaveBeenCalledWith(
    expect.stringContaining("MOT history checked 29 Oct 2026"),
  );
  expect(state.fetch).toHaveBeenCalledOnce();
  expect(state.fetch.mock.calls[0][1]).not.toHaveProperty("method", "POST");
});

it("does not request MOT data for missing registration or accidentally use another car's registration", () => {
  render(
    <EnquiryChecks
      entry={{ ...entry, vehicleRegistration: null }}
      car={{ ...car, id: "other-car" }}
      canManage
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: /MOT history/ }));
  expect(
    screen.getByText(/This car has no registration recorded/),
  ).toBeVisible();
  expect(state.fetch).not.toHaveBeenCalled();
});

it("clears the active check and results when staff change customer records", async () => {
  state.fetch.mockResolvedValue({ status: "available", history });
  const { rerender } = render(
    <EnquiryChecks entry={entry} car={car} canManage onInsertText={vi.fn()} />,
  );
  fireEvent.click(screen.getByRole("button", { name: /MOT history/ }));
  await screen.findByRole("button", { name: "Add MOT details to reply" });
  rerender(
    <EnquiryChecks
      entry={{ ...entry, id: "another-customer" }}
      car={car}
      canManage
      onInsertText={vi.fn()}
    />,
  );
  expect(
    screen.queryByRole("button", { name: "Add MOT details to reply" }),
  ).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: /MOT history/ })).toHaveAttribute(
    "aria-expanded",
    "false",
  );
  expect(state.fetch).toHaveBeenCalledOnce();
});

it("uses the existing part-exchange identity/mileage estimate only after staff request it and keeps supplied mileage", async () => {
  vi.useFakeTimers();
  state.fetch.mockResolvedValue({
    status: "estimated",
    registration: "CD34EFG",
    vehicle: { make: "FORD", model: "FIESTA" },
    estimate: { mileage: 55000 },
  });
  const insert = vi.fn();
  render(<EnquiryChecks entry={entry} canManage onInsertText={insert} />);
  fireEvent.click(screen.getByRole("button", { name: /Part exchange/ }));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(900);
  });
  expect(state.fetch).not.toHaveBeenCalled();
  fireEvent.click(
    screen.getByRole("button", { name: "Identify car & estimate mileage" }),
  );
  await act(async () => {
    await vi.advanceTimersByTimeAsync(850);
  });
  expect(state.fetch.mock.calls[0][0]).toBe(
    "/api/mot-mileage-estimate?registration=CD34EFG",
  );
  expect(screen.getByRole("status")).toHaveTextContent(
    "FORD FIESTA · Estimated 55,000",
  );
  expect(screen.getByText(/Customer supplied: 53,000 miles/)).toBeVisible();
  fireEvent.click(
    screen.getByRole("button", { name: "Add mileage estimate to reply" }),
  );
  expect(insert).toHaveBeenCalledWith(
    expect.stringContaining("not an agreed mileage or valuation"),
  );
  expect(entry.partExchangeMileage).toBe(53000);
  fireEvent.click(
    screen.getByRole("button", { name: "Identify car & estimate mileage" }),
  );
  await act(async () => {
    await vi.advanceTimersByTimeAsync(850);
  });
  expect(state.fetch).toHaveBeenCalledTimes(2);
  expect(
    screen.getByRole("button", { name: "Add mileage estimate to reply" }),
  ).toBeEnabled();
});

it("asks for a complete registration and does not invent a mileage when history is insufficient", async () => {
  vi.useFakeTimers();
  state.fetch.mockResolvedValue({
    status: "unavailable",
    registration: "CD34EFG",
    vehicle: { make: "FORD", model: "FIESTA" },
  });
  render(<EnquiryChecks entry={entry} canManage onInsertText={vi.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: /Part exchange/ }));
  const registration = screen.getByLabelText("Part-exchange registration");
  fireEvent.change(registration, { target: { value: "CD" } });
  expect(
    screen.getByRole("button", { name: "Identify car & estimate mileage" }),
  ).toBeDisabled();
  expect(screen.getByText(/Enter a complete UK registration/)).toBeVisible();
  fireEvent.change(registration, { target: { value: "CD34 EFG" } });
  fireEvent.click(
    screen.getByRole("button", { name: "Identify car & estimate mileage" }),
  );
  await act(async () => {
    await vi.advanceTimersByTimeAsync(850);
  });
  expect(screen.getByRole("status")).toHaveTextContent(
    "Not enough reliable MOT history",
  );
  expect(
    screen.queryByRole("button", { name: "Add mileage estimate to reply" }),
  ).not.toBeInTheDocument();
});

it("calculates a road quote only on request, and places a clearly estimated price in the editable reply", async () => {
  state.fetch.mockResolvedValue(quote);
  const insert = vi.fn();
  render(<EnquiryChecks entry={entry} canManage onInsertText={insert} />);
  fireEvent.click(screen.getByRole("button", { name: /Delivery estimate/ }));
  expect(state.fetch).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText("Delivery postcode"), {
    target: { value: "SW1A1AA" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Calculate delivery" }));
  await screen.findByRole("button", { name: "Add delivery estimate to reply" });
  expect(state.fetch.mock.calls[0][0]).toBe(
    "/api/postcodes/delivery-estimate?postcode=SW1A1AA",
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Add delivery estimate to reply" }),
  );
  expect(insert).toHaveBeenCalledWith(
    expect.stringContaining(
      "Estimated delivery to SW1A 1AA: £57.40, based on 14.5 one-way road miles (£40.00 base charge plus £1.20 per mile)",
    ),
  );
  expect(insert).toHaveBeenCalledWith(
    expect.stringContaining("Nothing has been booked or charged"),
  );
  fireEvent.change(screen.getByLabelText("Delivery postcode"), {
    target: { value: "N1 1AA" },
  });
  await waitFor(() =>
    expect(
      screen.queryByRole("button", { name: "Add delivery estimate to reply" }),
    ).not.toBeInTheDocument(),
  );
});

it("respects disabled delivery estimates and gives an honest route failure instead of zero pricing", async () => {
  state.settings.deliveryPricing.enabled = false;
  const { rerender } = render(<EnquiryChecks entry={entry} canManage />);
  fireEvent.click(screen.getByRole("button", { name: /Delivery estimate/ }));
  expect(
    screen.getByText(/Online delivery estimates are not enabled/),
  ).toBeVisible();
  expect(state.fetch).not.toHaveBeenCalled();
  state.settings.deliveryPricing.enabled = true;
  state.fetch.mockRejectedValue({ data: { code: "routing_not_configured" } });
  rerender(<EnquiryChecks entry={entry} canManage onInsertText={vi.fn()} />);
  fireEvent.change(screen.getByLabelText("Delivery postcode"), {
    target: { value: "SW1A1AA" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Calculate delivery" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "couldn’t calculate a road delivery estimate",
  );
  expect(
    screen.queryByRole("button", { name: "Add delivery estimate to reply" }),
  ).not.toBeInTheDocument();
});

it("does not present an older pass expiry as current when a later MOT failed", () => {
  const summary = enquiryMotSummary({
    ...history,
    tests: [
      ...history.tests,
      {
        ...history.tests[0],
        result: "FAILED",
        completedDate: "2026-10-28",
        expiryDate: null,
      },
    ],
  });
  expect(summary).toContain("latest recorded MOT failed on 28 Oct 2026");
  expect(summary).not.toContain("Recorded expiry");
});
