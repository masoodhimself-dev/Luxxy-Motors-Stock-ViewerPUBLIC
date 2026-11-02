import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
const state = vi.hoisted(() => ({ enquiries: vi.fn() }));
vi.mock("./enquiries-panel", () => ({
  EnquiriesPanel: (props: { initialView: string; inboxTools?: ReactNode; onQuickEnquiry?: () => void; onOpenCustomer?: (id: string) => void }) => {
    state.enquiries(props);
    return <section aria-label={props.initialView === "calendar" ? "Calendar content" : "Conversation list"}>
      {props.inboxTools}
      {props.onQuickEnquiry && <button onClick={props.onQuickEnquiry}>New enquiry</button>}
      {props.onOpenCustomer && <button onClick={() => props.onOpenCustomer!("e1")}>Open customer from calendar</button>}
    </section>;
  },
}));
vi.mock("./test-drive-bookings-panel", () => ({
  TestDriveBookingsPanel: () => <section aria-label="Booking list" />,
}));
vi.mock("./email-workspace", () => ({
  EmailWorkspace: () => <section aria-label="Email record content" />,
}));
vi.mock("./device-notifications", () => ({ DeviceNotifications: () => null }));
import { NotificationsWorkspace } from "./notifications-workspace";
function show(search = "", canEmail = true, onQuickEnquiry?: () => void) {
  const location = memoryLocation({ path: `/portal${search}`, record: true });
  render(
    <Router hook={location.hook}>
      <NotificationsWorkspace canEmail={canEmail} onQuickEnquiry={onQuickEnquiry} />
    </Router>,
  );
  return location;
}
beforeEach(() => state.enquiries.mockClear());
it("opens the rebuilt conversations directly without another dashboard or duplicate navigation", () => {
  show();
  expect(
    screen.getByRole("region", { name: "Conversation list" }),
  ).toBeVisible();
  expect(
    screen.queryByRole("button", { name: /^Today/ }),
  ).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /^Test drives/ })).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Calendar" })).toBeVisible();
  expect(screen.getByRole("button", { name: "Email records" })).toBeVisible();
  expect(state.enquiries).toHaveBeenCalledWith(expect.objectContaining({ embedded: true, initialView: "history", canEmail: true }));
});
it("opens direct booking links and keeps booking tools in Inbox", () => {
  show("?section=notifications&workView=test-drives");
  expect(screen.getByRole("region", { name: "Booking list" })).toBeVisible();
  expect(screen.getByRole("button", { name: "Calendar" })).toBeVisible();
});
it("opens saved draft and compose bookmarks in email records", () => {
  show("?section=notifications&draft=e1");
  expect(screen.getByRole("region", { name: "Email record content" })).toBeVisible();
});
it("old overview links return to conversations", () => {
  show("?section=overview");
  expect(
    screen.getByRole("region", { name: "Conversation list" }),
  ).toBeVisible();
});
it("switches to email records and preserves the selected customer", () => {
  const location = show(
    "?section=notifications&workView=customers&enquiryId=e1",
  );
  fireEvent.click(screen.getByRole("button", { name: /^Email records/ }));
  expect(screen.getByRole("region", { name: "Email record content" })).toBeVisible();
  expect(location.history!.at(-1)).toContain("enquiryId=e1");
});
it("opens Calendar from the Inbox tools and can return to a selected conversation", () => {
  const location = show();
  fireEvent.click(screen.getByRole("button", { name: "Calendar" }));
  expect(screen.getByRole("region", { name: "Calendar content" })).toBeVisible();
  expect(location.history!.at(-1)).toContain("deskView=calendar");
  fireEvent.click(screen.getByRole("button", { name: "Open customer from calendar" }));
  expect(screen.getByRole("region", { name: "Conversation list" })).toBeVisible();
  expect(location.history!.at(-1)).toContain("workView=customers&enquiryId=e1");
});
it("keeps the historical booking display and returns to Inbox with the selected customer", () => {
  const location = show("?section=test-drives&enquiryId=e1");
  expect(screen.getByRole("region", { name: "Booking list" })).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Back to Inbox" }));
  expect(screen.getByRole("region", { name: "Conversation list" })).toBeVisible();
  expect(location.history!.at(-1)).toContain("workView=customers");
  expect(location.history!.at(-1)).toContain("enquiryId=e1");
});
it("does not expose email records through Inbox tools to staff without access", () => {
  show("", false);
  expect(screen.queryByRole("button", { name: "Email records" })).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Calendar" })).toBeVisible();
});
it("explains a bookmarked email page when the staff role lacks email permission", () => {
  show("?section=notifications&workView=email", false);
  expect(screen.getByRole("status")).toHaveTextContent("Email access isn’t included in your staff role.");
  expect(screen.queryByRole("region", { name: "Email record content" })).not.toBeInTheDocument();
});
it("hands the new-enquiry action to the existing quick-enquiry flow", () => {
  const quick = vi.fn();
  show("", true, quick);
  fireEvent.click(screen.getByRole("button", { name: "New enquiry" }));
  expect(quick).toHaveBeenCalledOnce();
});
