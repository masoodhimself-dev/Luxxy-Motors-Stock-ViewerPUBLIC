import { useState } from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, afterEach, it, expect, vi } from "vitest";
const state = vi.hoisted(() => ({
  permissions: ["sales.manage", "settings.publish", "team.manage"],
  signedIn: true,
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
  QuickEnquiryDialog: () => null,
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
vi.mock("@/components/portal/dealer-reports", () => ({ DealerReports: () => <p>Reports workspace</p> }));
vi.mock("@/pages/sales-demo", () => ({
  SalesWorkspace: () => <p>Sales workspace</p>,
}));
import Portal from "./portal";
beforeEach(() => {
  state.permissions = ["sales.manage", "settings.publish", "team.manage"];
  state.signedIn = true;
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
it("defaults to Inbox with only Inbox, Sales, Reports and Settings destinations", () => {
  render(<Portal />);
  expect(screen.getByText("Inbox workspace")).toBeVisible();
  const nav = screen.getByRole("navigation", { name: "Portal sections" });
  expect(
    within(nav)
      .getAllByRole("button")
      .map((button) => button.textContent),
  ).toEqual(["Inbox", "Sales", "Reports", "Settings"]);
  expect(
    screen.queryByRole("button", { name: "Home" }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "Cars" }),
  ).not.toBeInTheDocument();
});
it("retired Cars bookmarks return to Inbox without loading a Cars workspace", () => {
  window.history.replaceState(
    {},
    "",
    "/portal?section=inventory&recordVideo=1",
  );
  render(<Portal />);
  expect(screen.getByText("Inbox workspace")).toBeVisible();
});
it("keeps Settings in the four-item phone navigation", () => {
  window.innerWidth = 390;
  render(<Portal />);
  const buttons = within(
    screen.getByRole("navigation", { name: "Portal sections" }),
  ).getAllByRole("button");
  expect(buttons).toHaveLength(4);
  expect(buttons[2]).toHaveTextContent("Reports");
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
  ).toEqual(["Inbox", "Sales", "Reports"]);
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

it("opens Reports and protects unsaved settings when navigating to it", () => {
  window.history.replaceState({}, "", "/portal?section=settings");
  render(<Portal />);
  fireEvent.change(screen.getByLabelText("Private wording"), { target: { value: "unsaved" } });
  const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
  fireEvent.click(screen.getByRole("button", { name: "Reports" }));
  expect(confirm).toHaveBeenCalledOnce();
  expect(screen.queryByText("Reports workspace")).not.toBeInTheDocument();
  confirm.mockReturnValue(true);
  fireEvent.click(screen.getByRole("button", { name: "Reports" }));
  expect(screen.getByText("Reports workspace")).toBeVisible();
});
