import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
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
function mount(open = true, initialVehicleId?: string, initialBookTestDrive = false, continueEnabled = true) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const invalidate = vi.spyOn(client, "invalidateQueries").mockResolvedValue();
  const onOpenChange = vi.fn(),
    onCreated = vi.fn(),
    onContinueEnquiry = vi.fn();
  const view = render(
    <QueryClientProvider client={client}>
      <QuickEnquiryDialog
        open={open}
        initialVehicleId={initialVehicleId}
        initialBookTestDrive={initialBookTestDrive}
        onOpenChange={onOpenChange}
        onCreated={onCreated}
        onContinueEnquiry={continueEnabled ? onContinueEnquiry : undefined}
      />
    </QueryClientProvider>,
  );
  return { ...view, invalidate, onOpenChange, onCreated, onContinueEnquiry };
}
function fill() {
  fireEvent.change(screen.getByRole("combobox", { name: "Customer name" }), {
    target: { value: "  Alex Smith  " },
  });
  fireEvent.change(screen.getByRole("combobox", { name: "Phone number" }), {
    target: { value: " 07700 900123 " },
  });
}

it("starts with the useful contact fields and a quiet optional car search", async () => {
  mount();
  const name = screen.getByRole("combobox", { name: "Customer name" });
  const phone = screen.getByRole("combobox", { name: "Phone number" });
  expect(name).toBeVisible();
  expect(phone).toBeVisible();
  expect(screen.getAllByRole("combobox").slice(0, 2)).toEqual([name, phone]);
  expect(screen.queryByRole("combobox", { name: "Email (optional)" })).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Add email" })).toBeVisible();
  expect(screen.getByRole("combobox", { name: "Car (optional)" })).toHaveAttribute("placeholder", "Make, model or reg");
  expect(screen.queryByText(/cars? found$/)).not.toBeInTheDocument();
  expect(screen.queryByRole("option", { name: /Ford Focus/ })).not.toBeInTheDocument();
  expect(screen.queryByRole("option", { name: /Toyota Yaris/ })).not.toBeInTheDocument();
  expect(screen.getByRole("textbox", { name: "Notes (optional)" })).toHaveAttribute("rows", "2");
  expect(screen.getByRole("checkbox", { name: "Book a Test Drive" })).not.toBeChecked();
  expect(screen.queryByRole("button", { name: "15:00" })).not.toBeInTheDocument();
  await waitFor(() => expect(name).toHaveFocus());
  expect(state.create).not.toHaveBeenCalled();
});

it("focuses the heading on phones so opening the dialog does not summon the keyboard", async () => {
  const previous = window.matchMedia;
  window.matchMedia = vi.fn().mockReturnValue({ matches: true }) as typeof window.matchMedia;
  try {
    mount();
    await waitFor(() => expect(screen.getByRole("heading", { name: "New enquiry" })).toHaveFocus());
    expect(screen.getByRole("combobox", { name: "Customer name" })).not.toHaveFocus();
    expect(screen.getByRole("combobox", { name: "Phone number" })).not.toHaveFocus();
    expect(state.create).not.toHaveBeenCalled();
  } finally {
    window.matchMedia = previous;
  }
});

it("tracks the usable viewport when the phone keyboard opens and removes its listeners on close", async () => {
  const previous = Object.getOwnPropertyDescriptor(window, "visualViewport");
  const viewport = Object.assign(new EventTarget(), { height: 600, offsetTop: 0 });
  const removeListener = vi.spyOn(viewport, "removeEventListener");
  Object.defineProperty(window, "visualViewport", { configurable: true, value: viewport });
  let view: ReturnType<typeof mount> | undefined;
  try {
    view = mount();
    const dialog = screen.getByRole("dialog", { name: "New enquiry" });
    await waitFor(() => expect(dialog.style.getPropertyValue("--quick-viewport-height")).toBe("600px"));
    expect(dialog.style.getPropertyValue("--quick-viewport-bottom")).toBe(`${Math.max(0, window.innerHeight - 600)}px`);
    act(() => {
      viewport.height = 360;
      viewport.offsetTop = 25;
      viewport.dispatchEvent(new Event("resize"));
    });
    expect(dialog.style.getPropertyValue("--quick-viewport-height")).toBe("360px");
    expect(dialog.style.getPropertyValue("--quick-viewport-bottom")).toBe(`${Math.max(0, window.innerHeight - 385)}px`);
    act(() => {
      viewport.offsetTop = 50;
      viewport.dispatchEvent(new Event("scroll"));
    });
    expect(dialog.style.getPropertyValue("--quick-viewport-bottom")).toBe(`${Math.max(0, window.innerHeight - 410)}px`);
    view.unmount();
    expect(removeListener).toHaveBeenCalledWith("resize", expect.any(Function));
    expect(removeListener).toHaveBeenCalledWith("scroll", expect.any(Function));
    viewport.height = 300;
    viewport.dispatchEvent(new Event("resize"));
    expect(dialog.style.getPropertyValue("--quick-viewport-height")).toBe("360px");
  } finally {
    view?.unmount();
    if (previous) Object.defineProperty(window, "visualViewport", previous);
    else delete (window as unknown as { visualViewport?: VisualViewport }).visualViewport;
    removeListener.mockRestore();
  }
});

it("reveals email on demand without erasing the customer's name or telephone number", async () => {
  mount();
  fill();
  fireEvent.click(screen.getByRole("button", { name: "Add email" }));
  const email = screen.getByRole("combobox", { name: "Email (optional)" });
  expect(email).toBeVisible();
  await waitFor(() => expect(email).toHaveFocus());
  expect(screen.getByRole("combobox", { name: "Customer name" })).toHaveValue("  Alex Smith  ");
  expect(screen.getByRole("combobox", { name: "Phone number" })).toHaveValue(" 07700 900123 ");
  expect(state.create).not.toHaveBeenCalled();
});

it("shows car results only after staff search and keeps a compact chosen-car summary", async () => {
  mount();
  fill();
  fireEvent.change(screen.getByRole("textbox", { name: "Notes (optional)" }), { target: { value: "Please call tomorrow" } });
  fireEvent.change(screen.getByRole("combobox", { name: "Car (optional)" }), { target: { value: "Ford" } });
  fireEvent.click(screen.getByRole("option", { name: /Ford Focus/ }));
  expect(screen.getByRole("article", { name: "Selected car" })).toHaveTextContent("Ford Focus");
  expect(screen.queryByRole("combobox", { name: "Car (optional)" })).not.toBeInTheDocument();
  expect(screen.queryByText(/cars? found$/)).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Change car" })).toBeVisible();
  expect(screen.getByRole("textbox", { name: "Notes (optional)" })).toHaveValue("Please call tomorrow");
  fireEvent.click(screen.getByRole("button", { name: "Save enquiry" }));
  await waitFor(() => expect(state.create).toHaveBeenCalledOnce());
  expect(state.create.mock.calls[0][0].data).toMatchObject({
    customerName: "Alex Smith", vehicleId: "car-one", message: "Please call tomorrow", email: null, appointmentAt: null,
  });
  expect(state.createBooking).not.toHaveBeenCalled();
});

it("can save a general enquiry using only the name and telephone number", async () => {
  const view = mount();
  fill();
  fireEvent.click(screen.getByRole("button", { name: "Save enquiry" }));
  await waitFor(() => expect(view.onCreated).toHaveBeenCalledOnce());
  expect(state.create).toHaveBeenCalledExactlyOnceWith({ data: {
    assignedToId: "staff-current", type: "general", customerName: "Alex Smith", phone: "07700 900123",
    email: null, preferredContact: "phone", vehicleId: null,
    message: "Customer enquiry recorded by our showroom.", appointmentAt: null,
  } });
  expect(state.createBooking).not.toHaveBeenCalled();
  expect(view.onOpenChange).toHaveBeenCalledWith(false);
});

it("marks the first invalid contact field inline and focuses it before making a request", async () => {
  mount();
  const name = screen.getByRole("combobox", { name: "Customer name" });
  const phone = screen.getByRole("combobox", { name: "Phone number" });
  fireEvent.click(screen.getByRole("button", { name: "Save enquiry" }));
  await waitFor(() => expect(name).toHaveFocus());
  expect(name).toHaveAttribute("aria-invalid", "true");
  expect(phone).not.toHaveAttribute("aria-invalid", "true");
  expect(name).toHaveAccessibleDescription(/name/i);
  expect(state.create).not.toHaveBeenCalled();
  expect(state.createBooking).not.toHaveBeenCalled();
});

it("focuses an invalid phone after the name is complete and clears its error on edit", async () => {
  mount();
  fill();
  const phone = screen.getByRole("combobox", { name: "Phone number" });
  fireEvent.change(phone, { target: { value: "123" } });
  fireEvent.click(screen.getByRole("button", { name: "Save enquiry" }));
  await waitFor(() => expect(phone).toHaveFocus());
  expect(phone).toHaveAttribute("aria-invalid", "true");
  fireEvent.change(phone, { target: { value: "07700 900123" } });
  expect(phone).not.toHaveAttribute("aria-invalid", "true");
  fireEvent.click(screen.getByRole("button", { name: "Save enquiry" }));
  await waitFor(() => expect(state.create).toHaveBeenCalledOnce());
});

it("validates an added email where it is entered while preserving all other answers", async () => {
  mount(true, "car-one");
  fill();
  fireEvent.click(screen.getByRole("button", { name: "Add email" }));
  const email = screen.getByRole("combobox", { name: "Email (optional)" });
  fireEvent.change(email, { target: { value: "wrong-address" } });
  fireEvent.click(screen.getByRole("button", { name: "Save enquiry" }));
  await waitFor(() => expect(email).toHaveFocus());
  expect(email).toHaveAttribute("aria-invalid", "true");
  expect(email).toHaveAccessibleDescription(/email/i);
  expect(screen.getByRole("article", { name: "Selected car" })).toHaveTextContent("Ford Focus");
  expect(state.create).not.toHaveBeenCalled();
  fireEvent.change(email, { target: { value: " Alex@Example.test " } });
  fireEvent.click(screen.getByRole("button", { name: "Save enquiry" }));
  await waitFor(() => expect(state.create).toHaveBeenCalledOnce());
  expect(state.create.mock.calls[0][0].data).toMatchObject({ email: "Alex@Example.test", vehicleId: "car-one" });
});

it("opens a direct test-drive handoff with the correct car and visible booking controls", async () => {
  mount(true, "car-one", true);
  expect(screen.getByRole("dialog", { name: "Book test drive" })).toBeVisible();
  expect(screen.getByRole("checkbox", { name: "Book a Test Drive" })).toBeChecked();
  expect(screen.getByRole("article", { name: "Selected car" })).toHaveTextContent("Ford Focus");
  expect(screen.queryByRole("combobox", { name: "Car (optional)" })).not.toBeInTheDocument();
  expect(await screen.findByRole("button", { name: "15:00" })).toBeVisible();
  expect(screen.queryByRole("combobox", { name: "Email (optional)" })).not.toBeInTheDocument();
  expect(state.create).not.toHaveBeenCalled();
  expect(state.createBooking).not.toHaveBeenCalled();
});

it("lets staff cancel an untouched direct booking handoff without a discard warning", () => {
  const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
  try {
    const view = mount(true, "car-one", true);
    fireEvent.click(screen.getByRole("button", { name: "Cancel", exact: true }));
    expect(confirm).not.toHaveBeenCalled();
    expect(view.onOpenChange).toHaveBeenCalledExactlyOnceWith(false);
    expect(state.create).not.toHaveBeenCalled();
    expect(state.createBooking).not.toHaveBeenCalled();
  } finally {
    confirm.mockRestore();
  }
});

it("reveals and focuses the car picker when a selected car is no longer available for a booking", async () => {
  state.inventoryStatus = "sold";
  mount(true, "car-one", true);
  fill();
  const form = screen.getByRole("button", { name: "Save booking" }).closest("form")!;
  fireEvent.submit(form);
  const car = await screen.findByRole("combobox", { name: "Car (optional)" });
  await waitFor(() => expect(car).toHaveFocus());
  expect(car).toHaveAttribute("aria-invalid", "true");
  expect(car).toHaveAccessibleDescription(/available stock car/i);
  expect(screen.getByText(/Currently: Ford Focus/)).toBeVisible();
  expect(screen.getByRole("combobox", { name: "Customer name" })).toHaveValue("  Alex Smith  ");
  expect(state.createBooking).not.toHaveBeenCalled();
  expect(state.create).not.toHaveBeenCalled();
});

it("retains an explicitly selected car without silently making the enquiry a booking", async () => {
  mount(true, "car-one");
  fill();
  expect(screen.getByRole("dialog", { name: "New enquiry" })).toBeVisible();
  expect(screen.getByRole("article", { name: "Selected car" })).toHaveTextContent("Ford Focus");
  fireEvent.click(screen.getByRole("button", { name: "Save enquiry" }));
  await waitFor(() => expect(state.create).toHaveBeenCalledOnce());
  expect(state.create.mock.calls[0][0].data).toMatchObject({ vehicleId: "car-one", appointmentAt: null });
  expect(state.createBooking).not.toHaveBeenCalled();
});

it("keeps the shortened form and entered details intact when an uncertain save fails", async () => {
  state.create.mockRejectedValue(new Error("Connection interrupted"));
  const view = mount(true, "car-one");
  fill();
  fireEvent.change(screen.getByRole("textbox", { name: "Notes (optional)" }), { target: { value: "Customer will call tomorrow" } });
  fireEvent.click(screen.getByRole("button", { name: "Save enquiry" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Check Enquiries or Test drives before retrying");
  expect(screen.getByRole("combobox", { name: "Customer name" })).toHaveValue("  Alex Smith  ");
  expect(screen.getByRole("textbox", { name: "Notes (optional)" })).toHaveValue("Customer will call tomorrow");
  expect(screen.getByRole("article", { name: "Selected car" })).toHaveTextContent("Ford Focus");
  expect(screen.queryByRole("combobox", { name: "Car (optional)" })).not.toBeInTheDocument();
  expect(state.create).toHaveBeenCalledOnce();
  expect(view.onOpenChange).not.toHaveBeenCalled();
});

it("keeps an unknown save-result warning visible while staff edit contact details or notes", async () => {
  state.create.mockRejectedValue(new Error("Connection interrupted"));
  const view = mount();
  fill();
  fireEvent.click(screen.getByRole("button", { name: "Save enquiry" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Check Enquiries or Test drives before retrying");
  fireEvent.change(screen.getByRole("textbox", { name: "Notes (optional)" }), { target: { value: "Customer will call later" } });
  expect(screen.getByRole("alert")).toHaveTextContent("Check Enquiries or Test drives before retrying");
  fireEvent.change(screen.getByRole("combobox", { name: "Phone number" }), { target: { value: "07700 900124" } });
  expect(screen.getByRole("alert")).toHaveTextContent("Check Enquiries or Test drives before retrying");
  fireEvent.change(screen.getByRole("combobox", { name: "Customer name" }), { target: { value: "Alex Taylor" } });
  expect(screen.getByRole("alert")).toHaveTextContent("Check Enquiries or Test drives before retrying");
  expect(state.create).toHaveBeenCalledOnce();
  expect(state.createBooking).not.toHaveBeenCalled();
  expect(view.onCreated).not.toHaveBeenCalled();
  expect(view.onOpenChange).not.toHaveBeenCalled();
});

it("blocks duplicate saves and closing while its compact form is saving", async () => {
  let resolve!: (value: unknown) => void;
  state.create.mockImplementation(() => new Promise(done => { resolve = done; }));
  const view = mount();
  fill();
  const form = screen.getByRole("button", { name: "Save enquiry" }).closest("form")!;
  fireEvent.submit(form);
  fireEvent.submit(form);
  fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
  expect(state.create).toHaveBeenCalledOnce();
  expect(screen.getByRole("button", { name: "Cancel", exact: true })).toBeDisabled();
  expect(view.onOpenChange).not.toHaveBeenCalled();
  await act(async () => { resolve({ id: "enquiry-new", reference: "ENQ-123" }); });
  await waitFor(() => expect(view.onCreated).toHaveBeenCalledOnce());
});
