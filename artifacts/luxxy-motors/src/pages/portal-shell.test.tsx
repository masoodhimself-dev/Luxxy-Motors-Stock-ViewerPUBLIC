import { useState } from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, afterEach, it, expect, vi } from "vitest";
const state = vi.hoisted(() => ({
  permissions: ["sales.manage", "settings.publish", "team.manage"],
  signedIn: true,
  bookingEnabled: true,
}));
vi.mock("@clerk/react", () => ({
  useAuth: () => ({ isLoaded: true, isSignedIn: state.signedIn }),
  useUser: () => ({ user: { firstName: "Operator" } }),
  UserButton: () => <button>Account</button>,
  SignInButton: ({ children }: any) => children,
}));
vi.mock("@workspace/api-client-react", () => ({
  getGetPortalSessionQueryKey: () => ["portal-session"],
  useGetPortalSession: () => ({
    data: { state: "allowed", name: "Operator" },
    isLoading: false,
    isError: false,
  }),
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
    isLoading: false,
    isError: false,
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
  DealerWordmark: () => <span>Dealer</span>,
}));
vi.mock("@/lib/dealer-settings-context", () => ({
  useDealerSettings: () => ({ settings: { identity: { name: "Dealer" } } }),
}));
vi.mock("@/pages/sales-demo", () => ({
  SalesWorkspace: ({ newSaleVehicleId }: any) => (
    <p>Sales workspace{newSaleVehicleId ? ` · ${newSaleVehicleId}` : ""}</p>
  ),
}));
import Portal from "./portal";
beforeEach(() => {
  state.permissions = ["sales.manage", "settings.publish", "team.manage"];
  state.signedIn = true;
  state.bookingEnabled = true;
  window.history.replaceState({}, "", "/portal");
  global.ResizeObserver = class {
    observe() {}
    disconnect() {}
    unobserve() {}
  };
});
afterEach(() => {
  vi.restoreAllMocks();
  window.history.replaceState({}, "", "/");
});
it("defaults to Inbox with the focused Cars workspace beside Sales and Settings", () => {
  render(<Portal />);
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
  render(<Portal />);
  expect(screen.getByRole("region", { name: "Cars" })).toBeVisible();
  expect(screen.getByText("Current stock")).toBeVisible();
  expect(
    screen.queryByRole("button", { name: /video/i }),
  ).not.toBeInTheDocument();
});
it("keeps Settings in the four-item phone navigation", () => {
  window.innerWidth = 390;
  render(<Portal />);
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
  render(<Portal />);
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
  render(<Portal />);
  expect(
    within(screen.getByRole("navigation", { name: "Portal sections" }))
      .getAllByRole("button")
      .map((button) => button.textContent),
  ).toEqual(["Inbox", "Cars", "Sales"]);
});

it("opens a prefilled enquiry or booking from the focused Cars finder", () => {
  window.history.replaceState({}, "", "/portal?section=cars");
  const view = render(<Portal />);
  fireEvent.click(screen.getByRole("button", { name: "Car enquiry" }));
  expect(screen.getByText("Quick enquiry: car-one · enquiry")).toBeVisible();
  view.unmount();
  render(<Portal />);
  fireEvent.click(screen.getByRole("button", { name: "Car booking" }));
  expect(screen.getByText("Quick enquiry: car-one · test drive")).toBeVisible();
});

it("starts a car-specific unsaved sale through the existing Sales workspace", () => {
  window.history.replaceState({}, "", "/portal?section=cars");
  render(<Portal />);
  fireEvent.click(screen.getByRole("button", { name: "Car sale" }));
  expect(screen.getByText("Sales workspace · car-one")).toBeVisible();
});

it("does not offer a Cars booking when the dealer feature is disabled", () => {
  state.bookingEnabled = false;
  window.history.replaceState({}, "", "/portal?section=cars");
  render(<Portal />);
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
  render(<Portal />);
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
  render(<Portal />);
  expect(screen.getByText("Inbox workspace")).toBeVisible();
  expect(
    screen.queryByRole("button", { name: "Reports" }),
  ).not.toBeInTheDocument();
});
