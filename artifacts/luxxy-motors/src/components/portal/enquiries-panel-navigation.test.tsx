import { beforeEach, expect, it, vi } from "vitest";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import type { Enquiry } from "@workspace/api-client-react";

const featureState = vi.hoisted(() => ({
  allowed: true,
  isLoading: false,
  isError: false,
  refetch: vi.fn(),
}));
const settingsState = vi.hoisted(() => ({ bookings: true }));
vi.mock("@/lib/dealer-features", () => ({
  useDealerFeatures: () => ({
    ...featureState,
    enabled: () => featureState.allowed,
  }),
}));
const state = vi.hoisted(() => ({
  fetchEnquiries: vi.fn(),
  create: vi.fn(),
  change: vi.fn(),
}));
vi.mock("@workspace/api-client-react", async (importOriginal) => {
  const { useQuery } = await import("@tanstack/react-query");
  return {
    ...(await importOriginal<object>()),
    getGetEnquiriesQueryKey: () => ["enquiries"],
    getGetTestDriveBookingsQueryKey: () => ["test-drive-bookings"],
    useGetEnquiries: (_params?: unknown, options?: { query?: object }) =>
      useQuery({
        queryKey: ["enquiries"],
        queryFn: () => state.fetchEnquiries(),
        ...options?.query,
      }),
    useGetStaffDirectory: () => ({
      data: { currentUserId: "staff-one", members: [] },
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    }),
    useCreateStaffEnquiry: () => ({
      mutateAsync: state.create,
      isPending: false,
      isError: false,
    }),
    useChangeStaffAppointment: () => ({
      mutateAsync: state.change,
      isPending: false,
      isError: false,
    }),
  };
});
vi.mock("@/lib/stock-context", () => ({
  useStock: () => ({ stock: { cars: [] }, isLoading: false, error: null }),
}));
vi.mock("@/lib/dealer-settings-context", () => ({
  useDealerSettings: () => ({
    settings: {
      identity: { name: "Fictional Motors" },
      testDriveBooking: { enabled: settingsState.bookings },
    },
    isLoading: false,
    isError: false,
  }),
}));
vi.mock("@/lib/enquiry-desk-model", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  readCallDraft: () => null,
  saveCallDraft: () => true,
  removeCallDraft: () => {},
}));
vi.mock("./enquiry-calendar", () => ({
  EnquiryCalendar: ({ onAdd }: { onAdd?: (date: string) => void }) => (
    <button
      type="button"
      disabled={!onAdd}
      onClick={() => onAdd?.("2026-11-02")}
    >
      Add calendar appointment
    </button>
  ),
  AppointmentExceptionLabels: () => null,
}));
vi.mock("./enquiry-stock-desk", () => ({ EnquiryStockDesk: () => null }));
vi.mock("./enquiry-workspace-tools", () => ({
  OwnerSelect: () => null,
  WorkspaceEditor: () => null,
  TodayDesk: () => null,
  CustomerHistory: () => null,
}));
vi.mock("./enquiry-record-browser", () => ({
  EnquiryRecordBrowser: ({
    entries,
    selectedId,
    actions,
  }: {
    entries: Enquiry[];
    selectedId: string | null;
    actions: {
      onAppointment: (entry: Enquiry) => void;
      onDeletedEnquiry?: (id: string) => void;
    };
  }) => (
    <section aria-label="Customer records">
      <p data-testid="selected-enquiry">{selectedId ?? "none"}</p>
      {entries.map((entry) => (
        <div key={entry.id}>
          <p>
            {entry.customerName} · {entry.reference}
          </p>
          {entry.appointmentAt && (
            <button onClick={() => actions.onAppointment(entry)}>
              Change appointment for {entry.customerName}
            </button>
          )}
          {entry.customerName.startsWith("TEST") && (
            <button onClick={() => actions.onDeletedEnquiry?.(entry.id)}>
              Simulate confirmed test deletion
            </button>
          )}
        </div>
      ))}
    </section>
  ),
}));
import { EnquiriesPanel } from "./enquiries-panel";

function enquiry(id: string, name: string): Enquiry {
  return {
    id,
    customerName: name,
    reference: `ENQ-${id}`,
    phone: "07700900123",
    email: null,
    type: "general",
    status: "new",
    createdAt: "2026-10-16T10:00:00Z",
    vehicleId: null,
    vehicleTitle: null,
    message: "Customer called the showroom.",
    assignedToId: "staff-one",
    workspaceRevision: 0,
    followUpRevision: 0,
    callOutcome: "information_given",
  } as Enquiry;
}
const alex = enquiry("alex", "Alex Customer");
const jordan = enquiry("jordan", "Jordan Customer");

function mount(search: string, entries: Enquiry[] = [alex, jordan]) {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: Infinity },
      mutations: { retry: false },
    },
  });
  client.setQueryData(["enquiries", "timeline-omitted"], entries);
  const location = memoryLocation({ path: `/portal?${search}`, record: true });
  const rendered = render(
    <QueryClientProvider client={client}>
      <Router hook={location.hook}>
        <EnquiriesPanel embedded initialView="history" />
      </Router>
    </QueryClientProvider>,
  );
  return {
    client,
    location,
    ...rendered,
    refresh: () =>
      rendered.rerender(
        <QueryClientProvider client={client}>
          <Router hook={location.hook}>
            <EnquiriesPanel embedded initialView="history" />
          </Router>
        </QueryClientProvider>,
      ),
  };
}
beforeEach(() => {
  state.fetchEnquiries.mockReset().mockResolvedValue([alex, jordan]);
  state.create.mockReset();
  state.change.mockReset();
  featureState.allowed = true;
  featureState.isError = false;
  featureState.isLoading = false;
  settingsState.bookings = true;
  featureState.refetch.mockReset();
});

it("keeps the first edited search value when clearing a selected customer and its route context", async () => {
  const { location } = mount(
    "section=notifications&workView=customers&enquiryId=alex",
  );
  const search = screen.getByRole("textbox", {
    name: "Search enquiries",
  });
  await waitFor(() => expect(screen.getByTestId("selected-enquiry")).toHaveTextContent("alex"));
  expect(search).toHaveValue("");
  fireEvent.change(search, { target: { value: "Jordan" } });
  expect(search).toHaveValue("Jordan");
  expect(screen.getByTestId("selected-enquiry")).toHaveTextContent("none");
  expect(screen.getByText("Jordan Customer · ENQ-jordan")).toBeVisible();
  expect(
    screen.queryByText("Alex Customer · ENQ-alex"),
  ).not.toBeInTheDocument();
  const query = new URL(location.history!.at(-1)!, "https://dealer.example")
    .searchParams;
  expect(query.get("workView")).toBe("customers");
  expect(query.has("enquiryId")).toBe(false);
});

it("removes the exact deleted test from caches and route while preserving real contact matches even if refresh fails", async () => {
  const test = {
    ...alex,
    id: "test-delete",
    customerName: "TEST — duplicate contact",
    reference: "TEST",
  };
  state.fetchEnquiries.mockRejectedValue(
    new Error("Refresh temporarily unavailable"),
  );
  const { client, location } = mount(
    "section=notifications&workView=customers&enquiryId=test-delete",
    [test, alex, jordan],
  );
  client.setQueryData(["enquiries"], [test, alex, jordan]);
  const original = JSON.stringify([alex, jordan]);
  fireEvent.click(
    await screen.findByRole("button", {
      name: "Simulate confirmed test deletion",
    }),
  );
  await waitFor(() =>
    expect(client.getQueryData(["enquiries", "timeline-omitted"])).toEqual([
      alex,
      jordan,
    ]),
  );
  expect(client.getQueryData(["enquiries"])).toEqual([alex, jordan]);
  expect(screen.getByRole("status")).toHaveTextContent("Enquiry deleted.");
  expect(
    screen.queryByText(/This enquiry could not be found/),
  ).not.toBeInTheDocument();
  expect(
    new URL(
      location.history!.at(-1)!,
      "https://dealer.example",
    ).searchParams.has("enquiryId"),
  ).toBe(false);
  expect(JSON.stringify([alex, jordan])).toBe(original);
  expect(state.create).not.toHaveBeenCalled();
  expect(state.change).not.toHaveBeenCalled();
});

it("shows a newly saved customer before the invalidated enquiry list finishes refreshing", async () => {
  const fresh = enquiry("new-customer", "New Customer");
  state.create.mockResolvedValue(fresh);
  // Hold the refresh so this verifies that the create response populates the cache itself.
  state.fetchEnquiries.mockImplementation(() => new Promise(() => {}));
  const { client, location } = mount(
    "section=notifications&workView=customers&deskView=new",
  );
  fireEvent.change(
    await screen.findByRole("combobox", { name: "Customer name" }),
    { target: { value: fresh.customerName } },
  );
  fireEvent.change(screen.getByRole("combobox", { name: "Phone number" }), {
    target: { value: fresh.phone },
  });
  fireEvent.change(screen.getByRole("combobox", { name: "Vehicle source" }), {
    target: { value: "none" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save phone enquiry" }));
  await waitFor(() =>
    expect(screen.getByTestId("selected-enquiry")).toHaveTextContent(fresh.id),
  );
  expect(screen.getByText("New Customer · ENQ-new-customer")).toBeVisible();
  expect(
    client
      .getQueryData<Enquiry[]>(["enquiries", "timeline-omitted"])
      ?.find((entry) => entry.id === fresh.id),
  ).toEqual(fresh);
  expect(
    screen.queryByText(/This enquiry could not be found/),
  ).not.toBeInTheDocument();
  const query = new URL(location.history!.at(-1)!, "https://dealer.example")
    .searchParams;
  expect(query.get("enquiryId")).toBe(fresh.id);
  expect(query.has("deskView")).toBe(false);
});

it("autofills a recent contact into a new enquiry without reusing their old car, notes or record", async () => {
  const existing = {
    ...alex,
    phone: "07700900124",
    email: "alex@example.test",
    vehicleId: "previous-car",
    vehicleTitle: "Previous car",
    message: "Original question stays on its own record.",
  } as Enquiry;
  const original = JSON.stringify(existing);
  state.create.mockResolvedValue(enquiry("fresh-call", "Alex Customer"));
  mount("section=notifications&workView=customers&deskView=new", [existing]);
  const name = await screen.findByRole("combobox", { name: "Customer name" });
  fireEvent.focus(name);
  fireEvent.change(name, { target: { value: "Alex" } });
  expect(screen.getByRole("option", { name: /Alex Customer/ })).toBeVisible();
  expect(state.create).not.toHaveBeenCalled();
  fireEvent.keyDown(name, { key: "ArrowDown" });
  fireEvent.keyDown(name, { key: "Enter" });
  expect(name).toHaveValue("Alex Customer");
  expect(screen.getByRole("combobox", { name: "Phone number" })).toHaveValue(
    existing.phone,
  );
  expect(
    screen.getByRole("combobox", { name: "Email (optional)" }),
  ).toHaveValue(existing.email);
  expect(screen.getByLabelText("Call notes (optional)")).toHaveValue("");
  expect(state.create).not.toHaveBeenCalled();
  fireEvent.change(screen.getByRole("combobox", { name: "Vehicle source" }), {
    target: { value: "none" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save phone enquiry" }));
  await waitFor(() => expect(state.create).toHaveBeenCalledOnce());
  expect(state.create.mock.calls[0][0].data).toMatchObject({
    customerName: existing.customerName,
    phone: existing.phone,
    email: existing.email,
    vehicleId: null,
    appointmentAt: null,
  });
  expect(JSON.stringify(existing)).toBe(original);
});

it("opens a requested record when it becomes available after a query refresh", async () => {
  const fresh = enquiry("new-customer", "New Customer");
  const { client } = mount(
    `section=notifications&workView=customers&enquiryId=${fresh.id}`,
  );
  expect(
    await screen.findByText(/This enquiry could not be found/),
  ).toBeVisible();
  expect(
    screen.queryByRole("region", { name: "Customer records" }),
  ).not.toBeInTheDocument();
  expect(
    screen.getByRole("button", { name: "Show all enquiries" }),
  ).toBeVisible();
  await act(async () => {
    client.setQueryData(
      ["enquiries", "timeline-omitted"],
      [fresh, alex, jordan],
    );
  });
  await waitFor(() =>
    expect(screen.getByTestId("selected-enquiry")).toHaveTextContent(fresh.id),
  );
  expect(
    screen.getByRole("textbox", { name: "Search enquiries" }),
  ).toHaveValue("");
  expect(
    screen.queryByText(/This enquiry could not be found/),
  ).not.toBeInTheDocument();
});

it("starts a calendar appointment with the selected day and booking intent without saving anything", async () => {
  mount("section=notifications&workView=test-drives&deskView=calendar");
  fireEvent.click(
    await screen.findByRole("button", { name: "Add calendar appointment" }),
  );
  expect(
    screen.getByRole("heading", { name: "New appointment" }),
  ).toBeVisible();
  expect(
    screen.getByRole("radio", { name: "Book a Test Drive" }),
  ).toBeChecked();
  expect(screen.getByRole("status")).toHaveTextContent(
    "New appointment for Monday 2 November",
  );
  expect(state.create).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Back to calendar" }));
  expect(
    screen.getByRole("button", { name: "Add calendar appointment" }),
  ).toBeVisible();
  expect(state.create).not.toHaveBeenCalled();
});

it("keeps appointment-load failures recoverable when the calendar hides the general workspace ribbon", async () => {
  state.fetchEnquiries.mockRejectedValue(
    new Error("Temporary connection failure"),
  );
  const { client } = mount(
    "section=notifications&workView=test-drives&deskView=calendar",
  );
  await act(async () => {
    await client.refetchQueries({ queryKey: ["enquiries"] });
  });
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Appointments could not be loaded",
  );
  expect(
    screen.queryByRole("button", { name: "Refresh enquiries and stock" }),
  ).not.toBeInTheDocument();
  state.fetchEnquiries.mockResolvedValue([alex, jordan]);
  fireEvent.click(screen.getByRole("button", { name: "Retry appointments" }));
  expect(
    await screen.findByRole("button", { name: "Add calendar appointment" }),
  ).toBeVisible();
  expect(state.create).not.toHaveBeenCalled();
});

it("starts rescheduling on the existing UK day while requiring a new time", async () => {
  const booked = {
    ...alex,
    appointmentAt: "2026-11-02T11:00:00Z",
    appointmentStatus: "confirmed",
  } as Enquiry;
  mount("section=notifications&workView=customers&enquiryId=alex", [booked]);
  fireEvent.click(
    await screen.findByRole("button", {
      name: "Change appointment for Alex Customer",
    }),
  );
  fireEvent.click(screen.getByRole("button", { name: "Choose date & time" }));
  expect(screen.getByLabelText("Appointment date (UK)")).toHaveValue(
    "2026-11-02",
  );
  expect(screen.getByLabelText("Appointment time (UK)")).toHaveValue("");
  expect(
    screen.getByRole("button", { name: "Save new appointment" }),
  ).toBeDisabled();
  expect(state.create).not.toHaveBeenCalled();
});

it("pauses new test-drive intent while keeping phone enquiry fields usable", async () => {
  featureState.allowed = false;
  mount("section=notifications&workView=customers&deskView=new");
  expect(
    await screen.findByRole("radio", { name: "Book a Test Drive" }),
  ).toBeDisabled();
  expect(
    screen.getByRole("radio", { name: "Log call / enquiry only" }),
  ).toBeEnabled();
  expect(screen.getByRole("combobox", { name: "Customer name" })).toBeEnabled();
  expect(
    screen.getByText(
      /New test drives and rescheduling are paused by the platform/,
    ),
  ).toBeVisible();
  expect(state.create).not.toHaveBeenCalled();
});
it('also pauses new test drives when the dealership setting is switched off', async () => {
  settingsState.bookings=false;
  mount('section=notifications&workView=test-drives&deskView=calendar');
  expect(await screen.findByRole('button',{name:'Add calendar appointment'})).toBeDisabled();
  expect(state.create).not.toHaveBeenCalled();
});

it("locks an open reschedule form after a policy failure while keeping cancellation available", async () => {
  const booked = {
    ...alex,
    appointmentAt: "2026-11-02T11:00:00Z",
    appointmentStatus: "confirmed",
    appointmentRevision: 2,
  } as Enquiry;
  state.change.mockResolvedValue({
    ...booked,
    appointmentCancelledAt: "2026-10-18T12:00:00Z",
  });
  const view = mount(
    "section=notifications&workView=customers&enquiryId=alex",
    [booked],
  );
  fireEvent.click(
    await screen.findByRole("button", {
      name: "Change appointment for Alex Customer",
    }),
  );
  fireEvent.click(screen.getByRole("button", { name: "Choose date & time" }));
  expect(screen.getByLabelText("Appointment date (UK)")).toBeVisible();
  featureState.allowed = false;
  featureState.isError = true;
  view.refresh();
  expect(
    screen.queryByLabelText("Appointment date (UK)"),
  ).not.toBeInTheDocument();
  expect(
    screen.getByRole("button", { name: "Save new appointment" }),
  ).toBeDisabled();
  fireEvent.click(
    screen.getByRole("button", { name: "Retry booking availability" }),
  );
  expect(featureState.refetch).toHaveBeenCalledTimes(1);
  expect(state.change).not.toHaveBeenCalled();
  fireEvent.click(
    screen.getByRole("button", { name: "Cancel appointment instead" }),
  );
  expect(
    screen.getByRole("button", { name: "Confirm cancellation" }),
  ).toBeEnabled();
  fireEvent.click(screen.getByRole("button", { name: "Confirm cancellation" }));
  await waitFor(() =>
    expect(state.change).toHaveBeenCalledWith({
      id: "alex",
      data: { action: "cancel", appointmentAt: null, expectedRevision: 2 },
    }),
  );
});
