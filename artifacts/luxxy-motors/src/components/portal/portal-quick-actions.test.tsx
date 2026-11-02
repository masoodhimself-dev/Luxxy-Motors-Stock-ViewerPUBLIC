import { createRef, type ComponentProps } from "react";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { customFetch } from "@workspace/api-client-react";
import { PortalQuickActions } from "./portal-quick-actions";

vi.mock("@workspace/api-client-react", () => ({ customFetch: vi.fn() }));
const fetchMock = vi.mocked(customFetch);
const clients: QueryClient[] = [];
const car = { id: "selected-car", title: "Ford Focus", registration: "AB12 CDE", canBook: true, canStartSale: true };
type Props = ComponentProps<typeof PortalQuickActions>;
type Summary = { drafts: { enquiryId: string }[]; hasMore: boolean };
const summary = (count: number, hasMore = false): Summary => ({
  drafts: Array.from({ length: count }, (_, index) => ({ enquiryId: `enquiry-${index}` })), hasMore,
});

function mount(overrides: Partial<Props> = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  clients.push(client);
  const callbacks = { onEnquiry: vi.fn(), onSale: vi.fn(), onMot: vi.fn(), onCalendar: vi.fn(), onDrafts: vi.fn() };
  const triggerRef = createRef<HTMLButtonElement>();
  const view = render(<QueryClientProvider client={client}>
    <PortalQuickActions canManage bookingEnabled triggerRef={triggerRef} {...callbacks} {...overrides} />
  </QueryClientProvider>);
  return { ...view, ...callbacks, client, triggerRef };
}

async function openMenu() {
  const trigger = screen.getByRole("button", { name: "Quick actions" });
  trigger.focus();
  fireEvent.keyDown(trigger, { key: "ArrowDown" });
  return screen.findByRole("menu", { name: "Quick actions" });
}

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockResolvedValue(summary(0));
});
afterEach(() => {
  clients.splice(0).forEach(client => client.clear());
});

describe("portal quick actions", () => {
  it("keeps draft fetching idle until an authorised member opens the menu", async () => {
    mount();
    expect(fetchMock).not.toHaveBeenCalled();
    const trigger = screen.getByRole("button", { name: "Quick actions" });
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    const menu = await openMenu();
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(within(menu).getByRole("group", { name: "Create" })).toBeVisible();
    expect(within(menu).getByRole("group", { name: "Tools" })).toBeVisible();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    expect(fetchMock).toHaveBeenCalledWith("/api/staff/email-drafts", expect.objectContaining({ signal: expect.any(AbortSignal) }));
  });

  it("shows the real queue count and reuses the inbox cache when reopened", async () => {
    fetchMock.mockResolvedValue(summary(3));
    mount();
    await openMenu();
    expect(await screen.findByLabelText("3 saved replies")).toHaveTextContent("3");
    fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("menu")).not.toBeInTheDocument());
    await openMenu();
    expect(screen.getByLabelText("3 saved replies")).toBeVisible();
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("marks a truncated queue as a lower bound rather than an exact total", async () => {
    fetchMock.mockResolvedValue(summary(100, true));
    mount(); await openMenu();
    expect(await screen.findByLabelText("100 or more saved replies")).toHaveTextContent("100+");
  });

  it("does not invent a count while the queue is loading", async () => {
    let resolve!: (value: Summary) => void;
    fetchMock.mockReturnValue(new Promise<Summary>(done => { resolve = done; }));
    mount(); await openMenu();
    const drafts = screen.getByRole("menuitem", { name: "Email drafts" });
    expect(drafts).toHaveTextContent(/^Email drafts$/);
    await act(async () => { resolve(summary(2)); });
    expect(await screen.findByLabelText("2 saved replies")).toBeVisible();
  });

  it("keeps drafts accessible without a badge when the queue is empty", async () => {
    const { client, onDrafts } = mount(); await openMenu();
    await waitFor(() => expect(client.getQueryState(["staff-email-drafts", "all"])?.status).toBe("success"));
    const drafts = screen.getByRole("menuitem", { name: "Email drafts" });
    expect(drafts).toHaveTextContent(/^Email drafts$/);
    fireEvent.click(drafts);
    expect(onDrafts).toHaveBeenCalledOnce();
  });

  it("does not show a misleading zero or private error when the count request fails", async () => {
    fetchMock.mockRejectedValue(Error("private server detail"));
    const { client } = mount(); await openMenu();
    await waitFor(() => expect(client.getQueryState(["staff-email-drafts", "all"])?.status).toBe("error"));
    expect(screen.getByRole("menuitem", { name: "Email drafts" })).toHaveTextContent(/^Email drafts$/);
    expect(screen.queryByText(/private server detail/)).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("limits restricted staff to Calendar without requesting or exposing drafts", async () => {
    const { client, onCalendar } = mount({ canManage: false, vehicle: car });
    client.setQueryData(["staff-email-drafts", "all"], summary(8));
    const menu = await openMenu();
    expect(within(menu).getAllByRole("menuitem").map(item => item.textContent)).toEqual(["Calendar"]);
    expect(within(menu).queryByRole("group", { name: "Create" })).not.toBeInTheDocument();
    expect(screen.queryByText("Ford Focus")).not.toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("menuitem", { name: "Calendar" }));
    expect(onCalendar).toHaveBeenCalledOnce();
  });

  it("hides new bookings when disabled but keeps the existing calendar available", async () => {
    mount({ bookingEnabled: false }); await openMenu();
    expect(screen.queryByRole("menuitem", { name: "Book test drive" })).not.toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "New enquiry" })).toBeVisible();
    expect(screen.getByRole("menuitem", { name: "Start sale" })).toBeVisible();
    expect(screen.getByRole("menuitem", { name: "Calendar" })).toBeVisible();
  });

  it("hides booking for an ineligible selected car while preserving enquiry and sale", async () => {
    mount({ vehicle: { ...car, canBook: false } }); await openMenu();
    expect(screen.queryByRole("menuitem", { name: "Book test drive" })).not.toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "New enquiry" })).toBeVisible();
    expect(screen.getByRole("menuitem", { name: "Start sale" })).toBeVisible();
    expect(screen.getByRole("menuitem", { name: "Calendar" })).toBeVisible();
  });

  it("hides sale for an ineligible selected car while preserving enquiry and booking", async () => {
    mount({ vehicle: { ...car, canStartSale: false } }); await openMenu();
    expect(screen.queryByRole("menuitem", { name: "Start sale" })).not.toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "New enquiry" })).toBeVisible();
    expect(screen.getByRole("menuitem", { name: "Book test drive" })).toBeVisible();
    expect(screen.getByRole("menuitem", { name: "Calendar" })).toBeVisible();
  });

  it.each([
    ["New enquiry", "onEnquiry", [car.id]],
    ["Book test drive", "onEnquiry", [car.id, true]],
    ["Start sale", "onSale", [car.id]],
  ] as const)("shows and passes the explicitly selected car to %s", async (label, callback, args) => {
    const mounted = mount({ vehicle: car }); await openMenu();
    expect(screen.getByRole("group", { name: "Create" })).toHaveTextContent("Ford Focus");
    expect(screen.getByRole("group", { name: "Create" })).toHaveTextContent("AB12 CDE");
    fireEvent.click(screen.getByRole("menuitem", { name: label }));
    expect(mounted[callback]).toHaveBeenCalledExactlyOnceWith(...args);
    await waitFor(() => expect(screen.queryByRole("menu")).not.toBeInTheDocument());
  });

  it.each([
    ["New enquiry", "onEnquiry", [undefined]],
    ["Book test drive", "onEnquiry", [undefined, true]],
    ["Start sale", "onSale", [undefined]],
  ] as const)("does not silently select a car for %s outside a vehicle file", async (label, callback, args) => {
    const mounted = mount(); await openMenu();
    expect(screen.queryByText("Ford Focus")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("menuitem", { name: label }));
    expect(mounted[callback]).toHaveBeenCalledExactlyOnceWith(...args);
  });

  it.each([
    ["Check MOT", "onMot"], ["Calendar", "onCalendar"], ["Email drafts", "onDrafts"],
  ] as const)("opens %s without invoking a create action", async (label, callback) => {
    const mounted = mount({ vehicle: car }); await openMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: label }));
    expect(mounted[callback]).toHaveBeenCalledOnce();
    expect(mounted.onEnquiry).not.toHaveBeenCalled();
    expect(mounted.onSale).not.toHaveBeenCalled();
  });

  it("supports keyboard navigation and returns focus to its opener on Escape", async () => {
    const { triggerRef } = mount(); await openMenu();
    const enquiry = screen.getByRole("menuitem", { name: "New enquiry" });
    await waitFor(() => expect(enquiry).toHaveFocus());
    fireEvent.keyDown(enquiry, { key: "ArrowDown" });
    await waitFor(() => expect(screen.getByRole("menuitem", { name: "Book test drive" })).toHaveFocus());
    fireEvent.keyDown(document.activeElement!, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("menu")).not.toBeInTheDocument());
    expect(triggerRef.current).toHaveFocus();
  });
});
