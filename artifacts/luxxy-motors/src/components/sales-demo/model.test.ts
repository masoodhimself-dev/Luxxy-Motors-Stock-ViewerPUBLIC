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
    "Part exchange, discounts and payments cannot exceed the total due.",
  );
  expect(errors(draft)).toContain("Enter the customer name.");
});

it("itemises fees, discounts, three exchanges and split payments without legacy double counting", () => {
  const d = {
    ...emptyDraft(),
    customer: "Buyer",
    vehicleId: "car",
    price: "10000",
    deposit: "999",
    partExchange: true,
    pxValue: "999",
    exchanges: [
      { registration: "A", description: "A", value: "1000" },
      { registration: "B", description: "B", value: "2000" },
      { registration: "C", description: "C", value: "500" },
    ],
    adjustments: [
      { description: "Delivery", amount: "100", kind: "fee" as const },
      { description: "Discount", amount: "50", kind: "discount" as const },
    ],
    payments: [
      { amount: "500", method: "Cash", date: "2026-09-28", reference: "" },
      {
        amount: "1000",
        method: "Bank transfer",
        date: "2026-09-28",
        reference: "",
      },
    ],
  };
  expect(totals(d).balance).toBe(505000);
  expect(errors(d)).toEqual([]);
  expect(totals({ ...d, exchanges: [], payments: [] }).balance).toBe(1005000);
  expect(
    errors({ ...d, exchanges: [...d.exchanges, d.exchanges[0]] }),
  ).toContain("A maximum of three part-exchange cars is allowed.");
});
