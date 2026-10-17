import { afterEach, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";

vi.mock("./notifications-home", () => ({
  NotificationsHome: () => <section aria-label="Attention panel" />,
}));
vi.mock("./enquiries-panel", () => ({
  EnquiriesPanel: ({ canEmail, initialView }: { canEmail: boolean; initialView?: string }) => (
    <section aria-label="Customer panel" data-can-email={String(canEmail)} data-initial-view={initialView} />
  ),
}));
vi.mock("./test-drive-bookings-panel", () => ({
  TestDriveBookingsPanel: ({ canEmail, enquiryId }: { canEmail: boolean; enquiryId?: string }) => (
    <section aria-label="Test drive panel" data-can-email={String(canEmail)} data-enquiry-id={enquiryId} />
  ),
}));
vi.mock("./email-workspace", () => ({
  EmailWorkspace: () => <section aria-label="Email panel" />,
}));

import { NotificationsWorkspace } from "./notifications-workspace";

function mount(search = "", canEmail = true) {
  const location = memoryLocation({
    path: `/portal${search ? `?${search}` : ""}`,
    record: true,
  });
  render(
    <Router hook={location.hook}>
      <NotificationsWorkspace canEmail={canEmail} />
    </Router>,
  );
  return location;
}

function currentQuery(location: ReturnType<typeof memoryLocation>) {
  return new URL(location.history!.at(-1)!, "https://dealer.example").searchParams;
}

afterEach(() => vi.unstubAllGlobals());

it("opens Needs attention by default with one integrated navigation", () => {
  mount();
  expect(screen.getByRole("heading", { name: "Your day" })).toBeVisible();
  expect(screen.getByRole("region", { name: "Attention panel" })).toBeVisible();
  for (const name of [
    "Needs attention",
    "Customers & enquiries",
    "Test drives",
    "Email",
  ]) {
    expect(screen.getByRole("button", { name: new RegExp(`^${name}`) })).toBeVisible();
  }
  expect(screen.queryByRole("region", { name: "Customer panel" })).not.toBeInTheDocument();
  expect(screen.queryByRole("region", { name: "Email panel" })).not.toBeInTheDocument();
});

it.each([
  ["customers", "Customer panel"],
  ["test-drives", "Test drive panel"],
  ["email", "Email panel"],
])("opens the %s workspace directly", (view, panel) => {
  mount(`section=notifications&workView=${view}`);
  expect(screen.getByRole("region", { name: panel })).toBeVisible();
  expect(screen.queryByRole("region", { name: "Attention panel" })).not.toBeInTheDocument();
});

it.each([
  ["overview", "Attention panel"],
  ["enquiries", "Customer panel"],
  ["test-drives", "Test drive panel"],
  ["email", "Email panel"],
])("keeps existing section=%s bookmarks working", (section, panel) => {
  mount(`section=${section}`);
  expect(screen.getByRole("region", { name: panel })).toBeVisible();
});

it("opens an enquiry notification in its customer workspace", () => {
  mount("section=notifications&enquiryId=enquiry-1");
  expect(screen.getByRole("region", { name: "Customer panel" })).toBeVisible();
});

it.each(["draft", "compose"])("opens an attention %s link in Email", (key) => {
  mount(`section=notifications&${key}=enquiry-1`);
  expect(screen.getByRole("region", { name: "Email panel" })).toBeVisible();
});

it("honours an explicit attention view over retained enquiry context", () => {
  mount("section=notifications&workView=attention&enquiryId=enquiry-1&compose=enquiry-1");
  expect(screen.getByRole("region", { name: "Attention panel" })).toBeVisible();
  expect(screen.queryByRole("region", { name: "Email panel" })).not.toBeInTheDocument();
});

it("passes email permission to customer tools", () => {
  mount("section=notifications&workView=customers", false);
  expect(screen.getByRole("region", { name: "Customer panel" })).toHaveAttribute(
    "data-can-email",
    "false",
  );
});

it("passes the customer selection and email permission to test-drive tools", () => {
  mount("section=notifications&workView=test-drives&enquiryId=enquiry-1", false);
  const panel = screen.getByRole("region", { name: "Test drive panel" });
  expect(panel).toHaveAttribute("data-can-email", "false");
  expect(panel).toHaveAttribute("data-enquiry-id", "enquiry-1");
});

it("offers the existing appointment calendar inside Test drives", () => {
  mount("section=notifications&workView=test-drives");
  fireEvent.click(screen.getByRole("button", { name: "Calendar" }));
  expect(screen.getByRole("region", { name: "Customer panel" })).toHaveAttribute(
    "data-initial-view",
    "calendar",
  );
  expect(screen.queryByRole("region", { name: "Test drive panel" })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Bookings" }));
  expect(screen.getByRole("region", { name: "Test drive panel" })).toBeVisible();
});

it("gives the diary space without repeating the notifications heading and new-enquiry action", () => {
  mount("section=notifications&workView=test-drives&deskView=calendar");
  expect(screen.getByRole("region", { name: "Customer notifications workspace" })).toHaveAttribute("data-calendar", "true");
  expect(screen.queryByRole("heading", { name: "Notifications" })).not.toBeInTheDocument();
  expect(screen.queryByRole("heading", { name: "Your day" })).not.toBeInTheDocument();
  expect(screen.queryByRole("heading", { name: "Test drives" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Quick enquiry" })).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Bookings" })).toBeVisible();
});

it("keeps the full new-enquiry route as a standalone fallback", () => {
  const location = mount();
  fireEvent.click(screen.getByRole("button", { name: "Quick enquiry" }));
  expect(currentQuery(location).get("section")).toBe("notifications");
  expect(currentQuery(location).get("workView")).toBe("customers");
  expect(currentQuery(location).get("deskView")).toBe("new");
  expect(screen.getByRole("region", { name: "Customer panel" })).toBeVisible();
});

it("opens a quick enquiry over the home screen without navigating", () => {
  const location = memoryLocation({ path: '/portal?section=notifications', record: true });
  const quick = vi.fn(), sale = vi.fn();
  render(<Router hook={location.hook}><NotificationsWorkspace canEmail onQuickEnquiry={quick} onNewSale={sale} /></Router>);
  fireEvent.click(screen.getByRole('button', { name: 'Quick enquiry' }));
  expect(quick).toHaveBeenCalledOnce();
  expect(currentQuery(location).get('section')).toBe('notifications');
  expect(currentQuery(location).has('workView')).toBe(false);
  fireEvent.click(screen.getByRole('button', { name: 'New sale' }));
  expect(sale).toHaveBeenCalledOnce();
});

it("keeps creation and email shortcuts out of read-only staff views", () => {
  mount('', false);
  expect(screen.queryByRole('button', { name: 'Quick enquiry' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'New sale' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Saved email drafts' })).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Calendar' })).toBeVisible();
});

it("opens calendar and saved drafts directly from home shortcuts", () => {
  const location = mount();
  fireEvent.click(screen.getByRole('button', { name: 'Saved email drafts' }));
  expect(currentQuery(location).get('workView')).toBe('email');
  expect(currentQuery(location).get('view')).toBe('drafts');
});

it.each([
  "section=notifications&workView=email",
  "section=email&draft=enquiry-1",
  "section=notifications&compose=enquiry-1",
])("does not expose the Email workspace without permission: %s", (search) => {
  mount(search, false);
  expect(screen.queryByRole("button", { name: /^Email/ })).not.toBeInTheDocument();
  expect(screen.queryByRole("region", { name: "Email panel" })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: /Back to needs attention/i }));
  expect(screen.getByRole("region", { name: "Attention panel" })).toBeVisible();
});

it("uses canonical workspace URLs and retains the selected customer for email", () => {
  const location = mount("section=enquiries&enquiryId=enquiry-1");
  fireEvent.click(screen.getByRole("button", { name: /^Email/ }));
  const query = currentQuery(location);
  expect(query.get("section")).toBe("notifications");
  expect(query.get("workView")).toBe("email");
  expect(query.get("enquiryId")).toBe("enquiry-1");
  expect(screen.getByRole("region", { name: "Email panel" })).toBeVisible();
});

it("clears stale email actions when navigating to customer records", () => {
  const location = mount(
    "section=notifications&workView=email&compose=enquiry-1&draft=enquiry-1&view=drafts",
  );
  fireEvent.click(screen.getByRole("button", { name: /^Customers & enquiries/ }));
  const query = currentQuery(location);
  expect(query.get("section")).toBe("notifications");
  expect(query.get("workView")).toBe("customers");
  expect(query.has("compose")).toBe(false);
  expect(query.has("draft")).toBe(false);
  expect(query.has("view")).toBe(false);
  expect(screen.getByRole("region", { name: "Customer panel" })).toBeVisible();
});

it("retains customer context across views and clears it when returning to Needs attention", () => {
  const location = mount("section=notifications&workView=customers&enquiryId=enquiry-1");
  fireEvent.click(screen.getByRole("button", { name: /^Test drives/ }));
  expect(currentQuery(location).get("enquiryId")).toBe("enquiry-1");
  fireEvent.click(screen.getByRole("button", { name: /^Customers & enquiries/ }));
  expect(currentQuery(location).get("enquiryId")).toBe("enquiry-1");
  fireEvent.click(screen.getByRole("button", { name: /^Needs attention/ }));
  expect(currentQuery(location).get("workView")).toBe("attention");
  expect(currentQuery(location).has("enquiryId")).toBe(false);
  expect(screen.getByRole("region", { name: "Attention panel" })).toBeVisible();
});

it("responds to query navigation without a page reload", () => {
  const location = mount("section=notifications&workView=attention");
  act(() => {
    location.navigate("/portal?section=notifications&workView=test-drives");
  });
  expect(screen.getByRole("region", { name: "Test drive panel" })).toBeVisible();
  act(() => {
    location.navigate("/portal?section=enquiries&enquiryId=enquiry-2");
  });
  expect(screen.getByRole("region", { name: "Customer panel" })).toBeVisible();
});

it("falls back to Needs attention for an invalid view", () => {
  mount("section=notifications&workView=unrecognised");
  expect(screen.getByRole("region", { name: "Attention panel" })).toBeVisible();
});

it("switches workspaces without sending emails, creating bookings or making network calls", () => {
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  mount("section=notifications");
  for (const name of ["Customers & enquiries", "Test drives", "Email", "Needs attention"]) {
    fireEvent.click(screen.getByRole("button", { name: new RegExp(`^${name}`) }));
  }
  expect(fetch).not.toHaveBeenCalled();
  expect(screen.getByRole("region", { name: "Attention panel" })).toBeVisible();
});
