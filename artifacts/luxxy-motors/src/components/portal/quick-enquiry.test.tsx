import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
const state = vi.hoisted(() => ({
  create: vi.fn(),
  createBooking: vi.fn(),
  availabilityOptions: vi.fn(),
  availabilityRetry: vi.fn(),
  featureRetry: vi.fn(),
  availabilityLoading: false,
  availabilityError: false,
  hasAvailableTime: true,
  bookingEnabled: true,
  settingsLoading: false,
  settingsError: false,
  featureEnabled: true,
  featureLoading: false,
  featureFetching: false,
  featureError: false,
  inventoryStatus: "available",

  options: vi.fn(),
  directoryOptions: vi.fn(),
  recentOptions: vi.fn(),
  recentCustomers: [] as Array<Record<string, unknown>>,
  recentError: false,
  accessRetry: vi.fn(),
  directoryRetry: vi.fn(),
  allowed: true,
  accessLoading: false,
  accessError: false,
  directoryLoading: false,
  directoryError: false,
  stockLoading: false,
  stockError: null as string | null,
}));
vi.mock("@/lib/enquiry-summary-query", () => ({
  useEnquirySummaries: (_params: unknown, options: unknown) => {
    state.recentOptions(options);
    return { data: state.recentCustomers, isError: state.recentError };
  },
}));
vi.mock("@workspace/api-client-react", () => ({
  getGetEnquiriesQueryKey: () => ["/api/enquiries"],
  getGetStockQueryKey: () => ["/api/stock"],
  getGetStaffDirectoryQueryKey: () => ["/api/staff/directory"],
  getGetDealerSettingsQueryKey: () => ["/api/dealer-settings"],
  useCreateStaffEnquiry: (options: { request?: { headers?: Record<string, string> } } = {}) => {
    state.options(options);
    return { mutateAsync: options.request?.headers?.["X-Enquiry-Capture"] === "quick" ? state.create : state.createBooking, isPending: false };
  },
  getGetTestDriveBookingsQueryKey: () => ["/api/test-drive-bookings"],
  getGetEnquiryAvailabilityQueryKey: (params?: { date: string }) => params ? ["/api/enquiries/availability", params] : ["/api/enquiries/availability"],
  getGetStaffAppointmentAvailabilityQueryKey: (id: string, { date }: { date: string }) => ["/api/staff/appointments", id, { date }],
  useGetEnquiryAvailability: ({ date }: { date: string }, options: unknown) => {
    state.availabilityOptions(options);
    return {
      data: state.availabilityLoading || state.availabilityError ? undefined : { date, slots: [{ startAt: `${date}T14:00:00.000Z`, label: "15:00", available: state.hasAvailableTime }] },
      isLoading: state.availabilityLoading,
      isError: state.availabilityError,
      refetch: state.availabilityRetry,
    };
  },
  useGetStaffAppointmentAvailability: () => ({ data: { slots: [] }, isLoading: false, isError: false, refetch: state.availabilityRetry }),
  useGetStaffDirectory: (options: unknown) => {
    state.directoryOptions(options);
    return {
      data:
        state.directoryLoading || state.directoryError
          ? undefined
          : { currentUserId: "staff-current", members: [] },
      isLoading: state.directoryLoading,
      isError: state.directoryError,
      refetch: state.directoryRetry,
    };
  },
}));
vi.mock("@/lib/dealer-features", () => ({
  useDealerFeatures: () => ({
    data: state.featureLoading ? undefined : { features: { testDriveBookings: state.featureEnabled } },
    isLoading: state.featureLoading,
    isFetching: state.featureFetching,
    isError: state.featureError,
    isSuccess: !state.featureError && !state.featureLoading,
    enabled: () => state.featureEnabled,
    refetch: state.featureRetry,
  }),
}));
vi.mock("@/lib/dealer-settings-context", () => ({
  useDealerSettings: () => ({
    settings: {
      testDriveBooking: {
        enabled: state.bookingEnabled,
        durationMinutes: 30,
        bufferMinutes: 0,
        minimumNoticeHours: 0,
        dailyCapacity: 16,
        daysAhead: 7,
        blockedDates: [],
        instructions: "",
        confirmationMode: "instant",
        weeklyHours: Array.from({ length: 7 }, (_, day) => ({ day, enabled: true, open: "08:00", close: "18:00" })),
      },
    },
    isLoading: state.settingsLoading,
    isError: state.settingsError,
  }),
}));
vi.mock("./dealer-administration", () => ({
  useStaffAccess: () => ({
    data: state.accessLoading
      ? undefined
      : { permissions: state.allowed ? ["sales.manage"] : [] },
    isLoading: state.accessLoading,
    isError: state.accessError,
    refetch: state.accessRetry,
  }),
}));
vi.mock("@/lib/stock-context", () => ({
  useStock: () => ({
    stock: {
      cars: [
        {
          id: "car-one",
          title: "Ford Focus",
          year: 2019,
          plate: "AB69CDE",
          registration: "2019",
          inventoryStatus: state.inventoryStatus,
        },
        { id: "car-two", title: "Toyota Yaris", year: 2020, inventoryStatus: "available" },
      ],
    },
    isLoading: state.stockLoading,
    error: state.stockError,
  }),
}));
vi.mock("./enquiry-email-composer", () => ({ EnquiryEmailComposer: ({ entry, onClose }: { entry: { id: string; customerName: string }; onClose: () => void }) => <div role="dialog" aria-label="Customer message"><p>Message for {entry.customerName}</p><p>{entry.id}</p><button onClick={onClose}>Return to saved enquiry</button></div> }));
import { QuickEnquiryDialog } from "./quick-enquiry";
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-19T09:00:00Z"));
  state.createBooking.mockReset().mockResolvedValue({ id: "booking-new", reference: "ENQ-BOOK", appointmentAt: "2026-10-19T14:00:00.000Z" });
  state.availabilityOptions.mockClear();
  state.availabilityRetry.mockClear();
  state.featureRetry.mockClear();
  state.availabilityLoading = false;
  state.availabilityError = false;
  state.hasAvailableTime = true;
  state.bookingEnabled = true;
  state.settingsLoading = false;
  state.settingsError = false;
  state.featureEnabled = true;
  state.featureLoading = false;
  state.featureFetching = false;
  state.featureError = false;
  state.inventoryStatus = "available";
  state.create
    .mockReset()
    .mockResolvedValue({ id: "enquiry-new", reference: "ENQ-123" });
  state.options.mockClear();
  state.directoryOptions.mockClear();
  state.recentOptions.mockClear();
  state.recentCustomers = [];
  state.recentError = false;
  state.accessRetry.mockClear();
  state.directoryRetry.mockClear();
  state.allowed = true;
  state.accessLoading = false;
  state.accessError = false;
  state.directoryLoading = false;
  state.directoryError = false;
  state.stockLoading = false;
  state.stockError = null;
});
afterEach(() => vi.useRealTimers());
function mount(open = true, initialVehicleId?: string) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const invalidate = vi.spyOn(client, "invalidateQueries").mockResolvedValue();
  const onOpenChange = vi.fn(),
    onCreated = vi.fn();
  const view = render(
    <QueryClientProvider client={client}>
      <QuickEnquiryDialog
        open={open}
        initialVehicleId={initialVehicleId}
        onOpenChange={onOpenChange}
        onCreated={onCreated}
      />
    </QueryClientProvider>,
  );
  return { ...view, invalidate, onOpenChange, onCreated };
}
function fill() {
  fireEvent.change(screen.getByRole("combobox", { name: "Customer name" }), {
    target: { value: "  Alex Smith  " },
  });
  fireEvent.change(screen.getByRole("combobox", { name: "Phone number" }), {
    target: { value: " 07700 900123 " },
  });
}
it("autofills a recent customer while keeping the chosen car and notes for this enquiry", () => {
  const recent = { id: "old-enquiry", reference: "ENQ-OLD", customerName: "Amelia Taylor", phone: "07700900124", email: "amelia@example.test", vehicleId: "old-car", vehicleTitle: "Previous car", createdAt: "2026-10-01T10:00:00Z" };
  state.recentCustomers = [recent];
  const before = JSON.stringify(recent);
  mount(true, "car-one");
  const name = screen.getByRole("combobox", { name: "Customer name" });
  fireEvent.focus(name);
  fireEvent.change(name, { target: { value: "Amel" } });
  fireEvent.click(screen.getByRole("option", { name: /Amelia Taylor/ }));
  expect(name).toHaveValue(recent.customerName);
  expect(screen.getByRole("combobox", { name: "Phone number" })).toHaveValue(recent.phone);
  expect(screen.getByRole("combobox", { name: "Email (optional)" })).toHaveValue(recent.email);
  expect(screen.getByRole("article", { name: "Selected car" })).toHaveTextContent("Ford Focus");
  expect(screen.getByRole("textbox", { name: "Notes (optional)" })).toHaveValue("");
  expect(state.create).not.toHaveBeenCalled();
  expect(JSON.stringify(recent)).toBe(before);
});

it("keeps manual capture available if recent contacts fail to load", () => {
  state.recentError = true;
  mount();
  expect(screen.getByText("Recent customers could not load. You can still enter their details.")).toBeVisible();
  fill();
  expect(screen.getByRole("combobox", { name: "Customer name" })).toHaveValue("  Alex Smith  ");
  expect(state.create).not.toHaveBeenCalled();
});

it("only loads recent customer suggestions while the dialog is open with staff access", () => {
  const view = mount(false);
  expect(state.recentOptions).toHaveBeenLastCalledWith(expect.objectContaining({ query: expect.objectContaining({ enabled: false }) }));
  view.unmount();
  state.allowed = false;
  mount(true);
  expect(state.recentOptions).toHaveBeenLastCalledWith(expect.objectContaining({ query: expect.objectContaining({ enabled: false }) }));
});

it("starts a car enquiry with the chosen stock car and keeps capture in place", async () => {
  const view = mount(true, "car-one");
  expect(screen.getByRole("article", { name: "Selected car" })).toHaveTextContent("Ford Focus");
  fill();
  fireEvent.click(screen.getByRole("button", { name: "Save enquiry" }));
  await waitFor(() => expect(view.onCreated).toHaveBeenCalled());
  expect(state.create.mock.calls[0][0].data.vehicleId).toBe("car-one");
});
it("lets staff cancel a preselected car enquiry without a discard warning until they edit it", () => {
  const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
  const view = mount(true, "car-one");
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(confirm).not.toHaveBeenCalled();
  expect(view.onOpenChange).toHaveBeenCalledWith(false);
  confirm.mockRestore();
});
it("captures a general enquiry in place using the no-email mode and the current staff owner", async () => {
  const view = mount();
  fill();
  fireEvent.change(screen.getByRole("combobox", { name: "Email (optional)" }), {
    target: { value: " alex@example.test " },
  });
  fireEvent.change(screen.getByRole("searchbox"), { target: { value: "Ford" } });
  fireEvent.click(screen.getByRole("button", { name: /Ford Focus/ }));
  fireEvent.change(screen.getByRole("textbox", { name: "Notes (optional)" }), {
    target: { value: "  Please call about the service history.  " },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save enquiry" }));
  await waitFor(() =>
    expect(view.onCreated).toHaveBeenCalledWith({
      id: "enquiry-new",
      reference: "ENQ-123",
    }),
  );
  expect(state.options).toHaveBeenCalledWith({
    request: { headers: { "X-Enquiry-Capture": "quick" } },
    mutation: { retry: false },
  });
  expect(state.create).toHaveBeenCalledExactlyOnceWith({
    data: {
      assignedToId: "staff-current",
      type: "general",
      customerName: "Alex Smith",
      phone: "07700 900123",
      email: "alex@example.test",
      preferredContact: "phone",
      vehicleId: "car-one",
      message: "Please call about the service history.",
      appointmentAt: null,
    },
  });
  expect(view.onOpenChange).toHaveBeenCalledWith(false);
  for (const key of [
    ["/api/enquiries"],
    ["staff-notifications"],
    ["dealer-operations"],
    ["staff-relationships"],
    ["inventory-customers"],
  ])
    expect(view.invalidate).toHaveBeenCalledWith({ queryKey: key });
  expect(screen.getByRole("combobox", { name: "Customer name" })).toHaveValue(
    "",
  );
  expect(
    screen.getByText("Enquiry only: no email is sent."),
  ).toBeVisible();
});
it("allows no email, car or notes and never creates an appointment or callback", async () => {
  mount();
  fill();
  fireEvent.click(screen.getByRole("button", { name: "Save enquiry" }));
  await waitFor(() => expect(state.create).toHaveBeenCalledTimes(1));
  const payload = state.create.mock.calls[0][0].data;
  expect(payload).toMatchObject({
    email: null,
    vehicleId: null,
    appointmentAt: null,
    type: "general",
    message: "Customer enquiry recorded by our showroom.",
  });
  expect(payload).not.toHaveProperty("followUpAt");
  expect(payload).not.toHaveProperty("allowOutsideHours");
  expect(payload).not.toHaveProperty("adHocVehicle");
});
it.each([
  ["Customer name", "A", "Enter the customer’s name (2–120 characters)."],
  ["Phone number", "123", "Enter a valid contact number."],
  [
    "Email (optional)",
    "not-an-email",
    "Enter a valid email address, or leave it blank.",
  ],
])("validates %s before making any request", async (field, value, message) => {
  mount();
  fill();
  fireEvent.change(screen.getByLabelText(field), {
    target: { value },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save enquiry" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(message);
  expect(state.create).not.toHaveBeenCalled();
});
it("keeps all details and the server explanation when saving fails", async () => {
  state.create.mockRejectedValue({
    status: 409,
    data: { error: "This car has changed. Please choose it again." },
  });
  const view = mount();
  fill();
  fireEvent.change(screen.getByRole("textbox", { name: "Notes (optional)" }), {
    target: { value: "Customer notes" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save enquiry" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "This car has changed. Please choose it again.",
  );
  expect(screen.getByRole("combobox", { name: "Customer name" })).toHaveValue(
    "  Alex Smith  ",
  );
  expect(screen.getByRole("textbox", { name: "Notes (optional)" })).toHaveValue(
    "Customer notes",
  );
  expect(view.onOpenChange).not.toHaveBeenCalled();
  expect(view.onCreated).not.toHaveBeenCalled();
  expect(state.create).toHaveBeenCalledTimes(1);
});
it("does not automatically retry an uncertain save", async () => {
  state.create.mockRejectedValue(new Error("Network disconnected"));
  mount();
  fill();
  fireEvent.click(screen.getByRole("button", { name: "Save enquiry" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Check Enquiries or Test drives before retrying",
  );
  expect(state.create).toHaveBeenCalledTimes(1);
});
it("prevents duplicate submits and closing until the pending save finishes", async () => {
  let resolve!: (value: unknown) => void;
  state.create.mockImplementation(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  const view = mount();
  fill();
  const form = screen
    .getByRole("button", { name: "Save enquiry" })
    .closest("form")!;
  fireEvent.submit(form);
  fireEvent.submit(form);
  fireEvent.click(screen.getByRole("button", { name: "Close" }));
  fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
  expect(state.create).toHaveBeenCalledTimes(1);
  expect(view.onOpenChange).not.toHaveBeenCalled();
  expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
  resolve({ id: "enquiry-new", reference: "ENQ-123" });
  await waitFor(() => expect(view.onCreated).toHaveBeenCalledTimes(1));
});
it("confirms discarding a dirty enquiry and preserves it when staff choose to keep editing", () => {
  const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
  const view = mount();
  fill();
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(confirm).toHaveBeenCalledTimes(1);
  expect(view.onOpenChange).not.toHaveBeenCalled();
  expect(screen.getByRole("combobox", { name: "Customer name" })).toHaveValue(
    "  Alex Smith  ",
  );
  confirm.mockReturnValue(true);
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(view.onOpenChange).toHaveBeenCalledWith(false);
  expect(screen.getByRole("combobox", { name: "Customer name" })).toHaveValue(
    "",
  );
  expect(state.create).not.toHaveBeenCalled();
  confirm.mockRestore();
});
it("shows access loading and does not expose a form to staff without permission", () => {
  state.accessLoading = true;
  const view = mount();
  expect(screen.getByRole("status")).toHaveTextContent(
    "Checking your staff access",
  );
  expect(
    screen.queryByRole("button", { name: "Save enquiry" }),
  ).not.toBeInTheDocument();
  view.unmount();
  state.accessLoading = false;
  state.allowed = false;
  mount();
  expect(
    screen.getByText("Your staff role does not allow creating enquiries."),
  ).toBeVisible();
  expect(
    screen.queryByRole("combobox", { name: "Customer name" }),
  ).not.toBeInTheDocument();
  expect(state.create).not.toHaveBeenCalled();
});
it("retains typed details while staff details are loading or need retrying", () => {
  state.directoryError = true;
  mount();
  fill();
  expect(screen.getByRole("button", { name: "Save enquiry" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Retry staff details" }));
  expect(state.directoryRetry).toHaveBeenCalledTimes(1);
  expect(screen.getByRole("combobox", { name: "Customer name" })).toHaveValue(
    "  Alex Smith  ",
  );
  expect(state.create).not.toHaveBeenCalled();
});
it("allows a general enquiry when stock is unavailable and keeps closed dialogs inactive", async () => {
  state.stockError = "Unavailable";
  const view = mount();
  fill();
  expect(
    screen.getByText(
      "Stock could not load. You can still take a general enquiry.",
    ),
  ).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Save enquiry" }));
  await waitFor(() => expect(state.create).toHaveBeenCalledTimes(1));
  view.unmount();
  mount(false);
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(state.directoryOptions).toHaveBeenLastCalledWith({
    query: { queryKey: ["/api/staff/directory"], enabled: false, retry: false },
  });
});

function turnOnTestDrive() {
  fireEvent.click(screen.getByRole("checkbox", { name: /^Book a Test Drive/ }));
}
async function chooseTestDrive() {
  turnOnTestDrive();
  fireEvent.click(await screen.findByRole("button", { name: "15:00" }));
}
const bookingButton = () => screen.getByRole("button", { name: "Save enquiry & book test drive" });

it("books one test drive atomically through normal staff creation without the quick no-email header", async () => {
  const view = mount(true, "car-one");
  fill();
  fireEvent.change(screen.getByRole("combobox", { name: "Email (optional)" }), { target: { value: " alex@example.test " } });
  fireEvent.change(screen.getByRole("textbox", { name: "Notes (optional)" }), { target: { value: "  Would like a test drive.  " } });
  expect(screen.getByRole("checkbox", { name: /^Book a Test Drive/ })).not.toBeChecked();
  await chooseTestDrive();
  expect(screen.getAllByText(/UK time/).length).toBeGreaterThan(0);
  fireEvent.click(bookingButton());
  await waitFor(() => expect(view.onCreated).toHaveBeenCalledTimes(1));
  expect(state.create).not.toHaveBeenCalled();
  expect(state.createBooking).toHaveBeenCalledExactlyOnceWith({ data: {
    assignedToId: "staff-current",
    type: "viewing",
    customerName: "Alex Smith",
    phone: "07700 900123",
    email: "alex@example.test",
    preferredContact: "phone",
    vehicleId: "car-one",
    message: "Would like a test drive.",
    appointmentAt: "2026-10-19T14:00:00.000Z",
    callOutcome: "test_drive_booked",
    allowOutsideHours: false,
    allowDoubleBooking: false,
  } });
  expect(state.options).toHaveBeenCalledWith({ mutation: { retry: false } });
  expect(view.onCreated).toHaveBeenCalledWith(expect.objectContaining({ id: "booking-new", reference: "ENQ-BOOK", appointmentAt: "2026-10-19T14:00:00.000Z" }));
  expect(view.invalidate).toHaveBeenCalledWith({ queryKey: ["/api/test-drive-bookings"] });
});

it.each([
  ["platform disabled", { featureEnabled: false }],
  ["feature check loading", { featureLoading: true }],
  ["feature check failed despite a cached enabled flag", { featureError: true }],
  ["booking settings loading", { settingsLoading: true }],
  ["booking settings failed despite enabled settings", { settingsError: true }],
  ["dealer scheduling disabled", { bookingEnabled: false }],
])("blocks only the optional booking when %s", async (_label, patch) => {
  Object.assign(state, patch);
  mount();
  fill();
  expect(screen.getByRole("checkbox", { name: /^Book a Test Drive/ })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Save enquiry" })).toBeEnabled();
  fireEvent.click(screen.getByRole("button", { name: "Save enquiry" }));
  await waitFor(() => expect(state.create).toHaveBeenCalledTimes(1));
  expect(state.createBooking).not.toHaveBeenCalled();
  expect(state.create.mock.calls[0][0].data.appointmentAt).toBeNull();
});

it("requires a current available car and a selected time before booking", async () => {
  mount();
  fill();
  turnOnTestDrive();
  fireEvent.submit(bookingButton().closest("form")!);
  expect(await screen.findByRole("alert")).toHaveTextContent(/available.*car|car.*available|choose.*car/i);
  expect(state.createBooking).not.toHaveBeenCalled();
  fireEvent.change(screen.getByRole("searchbox"), { target: { value: "Ford" } });
  fireEvent.click(screen.getByRole("button", { name: /Ford Focus/ }));
  fireEvent.submit(bookingButton().closest("form")!);
  expect(await screen.findByRole("alert")).toHaveTextContent(/time/i);
  expect(state.create).not.toHaveBeenCalled();
  expect(state.createBooking).not.toHaveBeenCalled();
});

it.each(["sold", "reserved", "hidden", "archived"])("does not book a preselected %s car", async status => {
  state.inventoryStatus = status;
  mount(true, "car-one");
  fill();
  turnOnTestDrive();
  const time = screen.queryByRole("button", { name: "15:00" });
  if (time) fireEvent.click(time);
  fireEvent.submit(bookingButton().closest("form")!);
  expect(await screen.findByRole("alert")).toHaveTextContent(/available.*car|car.*available|choose.*car/i);
  expect(state.create).not.toHaveBeenCalled();
  expect(state.createBooking).not.toHaveBeenCalled();
});

it("clears the chosen time when the car changes", async () => {
  mount(true, "car-one");
  fill();
  await chooseTestDrive();
  expect(screen.getByRole("button", { name: "15:00" })).toHaveAttribute("aria-pressed", "true");
  fireEvent.change(screen.getByRole("searchbox"), { target: { value: "Toyota" } });
  fireEvent.click(screen.getByRole("button", { name: /Toyota Yaris/ }));
  expect(await screen.findByRole("button", { name: "15:00" })).toHaveAttribute("aria-pressed", "false");
  fireEvent.submit(bookingButton().closest("form")!);
  expect(await screen.findByRole("alert")).toHaveTextContent(/time/i);
  expect(state.createBooking).not.toHaveBeenCalled();
});

it("clears the chosen time when booking is turned off and saves a normal no-email enquiry", async () => {
  mount(true, "car-one");
  fill();
  await chooseTestDrive();
  fireEvent.click(screen.getByRole("checkbox", { name: /^Book a Test Drive/ }));
  expect(screen.queryByRole("button", { name: "15:00" })).not.toBeInTheDocument();
  turnOnTestDrive();
  expect(await screen.findByRole("button", { name: "15:00" })).toHaveAttribute("aria-pressed", "false");
  fireEvent.click(screen.getByRole("checkbox", { name: /^Book a Test Drive/ }));
  fireEvent.click(screen.getByRole("button", { name: "Save enquiry" }));
  await waitFor(() => expect(state.create).toHaveBeenCalledTimes(1));
  expect(state.createBooking).not.toHaveBeenCalled();
  expect(state.create.mock.calls[0][0].data).toMatchObject({ type: "general", appointmentAt: null });
  expect(state.create.mock.calls[0][0].data).not.toHaveProperty("callOutcome");
});

it("allows booking without email and explains that staff should confirm by phone", async () => {
  mount(true, "car-one");
  fill();
  await chooseTestDrive();
  expect(screen.getByText(/confirm.*phone/i)).toBeVisible();
  fireEvent.click(bookingButton());
  await waitFor(() => expect(state.createBooking).toHaveBeenCalledTimes(1));
  expect(state.createBooking.mock.calls[0][0].data.email).toBeNull();
  expect(state.create).not.toHaveBeenCalled();
});

it("retains customer details, notes and chosen time on an uncertain booking save without retrying", async () => {
  state.createBooking.mockRejectedValue(new Error("Network disconnected"));
  const view = mount(true, "car-one");
  fill();
  fireEvent.change(screen.getByRole("textbox", { name: "Notes (optional)" }), { target: { value: "Keep these notes" } });
  await chooseTestDrive();
  fireEvent.click(bookingButton());
  expect(await screen.findByRole("alert")).toHaveTextContent(/Check Enquiries or Test drives before retrying/);
  expect(screen.getByRole("combobox", { name: "Customer name" })).toHaveValue("  Alex Smith  ");
  expect(screen.getByRole("textbox", { name: "Notes (optional)" })).toHaveValue("Keep these notes");
  expect(screen.getByRole("button", { name: "15:00" })).toHaveAttribute("aria-pressed", "true");
  expect(state.createBooking).toHaveBeenCalledTimes(1);
  expect(state.create).not.toHaveBeenCalled();
  expect(view.onCreated).not.toHaveBeenCalled();
  expect(view.onOpenChange).not.toHaveBeenCalled();
});

it("clears a conflicting time, refreshes availability and keeps the contact details after a 409", async () => {
  state.createBooking.mockRejectedValue({ status: 409, data: { error: "That time has just been taken. Choose another." } });
  const view = mount(true, "car-one");
  fill();
  await chooseTestDrive();
  fireEvent.click(bookingButton());
  expect(await screen.findByRole("alert")).toHaveTextContent("That time has just been taken.");
  expect(screen.getByRole("button", { name: "15:00" })).toHaveAttribute("aria-pressed", "false");
  expect(screen.getByRole("combobox", { name: "Customer name" })).toHaveValue("  Alex Smith  ");
  const refresh = view.invalidate.mock.calls.find(([options]) => options?.predicate);
  expect(refresh).toBeDefined();
  expect(refresh![0]!.predicate!({ queryKey: ["/api/enquiries/availability", { date: "2026-10-19" }] } as never)).toBe(true);
  expect(refresh![0]!.predicate!({ queryKey: ["/api/enquiries"] } as never)).toBe(false);
  expect(view.invalidate).toHaveBeenCalledWith({ queryKey: ["/api/stock"] });
  expect(state.createBooking).toHaveBeenCalledTimes(1);
  expect(state.create).not.toHaveBeenCalled();
});

it("prevents a second booking POST and keeps the popup open while its single atomic save is pending", async () => {
  let resolve!: (value: unknown) => void;
  state.createBooking.mockImplementation(() => new Promise(done => { resolve = done; }));
  const view = mount(true, "car-one");
  fill();
  await chooseTestDrive();
  const form = bookingButton().closest("form")!;
  fireEvent.submit(form);
  fireEvent.submit(form);
  fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
  expect(state.createBooking).toHaveBeenCalledTimes(1);
  expect(state.create).not.toHaveBeenCalled();
  expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
  expect(view.onOpenChange).not.toHaveBeenCalled();
  resolve({ id: "booking-new", reference: "ENQ-BOOK", appointmentAt: "2026-10-19T14:00:00.000Z" });
  await waitFor(() => expect(view.onCreated).toHaveBeenCalledTimes(1));
});

it("blocks a previously chosen booking if the feature check later fails while general capture remains usable", async () => {
  mount(true, "car-one");
  fill();
  await chooseTestDrive();
  state.featureError = true;
  fireEvent.change(screen.getByRole("textbox", { name: "Notes (optional)" }), { target: { value: "Still keep customer notes" } });
  fireEvent.submit(bookingButton().closest("form")!);
  expect(state.createBooking).not.toHaveBeenCalled();
  expect(state.create).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("checkbox", { name: /^Book a Test Drive/ }));
  fireEvent.click(screen.getByRole("button", { name: "Save enquiry" }));
  await waitFor(() => expect(state.create).toHaveBeenCalledTimes(1));
});

it.each([
  ["no available times", { hasAvailableTime: false }],
  ["availability loading", { availabilityLoading: true }],
  ["availability error", { availabilityError: true }],
])("does not submit a booking with %s", async (_label, patch) => {
  Object.assign(state, patch);
  mount(true, "car-one");
  fill();
  turnOnTestDrive();
  expect(screen.queryByRole("button", { name: "15:00" })).not.toBeInTheDocument();
  fireEvent.submit(bookingButton().closest("form")!);
  expect(state.createBooking).not.toHaveBeenCalled();
  expect(state.create).not.toHaveBeenCalled();
});


it("treats a booking HTTP500 as uncertain even when its API text suggests retrying", async () => {
  state.createBooking.mockRejectedValue({ status: 500, data: { error: "Temporary server error. Please try again." } });
  const view = mount(true, "car-one");
  fill();
  await chooseTestDrive();
  fireEvent.click(bookingButton());
  const alert = await screen.findByRole("alert");
  expect(alert).toHaveTextContent(/could not confirm/i);
  expect(alert).toHaveTextContent(/Check Enquiries/i);
  expect(alert).not.toHaveTextContent("Please try again.");
  expect(screen.getByRole("combobox", { name: "Customer name" })).toHaveValue("  Alex Smith  ");
  expect(state.createBooking).toHaveBeenCalledTimes(1);
  expect(state.create).not.toHaveBeenCalled();
  expect(view.onCreated).not.toHaveBeenCalled();
});

it("treats a general enquiry HTTP500 as uncertain rather than echoing an unsafe retry instruction", async () => {
  state.create.mockRejectedValue({ status: 500, data: { error: "Temporary server error. Please try again." } });
  mount();
  fill();
  fireEvent.click(screen.getByRole("button", { name: "Save enquiry" }));
  const alert = await screen.findByRole("alert");
  expect(alert).toHaveTextContent(/could not confirm/i);
  expect(alert).toHaveTextContent(/Check Enquiries/i);
  expect(alert).not.toHaveTextContent("Please try again.");
  expect(state.create).toHaveBeenCalledTimes(1);
  expect(state.createBooking).not.toHaveBeenCalled();
});

it("saves once then opens the message composer without losing the new enquiry", async () => {
  const view = mount(true, "car-one"); fill();
  fireEvent.click(screen.getByRole("button", { name: "Save & message" }));
  expect(await screen.findByRole("button", { name: "Write a message" })).toBeVisible();
  expect(state.create).toHaveBeenCalledTimes(1);
  expect(view.onCreated).not.toHaveBeenCalled();
  expect(view.onOpenChange).not.toHaveBeenCalled();
  expect(screen.queryByRole("button", { name: "Save enquiry" })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Write a message" }));
  expect(await screen.findByRole("dialog", { name: "Customer message" })).toHaveTextContent("Message for Alex Smith");
  expect(screen.getByRole("dialog", { name: "Customer message" })).toHaveTextContent("enquiry-new");
  fireEvent.click(screen.getByRole("button", { name: "Return to saved enquiry" }));
  fireEvent.click(await screen.findByRole("button", { name: "Done" }));
  expect(state.create).toHaveBeenCalledTimes(1);
  expect(state.createBooking).not.toHaveBeenCalled();
  expect(view.onCreated).toHaveBeenCalledExactlyOnceWith({ id: "enquiry-new", reference: "ENQ-123" });
  expect(view.onOpenChange).toHaveBeenCalledWith(false);
});

it("Save & message creates one atomic booking and never resaves while preparing messages", async () => {
  const view = mount(true, "car-one"); fill(); await chooseTestDrive();
  fireEvent.click(screen.getByRole("button", { name: "Save & message" }));
  await screen.findByRole("button", { name: "Write a message" });
  expect(screen.getByRole("status")).toHaveTextContent("test drive booked");
  fireEvent.click(screen.getByRole("button", { name: "Done" }));
  expect(state.createBooking).toHaveBeenCalledTimes(1);
  expect(state.create).not.toHaveBeenCalled();
  expect(view.onCreated).toHaveBeenCalledWith(expect.objectContaining({ id: "booking-new", appointmentAt: "2026-10-19T14:00:00.000Z" }));
});

it("does not open sharing when Save & message is not confirmed", async () => {
  state.create.mockRejectedValue(new Error("Connection lost"));
  const view = mount(); fill();
  fireEvent.click(screen.getByRole("button", { name: "Save & message" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Check Enquiries");
  expect(screen.queryByRole("button", { name: "Write a message" })).not.toBeInTheDocument();
  expect(view.onCreated).not.toHaveBeenCalled();
  expect(state.create).toHaveBeenCalledTimes(1);
});

it("labels an approval-mode appointment as awaiting approval in the saved message flow", async () => {
  state.createBooking.mockResolvedValue({ id: "booking-new", reference: "ENQ-BOOK", appointmentAt: "2026-10-19T14:00:00.000Z", appointmentStatus: "pending" });
  mount(true, "car-one"); fill(); await chooseTestDrive();
  fireEvent.click(screen.getByRole("button", { name: "Save & message" }));
  await screen.findByRole("button", { name: "Write a message" });
  expect(screen.getByRole("status")).toHaveTextContent("test drive awaiting approval");
  expect(screen.getByRole("status")).not.toHaveTextContent("test drive booked");
});
