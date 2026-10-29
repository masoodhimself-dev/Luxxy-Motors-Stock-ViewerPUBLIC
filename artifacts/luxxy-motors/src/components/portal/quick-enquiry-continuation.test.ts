import { expect, it } from "vitest";
import type { Enquiry } from "@workspace/api-client-react";
import { findContinuingEnquiries } from "./quick-enquiry-continuation";

const entry = (patch: Partial<Enquiry> = {}) =>
  ({
    id: "existing",
    dealerId: "dealer-one",
    customerName: "Alex Smith",
    phone: "07700 900123",
    email: "alex@example.test",
    vehicleId: "car-one",
    vehicleTitle: "Ford Focus",
    status: "new",
    reference: "ENQ-ONE",
    createdAt: "2026-10-01T10:00:00Z",
    updatedAt: "2026-10-02T10:00:00Z",
    ...patch,
  }) as Enquiry;
const contact = {
  phone: "+44 (0)7700 900123",
  email: "",
  vehicleId: "car-one",
};

it("offers exact canonical UK phone or valid email matches but never a name-only or partial contact match", () => {
  const records = [entry()];
  expect(findContinuingEnquiries(records, contact)[0].matchedBy).toEqual([
    "phone",
  ]);
  expect(
    findContinuingEnquiries(records, {
      ...contact,
      phone: "",
      email: " ALEX@example.test ",
    })[0].matchedBy,
  ).toEqual(["email"]);
  for (const phone of ["07700", "900123", "+44770090012", ""])
    expect(findContinuingEnquiries(records, { ...contact, phone })).toEqual([]);
  expect(
    findContinuingEnquiries(records, { ...contact, phone: "", email: "alex@" }),
  ).toEqual([]);
});

it("keeps provider-specific email aliases separate and checks exact selected vehicle IDs", () => {
  const records = [entry()];
  expect(
    findContinuingEnquiries(records, {
      ...contact,
      phone: "",
      email: "alex+other@example.test",
    }),
  ).toEqual([]);
  expect(
    findContinuingEnquiries(records, { ...contact, vehicleId: "other-car" }),
  ).toEqual([]);
  expect(
    findContinuingEnquiries(records, { ...contact, vehicleId: "" }),
  ).toHaveLength(1);
});

it("never offers closed or unknown-status enquiries", () => {
  expect(
    findContinuingEnquiries(
      [
        entry({ status: "closed" }),
        entry({ id: "unknown", status: undefined }),
      ],
      contact,
    ),
  ).toEqual([]);
  expect(
    findContinuingEnquiries([entry({ status: "contacted" })], contact),
  ).toHaveLength(1);
});

it("returns explicit merged primary IDs once while retaining the child vehicle that matched", () => {
  const root = entry({
    id: "primary",
    vehicleId: "other-car",
    phone: "02079460000",
    email: "different@example.test",
  });
  const child = entry({ id: "child", mergedIntoId: root.id });
  const duplicate = entry({ id: "child-two", mergedIntoId: root.id });
  const records = [root, child, duplicate];
  const original = JSON.stringify(records);
  const result = findContinuingEnquiries(records, contact);
  expect(result).toHaveLength(1);
  expect(result[0].primary.id).toBe("primary");
  expect(result[0].matchingRecord.vehicleId).toBe("car-one");
  expect(JSON.stringify(records)).toBe(original);
});

it("does not invent a primary when a merge is dangling, circular, closed or crosses dealerships", () => {
  const dangling = entry({ mergedIntoId: "missing" });
  expect(findContinuingEnquiries([dangling], contact)).toEqual([]);
  const first = entry({ id: "first", mergedIntoId: "second" });
  const second = entry({ id: "second", mergedIntoId: "first" });
  expect(findContinuingEnquiries([first, second], contact)).toEqual([]);
  const closed = entry({ id: "root", status: "closed" });
  expect(
    findContinuingEnquiries(
      [closed, entry({ mergedIntoId: closed.id })],
      contact,
    ),
  ).toEqual([]);
  const otherDealer = entry({
    id: "other",
    dealerId: "different",
    phone: null,
    email: null,
  });
  expect(
    findContinuingEnquiries(
      [otherDealer, entry({ mergedIntoId: otherDealer.id })],
      contact,
    ),
  ).toEqual([]);
});

it("keeps multiple independent exact-contact cases as choices and orders most recently used first", () => {
  const records = [
    entry({ id: "old" }),
    entry({ id: "newer", updatedAt: "2026-10-03T10:00:00Z" }),
  ];
  expect(
    findContinuingEnquiries(records, {
      ...contact,
      email: "alex@example.test",
    }).map((choice) => [choice.primary.id, choice.matchedBy]),
  ).toEqual([
    ["newer", ["phone", "email"]],
    ["old", ["phone", "email"]],
  ]);
});
