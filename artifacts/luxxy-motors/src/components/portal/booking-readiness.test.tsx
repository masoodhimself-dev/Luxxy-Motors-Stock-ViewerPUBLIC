import { beforeEach, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Enquiry } from "@workspace/api-client-react";
const state = vi.hoisted(() => ({ fetch: vi.fn(), access: { isError: false, isLoading: false, data: { permissions: ["sales.manage"] } } }));
vi.mock("@workspace/api-client-react", () => ({ customFetch: (...args: unknown[]) => state.fetch(...args) }));
vi.mock("./dealer-administration", () => ({ useStaffAccess: () => state.access }));
import { BookingReadiness } from "./booking-readiness";
const booking = { id: "booking-one", customerName: "Alex", vehicleId: "car-one", appointmentRevision: 2, appointmentAt: "2099-10-17T10:00:00Z", appointmentStatus: "confirmed", appointmentDurationMinutes: 30 } as Enquiry;
const declaration = {
  id: "declaration-one", status: "signed", current: true, signedAt: "2026-10-18T10:00:00Z", expiresAt: "2026-10-20T10:00:00Z",
  snapshot: { vehicleId: "car-one", appointmentRevision: 2, appointmentAt: booking.appointmentAt, durationMinutes: 30 },
  staffChecks: { licenceChecked: true, insuranceChecked: true },
};
function mount(value = booking, autoLoad = true) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return { client, ...render(<QueryClientProvider client={client}><BookingReadiness booking={value} autoLoad={autoLoad} /></QueryClientProvider>) };
}
beforeEach(() => { state.access = { isError: false, isLoading: false, data: { permissions: ["sales.manage"] } }; state.fetch.mockReset(); state.fetch.mockResolvedValue({ declarations: [declaration], currentAppointmentRevision: 2 }); });
it("shows signature and separate recorded staff checks without claiming the car is ready", async () => {
  mount();
  expect(await screen.findByText("Checks recorded")).toBeVisible();
  expect(screen.getByText("Declaration signed")).toBeVisible();
  expect(screen.getByText("Licence checked")).toBeVisible();
  expect(screen.getByText("Insurance checked")).toBeVisible();
  expect(screen.getByText(/Confirm the car is ready/)).toBeVisible();
  expect(state.fetch).toHaveBeenCalledWith("/api/staff/enquiries/booking-one/test-drive-declarations", {});
});
it("does not treat a signature as completion of the staff checks", async () => {
  state.fetch.mockResolvedValue({ declarations: [{ ...declaration, staffChecks: { licenceChecked: false, insuranceChecked: true } }], currentAppointmentRevision: 2 });
  mount();
  expect(await screen.findByText("Preparation needed")).toBeVisible();
  expect(screen.getByText("Licence check needed")).toBeVisible();
  expect(screen.queryByText("Checks recorded")).not.toBeInTheDocument();
});
it("does not use superseded declarations or another car's checks", async () => {
  state.fetch.mockResolvedValue({ declarations: [
    { ...declaration, current: false },
    { ...declaration, id: "other-car", snapshot: { ...declaration.snapshot, vehicleId: "other" } },
  ], currentAppointmentRevision: 2 });
  mount();
  expect(await screen.findByText("Declaration needed")).toBeVisible();
  expect(screen.getByText("Licence check needed")).toBeVisible();
  expect(screen.getByText("Insurance check needed")).toBeVisible();
  expect(screen.queryByText("Checks recorded")).not.toBeInTheDocument();
});
it("requires the booking to refresh when the declaration endpoint knows a newer appointment revision", async () => {
  state.fetch.mockResolvedValue({ declarations: [declaration], currentAppointmentRevision: 3 });
  mount();
  expect(await screen.findByText(/Appointment changed. Refresh the booking/)).toBeVisible();
  expect(screen.queryByText("Declaration signed")).not.toBeInTheDocument();
});
it("loads later bookings only when requested and performs no writes", async () => {
  mount(booking, false);
  expect(state.fetch).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Check preparation" }));
  expect(await screen.findByText("Checks recorded")).toBeVisible();
  expect(state.fetch).toHaveBeenCalledTimes(1);
});
it("hides stale successful checks when refreshing fails and offers retry", async () => {
  const { client } = mount();
  await screen.findByText("Checks recorded");
  state.fetch.mockRejectedValue(new Error("offline"));
  await client.invalidateQueries({ queryKey: ["test-drive-declarations", booking.id] });
  expect(await screen.findByText("Preparation could not be checked.")).toBeVisible();
  expect(screen.queryByText("Checks recorded")).not.toBeInTheDocument();
  expect(screen.queryByText("Declaration signed")).not.toBeInTheDocument();
  state.fetch.mockResolvedValue({ declarations: [], currentAppointmentRevision: 2 });
  fireEvent.click(screen.getByRole("button", { name: "Retry checks" }));
  expect(await screen.findByText("Declaration needed")).toBeVisible();
});
it("does not query cancelled, completed or unconfirmed bookings", async () => {
  for (const change of [{ appointmentCancelledAt: "2026-10-18T10:00:00Z" }, { attendance: "completed" }, { appointmentStatus: "pending" }]) {
    const view = mount({ ...booking, ...change } as Enquiry);
    await waitFor(() => expect(state.fetch).not.toHaveBeenCalled());
    view.unmount();
  }
});
it("does not load or offer declaration checks for accounts staff, pending access or an access error", () => {
  for (const access of [
    { isError: false, isLoading: false, data: { permissions: ["sales.view", "finance.export"] } },
    { isError: false, isLoading: true, data: { permissions: [] } },
    { isError: true, isLoading: false, data: { permissions: ["sales.manage"] } },
  ]) {
    state.access = access;
    const view = mount();
    expect(state.fetch).not.toHaveBeenCalled();
    expect(screen.queryByRole("region", { name: /Visit preparation/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Check preparation" })).not.toBeInTheDocument();
    view.unmount();
  }
});
it("preserves valid signed evidence when a newer replacement link is awaiting signature", async () => {
  state.fetch.mockResolvedValue({ declarations: [
    { ...declaration, id: "new-pending", status: "pending", signedAt: null, expiresAt: "2099-10-17T12:00:00Z", staffChecks: { licenceChecked: false, insuranceChecked: false } },
    { ...declaration, id: "revoked", status: "revoked" },
    declaration,
  ], currentAppointmentRevision: 2 });
  mount();
  expect(await screen.findByText("Checks recorded")).toBeVisible();
  expect(screen.getByText("Declaration signed")).toBeVisible();
  expect(screen.queryByText("Awaiting signature")).not.toBeInTheDocument();
});
