import type { Enquiry } from "@workspace/api-client-react";
import type { Car } from "@/lib/stock-context";
import { primaryEnquiry } from "@/lib/enquiry-groups";
import {
  enquiryPresentation,
  type EnquiryPresentation,
} from "@/lib/enquiry-presentation";
import type { InboxEnquiry } from "@/lib/enquiry-reply-attention";
import { vehicleDisplayTitle } from "@/lib/utils";
import { matchesEnquiryCar } from "./quick-enquiry-cars";

export type CarsAvailability = "all" | "available" | "reserved";
export type CarsSort = "stock" | "price-asc" | "price-desc" | "make";
export type VehicleCustomerActivity = {
  customer: Enquiry;
  /** The original record carrying this task; a merged parent may be about another car. */
  task: InboxEnquiry;
  presentation: EnquiryPresentation;
};
export type VehicleActivity = {
  cases: Enquiry[];
  customers: VehicleCustomerActivity[];
  nextAppointment?: Enquiry;
  nextFollowUp?: Enquiry;
  pendingAppointments: Enquiry[];
};

export function currentStockCars(cars: readonly Car[]) {
  return cars.filter(
    (car) =>
      car.inventoryStatus === "available" || car.inventoryStatus === "reserved",
  );
}

export function findWorkspaceCars(
  cars: readonly Car[],
  search: string,
  availability: CarsAvailability,
  sort: CarsSort,
) {
  const matches = currentStockCars(cars).filter(
    (car) =>
      (availability === "all" || car.inventoryStatus === availability) &&
      matchesEnquiryCar(car, search),
  );
  if (sort === "stock") return matches;
  return matches.sort((a, b) => {
    if (sort === "make")
      return vehicleDisplayTitle(a).localeCompare(
        vehicleDisplayTitle(b),
        "en-GB",
        { sensitivity: "base", numeric: true },
      );
    // Missing prices always stay last, in both directions. Never turn them into zero.
    if (a.price == null) return b.price == null ? 0 : 1;
    if (b.price == null) return -1;
    return sort === "price-asc" ? a.price - b.price : b.price - a.price;
  });
}

export function isUpcomingAppointment(entry: Enquiry, now: number) {
  return Boolean(
    entry.type === "viewing" &&
    entry.appointmentAt &&
    Number.isFinite(Date.parse(entry.appointmentAt)) &&
    Date.parse(entry.appointmentAt) > now &&
    !entry.appointmentCancelledAt &&
    (!entry.attendance || entry.attendance === "scheduled"),
  );
}

/** Count explicit cases only: shared contact details do not mean enquiries are merged. */
export function vehicleActivityById(
  entries: readonly InboxEnquiry[],
  now: number,
) {
  type ActivityGroup = {
    cases: Map<string, Enquiry>;
    appointments: Enquiry[];
    pending: Enquiry[];
    records: Map<string, InboxEnquiry[]>;
    followUps: Enquiry[];
  };
  const grouped = new Map<string, ActivityGroup>();
  for (const entry of entries) {
    if (!entry.vehicleId) continue;
    const group: ActivityGroup = grouped.get(entry.vehicleId) ?? {
      cases: new Map(),
      appointments: [],
      pending: [],
      records: new Map(),
      followUps: [],
    };
    const primary = primaryEnquiry(entry, entries);
    group.cases.set(primary.id, primary);
    const records = group.records.get(primary.id) ?? [];
    records.push(entry);
    group.records.set(primary.id, records);
    if (
      entry.followUpAt &&
      !entry.followUpCompletedAt &&
      Number.isFinite(Date.parse(entry.followUpAt))
    )
      group.followUps.push(entry);
    if (isUpcomingAppointment(entry, now)) {
      if (entry.appointmentStatus === "pending") group.pending.push(entry);
      else if (
        entry.appointmentStatus == null ||
        entry.appointmentStatus === "confirmed"
      )
        group.appointments.push(entry);
    }
    grouped.set(entry.vehicleId, group);
  }
  const byTime = (a: Enquiry, b: Enquiry) =>
    Date.parse(a.appointmentAt!) - Date.parse(b.appointmentAt!);
  return new Map<string, VehicleActivity>(
    Array.from(grouped, ([id, group]) => [
      id,
      {
        cases: Array.from(group.cases.values()).sort(
          (a, b) =>
            Date.parse(b.createdAt) - Date.parse(a.createdAt) ||
            a.id.localeCompare(b.id),
        ),
        customers: Array.from(group.cases.values())
          .map((customer) => {
            const tasks = (group.records.get(customer.id) ?? []).map(
              (task) => ({
                task,
                presentation: enquiryPresentation(task, now),
              }),
            );
            tasks.sort(
              (a, b) =>
                a.presentation.priority - b.presentation.priority ||
                (a.presentation.dueAt
                  ? Date.parse(a.presentation.dueAt)
                  : Infinity) -
                  (b.presentation.dueAt
                    ? Date.parse(b.presentation.dueAt)
                    : Infinity) ||
                a.task.id.localeCompare(b.task.id),
            );
            return {
              customer,
              ...(tasks[0] ?? {
                task: customer,
                presentation: enquiryPresentation(customer, now),
              }),
            };
          })
          .sort(
            (a, b) =>
              a.presentation.priority - b.presentation.priority ||
              Date.parse(b.customer.createdAt) -
                Date.parse(a.customer.createdAt) ||
              a.customer.id.localeCompare(b.customer.id),
          ),
        nextFollowUp: group.followUps.sort(
          (a, b) => Date.parse(a.followUpAt!) - Date.parse(b.followUpAt!),
        )[0],
        nextAppointment: group.appointments.sort(byTime)[0],
        pendingAppointments: group.pending.sort(byTime),
      },
    ]),
  );
}
