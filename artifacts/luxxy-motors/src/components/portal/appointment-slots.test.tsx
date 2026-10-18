import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { EnquiryAvailability } from "@workspace/api-client-react";
import { defaultBookingSettings } from "@/lib/test-drive-dates";

const mocks = vi.hoisted(() => ({
  publicQuery: { data: undefined as EnquiryAvailability | undefined, isLoading: false, isError: false, isFetching: false, refetch: vi.fn() },
  staffQuery: { data: undefined as EnquiryAvailability | undefined, isLoading: false, isError: false, isFetching: false, refetch: vi.fn() },
  publicHook: vi.fn(), staffHook: vi.fn(), settingsLoading: false, settingsError: false,
}));
let policy = structuredClone(defaultBookingSettings);
vi.mock("@workspace/api-client-react", async importOriginal => ({
  ...await importOriginal<object>(),
  useGetEnquiryAvailability: (...args: unknown[]) => { mocks.publicHook(...args); return mocks.publicQuery; },
  useGetStaffAppointmentAvailability: (...args: unknown[]) => { mocks.staffHook(...args); return mocks.staffQuery; },
}));
vi.mock("@/lib/dealer-settings-context", () => ({
  useDealerSettings: () => ({ settings: { testDriveBooking: policy }, isLoading: mocks.settingsLoading, isError: mocks.settingsError }),
}));
import { AppointmentSlots } from "./appointment-slots";

const monday = "2026-10-19", tuesday = "2026-10-20", iso = "2026-10-19T09:00:00.000Z";
const availability = (date = monday, available = true): EnquiryAvailability => ({ date, timezone: "Europe/London", slots: [{ startAt: `${date}T09:00:00.000Z`, label: "10:00", available }] });
function Harness({ initial = "", initialDate = monday, bookingId, onChange = () => {} }: { initial?: string; initialDate?: string; bookingId?: string; onChange?: (value: string) => void }) {
  const [time, setTime] = useState(initial), [valid, setValid] = useState(false);
  return <><AppointmentSlots bookingId={bookingId} initialDate={initialDate} value={time} onChange={value => { setTime(value); onChange(value); }} onValidityChange={setValid} /><output data-testid="selected-time">{time}</output><output data-testid="selection-valid">{String(valid)}</output></>;
}
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-19T08:00:00.000Z"));
  policy = structuredClone(defaultBookingSettings);
  mocks.publicQuery.data = availability(); mocks.staffQuery.data = availability();
  mocks.publicQuery.isError = false; mocks.publicQuery.isLoading = false; mocks.publicQuery.isFetching = false;
  mocks.staffQuery.isError = false; mocks.staffQuery.isLoading = false; mocks.staffQuery.isFetching = false;
  mocks.settingsLoading = false; mocks.settingsError = false;
  mocks.publicHook.mockClear(); mocks.staffHook.mockClear(); mocks.publicQuery.refetch.mockClear(); mocks.staffQuery.refetch.mockClear();
});
afterEach(() => vi.useRealTimers());

describe("shared appointment slots", () => {
  it("uses the exact server slot ISO while displaying UK time, and remains invalid until selected", () => {
    render(<Harness />);
    expect(screen.getByText(/UK time · 30 minutes/)).toBeVisible();
    expect(screen.getByTestId("selection-valid")).toHaveTextContent("false");
    fireEvent.click(screen.getByRole("button", { name: "10:00" }));
    expect(screen.getByTestId("selected-time")).toHaveTextContent(iso);
    expect(screen.getByTestId("selection-valid")).toHaveTextContent("true");
    expect(screen.getByRole("button", { name: "10:00" })).toHaveAttribute("aria-pressed", "true");
    expect(mocks.publicHook.mock.lastCall?.[1].query).toMatchObject({ enabled: true, refetchInterval: 30000, staleTime: 0 });
    expect(mocks.staffHook.mock.lastCall?.[2].query.enabled).toBe(false);
  });

  it("clears the selected time immediately when the appointment date changes", () => {
    const onChange = vi.fn(); render(<Harness initial={iso} onChange={onChange} />);
    expect(screen.getByTestId("selection-valid")).toHaveTextContent("true");
    fireEvent.change(screen.getByLabelText("Appointment date"), { target: { value: tuesday } });
    expect(onChange).toHaveBeenCalledWith("");
    expect(screen.getByTestId("selected-time")).toBeEmptyDOMElement();
    expect(screen.getByTestId("selection-valid")).toHaveTextContent("false");
    expect(mocks.publicHook.mock.lastCall?.[0]).toEqual({ date: tuesday });
  });

  it("clears a saved selection if refreshed availability says the slot is no longer available", () => {
    const onChange = vi.fn(), { rerender } = render(<Harness initial={iso} onChange={onChange} />);
    expect(screen.getByTestId("selection-valid")).toHaveTextContent("true");
    mocks.publicQuery.data = availability(monday, false);
    rerender(<Harness initial={iso} onChange={onChange} />);
    expect(onChange).toHaveBeenCalledWith("");
    expect(screen.getByTestId("selected-time")).toBeEmptyDOMElement();
    expect(screen.getByTestId("selection-valid")).toHaveTextContent("false");
    expect(screen.queryByRole("button", { name: "10:00" })).not.toBeInTheDocument();
    expect(screen.getByText("No times available. Choose another date.")).toBeVisible();
  });

  it("does not treat an availability error as valid cached availability and provides a retry", () => {
    const { rerender } = render(<Harness initial={iso} />);
    expect(screen.getByTestId("selection-valid")).toHaveTextContent("true");
    mocks.publicQuery.isError = true;
    rerender(<Harness initial={iso} />);
    expect(screen.getByTestId("selection-valid")).toHaveTextContent("false");
    expect(screen.getByRole("alert")).toHaveTextContent("Could not load times.");
    fireEvent.click(screen.getByRole("button", { name: "Retry times" }));
    expect(mocks.publicQuery.refetch).toHaveBeenCalledExactlyOnceWith();
    expect(screen.getByTestId("selected-time")).toHaveTextContent(iso);
  });

  it("reports loading and missing availability as invalid, then validates after a successful response", () => {
    mocks.publicQuery.data = undefined; mocks.publicQuery.isLoading = true;
    const { rerender } = render(<Harness initial={iso} />);
    expect(screen.getByText("Checking available times…")).toHaveAttribute("role", "status");
    expect(screen.getByTestId("selection-valid")).toHaveTextContent("false");
    mocks.publicQuery.isLoading = false;
    rerender(<Harness initial={iso} />);
    expect(screen.getByTestId("selection-valid")).toHaveTextContent("false");
    mocks.publicQuery.data = availability();
    rerender(<Harness initial={iso} />);
    expect(screen.getByTestId("selection-valid")).toHaveTextContent("true");
  });

  it("keeps a valid cached slot available during a background refresh", () => {
    mocks.publicQuery.isFetching = true;
    render(<Harness initial={iso} />);
    expect(screen.getByTestId("selection-valid")).toHaveTextContent("true");
    expect(screen.getByRole("button", { name: "10:00" })).toHaveAttribute("aria-pressed", "true");
  });

  it("routes an existing booking to staff availability and its own retry", () => {
    mocks.publicQuery.data = availability(monday, false);
    const { rerender } = render(<Harness bookingId="booking-one" initial={iso} />);
    expect(screen.getByTestId("selection-valid")).toHaveTextContent("true");
    expect(mocks.publicHook.mock.lastCall?.[1].query.enabled).toBe(false);
    expect(mocks.staffHook.mock.lastCall?.[0]).toBe("booking-one");
    expect(mocks.staffHook.mock.lastCall?.[2].query.enabled).toBe(true);
    mocks.staffQuery.isError = true;
    rerender(<Harness bookingId="booking-one" initial={iso} />);
    fireEvent.click(screen.getByRole("button", { name: "Retry times" }));
    expect(mocks.staffQuery.refetch).toHaveBeenCalledOnce(); expect(mocks.publicQuery.refetch).not.toHaveBeenCalled();
    expect(screen.getByTestId("selection-valid")).toHaveTextContent("false");
  });

  it.each(["loading", "error", "disabled"])("requires ready and enabled settings: %s", mode => {
    mocks.settingsLoading = mode === "loading"; mocks.settingsError = mode === "error"; policy.enabled = mode !== "disabled";
    render(<Harness initial={iso} />);
    expect(screen.getByTestId("selection-valid")).toHaveTextContent("false");
    expect(screen.queryByRole("button", { name: "10:00" })).not.toBeInTheDocument();
    expect(mocks.publicHook.mock.lastCall?.[1].query.enabled).toBe(false);
  });

  it("handles no bookable dates without presenting old times or a dead-end date selector", () => {
    policy.weeklyHours = policy.weeklyHours.map(day => ({ ...day, enabled: false }));
    render(<Harness initial={iso} />);
    expect(screen.getByLabelText("Appointment date")).toBeDisabled();
    expect(screen.getByText("No booking dates are available. Check the opening hours or try again later.")).toBeVisible();
    expect(screen.queryByRole("button", { name: "10:00" })).not.toBeInTheDocument();
    expect(screen.getByTestId("selection-valid")).toHaveTextContent("false");
  });

  it("does not validate an unavailable date or a response cached for a different date", () => {
    const { rerender } = render(<Harness initial={iso} />);
    mocks.publicQuery.data = { ...availability(), date: tuesday };
    rerender(<Harness initial={iso} />);
    expect(screen.getByTestId("selection-valid")).toHaveTextContent("false");
    mocks.publicQuery.data = availability(); policy.blockedDates = [monday];
    rerender(<Harness initial={iso} />);
    expect(screen.getByTestId("selection-valid")).toHaveTextContent("false");
    expect(screen.getByText("This date is outside the available booking dates. Choose another date.")).toBeVisible();
  });

  it("keeps approval wording and unavailable slots out of the available choices", () => {
    policy.confirmationMode = "approval";
    mocks.publicQuery.data = { ...availability(), slots: [...availability().slots, { startAt: "2026-10-19T10:00:00.000Z", label: "11:00", available: false }] };
    render(<Harness />);
    expect(screen.getByText(/Staff approval required after saving/)).toBeVisible();
    expect(screen.getByRole("button", { name: "10:00" })).toBeVisible();
    expect(screen.queryByRole("button", { name: "11:00" })).not.toBeInTheDocument();
  });

  it("offers only staff-compatible quarter-hour times when duration and buffer produce forty-minute slots", () => {
    policy.durationMinutes = 30; policy.bufferMinutes = 10;
    mocks.publicQuery.data = { ...availability(), slots: [
      { startAt: "2026-10-19T09:00:00.000Z", label: "10:00", available: true },
      { startAt: "2026-10-19T09:40:00.000Z", label: "10:40", available: true },
      { startAt: "2026-10-19T10:20:00.000Z", label: "11:20", available: true },
      { startAt: "2026-10-19T11:00:00.000Z", label: "12:00", available: true },
    ] };
    const onChange = vi.fn(); render(<Harness initial="2026-10-19T09:40:00.000Z" onChange={onChange} />);
    expect(screen.getByRole("button", { name: "10:00" })).toBeVisible();
    expect(screen.getByRole("button", { name: "12:00" })).toBeVisible();
    expect(screen.queryByRole("button", { name: "10:40" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "11:20" })).not.toBeInTheDocument();
    expect(screen.getByTestId("selected-time")).toBeEmptyDOMElement();
    expect(screen.getByTestId("selection-valid")).toHaveTextContent("false");
    expect(onChange).toHaveBeenCalledWith("");
    fireEvent.click(screen.getByRole("button", { name: "12:00" }));
    expect(screen.getByTestId("selected-time")).toHaveTextContent("2026-10-19T11:00:00.000Z");
    expect(screen.getByTestId("selection-valid")).toHaveTextContent("true");
  });

  it("removes and clears a slot that has passed even when the server response still lists it", () => {
    const onChange = vi.fn(), { rerender } = render(<Harness initial={iso} onChange={onChange} />);
    expect(screen.getByTestId("selection-valid")).toHaveTextContent("true");
    vi.setSystemTime(new Date("2026-10-19T10:00:00.000Z"));
    rerender(<Harness initial={iso} onChange={onChange} />);
    expect(screen.queryByRole("button", { name: "10:00" })).not.toBeInTheDocument();
    expect(screen.getByTestId("selected-time")).toBeEmptyDOMElement();
    expect(screen.getByTestId("selection-valid")).toHaveTextContent("false");
    expect(onChange).toHaveBeenCalledWith("");
  });
});
