import { expect, it } from "vitest";
import { emptyDraft, totals, errors, pence } from "./model";
it("calculates in pence and credits the deposit once", () => {
  const draft = {
    ...emptyDraft(),
    customer: "Sample Buyer",
    vehicleId: "car",
    price: "15000",
    partExchange: true,
    pxRegistration: "AB12 CDE",
    pxValue: "3000",
    deposit: "250",
  };
  expect(totals(draft).balance).toBe(1175000);
  expect(errors(draft)).toEqual([]);
  expect(pence("0.29")).toBe(29);
});
it("rejects invalid amounts and overpayments for document preparation", () => {
  expect(Number.isNaN(pence("-5"))).toBe(true);
  expect(Number.isNaN(pence("2.345"))).toBe(true);
  const draft = { ...emptyDraft(), price: "100", deposit: "101" };
  expect(errors(draft)).toContain(
    "Part exchange and deposit cannot exceed the vehicle price.",
  );
  expect(errors(draft)).toContain("Enter the customer name.");
});
