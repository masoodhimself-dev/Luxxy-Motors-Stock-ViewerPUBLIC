import { expect, it } from "vitest";
import { stockRecoverySuggestions } from "./recovery";
import { createStockFilters } from "./url";
import type { Car } from "@/lib/stock-context";
it("counts real recoveries against full stock and hides suggestions that still return no cars", () => {
  const cars = [
    {
      id: "a",
      make: "Ford",
      model: "Focus",
      price: 6000,
      transmission: "Manual",
    },
    {
      id: "b",
      make: "Toyota",
      model: "Yaris",
      price: 4000,
      transmission: "Automatic",
    },
  ] as Car[];
  const results = stockRecoverySuggestions(cars, {
    ...createStockFilters(),
    make: "Ford",
    maxPrice: "5000",
  });
  expect(results).toContainEqual({
    label: "Remove price limits",
    patch: { minPrice: "", maxPrice: "" },
    count: 1,
  });
  expect(results.every((item) => item.count > 0)).toBe(true);
  expect(results.length).toBeLessThanOrEqual(3);
});
