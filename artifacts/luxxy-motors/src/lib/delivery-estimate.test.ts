import { expect, it } from "vitest";
import { deliveryVehicleTotal } from "./delivery-estimate";

it("adds integer pence and rounds a decimal car price once", () => {
  expect(deliveryVehicleTotal(2999.99, "GBP", 8510)).toEqual({
    vehiclePence: 299999,
    totalPence: 308509,
  });
  expect(deliveryVehicleTotal(10.075, "GBP", 100)).toEqual({
    vehiclePence: 1008,
    totalPence: 1108,
  });
  expect(deliveryVehicleTotal(0, " gbp ", 0)).toBeNull();
});
it("never adds different currencies, unknown prices or unsafe pence", () => {
  for (const currency of [undefined, null, "EUR", ""])
    expect(deliveryVehicleTotal(100, currency, 100)).toBeNull();
  for (const value of [
    null,
    undefined,
    -1,
    NaN,
    Infinity,
    Number.MAX_SAFE_INTEGER,
  ])
    expect(deliveryVehicleTotal(value, "GBP", 100)).toBeNull();
  expect(deliveryVehicleTotal(1, "GBP", Number.MAX_SAFE_INTEGER)).toBeNull();
  expect(deliveryVehicleTotal(100, "GBP", 0.1)).toBeNull();
});


it.each([null, undefined, "", "fixed", "fixed price", "VAT included", "inc. VAT", "inclusive of VAT"])("combines only a known consumer price basis: %s", priceType => {
  expect(deliveryVehicleTotal(2790, "GBP", 8510, priceType)).toEqual({vehiclePence:279000,totalPence:287510});
});
it.each(["+ VAT", "+VAT", "exVAT", "ex VAT", "excl. VAT", "excluding VAT", "VAT exclusive", "VAT qualifying", "finance price", "unknown"])("does not combine an exclusive or unknown price basis: %s", priceType => {
  expect(deliveryVehicleTotal(2790, "GBP", 8510, priceType)).toBeNull();
});
it("does not turn a zero/price-on-application car into a free-car total", () => {
  expect(deliveryVehicleTotal(0, "GBP", 8510, "fixed")).toBeNull();
});
