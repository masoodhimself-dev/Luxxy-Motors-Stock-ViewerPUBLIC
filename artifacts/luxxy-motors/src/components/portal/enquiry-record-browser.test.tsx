import { beforeEach, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { Enquiry } from "@workspace/api-client-react";
import type { Car } from "@/lib/stock-context";

const state = vi.hoisted(() => ({ customerCase: vi.fn() }));
vi.mock("./enquiry-customer-case", () => ({
  EnquiryCustomerCase: (props: {
    entry: Enquiry;
    entries?: Enquiry[];
    car?: Car;
  }) => {
    state.customerCase(props);
    return (
      <section aria-label={`Mock selected case ${props.entry.id}`}>
        <p>Record: {props.entry.id}</p>
        <p>Car: {props.car?.id || "none"}</p>
      </section>
    );
  },
}));
import {
  EnquiryRecordBrowser,
  type EnquiryRecordActions,
} from "./enquiry-record-browser";

const entry = (patch: Partial<Enquiry>): Enquiry =>
  ({
    id: "primary",
    dealerId: "dealer-one",
    customerName: "Alex Smith",
    reference: "ENQ-ONE",
    phone: "07700900123",
    email: "alex@example.test",
    type: "general",
    status: "contacted",
    message: "Please call me.",
    vehicleId: "primary-car",
    vehicleTitle: "Toyota Yaris",
    vehicleRegistration: "AB12CDE",
    vehiclePrice: null,
    vehicleUrl: null,
    appointmentAt: null,
    appointmentCancelledAt: null,
    managePath: null,
    calendarIcs: null,
    events: [],
    preferredContact: "phone",
    partExchangeRegistration: null,
    partExchangeMileage: null,
    partExchangeCondition: null,
    customerNotificationStatus: "not_sent",
    customerNotificationError: null,
    customerNotificationSentAt: null,
    dealerNotificationStatus: "not_sent",
    dealerNotificationError: null,
    dealerNotificationSentAt: null,
    reminderStatus: "not_scheduled",
    reminderError: null,
    reminderSentAt: null,
    source: "website",
    createdAt: "2026-10-01T10:00:00Z",
    updatedAt: "2026-10-01T10:00:00Z",
    callOutcome: "information_given",
    ...patch,
  });

beforeEach(() => {
  state.customerCase.mockClear();
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: vi.fn(() => ({ matches: false })),
  });
});

it("keeps a deep-linked merged original and its car selected, highlights its primary queue row, excludes same-phone neighbours and opens the group's most urgent original", () => {
  const primary = entry({});
  const child = entry({
    id: "linked-booking",
    mergedIntoId: "primary",
    type: "viewing",
    vehicleId: "child-car",
    vehicleTitle: "Ford Focus",
    vehicleRegistration: "CD34EFG",
    appointmentAt: "2099-06-15T10:00:00Z",
    appointmentStatus: "confirmed",
    callOutcome: null,
    createdAt: "2026-10-02T10:00:00Z",
  });
  const urgent = entry({
    id: "urgent-linked-task",
    mergedIntoId: "primary",
    followUpAt: "2020-01-01T10:00:00Z",
    followUpCompletedAt: null,
    followUpNote: "Call today",
    createdAt: "2026-10-03T10:00:00Z",
  });
  const unrelated = entry({
    id: "independent-same-phone",
    vehicleId: "other-car",
    vehicleTitle: "BMW 3 Series",
    createdAt: "2026-10-04T10:00:00Z",
  });
  const allEntries = [primary, child, urgent, unrelated];
  const cars = [
    { id: "primary-car", title: "Toyota Yaris" },
    { id: "child-car", title: "Ford Focus" },
    { id: "other-car", title: "BMW 3 Series" },
  ] as Car[];
  const before = JSON.stringify(allEntries);
  const onSelect = vi.fn();
  const actions: EnquiryRecordActions = {
    onUpdate: vi.fn(),
    onConversation: vi.fn(),
    onFollowUp: vi.fn(),
    onAppointment: vi.fn(),
    onBook: vi.fn(),
    onVehicle: vi.fn(),
  };
  render(
    <EnquiryRecordBrowser
      entries={[primary, unrelated]}
      allEntries={allEntries}
      cars={cars}
      selectedId={child.id}
      onSelect={onSelect}
      onBack={vi.fn()}
      actions={actions}
    />,
  );
  expect(
    screen.getByRole("region", { name: "Selected enquiry: Alex Smith" }),
  ).toHaveTextContent("Record: linked-booking");
  expect(
    screen.getByRole("region", { name: "Mock selected case linked-booking" }),
  ).toHaveTextContent("Car: child-car");
  const selectedProps = state.customerCase.mock.calls.at(-1)![0];
  expect(selectedProps.entry).toBe(child);
  expect(selectedProps.car).toBe(cars[1]);
  expect(selectedProps.entries.map((record: Enquiry) => record.id)).toEqual([
    primary.id,
    child.id,
    urgent.id,
  ]);
  expect(selectedProps.entries).not.toContain(unrelated);
  expect(
    screen.getByRole("button", {
      name: "Open enquiry for Alex Smith, Toyota Yaris",
    }),
  ).toHaveAttribute("aria-pressed", "true");
  expect(
    screen.getByRole("button", {
      name: "Open enquiry for Alex Smith, BMW 3 Series",
    }),
  ).toHaveAttribute("aria-pressed", "false");
  fireEvent.click(
    screen.getByRole("button", {
      name: "Open enquiry for Alex Smith, Toyota Yaris",
    }),
  );
  expect(onSelect).toHaveBeenCalledExactlyOnceWith("urgent-linked-task");
  expect(JSON.stringify(allEntries)).toBe(before);
  for (const callback of Object.values(actions))
    expect(callback).not.toHaveBeenCalled();
});
