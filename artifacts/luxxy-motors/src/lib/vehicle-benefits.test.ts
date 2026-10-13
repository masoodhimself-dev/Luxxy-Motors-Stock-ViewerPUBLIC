import { describe, expect, it } from "vitest";
import type { Car } from "./stock-context";
import { ULEZ_CHECK_URL, vehicleBenefits } from "./vehicle-benefits";

const car = (data: object) => data as Car;
const costs = (items: object[]) =>
  car({ sourceExtras: { runningCosts: { items } } });

describe("supplied ULEZ emissions standards", () => {
  it.each([
    ["Diesel", "Euro 6"],
    ["Diesel", "Euro 6d-TEMP"],
    ["Diesel", "Euro 6e"],
    ["Petrol", "Euro 4"],
    ["Petrol", "Euro 5"],
    ["Petrol", "Euro 6"],
    ["Petrol Plug-in Hybrid", "Euro 6"],
    ["Diesel Hybrid", "Euro 6"],
  ])(
    "compares %s / %s with the relevant fuel threshold and provides a vehicle-check qualifier",
    (fuel, emissionClass) => {
      const result = vehicleBenefits(car({ fuel, emissionClass })).ulez;
      expect(result?.text).toBe("ULEZ compliant");
      expect(result?.note).toContain(emissionClass);
      expect(result?.note).toContain("Check its registration with TfL");
      expect(result?.href).toBe(ULEZ_CHECK_URL);
    },
  );

  it.each([
    { fuel: "Diesel", emissionClass: "Euro 5" },
    { fuel: "Petrol", emissionClass: "Euro 3" },
    { fuel: null, emissionClass: "Euro 6" },
    { fuel: "Hybrid", emissionClass: "Euro 6" },
    { fuel: "Petrol/Diesel", emissionClass: "Euro 6" },
    { fuel: "Electric", emissionClass: "Euro 6" },
    { fuel: "Diesel", emissionClass: null, year: 2026, variant: "Euro 6 ULEZ" },
    { fuel: "Diesel", emissionClass: "Not Euro 6" },
    { fuel: "Diesel", emissionClass: "Euro 5 / Euro 6" },
    { fuel: "Diesel", emissionClass: "Euro 6 not compliant" },
  ])(
    "does not invent compliance for unsupported or absent facts: %j",
    (input) => {
      expect(vehicleBenefits(car(input)).ulez).toBeNull();
    },
  );

  it("does not make ULEZ eligibility depend on mileage", () => {
    expect(
      vehicleBenefits(
        car({ fuel: "Diesel", emissionClass: "Euro 6", mileage: 160_000 }),
      ).ulez,
    ).not.toBeNull();
    const lowMileageDiesel = vehicleBenefits(
      car({ fuel: "Diesel", emissionClass: "Euro 5", mileage: 10_000 }),
    );
    expect(lowMileageDiesel.lowMileage).not.toBeNull();
    expect(lowMileageDiesel.ulez).toBeNull();
  });
});

describe("actual mileage threshold", () => {
  it.each([0, 29_999, 30_000])("includes supplied %s miles", (mileage) => {
    expect(vehicleBenefits(car({ mileage })).lowMileage).not.toBeNull();
  });
  it.each([
    30_001,
    -1,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    12.5,
    "1000",
    null,
    undefined,
  ])("rejects out-of-range or invalid mileage %s", (mileage) => {
    expect(vehicleBenefits(car({ mileage })).lowMileage).toBeNull();
  });
});

describe("explicit annual tax", () => {
  it.each(["£0", "£20", "£35", "£20 per year", "£35/year", 1.1, 35])(
    "recognises annual figures within the £35 limit: %s",
    (value) => {
      const point = vehicleBenefits(
        costs([{ key: "Tax", label: "Tax per year", value }]),
      ).lowAnnualTax;
      expect(point?.text).toContain("road tax per year");
      expect(point?.note).toContain("confirm the current amount");
    },
  );
  it.each([
    "£35.01",
    "£200",
    "£20/month",
    "£20 monthly",
    "from £20",
    "$20",
    "€20",
    "Contact seller",
    -1,
    1.234,
  ])("does not promote unsuitable annual tax: %s", (value) => {
    expect(
      vehicleBenefits(costs([{ label: "Tax per year", value }])).lowAnnualTax,
    ).toBeNull();
  });

  it("recognises explicitly annual flat facts without inferring them from road tax, CO₂ or finance", () => {
    expect(
      vehicleBenefits(car({ sourceExtras: { annualTax: "£20" } })).lowAnnualTax,
    ).not.toBeNull();
    expect(
      vehicleBenefits(car({ specifications: { annualRoadTax: 35 } }))
        .lowAnnualTax,
    ).not.toBeNull();
    expect(
      vehicleBenefits(
        car({ sourceExtras: { roadTax: "£20", co2: 0, monthlyPayment: 20 } }),
      ).lowAnnualTax,
    ).toBeNull();
    expect(
      vehicleBenefits(
        costs([
          { label: "CO₂ emissions", value: "0g/km" },
          { label: "Monthly payment", value: "£20" },
          { label: "Road tax", value: "£20" },
        ]),
      ).lowAnnualTax,
    ).toBeNull();
  });

  it("does not choose the cheaper of conflicting supplied annual tax figures", () => {
    expect(
      vehicleBenefits(
        car({
          sourceExtras: {
            annualTax: 200,
            runningCosts: { items: [{ label: "Tax per year", value: "£20" }] },
          },
        }),
      ).lowAnnualTax,
    ).toBeNull();
  });
});

describe("supplied insurance groups", () => {
  it.each([
    ["1", "1"],
    ["10E", "10E"],
    ["11E", "11E"],
    ["15", "15"],
    ["11 e / 50", "11E"],
    ["Group 8A", "8A"],
    ["9 of 50", "9"],
  ])("preserves the stated valid group %s", (value, display) => {
    const point = vehicleBenefits(
      costs([{ key: "Insurance", label: "Insurance group", value }]),
    ).lowInsuranceGroup;
    expect(point?.text).toBe(`Lower insurance group · ${display}`);
    expect(point?.note).toContain("1–15");
    expect(point?.note).toContain("premium depends");
  });

  it.each([
    "16E",
    "50",
    "51",
    "0",
    "8X",
    "8E/20",
    "cheap",
    "£8",
    "8–12",
    1.5,
    null,
  ])("does not promote higher, invalid or unknown groups: %s", (value) => {
    expect(
      vehicleBenefits(costs([{ label: "Insurance group", value }]))
        .lowInsuranceGroup,
    ).toBeNull();
  });

  it("recognises existing flat insurance fields and refuses conflicting group facts", () => {
    expect(
      vehicleBenefits(car({ sourceExtras: { insuranceGroup: "11E" } }))
        .lowInsuranceGroup?.text,
    ).toBe("Lower insurance group · 11E");
    expect(
      vehicleBenefits(car({ specifications: { insuranceGroup: 8 } }))
        .lowInsuranceGroup?.text,
    ).toBe("Lower insurance group · 8");
    expect(
      vehicleBenefits(
        car({
          sourceExtras: {
            insuranceGroup: "30E",
            runningCosts: {
              items: [{ label: "Insurance group", value: "8E" }],
            },
          },
        }),
      ).lowInsuranceGroup,
    ).toBeNull();
  });
});
