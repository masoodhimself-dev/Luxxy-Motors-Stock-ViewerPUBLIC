import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { defaultBookingSettings } from "@/lib/test-drive-dates";

const query = vi.hoisted(() => ({
  data: [] as Array<{
    id: string;
    appointmentAt: string;
    appointmentCancelledAt?: string | null;
    appointmentDurationMinutes?: number;
    appointmentBufferMinutes?: number;
  }> | undefined,
  isLoading: false,
  isError: false,
}));

vi.mock("@workspace/api-client-react", async importOriginal => ({
  ...await importOriginal<object>(),
  useGetEnquiries: () => query,
  useGetEnquiryAvailability: () => ({ data: { slots: [] }, isLoading: false, isError: false }),
  useGetStaffAppointmentAvailability: () => ({ data: { slots: [] }, isLoading: false, isError: false }),
}));

let policy = structuredClone(defaultBookingSettings);
vi.mock("@/lib/dealer-settings-context", () => ({
  useDealerSettings: () => ({ settings: { testDriveBooking: policy }, isLoading: false, isError: false }),
}));

import { StaffAppointmentPicker } from "./enquiries-panel";

function Harness({ bookingId, initialDate, initialTime = "", initialManual = true }: {
  bookingId?: string;
  initialDate?: string;
  initialTime?: string;
  initialManual?: boolean;
}) {
  const [time, onTime] = useState(initialTime);
  const [manual, onManual] = useState(initialManual);
  const [allowOutsideHours, onOutsideHours] = useState(false);
  const [allowDoubleBooking, onDoubleBooking] = useState(false);
  return <>
    <StaffAppointmentPicker {...{ bookingId, initialDate, time, onTime, manual, onManual, allowOutsideHours, onOutsideHours, allowDoubleBooking, onDoubleBooking }} />
    <output data-testid="appointment-utc">{time}</output>
    <output data-testid="outside-consent">{String(allowOutsideHours)}</output>
    <output data-testid="overlap-consent">{String(allowDoubleBooking)}</output>
  </>;
}

function choose(date: string, time: string) {
  fireEvent.change(screen.getByLabelText("Appointment date (UK)"), { target: { value: date } });
  fireEvent.change(screen.getByLabelText("Appointment time (UK)"), { target: { value: time } });
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-17T08:00:00.000Z"));
  query.data = [];
  query.isLoading = false;
  query.isError = false;
  policy = structuredClone(defaultBookingSettings);
});

afterEach(() => vi.useRealTimers());

describe("staff appointment selection", () => {
  it("uses separate date and time fields and keeps exceptions away from an empty or partial appointment", () => {
    render(<Harness />);
    expect(screen.getByLabelText("Appointment date (UK)")).toHaveAttribute("type", "date");
    expect(screen.getByLabelText("Appointment time (UK)")).toHaveAttribute("type", "time");
    expect(screen.getByLabelText("Appointment time (UK)")).toHaveAttribute("step", "900");
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Booking exceptions" })).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Appointment date (UK)"), { target: { value: "2026-10-19" } });
    expect(screen.getByTestId("appointment-utc")).toBeEmptyDOMElement();
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  });

  it("converts a valid UK appointment to UTC and keeps routine bookings free of exception warnings", () => {
    render(<Harness />);
    choose("2026-10-19", "10:15");
    expect(screen.getByTestId("appointment-utc")).toHaveTextContent("2026-10-19T09:15:00.000Z");
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Booking exceptions" }));
    expect(screen.getByRole("checkbox", { name: "Allow outside normal booking hours or a closed date" })).not.toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Allow overlapping appointments or a full day" })).not.toBeChecked();
  });

  it("does not accept past appointments or times between fifteen-minute increments", () => {
    render(<Harness />);
    choose("2026-10-16", "10:00");
    expect(screen.getByTestId("appointment-utc")).toBeEmptyDOMElement();
    choose("2026-10-19", "10:07");
    expect(screen.getByTestId("appointment-utc")).toBeEmptyDOMElement();
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  });

  it("opens an outside-hours warning without pre-authorising it and clears permission after an edit", () => {
    render(<Harness />);
    choose("2026-10-19", "20:00");
    const checkbox = screen.getByRole("checkbox", { name: "Allow outside normal booking hours or a closed date" });
    expect(checkbox).not.toBeChecked();
    fireEvent.click(checkbox);
    expect(screen.getByTestId("outside-consent")).toHaveTextContent("true");
    fireEvent.change(screen.getByLabelText("Appointment date (UK)"), { target: { value: "2026-10-20" } });
    expect(screen.getByTestId("outside-consent")).toHaveTextContent("false");
    expect(screen.getByRole("checkbox", { name: "Allow outside normal booking hours or a closed date" })).not.toBeChecked();
  });

  it("shows overlap consent only after an actual clash and clears it when the time changes", () => {
    query.data = [{ id: "other-booking", appointmentAt: "2026-10-19T09:00:00.000Z", appointmentDurationMinutes: 30 }];
    render(<Harness />);
    choose("2026-10-19", "10:15");
    const checkbox = screen.getByRole("checkbox", { name: "Allow overlapping appointments or a full day" });
    expect(checkbox).not.toBeChecked();
    fireEvent.click(checkbox);
    expect(screen.getByTestId("overlap-consent")).toHaveTextContent("true");
    fireEvent.change(screen.getByLabelText("Appointment time (UK)"), { target: { value: "11:00" } });
    expect(screen.getByTestId("overlap-consent")).toHaveTextContent("false");
  });

  it("does not treat the appointment being rescheduled as its own clash", () => {
    query.data = [{ id: "current-booking", appointmentAt: "2026-10-19T09:00:00.000Z", appointmentDurationMinutes: 30 }];
    render(<Harness bookingId="current-booking" />);
    choose("2026-10-19", "10:15");
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  });

  it("shows a capacity exception even when the chosen time does not overlap", () => {
    policy.dailyCapacity = 1;
    query.data = [{ id: "other-booking", appointmentAt: "2026-10-19T12:00:00.000Z", appointmentDurationMinutes: 30 }];
    render(<Harness />);
    choose("2026-10-19", "10:15");
    expect(screen.getByRole("checkbox", { name: "Allow overlapping appointments or a full day" })).not.toBeChecked();
  });

  it("shows that the diary is still being checked instead of treating missing data as a free appointment", () => {
    query.data = undefined;
    query.isLoading = true;
    render(<Harness />);
    choose("2026-10-19", "10:15");
    expect(screen.getByText("Checking other appointments…")).toHaveAttribute("role", "status");
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  });

  it("explains a failed diary check and requires explicit consent for any exception", () => {
    query.data = undefined;
    query.isError = true;
    render(<Harness />);
    choose("2026-10-19", "10:15");
    expect(screen.getByText(/Other bookings could not be checked/)).toHaveAttribute("role", "status");
    expect(screen.getByRole("checkbox", { name: "Allow outside normal booking hours or a closed date" })).not.toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Allow overlapping appointments or a full day" })).not.toBeChecked();
  });

  it("clears a manual time and all exception permissions when returning to available slots", () => {
    render(<Harness />);
    choose("2026-10-19", "20:00");
    fireEvent.click(screen.getByRole("checkbox", { name: "Allow outside normal booking hours or a closed date" }));
    fireEvent.click(screen.getByRole("button", { name: "Available slots" }));
    expect(screen.getByTestId("appointment-utc")).toBeEmptyDOMElement();
    expect(screen.getByTestId("outside-consent")).toHaveTextContent("false");
    expect(screen.getByTestId("overlap-consent")).toHaveTextContent("false");
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  });

  it("preserves the calendar-selected date when opening manual date and time entry", () => {
    render(<Harness initialDate="2026-10-19" initialManual={false} />);
    fireEvent.click(screen.getByRole("button", { name: "Choose date & time" }));
    expect(screen.getByLabelText("Appointment date (UK)")).toHaveValue("2026-10-19");
    expect(screen.getByTestId("appointment-utc")).toBeEmptyDOMElement();
  });

  it("uses London summer time and rejects the spring clock-change gap", () => {
    vi.setSystemTime(new Date("2026-02-01T12:00:00.000Z"));
    render(<Harness />);
    choose("2026-07-06", "10:15");
    expect(screen.getByTestId("appointment-utc")).toHaveTextContent("2026-07-06T09:15:00.000Z");
    choose("2026-03-29", "01:30");
    expect(screen.getByTestId("appointment-utc")).toBeEmptyDOMElement();
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  });
});
