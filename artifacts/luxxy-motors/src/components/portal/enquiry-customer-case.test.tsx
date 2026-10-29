import { beforeEach, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Enquiry } from "@workspace/api-client-react";
import type { Car } from "@/lib/stock-context";
import type { EnquiryRecordActions } from "./enquiry-record-browser";
import type { EnquiryChecksProps } from "./enquiry-checks";

const state = vi.hoisted(() => ({
  manage: true,
  accessError: false,
  timeline: vi.fn(),
  checks: vi.fn(),
  reply: vi.fn(),
  fetch: vi.fn(),
  claim: vi.fn(),
  refresh: vi.fn(),
}));
vi.mock("@workspace/api-client-react", () => ({
  customFetch: (...args: unknown[]) => state.fetch(...args),
  getGetEnquiriesQueryKey: () => ["/api/enquiries"],
  useGetStaffDirectory: () => ({
    data: { currentUserId: "staff-one" },
    isError: false,
  }),
  useUpdateEnquiryWorkspace: () => ({
    mutateAsync: state.claim,
    isPending: false,
    isError: false,
  }),
}));
vi.mock("./dealer-administration", () => ({
  useStaffAccess: () => ({
    data: { permissions: state.manage ? ["sales.manage"] : [] },
    isError: state.accessError,
  }),
}));
vi.mock("./enquiry-workspace-tools", () => ({
  useRefreshDesk: () => state.refresh,
  workspaceError: () => "Could not save",
  AttendanceControls: () => <button type="button">Record attendance</button>,
}));
vi.mock("./enquiry-conversation", () => ({
  CustomerActivityTimeline: (props: unknown) => {
    state.timeline(props);
    return (
      <section aria-label="Mock customer activity">
        Saved customer activity
      </section>
    );
  },
}));
vi.mock("./enquiry-reply-desk", () => ({
  EnquiryReplyDesk: (props: {
    entry: Enquiry;
    insertion?: { id: number; text: string };
    focusRequest?: number;
    requestedChannel?: string;
    onBusyChange?: (busy: boolean) => void;
  }) => {
    state.reply(props);
    return (
      <section aria-label="Mock inline reply">
        <p>Inline reply for {props.entry.id}</p>
        <p data-testid="requested-channel">{props.requestedChannel}</p>
        <p data-testid="focus-request">{props.focusRequest}</p>
        {props.insertion && (
          <p data-testid="inserted-draft">{props.insertion.text}</p>
        )}
        <button type="button" onClick={() => props.onBusyChange?.(true)}>
          Simulate send in progress
        </button>
      </section>
    );
  },
}));
vi.mock("./enquiry-checks", () => ({
  EnquiryChecks: (props: EnquiryChecksProps) => {
    state.checks(props);
    return props.canManage ? (
      <section aria-label="Mock manual checks">
        <button
          type="button"
          disabled={!props.onInsertText}
          onClick={() =>
            props.onInsertText?.(
              "Estimated delivery to SW1A 1AA: £57.40. Showroom confirmation required.",
            )
          }
        >
          Add checked estimate to reply
        </button>
      </section>
    ) : (
      <p>Checks require staff access</p>
    );
  },
}));
vi.mock("./enquiry-calendar", () => ({
  AppointmentExceptionLabels: () => null,
}));
vi.mock("./delete-enquiry", () => ({ DeleteEnquiry: () => null }));
vi.mock("./history-links", () => ({
  HistoryLinks: () => <span>Read-only history links</span>,
}));

import { EnquiryCustomerCase } from "./enquiry-customer-case";
const entry: Enquiry = {
  id: "enquiry-one",
  reference: "ENQ-ONE",
  dealerId: "dealer-one",
  customerName: "Alex Example",
  phone: "07388831790",
  email: "customer@example.com",
  preferredContact: "email",
  status: "new",
  source: "website",
  type: "general",
  message: "Can I view this Golf?",
  vehicleId: "golf",
  vehicleTitle: "Volkswagen Golf",
  vehicleRegistration: "AB12 CDE",
  vehiclePrice: 7500,
  vehicleUrl: null,
  appointmentAt: null,
  appointmentCancelledAt: null,
  managePath: null,
  calendarIcs: null,
  partExchangeRegistration: null,
  partExchangeMileage: null,
  partExchangeCondition: null,
  customerNotificationStatus: "not_sent",
  customerNotificationError: null,
  customerNotificationSentAt: null,
  dealerNotificationStatus: "not_sent",
  dealerNotificationError: null,
  dealerNotificationSentAt: null,
  reminderStatus: "not_sent",
  reminderError: null,
  reminderSentAt: null,
  createdAt: "2026-10-28T10:00:00Z",
  updatedAt: "2026-10-28T10:00:00Z",
  events: [],
  assignedToId: "staff-one",
  assignedToName: "Sam",
  workspaceRevision: 1,
};
const car = {
  id: "golf",
  title: "Volkswagen Golf",
  price: 7500,
  inventoryStatus: "available",
  images: [],
} as unknown as Car;
function show(
  options: {
    current?: Enquiry;
    entries?: Enquiry[];
    car?: Car;
    canBook?: boolean;
    onEmail?: boolean;
  } = {},
) {
  const actions: EnquiryRecordActions = {
    onUpdate: vi.fn(),
    onConversation: vi.fn(),
    onFollowUp: vi.fn(),
    onAppointment: vi.fn(),
    onBook: vi.fn(),
    onVehicle: vi.fn(),
    onMerge: vi.fn(),
    onEmail: options.onEmail === false ? undefined : vi.fn(),
    onCustomerHistory: vi.fn(),
    canBook: options.canBook ?? true,
  };
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  render(
    <QueryClientProvider client={client}>
      <EnquiryCustomerCase
        entry={options.current ?? entry}
        entries={options.entries ?? [options.current ?? entry]}
        car={options.car ?? car}
        actions={actions}
      />
    </QueryClientProvider>,
  );
  return { actions, client };
}
function openVehicleChecks() {
  const details = screen.getByText("Vehicle & checks").closest("details")!;
  details.open = true;
  fireEvent(details, new Event("toggle"));
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal(
    "matchMedia",
    vi.fn((query) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  );
  state.manage = true;
  state.accessError = false;
});

it("passes the exact selected case group and linked vehicle to connected timeline and manual checks", () => {
  const merged = {
    ...entry,
    id: "explicit-merged",
    reference: "ENQ-MERGED",
    mergedIntoId: entry.id,
  } as Enquiry;
  const records = [entry, merged];
  const { actions } = show({ entries: records });
  expect(state.timeline.mock.calls.at(-1)?.[0]).toEqual({
    entry,
    entries: records,
    canEmail: true,
  });
  expect(state.checks.mock.calls.at(-1)?.[0]).toMatchObject({
    entry,
    car,
    canManage: true,
    onInsertText: expect.any(Function),
  });
  expect(state.reply.mock.calls.at(-1)?.[0]).toMatchObject({
    entry,
    focusRequest: 0,
  });
  openVehicleChecks();
  fireEvent.click(screen.getByRole("button", { name: "Vehicle information" }));
  expect(actions.onVehicle).toHaveBeenCalledWith(car);
  expect(state.fetch).not.toHaveBeenCalled();
});

it("opens the inline channel for the selected customer rather than redirecting to email records", () => {
  const { actions } = show();
  fireEvent.click(
    within(
      screen.getByRole("region", { name: "Recommended next action" }),
    ).getByRole("button", { name: "Respond" }),
  );
  expect(screen.getByTestId("requested-channel")).toHaveTextContent("email");
  expect(screen.getByTestId("focus-request")).toHaveTextContent("1");
  fireEvent.click(screen.getByRole("button", { name: "customer@example.com" }));
  expect(screen.getByTestId("focus-request")).toHaveTextContent("2");
  fireEvent.click(screen.getByRole("button", { name: "Log call" }));
  expect(screen.getByTestId("requested-channel")).toHaveTextContent("note");
  expect(actions.onEmail).not.toHaveBeenCalled();
  expect(actions.onConversation).not.toHaveBeenCalled();
  expect(
    screen.queryByRole("link", { name: /Read reply|Email records/i }),
  ).not.toBeInTheDocument();
  expect(state.fetch).not.toHaveBeenCalled();
});

it("inserts checked information into an editable draft only and blocks insertion while sending", () => {
  show();
  openVehicleChecks();
  fireEvent.click(
    screen.getByRole("button", { name: "Add checked estimate to reply" }),
  );
  expect(screen.getByTestId("inserted-draft")).toHaveTextContent(
    "Estimated delivery to SW1A 1AA: £57.40. Showroom confirmation required.",
  );
  expect(state.reply.mock.calls.at(-1)?.[0]).toMatchObject({
    entry,
    insertion: { id: 1, text: expect.any(String) },
    requestedChannel: "email",
    focusRequest: 1,
  });
  expect(state.fetch).not.toHaveBeenCalled();
  fireEvent.click(
    screen.getByRole("button", { name: "Simulate send in progress" }),
  );
  expect(state.checks.mock.calls.at(-1)?.[0].onInsertText).toBeUndefined();
  expect(
    screen.getByRole("button", { name: "Add checked estimate to reply" }),
  ).toBeDisabled();
});

it("keeps Respond functional without email access by opening the existing conversation action", () => {
  const { actions } = show({ onEmail: false });
  fireEvent.click(
    within(
      screen.getByRole("region", { name: "Recommended next action" }),
    ).getByRole("button", { name: "Respond" }),
  );
  expect(actions.onConversation).toHaveBeenCalledWith(entry);
  expect(state.reply).not.toHaveBeenCalled();
  expect(state.timeline.mock.calls.at(-1)?.[0].canEmail).toBe(false);
  expect(state.checks.mock.calls.at(-1)?.[0].onInsertText).toBeUndefined();
});

it("hides disabled booking entry points and keeps Start sale tied to the real selected enquiry", () => {
  show({ canBook: false });
  expect(
    screen.queryByRole("button", { name: "Book test drive" }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "Book another test drive" }),
  ).not.toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Start sale" })).toHaveAttribute(
    "href",
    "/portal?section=sales&enquiryId=enquiry-one",
  );
  expect(state.fetch).not.toHaveBeenCalled();
});

it("keeps manual follow-up and booking actions bound to this enquiry", () => {
  const { actions } = show();
  fireEvent.click(screen.getByRole("button", { name: "Set follow-up" }));
  fireEvent.click(screen.getByRole("button", { name: "Book test drive" }));
  expect(actions.onFollowUp).toHaveBeenCalledWith(entry);
  expect(actions.onBook).toHaveBeenCalledWith(entry);
  expect(state.fetch).not.toHaveBeenCalled();
});

it("shows pending incoming-email review and opens it in the same selected case", () => {
  const current = {
    ...entry,
    pendingEmailReplies: 1,
    emailRepliesToReview: 1,
  } as Enquiry;
  const { actions } = show({ current });
  expect(screen.getByText("Email needs review")).toBeVisible();
  expect(
    screen.getByRole("heading", { name: "Review incoming email" }),
  ).toBeVisible();
  expect(
    screen.getByText(
      "Check the sender before replying. Other scheduled work remains in place.",
    ),
  ).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Read & reply" }));
  expect(screen.getByTestId("focus-request")).toHaveTextContent("1");
  expect(state.reply.mock.calls.at(-1)?.[0].entry).toEqual(current);
  expect(actions.onEmail).not.toHaveBeenCalled();
});

it.each(["readonly", "access-error"])(
  "protects customer records and checks in %s mode",
  (mode) => {
    if (mode === "readonly") state.manage = false;
    else state.accessError = true;
    show();
    expect(
      screen.queryByRole("button", { name: "Respond" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Log call" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Set follow-up" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Book test drive" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "Start sale" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("region", { name: "Mock inline reply" }),
    ).not.toBeInTheDocument();
    expect(state.timeline.mock.calls.at(-1)?.[0].canEmail).toBe(false);
    expect(state.checks.mock.calls.at(-1)?.[0]).toMatchObject({
      canManage: false,
      onInsertText: undefined,
    });
    expect(state.reply).not.toHaveBeenCalled();
    expect(state.fetch).not.toHaveBeenCalled();
    expect(state.claim).not.toHaveBeenCalled();
  },
);
