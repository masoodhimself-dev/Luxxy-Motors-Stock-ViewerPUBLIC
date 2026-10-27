import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
vi.mock("./enquiries-panel", () => ({
  EnquiriesPanel: () => <section aria-label="Conversation list" />,
}));
vi.mock("./test-drive-bookings-panel", () => ({
  TestDriveBookingsPanel: () => <section aria-label="Booking list" />,
}));
vi.mock("./email-workspace", () => ({
  EmailWorkspace: () => <section aria-label="Email record content" />,
}));
vi.mock("./device-notifications", () => ({ DeviceNotifications: () => null }));
import { NotificationsWorkspace } from "./notifications-workspace";
function show(search = "") {
  const location = memoryLocation({ path: `/portal${search}`, record: true });
  render(
    <Router hook={location.hook}>
      <NotificationsWorkspace canEmail />
    </Router>,
  );
  return location;
}
it("opens conversations directly without a Today dashboard", () => {
  show();
  expect(
    screen.getByRole("region", { name: "Conversation list" }),
  ).toBeVisible();
  expect(
    screen.queryByRole("button", { name: /^Today/ }),
  ).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: /^Test drives/ })).toBeVisible();
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
