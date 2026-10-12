import { expect, it } from "vitest";
import type { Car } from "./stock-context";
import { vehicleSellingPoints } from "./vehicle-selling-points";

const car = (data: object) => data as Car;

it("prioritises requested supplied benefits and retains low keeper count and full history", () => {
  const points = vehicleSellingPoints(
    car({
      fuel: "Diesel",
      emissionClass: "Euro 6",
      mileage: 30_000,
      owners: 2,
      sourceExtras: {
        serviceHistory: "Full service history",
        runningCosts: {
          items: [
            { label: "Tax per year", value: "£20" },
            { label: "Insurance group", value: "11E" },
          ],
        },
      },
    }),
  );
  expect(points.map((point) => point.label)).toEqual([
    "ULEZ",
    "Mileage",
    "Annual tax",
    "Insurance group",
    "Previous keepers",
    "Service history",
  ]);
  expect(points.map((point) => point.text)).toContain("2 previous keepers");
  expect(points.map((point) => point.text)).toContain("Full service history");
});

it("keeps <=30,000-mile highlights separate from supplied below-average comparisons", () => {
  expect(
    vehicleSellingPoints(car({ mileage: 1000 })).map((point) => point.text),
  ).toEqual(["1,000 miles · low mileage"]);
  expect(
    vehicleSellingPoints(
      car({
        mileage: 20_000,
        sourceExtras: {
          vehicleHighlights: [{ key: "MileageLow", quantifier: "LOW" }],
        },
      }),
    ).filter((point) => point.label === "Mileage"),
  ).toHaveLength(1);
  expect(
    vehicleSellingPoints(
      car({
        mileage: 40_000,
        sourceExtras: {
          vehicleHighlights: [{ key: "MileageLow", quantifier: "LOW" }],
        },
      }),
    )[0].text,
  ).toBe("40,000 miles · below average");
  expect(vehicleSellingPoints(car({ mileage: 40_000 }))).toEqual([]);
});

it("does not promote expensive tax, higher owner count or partial history", () => {
  expect(
    vehicleSellingPoints(
      car({
        owners: 7,
        sourceExtras: {
          serviceHistory: "Partial service history",
          runningCosts: { items: [{ label: "Tax per year", value: "£200" }] },
        },
      }),
    ),
  ).toEqual([]);
  expect(
    vehicleSellingPoints(
      car({ sourceExtras: { serviceHistory: "No full service history" } }),
    ),
  ).toEqual([]);
  expect(
    vehicleSellingPoints(
      car({ sourceExtras: { serviceHistory: "Full (dealership)" } }),
    ),
  ).toEqual([]);
  expect(vehicleSellingPoints(car({}))).toEqual([]);
});

it("retains source-supported history aliases without turning negated history into a benefit", () => {
  for (const serviceHistory of [
    "Full",
    "Full service history",
    "Full dealership service history",
  ]) {
    expect(
      vehicleSellingPoints(
        car({ owners: 1, sourceExtras: { serviceHistory } }),
      ).map((point) => point.text),
    ).toEqual(["1 previous keeper", "Full service history"]);
  }
});
