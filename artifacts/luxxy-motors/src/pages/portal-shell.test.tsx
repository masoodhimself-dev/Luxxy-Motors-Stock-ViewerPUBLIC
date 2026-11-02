import { useState } from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, afterEach, it, expect, vi } from "vitest";
const state = vi.hoisted(() => ({
  permissions: ["sales.manage", "settings.publish", "team.manage"],
  signedIn: true,
  bookingEnabled: true,
  multiChoice: false,
  settingsLoading: false,
  settingsError: false,
  featureLoading: false,
  featureError: false,
  bookingSettingsEnabled: true,
  cars: [] as Array<Record<string, unknown>>,
  staffCarsOptions: vi.fn(),
  draftFetch: vi.fn(),
}));
vi.mock('@/lib/multi-home-scope', () => ({ isMultiChoiceWebsite: () => state.multiChoice }));
vi.mock("@clerk/react", () => ({
  useAuth: () => ({ isLoaded: true, isSignedIn: state.signedIn }),
  useUser: () => ({ user: { firstName: "Operator" } }),
  UserButton: () => <button>Account</button>,
  SignInButton: ({ children }: any) => children,
}));
vi.mock("@workspace/api-client-react", () => ({
  customFetch: (...args: unknown[]) => state.draftFetch(...args),
  getGetPortalSessionQueryKey: () => ["portal-session"],
  useGetPortalSession: () => ({
    data: { state: "allowed", name: "Operator" },
    isLoading: false,
    isError: false,
  }),
}));
vi.mock("@/components/portal/staff-cars-query", () => ({
  useStaffCars: (enabled: boolean) => {
    state.staffCarsOptions(enabled);
    return { data: { cars: state.cars }, isError: false };
  },
}));
vi.mock("@/components/mot-history", () => ({
  StaffMotLookupDialog: ({ initialRegistration, onClose }: any) => (
    <section aria-label="MOT lookup">
      <p>MOT registration: {initialRegistration || "none"}</p>
      <button onClick={onClose}>Close MOT lookup</button>
    </section>
  ),
}));
vi.mock("@/components/portal/dealer-administration", () => ({
  useStaffAccess: () => ({ data: { permissions: state.permissions } }),
  DealerSettingsHub: () => {
    const [draft, setDraft] = useState("");
    return (
      <section data-settings-dirty={!!draft}>
        <label>
          Private wording
          <input value={draft} onChange={(e) => setDraft(e.target.value)} />
        </label>
      </section>
    );
  },
}));
vi.mock("@/components/portal/notifications-workspace", () => ({
  NotificationsWorkspace: () => <p>Inbox workspace</p>,
}));
vi.mock("@/components/portal/quick-enquiry", () => ({
  QuickEnquiryDialog: ({
    open,
    initialVehicleId,
    initialBookTestDrive,
  }: any) =>
    open ? (
      <p>
        Quick enquiry: {initialVehicleId || "general"} ·{" "}
        {initialBookTestDrive ? "test drive" : "enquiry"}
      </p>
    ) : null,
}));
vi.mock("@/lib/dealer-features", () => ({
  useDealerFeatures: () => ({
    enabled: () => state.bookingEnabled,
    isLoading: state.featureLoading,
    isError: state.featureError,
  }),
}));
vi.mock("@/components/portal/cars-workspace", () => ({
  CarsWorkspace: ({ canManage, bookingEnabled, onEnquiry, onSale }: any) => (
    <section aria-label="Cars workspace">
      <p>Current stock</p>
      {canManage && (
        <>
          <button onClick={() => onEnquiry("car-one")}>Car enquiry</button>
          {bookingEnabled && (
            <button onClick={() => onEnquiry("car-one", true)}>
              Car booking
            </button>
          )}
          <button onClick={() => onSale("car-one")}>Car sale</button>
        </>
      )}
    </section>
  ),
}));
vi.mock("@/components/portal/device-notifications", () => ({
  PortalInstallMetadata: () => null,
}));
vi.mock("@/components/portal/history-links", () => ({
  ContextHistoryDialog: () => null,
}));
vi.mock("@/components/brand/wordmark", () => ({
  DealerWordmark: ({ name, logoAsset }: any) => <img alt={name} src={logoAsset} />,
}));
vi.mock("@/lib/dealer-settings-context", () => ({
  useDealerSettings: () => ({
    settings: {
      identity: { name: "Dealer", logoAsset: '/configured-dealer-logo.svg' },
      testDriveBooking: { enabled: state.bookingSettingsEnabled },
    },
    isLoading: state.settingsLoading,
    isError: state.settingsError,
  }),
}));
vi.mock("@/pages/sales-demo", () => ({
  SalesWorkspace: ({ newSaleVehicleId }: any) => (
    <p>Sales workspace{newSaleVehicleId ? ` · ${newSaleVehicleId}` : ""}</p>
  ),
}));
import Portal from "./portal";
function renderPortal() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={queryClient}><Portal /></QueryClientProvider>);
}
async function openQuickActions() {
  const trigger = screen.getByRole("button", { name: "Quick actions" });
  trigger.focus();
  fireEvent.keyDown(trigger, { key: "Enter", code: "Enter" });
  return screen.findByRole("menu");
}
beforeEach(() => {
  state.permissions = ["sales.manage", "settings.publish", "team.manage"];
  state.signedIn = true;
  state.bookingEnabled = true;
  state.multiChoice = false;
  state.settingsLoading = false;
  state.settingsError = false;
  state.featureLoading = false;
  state.featureError = false;
  state.bookingSettingsEnabled = true;
  state.cars = [];
  state.staffCarsOptions.mockClear();
  state.draftFetch.mockReset().mockResolvedValue({ drafts: [], hasMore: false });
  window.history.replaceState({}, "", "/portal");
  global.ResizeObserver = class {
    observe() {}
    disconnect() {}
    unobserve() {}
  };
  Element.prototype.scrollIntoView ??= () => {};
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.setPointerCapture ??= () => {};
  Element.prototype.releasePointerCapture ??= () => {};
});
it.each([true, false])('uses the approved Multi-Choice logo on portal headers when signedIn=%s', signedIn => {
  state.multiChoice = true;
  state.signedIn = signedIn;
  renderPortal();
  expect(screen.getByRole('img', { name: 'Dealer' })).toHaveAttribute('src', '/brand/multi-choice-motors/multi-choice-wordmark.svg');
});
it('keeps another dealership’s configured portal logo', () => {
  renderPortal();
  expect(screen.getByRole('img', { name: 'Dealer' })).toHaveAttribute('src', '/configured-dealer-logo.svg');
});
afterEach(() => {
  vi.restoreAllMocks();
  window.history.replaceState({}, "", "/");
});
it("defaults to Inbox with the focused Cars workspace beside Sales and Settings", () => {
  renderPortal();
  expect(screen.getByText("Inbox workspace")).toBeVisible();
  const nav = screen.getByRole("navigation", { name: "Portal sections" });
  expect(
    within(nav)
      .getAllByRole("button")
      .map((button) => button.textContent),
  ).toEqual(["Inbox", "Cars", "Sales", "Settings"]);
  expect(
    screen.queryByRole("button", { name: "Home" }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: /test mode|start test|practice/i }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByText(/test inbox|practice website/i),
  ).not.toBeInTheDocument();
});
it("old Cars bookmarks open the read-only finder without retired video actions", () => {
  window.history.replaceState(
    {},
    "",
    "/portal?section=inventory&recordVideo=1",
  );
  renderPortal();
  expect(screen.getByRole("region", { name: "Cars" })).toBeVisible();
  expect(screen.getByText("Current stock")).toBeVisible();
  expect(
    screen.queryByRole("button", { name: /video/i }),
  ).not.toBeInTheDocument();
});
it("keeps Settings in the four-item phone navigation", () => {
  window.innerWidth = 390;
  renderPortal();
  const buttons = within(
    screen.getByRole("navigation", { name: "Portal sections" }),
  ).getAllByRole("button");
  expect(buttons).toHaveLength(4);
  expect(buttons[3]).toHaveTextContent("Settings");
});
it("requires deliberate discard before leaving unsaved private Settings", () => {
  window.history.replaceState(
    {},
    "",
    "/portal?section=settings&settingsTab=emails",
  );
  renderPortal();
  fireEvent.change(screen.getByLabelText("Private wording"), {
    target: { value: "Unsaved wording" },
  });
  const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
  fireEvent.click(screen.getByRole("button", { name: "Sales" }));
  expect(confirm).toHaveBeenCalledOnce();
  expect(screen.getByLabelText("Private wording")).toHaveValue(
    "Unsaved wording",
  );
  expect(screen.queryByText("Sales workspace")).not.toBeInTheDocument();
  confirm.mockReturnValue(true);
  fireEvent.click(screen.getByRole("button", { name: "Sales" }));
  expect(screen.getByText("Sales workspace")).toBeVisible();
});
it("does not offer owner settings to an accounts role", () => {
  state.permissions = ["payments.record"];
  renderPortal();
  expect(
    within(screen.getByRole("navigation", { name: "Portal sections" }))
      .getAllByRole("button")
      .map((button) => button.textContent),
  ).toEqual(["Inbox", "Cars", "Sales"]);
});

it("opens a prefilled enquiry or booking from the focused Cars finder", () => {
  window.history.replaceState({}, "", "/portal?section=cars");
  const view = renderPortal();
  fireEvent.click(screen.getByRole("button", { name: "Car enquiry" }));
  expect(screen.getByText("Quick enquiry: car-one · enquiry")).toBeVisible();
  view.unmount();
  renderPortal();
  fireEvent.click(screen.getByRole("button", { name: "Car booking" }));
  expect(screen.getByText("Quick enquiry: car-one · test drive")).toBeVisible();
});

it("starts a car-specific unsaved sale through the existing Sales workspace", () => {
  window.history.replaceState({}, "", "/portal?section=cars");
  renderPortal();
  fireEvent.click(screen.getByRole("button", { name: "Car sale" }));
  expect(screen.getByText("Sales workspace · car-one")).toBeVisible();
});

it("does not offer a Cars booking when the dealer feature is disabled", () => {
  state.bookingEnabled = false;
  window.history.replaceState({}, "", "/portal?section=cars");
  renderPortal();
  expect(
    screen.queryByRole("button", { name: "Car booking" }),
  ).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Car enquiry" })).toBeVisible();
});

it("protects unsaved settings when using the workspace logo", () => {
  window.history.replaceState(
    {},
    "",
    "/portal?section=settings&settingsTab=emails",
  );
  renderPortal();
  fireEvent.change(screen.getByLabelText("Private wording"), {
    target: { value: "Keep my private wording" },
  });
  const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
  fireEvent.click(screen.getByRole("link", { name: "Dealer workspace" }));
  expect(confirm).toHaveBeenCalledOnce();
  expect(screen.getByLabelText("Private wording")).toHaveValue(
    "Keep my private wording",
  );
  confirm.mockReturnValue(true);
  fireEvent.click(screen.getByRole("link", { name: "Dealer workspace" }));
  expect(confirm).toHaveBeenCalledTimes(2);
  expect(screen.getByText("Inbox workspace")).toBeVisible();
});

it("retired Reports bookmarks return to Inbox", () => {
  window.history.replaceState({}, "", "/portal?section=reports");
  renderPortal();
  expect(screen.getByText("Inbox workspace")).toBeVisible();
  expect(
    screen.queryByRole("button", { name: "Reports" }),
  ).not.toBeInTheDocument();
});

it("groups Quick actions into creation and tools, using plain action labels", async () => {
  renderPortal();
  expect(state.draftFetch).not.toHaveBeenCalled();
  const menu = await openQuickActions();
  expect(within(menu).getByText("Create")).toBeVisible();
  expect(within(menu).getByText("Tools")).toBeVisible();
  expect(within(menu).getAllByRole("menuitem").map(item => item.textContent?.trim())).toEqual([
    "New enquiry", "Book test drive", "Start sale", "Check MOT", "Calendar", "Email drafts",
  ]);
  await waitFor(() => expect(state.draftFetch).toHaveBeenCalledOnce());
  expect(state.draftFetch.mock.calls[0][0]).toBe("/api/staff/email-drafts");
  expect(state.staffCarsOptions.mock.calls.every(([enabled]) => enabled === false)).toBe(true);
});

it.each([
  ["New enquiry", "Quick enquiry: general · enquiry"],
  ["Book test drive", "Quick enquiry: general · test drive"],
] as const)("opens %s directly from the staff menu", async (action, result) => {
  renderPortal();
  const menu = await openQuickActions();
  fireEvent.click(within(menu).getByRole("menuitem", { name: action }));
  expect(await screen.findByText(result)).toBeVisible();
  expect(screen.queryByRole("menu")).not.toBeInTheDocument();
});

it("opens an unsaved sale directly from Quick actions", async () => {
  renderPortal();
  const menu = await openQuickActions();
  fireEvent.click(within(menu).getByRole("menuitem", { name: "Start sale" }));
  expect(await screen.findByText("Sales workspace")).toBeVisible();
  expect(window.location.search).toBe("?section=sales");
});

it("opens the staff MOT tool without requiring a selected car", async () => {
  renderPortal();
  const menu = await openQuickActions();
  fireEvent.click(within(menu).getByRole("menuitem", { name: "Check MOT" }));
  expect(await screen.findByText("MOT registration: none")).toBeVisible();
});

it.each([
  ["Calendar", "?section=notifications&workView=test-drives&deskView=calendar"],
  ["Email drafts", "?section=notifications&workView=email&view=drafts"],
] as const)("opens %s in its existing workspace", async (action, search) => {
  window.history.replaceState({}, "", "/portal?section=cars");
  renderPortal();
  const menu = await openQuickActions();
  fireEvent.click(within(menu).getByRole("menuitem", { name: action }));
  await waitFor(() => expect(window.location.search).toBe(search));
  expect(screen.getByText("Inbox workspace")).toBeVisible();
});

it.each([
  ["Start sale", "?section=sales"],
  ["Calendar", "?section=notifications&workView=test-drives&deskView=calendar"],
  ["Email drafts", "?section=notifications&workView=email&view=drafts"],
] as const)("protects unsaved settings before opening %s", async (action, acceptedSearch) => {
  window.history.replaceState({}, "", "/portal?section=settings&settingsTab=emails");
  renderPortal();
  fireEvent.change(screen.getByLabelText("Private wording"), { target: { value: "Keep this wording" } });
  const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
  let menu = await openQuickActions();
  fireEvent.click(within(menu).getByRole("menuitem", { name: action }));
  expect(confirm).toHaveBeenCalledOnce();
  expect(window.location.search).toBe("?section=settings&settingsTab=emails");
  expect(screen.getByLabelText("Private wording")).toHaveValue("Keep this wording");
  confirm.mockReturnValue(true);
  menu = await openQuickActions();
  fireEvent.click(within(menu).getByRole("menuitem", { name: action }));
  await waitFor(() => expect(window.location.search).toBe(acceptedSearch));
  expect(confirm).toHaveBeenCalledTimes(2);
});

it("keeps Calendar available to read-only staff without offering managing actions or fetching drafts", async () => {
  state.permissions = ["payments.record"];
  renderPortal();
  const menu = await openQuickActions();
  expect(within(menu).getAllByRole("menuitem").map(item => item.textContent?.trim())).toEqual(["Calendar"]);
  expect(within(menu).queryByText("Create")).not.toBeInTheDocument();
  expect(state.draftFetch).not.toHaveBeenCalled();
});

it.each([
  "bookingEnabled", "bookingSettingsEnabled", "settingsLoading", "settingsError", "featureLoading", "featureError",
] as const)("hides new bookings while %s prevents them, retaining the existing calendar and drafts", async flag => {
  if (flag === "bookingEnabled" || flag === "bookingSettingsEnabled") state[flag] = false;
  else state[flag] = true;
  renderPortal();
  const menu = await openQuickActions();
  expect(within(menu).queryByRole("menuitem", { name: "Book test drive" })).not.toBeInTheDocument();
  expect(within(menu).getByRole("menuitem", { name: "New enquiry" })).toBeVisible();
  expect(within(menu).getByRole("menuitem", { name: "Calendar" })).toBeVisible();
  expect(within(menu).getByRole("menuitem", { name: "Email drafts" })).toBeVisible();
});

const selectedCar = {
  id: "car-one", make: "Ford", model: "Focus", title: "2018 Ford Focus", year: 2018, vrm: "AB18 CDE",
  inventoryStatus: "available",
  staff: { archivedAt: null, sourceStatus: "live", sale: null },
};

it.each([
  ["New enquiry", "Quick enquiry: car-one · enquiry"],
  ["Book test drive", "Quick enquiry: car-one · test drive"],
  ["Start sale", "Sales workspace · car-one"],
  ["Check MOT", "MOT registration: AB18 CDE"],
] as const)("carries the explicitly open vehicle into %s", async (action, result) => {
  state.cars = [selectedCar];
  window.history.replaceState({}, "", "/portal?section=cars&carId=car-one");
  renderPortal();
  const menu = await openQuickActions();
  expect(within(menu).getByText(/Ford Focus/)).toBeVisible();
  fireEvent.click(within(menu).getByRole("menuitem", { name: action }));
  expect(await screen.findByText(result)).toBeVisible();
});

it.each([
  { label: "sold", inventoryStatus: "sold", staff: {}, canBook: false },
  { label: "reserved", inventoryStatus: "reserved", staff: {}, canBook: false },
  { label: "missing from feed", inventoryStatus: "available", staff: { sourceStatus: "missing" }, canBook: false },
  { label: "hidden", inventoryStatus: "hidden", staff: {}, canBook: false },
  { label: "archived", inventoryStatus: "archived", staff: {}, canBook: false },
  { label: "archived by staff", inventoryStatus: "available", staff: { archivedAt: "2026-11-01T12:00:00Z" }, canBook: false },
  { label: "already linked to a sale", inventoryStatus: "available", staff: { sale: { id: "existing-sale" } }, canBook: true },
])("keeps the $label car's actions consistent with its vehicle file", async ({ inventoryStatus, staff, canBook }) => {
  state.cars = [{ ...selectedCar, inventoryStatus, staff: { ...selectedCar.staff, ...staff } }];
  window.history.replaceState({}, "", "/portal?section=cars&carId=car-one");
  renderPortal();
  const menu = await openQuickActions();
  expect(within(menu).getByText("Ford Focus")).toBeVisible();
  expect(within(menu).queryByRole("menuitem", { name: "Start sale" })).not.toBeInTheDocument();
  const booking = within(menu).queryByRole("menuitem", { name: "Book test drive" });
  if (canBook) expect(booking).toBeVisible();
  else expect(booking).not.toBeInTheDocument();
  expect(within(menu).getByRole("menuitem", { name: "New enquiry" })).toBeVisible();
  expect(within(menu).getByRole("menuitem", { name: "Check MOT" })).toBeVisible();
  fireEvent.click(within(menu).getByRole("menuitem", { name: "New enquiry" }));
  expect(await screen.findByText("Quick enquiry: car-one · enquiry")).toBeVisible();
});

it.each([
  "/portal?section=cars&carId=unknown",
  "/portal?section=notifications&carId=car-one",
] as const)("does not use stale or unmatched vehicle context from %s", async url => {
  state.cars = [selectedCar];
  window.history.replaceState({}, "", url);
  renderPortal();
  const menu = await openQuickActions();
  expect(within(menu).queryByText(/Ford Focus/)).not.toBeInTheDocument();
  fireEvent.click(within(menu).getByRole("menuitem", { name: "New enquiry" }));
  expect(await screen.findByText("Quick enquiry: general · enquiry")).toBeVisible();
});

it("supports keyboard opening, arrow navigation and Enter selection", async () => {
  renderPortal();
  const menu = await openQuickActions();
  const enquiry = within(menu).getByRole("menuitem", { name: "New enquiry" });
  const booking = within(menu).getByRole("menuitem", { name: "Book test drive" });
  await waitFor(() => expect(enquiry).toHaveFocus());
  fireEvent.keyDown(enquiry, { key: "ArrowDown", code: "ArrowDown" });
  await waitFor(() => expect(booking).toHaveFocus());
  fireEvent.keyDown(booking, { key: "Enter", code: "Enter" });
  expect(await screen.findByText("Quick enquiry: general · test drive")).toBeVisible();
});

it("returns focus to Quick actions when the menu is dismissed with Escape", async () => {
  renderPortal();
  const trigger = screen.getByRole("button", { name: "Quick actions" });
  const menu = await openQuickActions();
  fireEvent.keyDown(menu, { key: "Escape", code: "Escape" });
  await waitFor(() => expect(screen.queryByRole("menu")).not.toBeInTheDocument());
  await waitFor(() => expect(trigger).toHaveFocus());
});
