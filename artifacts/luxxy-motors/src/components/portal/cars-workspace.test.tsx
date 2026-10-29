import { beforeEach, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import type { Car } from "@/lib/stock-context";
import type { Enquiry } from "@workspace/api-client-react";
import { CarsWorkspace } from "./cars-workspace";
import {
  currentStockCars,
  findWorkspaceCars,
  vehicleActivityById,
} from "./cars-workspace-model";

const state = vi.hoisted(() => ({
  cars: [] as unknown[],
  loading: false,
  error: null as string | null,
  entries: [] as unknown[],
  replies: [] as unknown[],
  repliesLoading: false,
  repliesError: false,
  replyQuery: vi.fn(),
  replyRefetch: vi.fn(),
  fetch: vi.fn(),
  activityLoading: false,
  activityError: false,
  summary: vi.fn(),
  refetch: vi.fn(),
  invalidate: vi.fn(),
}));
vi.mock("@/lib/stock-context", () => ({
  useStock: () => ({
    stock: state.loading ? null : { cars: state.cars },
    isLoading: state.loading,
    error: state.error,
  }),
}));
vi.mock("@/lib/enquiry-summary-query", () => ({
  useEnquirySummaries: (_params: unknown, options: unknown) => {
    state.summary(options);
    return {
      data: state.entries,
      isPending: state.activityLoading,
      isError: state.activityError,
      refetch: state.refetch,
    };
  },
}));
vi.mock("@workspace/api-client-react", () => ({
  customFetch: (...args: unknown[]) => state.fetch(...args),
  getGetEnquiriesQueryKey: () => ["enquiries"],
  getGetStockQueryKey: () => ["stock"],
}));
vi.mock("@tanstack/react-query", () => ({
  useQuery: (options: unknown) => {
    state.replyQuery(options);
    return {
      data: { enquiries: state.replies },
      isPending: state.repliesLoading,
      isError: state.repliesError,
      refetch: state.replyRefetch,
    };
  },
  useQueryClient: () => ({ invalidateQueries: state.invalidate }),
}));
vi.mock("./enquiry-vehicle-information", () => ({
  EnquiryVehicleInformation: ({
    car,
    onClose,
    presentation,
    actions,
  }: {
    car: Car;
    onClose: () => void;
    presentation: string;
    actions: React.ReactNode;
  }) => (
    <div role="dialog" aria-label={car.title!} data-presentation={presentation}>
      <button onClick={onClose}>Close details</button>
      {actions}
    </div>
  ),
}));

const toyota = {
  id: "one",
  title: "Toyota Yaris",
  make: "Toyota",
  model: "Yaris",
  variant: "Excel",
  year: 2021,
  colour: "Black",
  transmission: "Automatic",
  fuel: "Petrol",
  price: 8990,
  mileage: 22000,
  plate: "AB12 CDE",
  inventoryStatus: "available",
  images: [],
} as unknown as Car;
const mg = {
  ...toyota,
  id: "two",
  title: "MG HS",
  make: "MG",
  model: "HS",
  colour: "Red",
  price: 14990,
  plate: "XY22 ZZZ",
  inventoryStatus: "reserved",
};
const now = Date.parse("2030-01-01T12:00:00Z");
const enquiry = (overrides: Partial<Enquiry> = {}) =>
  ({
    id: "enq-one",
    reference: "ENQ-001",
    dealerId: "dealer-one",
    type: "viewing",
    vehicleId: "one",
    customerName: "Alex",
    createdAt: "2029-12-01T12:00:00Z",
    appointmentAt: null,
    appointmentCancelledAt: null,
    appointmentStatus: null,
    ...overrides,
  }) as Enquiry;

beforeEach(() => {
  vi.clearAllMocks();
  state.cars = [toyota, mg];
  state.loading = false;
  state.error = null;
  state.entries = [];
  state.replies = [];
  state.repliesLoading = false;
  state.repliesError = false;
  state.activityLoading = false;
  state.activityError = false;
});

it("only includes available and reserved current stock, retaining stock order", () => {
  expect(
    currentStockCars([
      mg,
      { ...toyota, id: "sold", inventoryStatus: "sold" },
      toyota,
      { ...toyota, id: "unknown", inventoryStatus: null },
    ]).map((car) => car.id),
  ).toEqual(["two", "one"]);
});

it("does not keep a past test drive after time moves on with unchanged cached records", () => {
  const clock = vi.spyOn(Date, "now").mockReturnValue(now);
  try {
    state.entries = [
      enquiry({
        appointmentAt: "2030-01-02T12:00:00Z",
        appointmentStatus: "confirmed",
      }),
    ];
    const props = {
      canManage: true,
      bookingEnabled: true,
      onEnquiry: vi.fn(),
      onSale: vi.fn(),
    };
    const view = render(<CarsWorkspace {...props} />);
    expect(screen.getByText(/^Next test drive/)).toBeVisible();
    clock.mockReturnValue(Date.parse("2030-01-03T12:00:00Z"));
    view.rerender(<CarsWorkspace {...props} />);
    expect(screen.queryByText(/^Next test drive/)).not.toBeInTheDocument();
  } finally {
    clock.mockRestore();
  }
});

it("combines flexible car search with availability and puts missing prices last in either direction", () => {
  const missing = { ...toyota, id: "missing", price: null };
  const cars = [mg, missing, toyota];
  expect(
    findWorkspaceCars(cars, "black auto Toyota", "available", "stock").map(
      (car) => car.id,
    ),
  ).toEqual(["missing", "one"]);
  expect(
    findWorkspaceCars(cars, "", "reserved", "stock").map((car) => car.id),
  ).toEqual(["two"]);
  expect(
    findWorkspaceCars(cars, "AB12CDE", "all", "price-asc").map((car) => car.id),
  ).toEqual(["one", "missing"]);
  expect(
    findWorkspaceCars(cars, "", "all", "price-desc").map((car) => car.id),
  ).toEqual(["two", "one", "missing"]);
  expect(cars.map((car) => car.id)).toEqual(["two", "missing", "one"]);
});

it("counts explicit merged cases once but preserves separate customers sharing a phone", () => {
  const primary = enquiry({ phone: "07000000000" });
  const child = enquiry({ id: "child", mergedIntoId: primary.id });
  const separate = enquiry({ id: "separate", phone: primary.phone });
  const otherCar = enquiry({
    id: "other",
    vehicleId: "two",
    mergedIntoId: primary.id,
  });
  const result = vehicleActivityById(
    [
      primary,
      child,
      separate,
      otherCar,
      enquiry({ id: "general", vehicleId: null }),
    ],
    now,
  );
  expect(result.get("one")?.cases.map((entry) => entry.id)).toEqual([
    "enq-one",
    "separate",
  ]);
  expect(result.get("two")?.cases.map((entry) => entry.id)).toEqual([
    "enq-one",
  ]);
  expect(result.size).toBe(2);
});

it("shows the next approved or legacy booking, excluding pending, cancelled, attended and past appointments", () => {
  const entries = [
    enquiry({ id: "legacy", appointmentAt: "2030-01-03T12:00:00Z" }),
    enquiry({
      id: "approved",
      appointmentAt: "2030-01-02T12:00:00Z",
      appointmentStatus: "confirmed",
      attendance: "scheduled",
    }),
    enquiry({
      id: "pending",
      appointmentAt: "2030-01-02T10:00:00Z",
      appointmentStatus: "pending",
    }),
    enquiry({
      id: "cancelled",
      appointmentAt: "2030-01-02T08:00:00Z",
      appointmentCancelledAt: "2029-12-31T12:00:00Z",
    }),
    ...(["arrived", "completed", "no_show"] as const).map((attendance) =>
      enquiry({
        id: attendance,
        attendance,
        appointmentAt: "2030-01-02T08:00:00Z",
      }),
    ),
    enquiry({ id: "past", appointmentAt: "2029-12-31T12:00:00Z" }),
    enquiry({ id: "invalid", appointmentAt: "bad date" }),
    enquiry({
      id: "general-time",
      type: "general",
      appointmentAt: "2030-01-02T07:00:00Z",
    }),
    enquiry({
      id: "delivery-time",
      type: "delivery",
      appointmentAt: "2030-01-02T07:00:00Z",
    }),
  ];
  const result = vehicleActivityById(entries, now).get("one")!;
  expect(result.nextAppointment?.id).toBe("approved");
  expect(result.pendingAppointments.map((entry) => entry.id)).toEqual([
    "pending",
  ]);
  expect(
    vehicleActivityById([entries[0]], now).get("one")?.nextAppointment?.id,
  ).toBe("legacy");
});

it("searches current cars and filters availability without changing any records", () => {
  const onEnquiry = vi.fn();
  const onSale = vi.fn();
  render(
    <CarsWorkspace
      canManage
      bookingEnabled
      onEnquiry={onEnquiry}
      onSale={onSale}
    />,
  );
  fireEvent.change(
    screen.getByRole("searchbox", { name: "Search current cars" }),
    { target: { value: "MG red auto" } },
  );
  expect(screen.queryByTestId("portal-car-one")).not.toBeInTheDocument();
  expect(screen.getByTestId("portal-car-two")).toHaveTextContent("Reserved");
  fireEvent.click(screen.getByRole("button", { name: "Available 1" }));
  expect(screen.getByText("No matching cars")).toBeInTheDocument();
  fireEvent.click(
    screen.getByRole("button", { name: "Clear search and filters" }),
  );
  fireEvent.click(
    within(screen.getByTestId("portal-car-one")).getByRole("button", {
      name: "New enquiry",
    }),
  );
  expect(onEnquiry).toHaveBeenCalledWith("one");
  expect(onSale).not.toHaveBeenCalled();
});

it("opens the shared side panel, preserving search and closes it before handing off to a booking or sale", () => {
  const onEnquiry = vi.fn(() =>
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
  );
  const onSale = vi.fn();
  render(
    <CarsWorkspace
      canManage
      bookingEnabled
      onEnquiry={onEnquiry}
      onSale={onSale}
    />,
  );
  fireEvent.change(screen.getByRole("searchbox"), {
    target: { value: "Toyota" },
  });
  fireEvent.click(
    screen.getByRole("button", { name: "View details for Toyota Yaris" }),
  );
  expect(screen.getByRole("dialog")).toHaveAttribute(
    "data-presentation",
    "panel",
  );
  fireEvent.click(
    within(screen.getByRole("dialog")).getByRole("button", {
      name: "Book test drive",
    }),
  );
  expect(onEnquiry).toHaveBeenCalledWith("one", true);
  expect(screen.getByRole("searchbox")).toHaveValue("Toyota");
});

it("omits book actions when booking is off and sale actions for reserved vehicles", () => {
  render(
    <CarsWorkspace
      canManage
      bookingEnabled={false}
      onEnquiry={vi.fn()}
      onSale={vi.fn()}
    />,
  );
  fireEvent.click(
    screen.getByRole("button", { name: "View details for Toyota Yaris" }),
  );
  expect(
    within(screen.getByRole("dialog")).queryByRole("button", {
      name: "Book test drive",
    }),
  ).not.toBeInTheDocument();
  expect(
    within(screen.getByRole("dialog")).getByRole("button", {
      name: "Start sale",
    }),
  ).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Close details" }));
  fireEvent.click(
    screen.getByRole("button", { name: "View details for MG HS" }),
  );
  expect(
    within(screen.getByRole("dialog")).queryByRole("button", {
      name: "Start sale",
    }),
  ).not.toBeInTheDocument();
  expect(
    within(screen.getByRole("dialog")).getByRole("button", {
      name: "New enquiry",
    }),
  ).toBeInTheDocument();
});

it("keeps customer activity and management actions unavailable without permission, without fetching it", () => {
  render(
    <CarsWorkspace
      canManage={false}
      bookingEnabled
      onEnquiry={vi.fn()}
      onSale={vi.fn()}
    />,
  );
  expect(state.summary).toHaveBeenLastCalledWith({
    query: expect.objectContaining({ enabled: false, refetchInterval: false }),
  });
  expect(
    screen.queryByRole("button", { name: "New enquiry" }),
  ).not.toBeInTheDocument();
  expect(screen.queryByText("No enquiries yet")).not.toBeInTheDocument();
  fireEvent.click(
    screen.getByRole("button", { name: "View details for Toyota Yaris" }),
  );
  expect(
    screen.queryByRole("button", { name: "Start sale" }),
  ).not.toBeInTheDocument();
});

it("uses actual enquiry links and original appointment links, rather than inferred customer matches", () => {
  state.entries = [
    enquiry(),
    enquiry({
      id: "source-booking",
      mergedIntoId: "enq-one",
      appointmentAt: "2099-01-02T12:00:00Z",
      appointmentStatus: "confirmed",
    }),
  ];
  render(
    <CarsWorkspace
      canManage
      bookingEnabled
      onEnquiry={vi.fn()}
      onSale={vi.fn()}
    />,
  );
  const row = within(screen.getByTestId("portal-car-one"));
  expect(row.getByText("1 enquiry")).toBeVisible();
  expect(row.getByRole("link", { name: /^Alex / })).toHaveAttribute(
    "href",
    "/portal?section=notifications&workView=customers&enquiryId=enq-one",
  );
  expect(row.getByRole("link", { name: /Next test drive/ })).toHaveAttribute(
    "href",
    "/portal?section=notifications&workView=customers&enquiryId=source-booking",
  );
});

it("does not claim zero activity while loading or after an error", () => {
  state.activityLoading = true;
  const view = render(
    <CarsWorkspace
      canManage
      bookingEnabled
      onEnquiry={vi.fn()}
      onSale={vi.fn()}
    />,
  );
  expect(screen.getAllByText("Loading customer activity…")).toHaveLength(2);
  expect(screen.queryByText("No enquiries yet")).not.toBeInTheDocument();
  state.activityLoading = false;
  state.activityError = true;
  view.rerender(
    <CarsWorkspace
      canManage
      bookingEnabled
      onEnquiry={vi.fn()}
      onSale={vi.fn()}
    />,
  );
  expect(screen.getAllByText("Activity unavailable")).toHaveLength(2);
  expect(screen.queryByText("No upcoming test drive")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Try again" }));
  expect(state.refetch).toHaveBeenCalledOnce();
});

it("uses honest missing details for Cazoo cars and shows stock loading and failure states", () => {
  state.cars = [
    {
      ...toyota,
      plate: null,
      registration: "21 reg",
      vrm: null,
      price: null,
      mileage: null,
      mileageText: null,
    },
  ];
  const view = render(
    <CarsWorkspace
      canManage
      bookingEnabled
      onEnquiry={vi.fn()}
      onSale={vi.fn()}
    />,
  );
  expect(screen.getByTestId("portal-car-one")).toHaveTextContent(
    "Registration not supplied",
  );
  expect(screen.getByTestId("portal-car-one")).toHaveTextContent(
    "Price not supplied",
  );
  expect(screen.getByTestId("portal-car-one")).toHaveTextContent(
    "Mileage not supplied",
  );
  expect(screen.getByTestId("portal-car-one")).not.toHaveTextContent("£0");
  state.loading = true;
  view.rerender(
    <CarsWorkspace
      canManage
      bookingEnabled
      onEnquiry={vi.fn()}
      onSale={vi.fn()}
    />,
  );
  expect(screen.getByLabelText("Loading cars")).toBeInTheDocument();
  state.loading = false;
  state.error = "Network unavailable";
  state.cars = [];
  view.rerender(
    <CarsWorkspace
      canManage
      bookingEnabled
      onEnquiry={vi.fn()}
      onSale={vi.fn()}
    />,
  );
  expect(screen.getByRole("alert")).toHaveTextContent(
    "Stock could not be refreshed",
  );
  expect(screen.queryByText("No current cars")).not.toBeInTheDocument();
});

it("keeps a merged child's actual reply or follow-up attached to its own vehicle and source record", () => {
  const parent = enquiry({
    type: "general",
    status: "contacted",
    vehicleId: "one",
    customerName: "Alex Buyer",
  });
  const child = {
    ...enquiry({
      id: "child-reply",
      mergedIntoId: parent.id,
      type: "general",
      vehicleId: "one",
    }),
    pendingEmailReplies: 2,
  };
  const otherCar = enquiry({
    id: "other-car-followup",
    mergedIntoId: parent.id,
    vehicleId: "two",
    followUpAt: "2029-12-31T12:00:00Z",
  });
  const records = [parent, child, otherCar];
  const before = structuredClone(records);
  const result = vehicleActivityById(records, now);
  expect(result.get("one")?.cases).toHaveLength(1);
  expect(result.get("one")?.customers[0]).toMatchObject({
    customer: { id: parent.id, customerName: "Alex Buyer" },
    task: { id: child.id },
    presentation: { state: "Customer replied" },
  });
  expect(result.get("two")?.customers[0]).toMatchObject({
    customer: { id: parent.id },
    task: { id: otherCar.id },
    presentation: { state: "Follow-up overdue" },
  });
  expect(records).toEqual(before);
});

it("shows real customer names and recorded reply/follow-up work, opening the correct original customer record", () => {
  state.entries = [
    enquiry({
      type: "general",
      customerName: "Alex Buyer",
      status: "contacted",
    }),
    enquiry({
      id: "reply-child",
      mergedIntoId: "enq-one",
      type: "general",
      customerName: "Alex Buyer",
    }),
    enquiry({
      id: "followup",
      customerName: "Sam Driver",
      type: "general",
      followUpAt: "2020-01-01T12:00:00Z",
      phone: "07700900123",
    }),
  ];
  state.replies = [{ enquiryId: "reply-child", pending: 2, review: 0 }];
  const onOpenEnquiry = vi.fn(),
    onEnquiry = vi.fn(),
    onSale = vi.fn();
  render(
    <CarsWorkspace
      canManage
      bookingEnabled
      onEnquiry={onEnquiry}
      onSale={onSale}
      onOpenEnquiry={onOpenEnquiry}
    />,
  );
  const row = within(screen.getByTestId("portal-car-one"));
  expect(row.getByText("2 enquiries")).toBeVisible();
  expect(row.getByText("Alex Buyer")).toBeVisible();
  expect(row.getByText("Customer replied")).toBeVisible();
  expect(row.getByText("2 customer replies to review")).toBeVisible();
  expect(row.getByText("Sam Driver")).toBeVisible();
  expect(row.getByText(/Follow-up overdue/)).toBeVisible();
  const reply = row.getByRole("link", { name: /^Alex Buyer / });
  expect(reply).toHaveAttribute(
    "href",
    "/portal?section=notifications&workView=customers&enquiryId=reply-child",
  );
  fireEvent.click(reply);
  expect(onOpenEnquiry).toHaveBeenCalledExactlyOnceWith("reply-child");
  fireEvent.click(row.getByRole("link", { name: /^Sam Driver / }));
  expect(onOpenEnquiry).toHaveBeenLastCalledWith("followup");
  expect(onEnquiry).not.toHaveBeenCalled();
  expect(onSale).not.toHaveBeenCalled();
});

it("shares one permission-gated reply aggregate and explicitly disables polling", async () => {
  render(
    <CarsWorkspace
      canManage
      bookingEnabled
      onEnquiry={vi.fn()}
      onSale={vi.fn()}
    />,
  );
  expect(state.replyQuery).toHaveBeenCalledOnce();
  const options = state.replyQuery.mock.calls[0][0];
  expect(options).toMatchObject({
    queryKey: ["reply-attention"],
    enabled: true,
    refetchInterval: false,
    retry: false,
  });
  await options.queryFn();
  expect(state.fetch).toHaveBeenCalledExactlyOnceWith(
    "/api/staff/email/reply-attention",
  );
});

it("does not disclose cached customer names or reply status to staff without management permission", () => {
  state.entries = [enquiry({ customerName: "Private Buyer" })];
  state.replies = [{ enquiryId: "enq-one", pending: 2, review: 0 }];
  render(
    <CarsWorkspace
      canManage={false}
      bookingEnabled
      onEnquiry={vi.fn()}
      onSale={vi.fn()}
      onOpenEnquiry={vi.fn()}
    />,
  );
  expect(state.replyQuery).toHaveBeenLastCalledWith(
    expect.objectContaining({ enabled: false, refetchInterval: false }),
  );
  expect(screen.queryByText("Private Buyer")).not.toBeInTheDocument();
  expect(screen.queryByText("Customer replied")).not.toBeInTheDocument();
});

it("keeps the customer enquiries and bookings visible when reply status fails, with an honest retry state", () => {
  state.entries = [
    enquiry({
      customerName: "Alex Buyer",
      appointmentAt: "2099-01-02T12:00:00Z",
      appointmentStatus: "confirmed",
    }),
  ];
  state.repliesError = true;
  render(
    <CarsWorkspace
      canManage
      bookingEnabled
      onEnquiry={vi.fn()}
      onSale={vi.fn()}
    />,
  );
  const row = within(screen.getByTestId("portal-car-one"));
  expect(row.getByText("Alex Buyer")).toBeVisible();
  expect(row.getByText("Email reply status unavailable")).toBeVisible();
  expect(
    row.getByRole("link", { name: /Next test drive · Alex Buyer/ }),
  ).toBeVisible();
  expect(screen.queryByText("No enquiries yet")).toBeInTheDocument(); // Only the unrelated MG row has none.
  fireEvent.click(screen.getByRole("button", { name: "Retry reply status" }));
  expect(state.replyRefetch).toHaveBeenCalledOnce();
});

it("shows two useful customer names first and puts additional customers behind one tidy disclosure", () => {
  state.entries = [
    enquiry({
      id: "first",
      type: "general",
      customerName: "First Buyer",
      status: "closed",
    }),
    enquiry({
      id: "urgent",
      type: "general",
      customerName: "Reply Buyer",
      status: "contacted",
    }),
    enquiry({
      id: "due",
      type: "general",
      customerName: "Follow-up Buyer",
      followUpAt: "2020-01-01T12:00:00Z",
    }),
  ];
  state.replies = [{ enquiryId: "urgent", pending: 1, review: 0 }];
  render(
    <CarsWorkspace
      canManage
      bookingEnabled
      onEnquiry={vi.fn()}
      onSale={vi.fn()}
    />,
  );
  const row = within(screen.getByTestId("portal-car-one"));
  expect(row.getByText("Reply Buyer")).toBeVisible();
  expect(row.getByText("Follow-up Buyer")).toBeVisible();
  const more = row.getByText("1 more customer");
  expect(more.closest("details")).not.toHaveAttribute("open");
  fireEvent.click(more);
  expect(more.closest("details")).toHaveAttribute("open");
  expect(row.getByRole("link", { name: /First Buyer Closed/ })).toBeVisible();
});
