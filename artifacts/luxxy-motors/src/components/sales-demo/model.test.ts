import { expect, it } from "vitest";
import { emptyDraft, totals, errors, pence } from "./model";
import {
  saleWorkspacePence,
  saleWorkspaceTotals,
  type SaleWorkspaceDraft,
  type SaleWorkspacePayment,
} from "@workspace/vehicle-meta";
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

it("uses the backend penny parser, including the safe-integer boundary", () => {
  for (const value of [
    "0",
    "0.01",
    "8.04",
    "12000.99",
    " 20.5 ",
    "90071992547409.91",
    "90071992547409.92",
    "-1",
    "1e4",
    "1.001",
  ]) {
    expect(pence(value)).toBe(saleWorkspacePence(value));
  }
  expect(pence("90071992547409.91")).toBe(Number.MAX_SAFE_INTEGER);
  expect(pence("90071992547409.92")).toBeNaN();
});

it("matches authoritative totals for split payments, three exchanges, refunds, pending and cancelled entries", () => {
  const entries = [
    {
      id: "deposit",
      amount: "1000.01",
      amountPence: 100001,
      signedAmountPence: 100001,
      status: "confirmed",
      kind: "deposit",
    },
    {
      id: "cash",
      amount: "2500.29",
      amountPence: 250029,
      signedAmountPence: 250029,
      status: "confirmed",
      kind: "part-payment",
    },
    {
      id: "refund",
      amount: "10.01",
      amountPence: 1001,
      signedAmountPence: -1001,
      status: "confirmed",
      kind: "refund",
    },
    {
      id: "pending",
      amount: "50.00",
      amountPence: 5000,
      signedAmountPence: 5000,
      status: "pending",
      kind: "part-payment",
    },
    {
      id: "cancelled",
      amount: "100.00",
      amountPence: 10000,
      signedAmountPence: 10000,
      status: "cancelled",
      kind: "part-payment",
    },
  ].map((row) => ({
    ...row,
    method: "Bank transfer",
    date: "2026-10-12",
    reference: "",
    recordedBy: "Fixture",
    recordedAt: "2026-10-12T10:00:00Z",
  })) as SaleWorkspacePayment[];
  const draft = {
    ...emptyDraft(),
    price: "12345.67",
    customer: "Fixture",
    vehicleId: "fixture-car",
    vehicle: "Fixture vehicle",
    deposit: "999999",
    adjustments: [
      { kind: "fee" as const, description: "Delivery", amount: "150.29" },
      {
        kind: "discount" as const,
        description: "Agreed discount",
        amount: "20.17",
      },
    ],
    exchanges: ["1000.10", "2000.20", "3000.30"].map((value, index) => ({
      registration: `FIXTURE-${index}`,
      description: "Fixture",
      value,
    })),
    payments: entries,
  };
  expect(totals(draft)).toEqual(
    saleWorkspaceTotals(draft as SaleWorkspaceDraft, entries),
  );
  expect(totals(draft).totalDue).toBe(647519);
  expect(totals(draft).confirmedPaid).toBe(349029);
  expect(totals(draft).pending).toBe(5000);
  expect(totals(draft).balance).toBe(298490);
  expect(errors(draft)).toEqual([]);
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
