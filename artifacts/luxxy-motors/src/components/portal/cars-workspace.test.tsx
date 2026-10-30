import { beforeEach, expect, it, vi } from "vitest";
import {
  fireEvent,
  render,
  screen,
  within,
  waitFor,
} from "@testing-library/react";
import { CarsWorkspace, StaffMotBadge } from "./cars-workspace";
import {
  carNextStep,
  filterStaffCars,
  vehicleActivityById,
  workspaceStatus,
} from "./cars-workspace-model";
import type { StaffCar, StaffCarsData } from "./staff-cars-query";
import { staffMotSummary } from "@workspace/vehicle-meta";
import type { Enquiry } from "@workspace/api-client-react";
const state = vi.hoisted(() => ({
  data: undefined as StaffCarsData | undefined,
  pending: false,
  error: false,
  entries: [] as any[],
  replies: [] as any[],
  activityError: false,
  activityPending: false,
  replyError: false,
  queryOptions: [] as any[],
  summaryOptions: [] as any[],
  refetch: vi.fn(),
  invalidate: vi.fn(),
}));
vi.mock("./staff-cars-query", () => ({
  staffCarsKey: ["staff-cars"],
  useStaffCars: () => ({
    data: state.data,
    isPending: state.pending,
    isError: state.error,
    refetch: state.refetch,
  }),
}));
vi.mock("@/lib/enquiry-summary-query", () => ({
  useEnquirySummaries: (_: unknown, options: any) => {
    state.summaryOptions.push(options);
    return {
      data: state.entries,
      isPending: state.activityPending,
      isError: state.activityError,
      refetch: state.refetch,
    };
  },
}));
vi.mock("@tanstack/react-query", () => ({
  useQuery: (options: any) => {
    state.queryOptions.push(options);
    return {
      data: { enquiries: state.replies },
      isPending: false,
      isError: state.replyError,
      refetch: state.refetch,
    };
  },
  useQueryClient: () => ({ invalidateQueries: state.invalidate }),
}));
vi.mock("./enquiry-vehicle-information", () => ({
  VehicleInformationBody: ({ car }: any) => <p>Vehicle facts: {car.title}</p>,
  EnquiryVehicleInformation: ({ car, actions, onClose, published }: any) => (
    <div role="dialog" aria-label={car.title}>
      <button onClick={onClose}>Close</button>
      <span>{published ? "Advert available" : "No customer advert"}</span>
      {actions}
    </div>
  ),
}));
vi.mock("@/components/mot-history", () => ({
  MotHistoryPanel: ({ vehicleId }: any) => (
    <button>Check MOT for {vehicleId}</button>
  ),
}));
const now = "2026-10-29T12:00:00Z";
function car(id: string, extra: any = {}): StaffCar {
  return {
    id,
    advertId: id,
    title: "Toyota Yaris " + id,
    make: "Toyota",
    model: "Yaris",
    variant: "1.5 Hybrid Automatic",
    year: 2021,
    price: 8990,
    mileage: 22000,
    fuel: "Petrol Hybrid",
    transmission: "Automatic",
    plate: "AB12 CDE",
    inventoryStatus: "available",
    heroImage: null,
    images: [],
    staff: {
      source: "cazoo",
      sourceStatus: "live",
      inventoryStatus: "available",
      published: true,
      firstSeenAt: now,
      lastSeenAt: now,
      archivedAt: null,
      mot: staffMotSummary(null),
      changes: [],
      sale: null,
    },
    ...extra,
  } as StaffCar;
}
const props = {
  canManage: true,
  bookingEnabled: true,
  onEnquiry: vi.fn(),
  onSale: vi.fn(),
  onOpenEnquiry: vi.fn(),
};
const entry = (extra: any = {}) =>
  ({
    id: "enquiry-one",
    vehicleId: "one",
    type: "general",
    status: "new",
    customerName: "Amelia Buyer",
    phone: "07700900123",
    createdAt: now,
    ...extra,
  }) as Enquiry;
beforeEach(() => {
  vi.clearAllMocks();
  window.history.replaceState({}, "", "/portal?section=cars");
  state.data = {
    feed: {
      source: "Official Cazoo CSV",
      receivedAt: now,
      appliedAt: now,
      state: "current",
      scheduled: true,
    },
    cars: [
      car("one"),
      car("two", { inventoryStatus: "reserved" }),
      car("sold", { inventoryStatus: "sold" }),
      car("missing", {
        staff: { ...car("x").staff, sourceStatus: "missing", published: false },
      }),
    ],
  };
  state.pending = false;
  state.error = false;
  state.entries = [];
  state.replies = [];
  state.activityError = false;
  state.activityPending = false;
  state.replyError = false;
  state.queryOptions = [];
  state.summaryOptions = [];
  sessionStorage.clear();
  vi.spyOn(window, "scrollTo").mockImplementation(() => {});
});
it("keeps sold and missing staff views separate from current stock", async () => {
  render(<CarsWorkspace {...props} />);
  expect(screen.getAllByTestId(/^portal-car-/)).toHaveLength(2);
  fireEvent.click(screen.getByRole("button", { name: "Sold 1" }));
  await waitFor(() =>
    expect(screen.getAllByTestId(/^portal-car-/)).toHaveLength(1),
  );
  expect(screen.getByTestId("portal-car-sold")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Missing from feed 1" }));
  await waitFor(() =>
    expect(screen.getByTestId("portal-car-missing")).toBeVisible(),
  );
  expect(screen.queryByTestId("portal-car-sold")).not.toBeInTheDocument();
});
it("uses bookmarkable vehicle pages and restores the list search and filters on Back", async () => {
  render(<CarsWorkspace {...props} />);
  fireEvent.change(screen.getByRole("searchbox"), { target: { value: "one" } });
  await waitFor(() =>
    expect(screen.queryByTestId("portal-car-two")).not.toBeInTheDocument(),
  );
  const link = screen.getByRole("link", {
    name: "Open vehicle file for Toyota Yaris one",
  });
  expect(link.getAttribute("href")).toContain("carId=one");
  fireEvent.click(link);
  await waitFor(() =>
    expect(screen.getByText("Vehicle facts: Toyota Yaris one")).toBeVisible(),
  );
  fireEvent.click(screen.getByRole("link", { name: "Back to Cars" }));
  await waitFor(() => expect(screen.getByRole("searchbox")).toHaveValue("one"));
});
it("supports direct sold vehicle links and routes staff to the existing sale without creating one", () => {
  const sold = state.data!.cars[2];
  sold.staff.sale = {
    id: "sale-existing",
    reference: "SALE-1",
    status: "sold",
  };
  window.history.replaceState({}, "", "/portal?section=cars&carId=sold");
  render(<CarsWorkspace {...props} />);
  expect(screen.getByRole("link", { name: "View sale" })).toHaveAttribute(
    "href",
    "/portal?section=sales&saleId=sale-existing",
  );
  expect(
    screen.queryByRole("button", { name: "Start sale" }),
  ).not.toBeInTheDocument();
  expect(props.onSale).not.toHaveBeenCalled();
});
it("chooses the actual merged child reply as the next action", () => {
  state.entries = [
    entry(),
    entry({ id: "child", mergedIntoId: "enquiry-one" }),
  ];
  state.replies = [{ enquiryId: "child", pending: 1, review: 0 }];
  render(<CarsWorkspace {...props} />);
  const row = within(screen.getByTestId("portal-car-one"));
  expect(row.getByText("1 awaiting reply")).toBeVisible();
  fireEvent.click(row.getByRole("link", { name: "Reply to Amelia Buyer" }));
  expect(props.onOpenEnquiry).toHaveBeenCalledWith("child");
});
it("permission-gates customer data, including stale cached activity, and never polls", () => {
  state.entries = [entry()];
  state.replies = [{ enquiryId: "enquiry-one", pending: 1, review: 0 }];
  render(<CarsWorkspace {...props} canManage={false} />);
  expect(screen.queryByText(/Amelia/)).not.toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "New enquiry" }),
  ).not.toBeInTheDocument();
  expect(state.queryOptions.at(-1)).toMatchObject({
    enabled: false,
    refetchInterval: false,
  });
  expect(state.summaryOptions.at(-1).query).toMatchObject({
    enabled: false,
    refetchInterval: false,
  });
});
it("keeps booking disabled and does not offer Start sale on a reserved or missing vehicle", () => {
  window.history.replaceState({}, "", "/portal?section=cars&carId=two");
  render(<CarsWorkspace {...props} bookingEnabled={false} />);
  expect(
    screen.queryByRole("button", { name: "Book test drive" }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "Start sale" }),
  ).not.toBeInTheDocument();
});
it("does not show unavailable customer adverts for missing stock", () => {
  window.history.replaceState({}, "", "/portal?section=cars&carId=missing");
  render(<CarsWorkspace {...props} />);
  expect(
    screen.queryByRole("link", { name: /View customer advert/ }),
  ).not.toBeInTheDocument();
  expect(screen.getByText(/does not confirm a sale/)).toBeVisible();
});
it("filters actual changes and fixable issues, preserving sold state over a missing source", () => {
  const a = car("a"),
    b = car("b", { images: ["https://example.test/photo.jpg"] }),
    sold = car("s", {
      inventoryStatus: "sold",
      staff: { ...a.staff, sourceStatus: "missing" },
    });
  a.staff.changes = [
    {
      kind: "price",
      label: "Price reduced",
      at: now,
      before: 9000,
      after: 8990,
    },
  ];
  expect(workspaceStatus(sold)).toBe("sold");
  expect(
    filterStaffCars([a, b], "", "all", "stock", "changed", new Map()).map(
      (c) => c.id,
    ),
  ).toEqual(["a"]);
  expect(
    filterStaffCars([a, b], "", "all", "stock", "no-photos", new Map()).map(
      (c) => c.id,
    ),
  ).toEqual(["a"]);
  const before = JSON.stringify([a, b]);
  filterStaffCars([a, b], "", "all", "price-desc", "all", new Map());
  expect(JSON.stringify([a, b])).toBe(before);
});
it("does not claim zero customer activity while loading or after an error", () => {
  state.activityPending = true;
  const view = render(<CarsWorkspace {...props} />);
  expect(screen.getAllByText("Loading customer activity…")).toHaveLength(2);
  expect(screen.queryByText("0 enquiries")).not.toBeInTheDocument();
  state.activityPending = false;
  state.activityError = true;
  view.rerender(<CarsWorkspace {...props} />);
  expect(screen.getAllByText("Customer activity unavailable")).toHaveLength(2);
});
it("renders MOT text and dates alongside colour and does not fetch MOT on list load", () => {
  const summary = {
    state: "expired",
    tone: "red",
    label: "MOT expired",
    date: "2026-10-28",
    checkedAt: now,
    lastMileage: null,
  } as const;
  render(<StaffMotBadge summary={summary} />);
  expect(screen.getByText(/MOT expired/)).toHaveTextContent("28 Oct 2026");
  expect(
    screen.getByText(/MOT expired/).closest(".staff-mot-badge"),
  ).toHaveAttribute("data-tone", "red");
});
it("loads a first-MOT due date through the same staff status model", () => {
  const s = staffMotSummary(
    {
      registration: "AB25CDE",
      make: null,
      model: null,
      checkedAt: now,
      recall: "Unknown",
      tests: [],
      firstMotDueDate: "2028-03-01",
    },
    new Date(now),
  );
  expect(s.state).toBe("first_due");
  expect(s.date).toBe("2028-03-01");
});
it("shows a clear loading and failure state and explains screen refresh", () => {
  state.pending = true;
  state.data = undefined;
  const view = render(<CarsWorkspace {...props} />);
  expect(screen.getByLabelText("Loading cars")).toBeVisible();
  state.pending = false;
  state.error = true;
  view.rerender(<CarsWorkspace {...props} />);
  expect(screen.getByRole("alert")).toHaveTextContent(
    "Cars could not be refreshed",
  );
  expect(screen.queryByText("No current cars")).not.toBeInTheDocument();
});

it("keeps a reserved car visible in Reserved when its advert goes missing", () => {
  const reserved = car("reserved", {
    inventoryStatus: "reserved",
    staff: {
      ...car("x").staff,
      inventoryStatus: "reserved",
      sourceStatus: "missing",
      published: false,
    },
  });
  expect(
    filterStaffCars([reserved], "", "reserved", "stock", "all", new Map()),
  ).toHaveLength(1);
  expect(
    filterStaffCars([reserved], "", "missing", "stock", "all", new Map()),
  ).toHaveLength(1);
  expect(
    filterStaffCars([reserved], "", "all", "stock", "all", new Map()),
  ).toHaveLength(0);
  state.data!.cars = [reserved];
  window.history.replaceState({}, "", "/portal?section=cars&carsTab=reserved");
  render(<CarsWorkspace {...props} />);
  expect(
    within(screen.getByTestId("portal-car-reserved")).getByText("Reserved", {
      exact: true,
    }),
  ).toBeVisible();
});

it("offers a direct sale beside the next enquiry action only for eligible stock", () => {
  render(<CarsWorkspace {...props} />);
  const available = within(screen.getByTestId("portal-car-one"));
  expect(available.getByRole("button", { name: "New enquiry" })).toBeVisible();
  fireEvent.click(available.getByRole("button", { name: "Start sale" }));
  expect(props.onSale).toHaveBeenCalledWith("one");
  expect(within(screen.getByTestId("portal-car-two")).queryByRole("button", { name: "Start sale" })).not.toBeInTheDocument();
  expect(screen.queryByText("Official Cazoo CSV")).not.toBeInTheDocument();
});
