import { expect, it } from "vitest";
import type { Car } from "@/lib/stock-context";
import type { Enquiry } from "@workspace/api-client-react";
import {
  currentStockCars,
  findWorkspaceCars,
  vehicleActivityById,
} from "./cars-workspace-model";
const toyota = {
  id: "one",
  title: "Toyota Yaris",
  make: "Toyota",
  model: "Yaris",
  variant: "Excel",
  year: 2021,
  colour: "Black",
  transmission: "Automatic",
  fuel: "Petrol",
  price: 8990,
  mileage: 22000,
  plate: "AB12 CDE",
  inventoryStatus: "available",
  images: [],
} as unknown as Car;
const mg = {
  ...toyota,
  id: "two",
  title: "MG HS",
  make: "MG",
  model: "HS",
  colour: "Red",
  price: 14990,
  plate: "XY22 ZZZ",
  inventoryStatus: "reserved",
};
const now = Date.parse("2030-01-01T12:00:00Z");
const enquiry = (overrides: Partial<Enquiry> = {}) =>
  ({
    id: "enq-one",
    reference: "ENQ-001",
    dealerId: "dealer-one",
    type: "viewing",
    vehicleId: "one",
    customerName: "Alex",
    createdAt: "2029-12-01T12:00:00Z",
    appointmentAt: null,
    appointmentCancelledAt: null,
    appointmentStatus: null,
    ...overrides,
  }) as Enquiry;

it("only includes available and reserved current stock, retaining stock order", () => {
  expect(
    currentStockCars([
      mg,
      { ...toyota, id: "sold", inventoryStatus: "sold" },
      toyota,
      { ...toyota, id: "unknown", inventoryStatus: null },
    ]).map((car) => car.id),
  ).toEqual(["two", "one"]);
});

it("combines flexible car search with availability and puts missing prices last in either direction", () => {
  const missing = { ...toyota, id: "missing", price: null };
  const cars = [mg, missing, toyota];
  expect(
    findWorkspaceCars(cars, "black auto Toyota", "available", "stock").map(
      (car) => car.id,
    ),
  ).toEqual(["missing", "one"]);
  expect(
    findWorkspaceCars(cars, "", "reserved", "stock").map((car) => car.id),
  ).toEqual(["two"]);
  expect(
    findWorkspaceCars(cars, "AB12CDE", "all", "price-asc").map((car) => car.id),
  ).toEqual(["one", "missing"]);
  expect(
    findWorkspaceCars(cars, "", "all", "price-desc").map((car) => car.id),
  ).toEqual(["two", "one", "missing"]);
  expect(cars.map((car) => car.id)).toEqual(["two", "missing", "one"]);
});

it("counts explicit merged cases once but preserves separate customers sharing a phone", () => {
  const primary = enquiry({ phone: "07000000000" });
  const child = enquiry({ id: "child", mergedIntoId: primary.id });
  const separate = enquiry({ id: "separate", phone: primary.phone });
  const otherCar = enquiry({
    id: "other",
    vehicleId: "two",
    mergedIntoId: primary.id,
  });
  const result = vehicleActivityById(
    [
      primary,
      child,
      separate,
      otherCar,
      enquiry({ id: "general", vehicleId: null }),
    ],
    now,
  );
  expect(result.get("one")?.cases.map((entry) => entry.id)).toEqual([
    "enq-one",
    "separate",
  ]);
  expect(result.get("two")?.cases.map((entry) => entry.id)).toEqual([
    "enq-one",
  ]);
  expect(result.size).toBe(2);
});

it("shows the next approved or legacy booking, excluding pending, cancelled, attended and past appointments", () => {
  const entries = [
    enquiry({ id: "legacy", appointmentAt: "2030-01-03T12:00:00Z" }),
    enquiry({
      id: "approved",
      appointmentAt: "2030-01-02T12:00:00Z",
      appointmentStatus: "confirmed",
      attendance: "scheduled",
    }),
    enquiry({
      id: "pending",
      appointmentAt: "2030-01-02T10:00:00Z",
      appointmentStatus: "pending",
    }),
    enquiry({
      id: "cancelled",
      appointmentAt: "2030-01-02T08:00:00Z",
      appointmentCancelledAt: "2029-12-31T12:00:00Z",
    }),
    ...(["arrived", "completed", "no_show"] as const).map((attendance) =>
      enquiry({
        id: attendance,
        attendance,
        appointmentAt: "2030-01-02T08:00:00Z",
      }),
    ),
    enquiry({ id: "past", appointmentAt: "2029-12-31T12:00:00Z" }),
    enquiry({ id: "invalid", appointmentAt: "bad date" }),
    enquiry({
      id: "general-time",
      type: "general",
      appointmentAt: "2030-01-02T07:00:00Z",
    }),
    enquiry({
      id: "delivery-time",
      type: "delivery",
      appointmentAt: "2030-01-02T07:00:00Z",
    }),
  ];
  const result = vehicleActivityById(entries, now).get("one")!;
  expect(result.nextAppointment?.id).toBe("approved");
  expect(result.pendingAppointments.map((entry) => entry.id)).toEqual([
    "pending",
  ]);
  expect(
    vehicleActivityById([entries[0]], now).get("one")?.nextAppointment?.id,
  ).toBe("legacy");
});

it("keeps a merged child's actual reply or follow-up attached to its own vehicle and source record", () => {
  const parent = enquiry({
    type: "general",
    status: "contacted",
    vehicleId: "one",
    customerName: "Alex Buyer",
  });
  const child = {
    ...enquiry({
      id: "child-reply",
      mergedIntoId: parent.id,
      type: "general",
      vehicleId: "one",
    }),
    pendingEmailReplies: 2,
  };
  const otherCar = enquiry({
    id: "other-car-followup",
    mergedIntoId: parent.id,
    vehicleId: "two",
    followUpAt: "2029-12-31T12:00:00Z",
  });
  const records = [parent, child, otherCar];
  const before = structuredClone(records);
  const result = vehicleActivityById(records, now);
  expect(result.get("one")?.cases).toHaveLength(1);
  expect(result.get("one")?.customers[0]).toMatchObject({
    customer: { id: parent.id, customerName: "Alex Buyer" },
    task: { id: child.id },
    presentation: { state: "Customer replied" },
  });
  expect(result.get("two")?.customers[0]).toMatchObject({
    customer: { id: parent.id },
    task: { id: otherCar.id },
    presentation: { state: "Follow-up overdue" },
  });
  expect(records).toEqual(before);
});
