import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { dealerConfig } from "@/config/dealer";

const state = vi.hoisted(() => ({
  auth: { isLoaded: true, isSignedIn: true },
  session: {} as any,
  access: {} as any,
  sessionHook: vi.fn(),
  accessHook: vi.fn(),
  refetch: vi.fn(),
  websiteChat: false,
  salesMounts: 0,
}));

vi.mock("@clerk/react", () => ({
  useAuth: () => state.auth,
  useUser: () => ({
    user: {
      firstName: "Alex",
      primaryEmailAddress: { emailAddress: "alex@example.test" },
    },
  }),
  UserButton: () => (
    <button type="button" aria-label="Account menu">
      Account
    </button>
  ),
  SignInButton: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
}));
vi.mock("@workspace/api-client-react", () => ({
  getGetPortalSessionQueryKey: () => ["portal-session"],
  useGetPortalSession: (...args: unknown[]) => {
    state.sessionHook(...args);
    return state.session;
  },
}));
vi.mock("@workspace/vehicle-meta", () => ({
  customerFeaturePolicy: {
    get websiteChat() {
      return state.websiteChat;
    },
  },
}));
vi.mock("@/lib/dealer-settings-context", () => ({
  useDealerSettings: () => ({
    settings: {
      ...dealerConfig,
      identity: {
        ...dealerConfig.identity,
        name: "Fictional Motors",
        logoText: "Fictional Motors",
        logoAsset: "/fixture-dealer-logo.png",
      },
    },
  }),
}));
vi.mock("@/components/portal/dealer-administration", () => ({
  useStaffAccess: (...args: unknown[]) => {
    state.accessHook(...args);
    return state.access;
  },
  DealerSettingsHub: () => (
    <section aria-label="Settings fixture">Settings</section>
  ),
}));
vi.mock("@/components/portal/notifications-workspace", async () => {
  const { useSearch } = await import("wouter");
  return {
    NotificationsWorkspace: ({
      canEmail,
      onQuickEnquiry,
    }: {
      canEmail: boolean;
      onQuickEnquiry?: () => void;
    }) => (
      <section
        aria-label="Notifications fixture"
        data-can-email={String(canEmail)}
        data-search={useSearch()}
      >
        Customer work
        {canEmail && (
          <button type="button" onClick={onQuickEnquiry}>
            Panel quick enquiry
          </button>
        )}
      </section>
    ),
  };
});
vi.mock("@/components/portal/staff-inventory", () => ({
  StaffInventory: ({ onQuickEnquiry }: { onQuickEnquiry?: (vehicleId: string) => void }) => (
    <section aria-label="Inventory fixture">All cars{onQuickEnquiry && <button type="button" onClick={() => onQuickEnquiry("stock-car-one")}>Enquire about fixture car</button>}</section>
  ),
}));
vi.mock("@/components/portal/quick-enquiry", () => ({
  QuickEnquiryDialog: ({
    open,
    onOpenChange,
    onCreated,
    initialVehicleId,
  }: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onCreated: (enquiry: { id: string; reference: string; appointmentAt?: string | null; appointmentStatus?: string | null; customerNotificationStatus?: string | null }) => void;
    initialVehicleId?: string | null;
  }) =>
    open ? (
      <section role="dialog" aria-label="Quick enquiry" data-vehicle-id={initialVehicleId || ""}>
        <button type="button" onClick={() => onOpenChange(false)}>
          Close fixture enquiry
        </button>
        <button
          type="button"
          onClick={() => onCreated({ id: "quick-id", reference: "Q-123" })}
        >
          Save fixture enquiry
        </button>
        {[
          { label: "confirmed", appointmentStatus: "confirmed", customerNotificationStatus: "sent" },
          { label: "pending", appointmentStatus: "pending", customerNotificationStatus: "sent" },
          { label: "failed-email", appointmentStatus: "confirmed", customerNotificationStatus: "failed" },
          { label: "unknown-email", appointmentStatus: "confirmed", customerNotificationStatus: "unknown" },
        ].map(result => <button key={result.label} type="button" onClick={() => onCreated({ id: "quick-id", reference: "Q-123", appointmentAt: "2026-10-19T14:00:00.000Z", appointmentStatus: result.appointmentStatus, customerNotificationStatus: result.customerNotificationStatus })}>Save fixture {result.label} booking</button>)}
      </section>
    ) : null,
}));
vi.mock("@/components/portal/relationships-panel", () => ({
  RelationshipsPanel: () => (
    <section aria-label="History fixture">History</section>
  ),
}));
vi.mock("@/components/portal/reservations-panel", () => ({
  ReservationsPanel: () => (
    <section aria-label="Reservations fixture">Reservations</section>
  ),
}));
vi.mock("@/components/portal/stripe-reservations-panel", () => ({
  StripeReservationsPanel: () => null,
}));
vi.mock("@/components/portal/chat-panel", () => ({
  ChatPanel: () => <section aria-label="Chat fixture">Chat</section>,
}));
vi.mock("@/components/portal/chat-notifications", () => ({
  ChatUnreadBadge: () => null,
}));
vi.mock("@/components/portal/device-notifications", () => ({
  PortalInstallMetadata: () => null,
}));
vi.mock("@/pages/sales-demo", async () => {
  const { useState } = await import("react");
  return {
    SalesWorkspace: ({
      newSaleRequest,
      onExit,
    }: {
      newSaleRequest: number;
      onExit: () => void;
    }) => {
      const [mountId] = useState(() => ++state.salesMounts);
      const [value, setValue] = useState("");
      return (
        <section
          aria-label="Sales fixture"
          data-request={newSaleRequest}
          data-mount={mountId}
        >
          <label>
            Retained sale worksheet
            <input
              value={value}
              onChange={(event) => setValue(event.target.value)}
            />
          </label>
          <button type="button" onClick={onExit}>
            Return to customer work
          </button>
        </section>
      );
    },
  };
});

import Portal from "./portal";

function mount(search = "") {
  const path = `/portal${search ? `?${search}` : ""}`;
  // The initial state reads the browser URL; subsequent navigation uses wouter.
  window.history.replaceState({}, "", path);
  const location = memoryLocation({ path, record: true });
  const rendered = render(
    <Router hook={location.hook}>
      <Portal />
    </Router>,
  );
  return { location, ...rendered };
}
function query(location: ReturnType<typeof memoryLocation>) {
  return new URL(location.history.at(-1)!, "https://dealer.example.test")
    .searchParams;
}
function section(key: string) {
  return screen.getByTestId(`tab-${key}`);
}
async function openQuickActions() {
  const trigger = screen.getByRole("button", { name: "Quick actions" });
  fireEvent.keyDown(trigger, { key: "ArrowDown", code: "ArrowDown" });
  return screen.findByRole("menu");
}
async function chooseQuickAction(name: string) {
  await openQuickActions();
  fireEvent.click(screen.getByRole("menuitem", { name }));
}
function expectCurrent(key: string) {
  const navigation = screen.getByRole("navigation", {
    name: "Portal sections",
  });
  const current = navigation.querySelectorAll('[aria-current="page"]');
  expect(current).toHaveLength(1);
  expect(section(key)).toHaveAttribute("aria-current", "page");
  const target = section(key).getAttribute("aria-controls");
  expect(target).toBeTruthy();
  expect(document.getElementById(target!)).toHaveAttribute(
    "aria-labelledby",
    section(key).id,
  );
}

beforeEach(() => {
  state.auth = { isLoaded: true, isSignedIn: true };
  state.session = {
    data: { state: "allowed", name: "Alex Staff", email: "alex@example.test" },
    isLoading: false,
    isError: false,
    isFetching: false,
    error: null,
    refetch: state.refetch,
  };
  state.access = {
    data: { role: "owner", permissions: ["sales.manage", "settings.publish"] },
    isLoading: false,
    isError: false,
  };
  state.sessionHook.mockClear();
  state.accessHook.mockClear();
  state.refetch.mockReset();
  state.websiteChat = false;
  state.salesMounts = 0;
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
});
afterEach(() => vi.unstubAllGlobals());

describe("portal shell access and navigation", () => {
  it("waits for authentication without requesting or mounting staff data", () => {
    state.auth.isLoaded = false;
    mount("section=inventory");
    expect(screen.getByRole("status")).toHaveTextContent(
      "Checking staff access",
    );
    expect(state.sessionHook).not.toHaveBeenCalled();
    expect(
      screen.queryByRole("navigation", { name: "Portal sections" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("region", { name: "Inventory fixture" }),
    ).not.toBeInTheDocument();
  });

  it("offers sign-in and a showroom escape before loading staff panels", () => {
    state.auth.isSignedIn = false;
    mount("section=sales");
    expect(
      screen.getByRole("heading", { name: "Sign in to your staff portal" }),
    ).toBeVisible();
    expect(screen.getByTestId("button-portal-sign-in")).toBeVisible();
    expect(
      screen.getByRole("link", { name: "Back to showroom" }),
    ).toHaveAttribute("href", "/");
    expect(state.sessionHook).not.toHaveBeenCalled();
    expect(state.salesMounts).toBe(0);
  });

  it("waits for the dealership session before mounting any workspace", () => {
    state.session = { ...state.session, data: undefined, isLoading: true };
    mount("section=inventory");
    expect(screen.getByRole("status")).toHaveTextContent(
      "Loading your workspace",
    );
    expect(state.accessHook).toHaveBeenCalledWith(false);
    expect(
      screen.queryByRole("region", { name: "Inventory fixture" }),
    ).not.toBeInTheDocument();
  });

  it.each(["forbidden", "http403"])(
    "keeps the denied %s account outside all staff panels",
    (kind) => {
      state.session =
        kind === "forbidden"
          ? {
              ...state.session,
              data: { state: "forbidden", email: "denied@example.test" },
            }
          : {
              ...state.session,
              data: undefined,
              isError: true,
              error: { status: 403 },
            };
      mount("section=sales");
      expect(
        screen.getByRole("heading", { name: "Access unavailable" }),
      ).toBeVisible();
      expect(
        screen.getByRole("button", { name: "Account menu" }),
      ).toBeVisible();
      expect(
        screen.queryByRole("navigation", { name: "Portal sections" }),
      ).not.toBeInTheDocument();
      expect(state.salesMounts).toBe(0);
    },
  );

  it("offers a safe access retry on a server failure", () => {
    state.session = {
      ...state.session,
      data: undefined,
      isError: true,
      error: { status: 503 },
    };
    mount();
    expect(
      screen.getByRole("heading", { name: "Unable to load your workspace" }),
    ).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(state.refetch).toHaveBeenCalledTimes(1);
    expect(
      screen.queryByRole("navigation", { name: "Portal sections" }),
    ).not.toBeInTheDocument();
  });

  it("opens one Home workspace by default and gives every section an accessible current target", () => {
    mount();
    expectCurrent("notifications");
    const nav = screen.getByRole("navigation", { name: "Portal sections" });
    expect(section("notifications")).toHaveAccessibleName("Home");
    expect(screen.queryByTestId("tab-overview")).not.toBeInTheDocument();
    expect(
      within(nav).queryByRole("button", { name: "Overview" }),
    ).not.toBeInTheDocument();
    expect(within(nav).getByTestId("tab-inventory")).toHaveAccessibleName(
      "Cars",
    );
    for (const button of within(nav).getAllByRole("button")) {
      expect(button).toHaveAttribute("type", "button");
      expect(button).toHaveAccessibleName();
    }
    expect(
      screen.getByRole("region", { name: "Notifications fixture" }),
    ).toHaveAttribute("data-can-email", "true");
  });

  it("uses one branded staff toolbar and keeps the showroom in a separate safe tab", () => {
    mount("section=inventory");
    const toolbar = screen.getByRole("banner", { name: "Staff workspace" });
    expect(
      within(toolbar).getByRole("link", { name: "Fictional Motors workspace" }),
    ).toHaveAttribute("href", "/portal");
    expect(
      within(toolbar).getByRole("img", { name: "Fictional Motors" }),
    ).toHaveAttribute("src", "/fixture-dealer-logo.png");
    const showroom = within(toolbar).getByRole("link", {
      name: "View showroom (opens in a new tab)",
    });
    expect(showroom).toHaveAttribute("href", "/");
    expect(showroom).toHaveAttribute("target", "_blank");
    expect(showroom).toHaveAttribute("rel", "noopener noreferrer");
    expect(screen.getAllByRole("link", { name: /View showroom/ })).toHaveLength(
      1,
    );
    expect(
      within(toolbar).getByRole("button", { name: "Quick actions" }),
    ).toBeVisible();
    expect(
      within(toolbar).getByRole("button", { name: "Account menu" }),
    ).toBeVisible();
    expect(screen.queryByText(/^Signed in as/)).not.toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "Back to showroom" }),
    ).not.toBeInTheDocument();
  });

  it.each(["not-a-section", "chat"])(
    "safely falls back from unavailable section=%s on first load and navigation",
    (requested) => {
      const { location } = mount(`section=${requested}`);
      expectCurrent("notifications");
      expect(
        screen.queryByRole("region", { name: "Chat fixture" }),
      ).not.toBeInTheDocument();
      expect(screen.queryByTestId("tab-chat")).not.toBeInTheDocument();
      act(() => location.navigate("/portal?section=inventory"));
      expectCurrent("inventory");
      act(() => location.navigate(`/portal?section=${requested}`));
      expectCurrent("notifications");
      expect(
        screen.getByRole("region", { name: "Notifications fixture" }),
      ).toBeVisible();
    },
  );

  it("keeps settings unavailable when resolved staff permissions forbid the bookmark", () => {
    state.access.data = { role: "salesperson", permissions: ["sales.manage"] };
    const { location } = mount("section=settings&settingsTab=integrations");
    expectCurrent("notifications");
    expect(screen.queryByTestId("tab-settings")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("region", { name: "Settings fixture" }),
    ).not.toBeInTheDocument();
    act(() => location.navigate("/portal?section=inventory"));
    act(() => location.navigate("/portal?section=settings"));
    expectCurrent("notifications");
    expect(
      screen.queryByRole("region", { name: "Settings fixture" }),
    ).not.toBeInTheDocument();
  });

  it("allows a chat bookmark only when the website chat feature is enabled", () => {
    state.websiteChat = true;
    mount("section=chat");
    expectCurrent("chat");
    expect(screen.getByRole("region", { name: "Chat fixture" })).toBeVisible();
  });

  it.each(["enquiries", "test-drives", "email"])(
    "preserves the legacy %s bookmark and customer context",
    (legacy) => {
      const search = `section=${legacy}&enquiryId=customer-1&compose=draft-1`;
      mount(search);
      expectCurrent("notifications");
      expect(
        screen.getByRole("region", { name: "Notifications fixture" }),
      ).toHaveAttribute("data-search", search);
    },
  );

  it("opens legacy Overview bookmarks in Home without a duplicate navigation section", () => {
    const { location } = mount("section=overview");
    expectCurrent("notifications");
    expect(section("notifications")).toHaveAccessibleName("Home");
    expect(
      screen.getByRole("region", { name: "Notifications fixture" }),
    ).toBeVisible();
    expect(screen.queryByTestId("tab-overview")).not.toBeInTheDocument();
    act(() => location.navigate("/portal?section=inventory"));
    act(() => location.navigate("/portal?section=overview"));
    expectCurrent("notifications");
  });

  it.each([
    "section=inventory&vehicleId=car-1",
    "section=history&view=vehicles&vehicleId=car-1",
    "section=sales&saleId=sale-1",
  ])("opens and cancels Quick enquiry without leaving %s", async (search) => {
    const { location } = mount(search);
    const initialHistory = [...location.history];
    const active = screen
      .getByRole("navigation", { name: "Portal sections" })
      .querySelector('[aria-current="page"]')!;
    await chooseQuickAction("Quick enquiry");
    expect(screen.getByRole("dialog", { name: "Quick enquiry" })).toBeVisible();
    expect(location.history).toEqual(initialHistory);
    expect(active).toHaveAttribute("aria-current", "page");
    fireEvent.click(
      screen.getByRole("button", { name: "Close fixture enquiry" }),
    );
    expect(
      screen.queryByRole("dialog", { name: "Quick enquiry" }),
    ).not.toBeInTheDocument();
    expect(location.history).toEqual(initialHistory);
  });

  it("prefills a car enquiry in place and resets the car for a later general enquiry", async () => {
    const { location } = mount("section=inventory&vehicleId=stock-car-one");
    const initialHistory = [...location.history];
    fireEvent.click(screen.getByRole("button", { name: "Enquire about fixture car" }));
    expect(screen.getByRole("dialog", { name: "Quick enquiry" })).toHaveAttribute("data-vehicle-id", "stock-car-one");
    expect(location.history).toEqual(initialHistory);
    fireEvent.click(screen.getByRole("button", { name: "Close fixture enquiry" }));
    await chooseQuickAction("Quick enquiry");
    expect(screen.getByRole("dialog", { name: "Quick enquiry" })).toHaveAttribute("data-vehicle-id", "");
    expect(location.history).toEqual(initialHistory);
  });

  it("confirms a quick enquiry without moving away or replacing an open sale worksheet", async () => {
    const { location } = mount("section=sales&saleId=sale-1");
    fireEvent.change(
      screen.getByRole("textbox", { name: "Retained sale worksheet" }),
      { target: { value: "Keep this invoice" } },
    );
    const initialHistory = [...location.history];
    await chooseQuickAction("Quick enquiry");
    fireEvent.click(
      screen.getByRole("button", { name: "Save fixture enquiry" }),
    );
    expect(
      screen.queryByRole("dialog", { name: "Quick enquiry" }),
    ).not.toBeInTheDocument();
    expect(location.history).toEqual(initialHistory);
    expectCurrent("sales");
    expect(screen.getByRole("status")).toHaveTextContent(
      "Enquiry saved.",
    );
    expect(screen.getByRole("status")).not.toHaveTextContent("Q-123");
    expect(screen.getByRole("link", { name: "Open enquiry" })).toHaveAttribute(
      "href",
      "/portal?section=notifications&workView=customers&enquiryId=quick-id",
    );
    expect(
      screen.getByRole("textbox", { name: "Retained sale worksheet" }),
    ).toHaveValue("Keep this invoice");
    expect(state.salesMounts).toBe(1);
    expect(screen.queryByText("Booking saved. Confirmation email needs attention.")).not.toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "Dismiss confirmation" }),
    );
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(location.history).toEqual(initialHistory);
  });

  it("confirms a quick test drive in place, with its UK appointment time and a direct booking link", async () => {
    const { location } = mount("section=inventory&vehicleId=stock-car-one");
    const initialHistory = [...location.history];
    await chooseQuickAction("Quick enquiry");
    fireEvent.click(screen.getByRole("button", { name: "Save fixture confirmed booking" }));
    expect(screen.queryByRole("dialog", { name: "Quick enquiry" })).not.toBeInTheDocument();
    expect(location.history).toEqual(initialHistory);
    expectCurrent("inventory");
    const confirmation = screen.getByRole("status");
    expect(confirmation).toHaveTextContent("Test drive booked");
    expect(confirmation).toHaveTextContent(/19 October 2026.*15:00/);
    expect(screen.queryByText("Booking saved. Confirmation email needs attention.")).not.toBeInTheDocument();
    const link = screen.getByRole("link", { name: "Open booking" });
    expect(link).toHaveAttribute("href", "/portal?section=notifications&workView=test-drives&enquiryId=quick-id");
    fireEvent.click(link);
    expectCurrent("notifications");
    const params = query(location);
    expect(params.get("workView")).toBe("test-drives");
    expect(params.get("enquiryId")).toBe("quick-id");
    expect(params.has("vehicleId")).toBe(false);
  });

  it("labels an approval-required quick test drive as a request rather than a confirmed booking", async () => {
    const { location } = mount("section=notifications&workView=customers");
    const initialHistory = [...location.history];
    await chooseQuickAction("Quick enquiry");
    fireEvent.click(screen.getByRole("button", { name: "Save fixture pending booking" }));
    expect(location.history).toEqual(initialHistory);
    const confirmation = screen.getByRole("status");
    expect(confirmation).toHaveTextContent("Test-drive request saved");
    expect(confirmation).toHaveTextContent(/19 October 2026.*15:00/);
    expect(confirmation).toHaveTextContent("Awaiting approval");
    expect(confirmation).not.toHaveTextContent("Test drive booked");
    expect(screen.getByRole("link", { name: "Open booking" })).toHaveAttribute("href", "/portal?section=notifications&workView=test-drives&enquiryId=quick-id");
    expect(screen.queryByText("Booking saved. Confirmation email needs attention.")).not.toBeInTheDocument();
  });

  it.each(["failed-email", "unknown-email"])("keeps the booking confirmation but flags the %s delivery outcome", async outcome => {
    const { location } = mount("section=inventory");
    const initialHistory = [...location.history];
    await chooseQuickAction("Quick enquiry");
    fireEvent.click(screen.getByRole("button", { name: `Save fixture ${outcome} booking` }));
    expect(location.history).toEqual(initialHistory);
    expect(screen.getByRole("status")).toHaveTextContent("Test drive booked");
    expect(screen.getByText("Booking saved. Confirmation email needs attention.")).toBeVisible();
    expect(screen.getByRole("link", { name: "Open booking" })).toHaveAttribute("href", "/portal?section=notifications&workView=test-drives&enquiryId=quick-id");
    expect(screen.queryByRole("link", { name: "Open enquiry" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Dismiss confirmation" }));
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(screen.queryByText("Booking saved. Confirmation email needs attention.")).not.toBeInTheDocument();
  });

  it("opens the same Quick enquiry dialog from the combined customer workspace", () => {
    const { location } = mount(
      "section=notifications&workView=customers&enquiryId=customer-1",
    );
    const initialHistory = [...location.history];
    fireEvent.click(
      screen.getByRole("button", { name: "Panel quick enquiry" }),
    );
    expect(screen.getByRole("dialog", { name: "Quick enquiry" })).toBeVisible();
    expect(location.history).toEqual(initialHistory);
  });

  it.each([
    ["Calendar", "test-drives", "deskView", "calendar"],
    ["Saved email drafts", "email", "view", "drafts"],
  ])(
    "opens %s using the existing workspace route and clears unrelated context",
    async (label, workView, parameter, value) => {
      const { location } = mount("section=inventory&vehicleId=car-1");
      await chooseQuickAction(label);
      const params = query(location);
      expectCurrent("notifications");
      expect(params.get("section")).toBe("notifications");
      expect(params.get("workView")).toBe(workView);
      expect(params.get(parameter)).toBe(value);
      expect(params.has("vehicleId")).toBe(false);
      expect(
        screen.queryByRole("dialog", { name: "Quick enquiry" }),
      ).not.toBeInTheDocument();
    },
  );

  it("honours deep links and external history changes between staff sections", () => {
    const { location } = mount("section=inventory&vehicleId=car-1");
    expectCurrent("inventory");
    expect(
      screen.getByRole("region", { name: "Inventory fixture" }),
    ).toBeVisible();
    act(() =>
      location.navigate(
        "/portal?section=history&view=vehicles&vehicleId=car-1",
      ),
    );
    expectCurrent("history");
    expect(
      screen.getByRole("region", { name: "History fixture" }),
    ).toBeVisible();
    act(() => location.navigate("/portal?section=inventory&vehicleId=car-1"));
    expectCurrent("inventory");
    expect(
      screen.queryByRole("region", { name: "History fixture" }),
    ).not.toBeInTheDocument();
  });

  it("only exposes owner settings and creation shortcuts to authorised staff", async () => {
    state.access.data = { role: "accounts", permissions: ["finance.export"] };
    mount();
    expect(
      screen.queryByRole("button", { name: "New sale" }),
    ).not.toBeInTheDocument();
    if (screen.queryByRole("button", { name: "Quick actions" }))
      await openQuickActions();
    for (const name of ["Quick enquiry", "New sale", "Saved email drafts"])
      expect(screen.queryByRole("menuitem", { name })).not.toBeInTheDocument();
    const menu = screen.queryByRole("menu");
    if (menu) {
      fireEvent.keyDown(menu, { key: "Escape" });
      await waitFor(() =>
        expect(screen.queryByRole("menu")).not.toBeInTheDocument(),
      );
    }
    expect(
      screen.queryByRole("dialog", { name: "Quick enquiry" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByTestId("tab-settings")).not.toBeInTheDocument();
    expect(screen.queryByTestId("tab-chat")).not.toBeInTheDocument();
    expect(
      screen.getByRole("region", { name: "Notifications fixture" }),
    ).toHaveAttribute("data-can-email", "false");
  });

  it("hides an open quick-create dialog if the current staff role loses permission", async () => {
    const { location, rerender } = mount("section=inventory");
    await chooseQuickAction("Quick enquiry");
    expect(screen.getByRole("dialog", { name: "Quick enquiry" })).toBeVisible();
    state.access.data = { role: "accounts", permissions: ["finance.export"] };
    rerender(
      <Router hook={location.hook}>
        <Portal />
      </Router>,
    );
    expect(
      screen.queryByRole("dialog", { name: "Quick enquiry" }),
    ).not.toBeInTheDocument();
    expectCurrent("inventory");
  });

  it("navigates without carrying another section’s record selection", () => {
    const { location } = mount("section=inventory&vehicleId=car-1");
    fireEvent.click(section("history"));
    expect(query(location).get("section")).toBe("history");
    expect(query(location).has("vehicleId")).toBe(false);
    expectCurrent("history");
  });

  it("keeps an owner settings bookmark while staff permissions are still loading", () => {
    state.access = { data: undefined, isLoading: true, isError: false };
    const { location, rerender } = mount("section=settings&settingsTab=emails");
    state.access = {
      data: { role: "owner", permissions: ["settings.publish"] },
      isLoading: false,
      isError: false,
    };
    rerender(
      <Router hook={location.hook}>
        <Portal />
      </Router>,
    );
    expectCurrent("settings");
    expect(
      screen.getByRole("region", { name: "Settings fixture" }),
    ).toBeVisible();
    expect(query(location).get("settingsTab")).toBe("emails");
  });

  it("reveals the current section when a narrow navigation row is resized", () => {
    let resize: ResizeObserverCallback | undefined;
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(callback: ResizeObserverCallback) {
          resize = callback;
        }
        observe() {}
        disconnect() {}
      },
    );
    mount("section=history");
    const navigation = screen.getByRole("navigation", {
      name: "Portal sections",
    });
    const current = section("history");
    vi.spyOn(navigation, "getBoundingClientRect").mockReturnValue({
      left: 0,
      right: 300,
    } as DOMRect);
    vi.spyOn(current, "getBoundingClientRect").mockReturnValue({
      left: 320,
      right: 400,
    } as DOMRect);
    act(() => resize?.([], {} as ResizeObserver));
    expect(navigation.scrollLeft).toBe(100);
    vi.spyOn(current, "getBoundingClientRect").mockReturnValue({
      left: -30,
      right: 50,
    } as DOMRect);
    act(() => resize?.([], {} as ResizeObserver));
    expect(navigation.scrollLeft).toBe(70);
  });

  it("keeps an open sale worksheet while switching sections and returns to customer work", async () => {
    const { location } = mount();
    await chooseQuickAction("New sale");
    expectCurrent("sales");
    const sale = screen.getByRole("region", { name: "Sales fixture" });
    expect(sale).toHaveAttribute("data-request", "1");
    fireEvent.change(
      screen.getByRole("textbox", { name: "Retained sale worksheet" }),
      { target: { value: "Keep this customer" } },
    );
    fireEvent.click(section("inventory"));
    expect(sale).not.toBeVisible();
    fireEvent.click(section("sales"));
    expect(
      screen.getByRole("textbox", { name: "Retained sale worksheet" }),
    ).toHaveValue("Keep this customer");
    expect(sale).toHaveAttribute("data-mount", "1");
    expect(state.salesMounts).toBe(1);
    await chooseQuickAction("New sale");
    expect(sale).toHaveAttribute("data-request", "2");
    fireEvent.click(
      screen.getByRole("button", { name: "Return to customer work" }),
    );
    expectCurrent("notifications");
    expect(query(location).get("workView")).toBe("customers");
    expect(sale).not.toBeVisible();
  });
});
