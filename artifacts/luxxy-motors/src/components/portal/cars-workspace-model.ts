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

export type StaffCarsTab =
  "all" | "available" | "reserved" | "sold" | "missing";
export type StaffCarsAttention =
  "all" | "changed" | "attention" | "no-photos" | "no-price" | "reply";
export function workspaceStatus(
  car: import("./staff-cars-query").StaffCar,
): StaffCarsTab | "hidden" {
  if (car.inventoryStatus === "sold") return "sold";
  if (
    car.inventoryStatus === "hidden" ||
    car.inventoryStatus === "archived" ||
    car.staff.archivedAt
  )
    return "hidden";
  if (car.staff.sourceStatus === "missing") return "missing";
  return car.inventoryStatus === "reserved" ? "reserved" : "available";
}
export function carIssues(
  car: import("./staff-cars-query").StaffCar,
  activity?: VehicleActivity,
) {
  const issues: string[] = [];
  if (!car.heroImage && !car.images.length) issues.push("No photos");
  if (car.price == null) issues.push("Missing price");
  if (workspaceStatus(car) === "missing") issues.push("Missing from feed");
  if (activity?.customers.some((c) => (c.task.pendingEmailReplies ?? 0) > 0))
    issues.push("Customer awaiting reply");
  return issues;
}
export function carInTab(
  car: import("./staff-cars-query").StaffCar,
  tab: StaffCarsTab,
) {
  const status = workspaceStatus(car);
  return (
    status !== "hidden" &&
    (tab === "all"
      ? ["available", "reserved"].includes(status)
      : tab === "reserved"
        ? car.inventoryStatus === "reserved"
        : status === tab)
  );
}
export function filterStaffCars(
  cars: import("./staff-cars-query").StaffCar[],
  search: string,
  tab: StaffCarsTab,
  sort: CarsSort,
  attention: StaffCarsAttention,
  activities: Map<string, VehicleActivity>,
) {
  const result = cars.filter((car) => {
    const issues = carIssues(car, activities.get(car.id));
    if (!carInTab(car, tab) || !matchesEnquiryCar(car, search)) return false;
    return (
      attention === "all" ||
      (attention === "changed" && car.staff.changes.length > 0) ||
      (attention === "attention" && issues.length > 0) ||
      (attention === "no-photos" && issues.includes("No photos")) ||
      (attention === "no-price" && issues.includes("Missing price")) ||
      (attention === "reply" && issues.includes("Customer awaiting reply"))
    );
  });
  return sort === "stock"
    ? result
    : result.sort((a, b) =>
        sort === "make"
          ? vehicleDisplayTitle(a).localeCompare(
              vehicleDisplayTitle(b),
              "en-GB",
              { numeric: true, sensitivity: "base" },
            )
          : a.price == null
            ? b.price == null
              ? 0
              : 1
            : b.price == null
              ? -1
              : sort === "price-asc"
                ? a.price - b.price
                : b.price - a.price,
      );
}
export function carNextStep(
  car: import("./staff-cars-query").StaffCar,
  activity?: VehicleActivity,
) {
  const reply = activity?.customers.find(
    (c) => (c.task.pendingEmailReplies ?? 0) > 0,
  );
  if (reply)
    return {
      kind: "enquiry",
      id: reply.task.id,
      label: `Reply to ${reply.customer.customerName}`,
    };
  if (car.staff.sale)
    return {
      kind: "sale",
      id: car.staff.sale.id,
      label: car.staff.sale.status === "sold" ? "View sale" : "Continue sale",
    };
  const task = activity?.customers.find((c) => c.presentation.priority <= 4);
  if (task)
    return {
      kind: "enquiry",
      id: task.task.id,
      label:
        task.presentation.action === "appointment"
          ? "View test drive"
          : task.presentation.nextAction,
    };
  if (activity?.nextAppointment)
    return {
      kind: "enquiry",
      id: activity.nextAppointment.id,
      label: "View test drive",
    };
  return workspaceStatus(car) === "available"
    ? { kind: "new", id: car.id, label: "New enquiry" }
    : { kind: "details", id: car.id, label: "Open car" };
}
