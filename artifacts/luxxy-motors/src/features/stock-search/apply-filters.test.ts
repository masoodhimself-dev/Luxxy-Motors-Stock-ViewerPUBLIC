import { expect, it } from "vitest";
import type { Car } from "@/lib/stock-context";
import { applyStockFilters, getStockFacetValue } from "./apply-filters";
import { createStockFilters } from "./url";
import type { StockFilters } from "./types";

const car = (id: string, fields: Partial<Car> = {}): Car =>
  ({
    id,
    advertId: id,
    title: null,
    make: null,
    model: null,
    fuel: null,
    transmission: null,
    colour: null,
    bodyType: null,
    price: null,
    mileage: null,
    year: null,
    engineCC: null,
    engineSize: null,
    seats: null,
    ...fields,
  }) as Car;
const cars = [
  car("corolla", {
    make: "Toyota",
    model: "Corolla",
    title: "Toyota Corolla",
    variant: "Design Sport",
    fuel: "Petrol",
    transmission: "Automatic DCT",
    colour: "Blue",
    bodyType: "Hatchback",
    price: 10000,
    mileage: 60000,
    year: 2020,
    engineCC: 1998,
    engineSize: "3.0L",
    seats: 5,
    registration: "AB12 CDE",
    emissionClass: "Euro 6",
    listedAt: "2026-10-01T12:00:00Z",
  }),
  car("yaris", {
    make: "Toyota",
    model: "Yaris",
    fuel: "Petrol Hybrid",
    transmission: "Manual",
    colour: "Red",
    bodyType: "Hatchback",
    price: 8000,
    mileage: 0,
    year: 2017,
    engineCC: 1498,
    seats: 5,
    vrm: "MA06LDW",
    listedAt: "2026-10-10T12:00:00Z",
  }),
  car("jazz", {
    make: "Honda",
    model: "Jazz",
    fuel: "Diesel",
    transmission: "Manual",
    colour: "Blue",
    bodyType: "Hatchback",
    price: 6000,
    mileage: 120000,
    year: 2013,
    engineCC: 1300,
    seats: 5,
  }),
  car("bmw", {
    make: "BMW",
    model: "X3",
    fuel: "Diesel",
    transmission: "Automatic",
    colour: "Black",
    bodyType: "SUV",
    price: 20000,
    mileage: 70000,
    year: 2019,
    engineCC: 2993,
    seats: 5,
  }),
  car("unknown", {
    make: "Audi",
    model: "A3",
    createdAt: "2026-10-20T12:00:00Z",
  }),
  car("electric", {
    make: "Nissan",
    model: "Leaf",
    fuel: "Electric",
    transmission: "Automatic",
    colour: "White",
    bodyType: "Hatchback",
    price: 15000,
    mileage: 25000,
    year: 2022,
    engineCC: 0,
    engineSize: "0.0L",
  }),
];
const filter = (fields: Partial<StockFilters> = {}) => ({
  ...createStockFilters(),
  ...fields,
});
const ids = (input: Car[], fields: Partial<StockFilters> = {}) =>
  applyStockFilters(input, filter(fields)).items.map((item) => item.id);

it("preserves the recommended input order and unknown facts when no filter is selected, without mutation", () => {
  const source = [...cars];
  Object.freeze(source);
  source.forEach(Object.freeze);
  const filters = Object.freeze(createStockFilters());
  const result = applyStockFilters(source, filters);
  expect(result.items.map((item) => item.id)).toEqual(
    cars.map((item) => item.id),
  );
  expect(result.items).not.toBe(source);
  expect(result.total).toBe(cars.length);
  expect(result.facets.seats).toEqual([{ value: "5", label: "5", count: 4 }]);
});

it("uses OR within multi-select facets and AND across facets with case-insensitive matching", () => {
  expect(
    ids(cars, { make: "toyota,HONDA", fuel: "petrol,diesel", colour: "BLUE" }),
  ).toEqual(["corolla", "jazz"]);
  expect(
    ids(cars, {
      make: "Toyota,Honda",
      model: "Corolla,Jazz",
      bodyType: "hatchback",
    }),
  ).toEqual(["corolla", "jazz"]);
});

it("counts each option against the other filters, and narrows model options to selected makes", () => {
  const result = applyStockFilters(
    cars,
    filter({ make: "Toyota", colour: "Blue" }),
  );
  expect(result.items.map((item) => item.id)).toEqual(["corolla"]);
  expect(result.facets.make.find((item) => item.value === "Honda")?.count).toBe(
    1,
  );
  expect(
    result.facets.make.find((item) => item.value === "Toyota")?.count,
  ).toBe(1);
  expect(result.facets.colour.find((item) => item.value === "Red")?.count).toBe(
    1,
  );
  expect(result.facets.model).toEqual([
    { value: "Corolla", label: "Corolla", count: 1 },
    { value: "Yaris", label: "Yaris", count: 0 },
  ]);
});

it("retains selected zero-count options and deduplicates a differently cased linked selection", () => {
  const result = applyStockFilters(
    cars,
    filter({
      make: "toyota",
      model: "Future model",
      colour: "Purple",
      engine: "9.0",
      seats: "9",
    }),
  );
  expect(result.total).toBe(0);
  expect(
    result.facets.make.filter((item) => item.value.toLowerCase() === "toyota"),
  ).toHaveLength(1);
  expect(result.facets.model).toContainEqual({
    value: "Future model",
    label: "Future model",
    count: 0,
  });
  expect(result.facets.colour).toContainEqual({
    value: "Purple",
    label: "Purple",
    count: 0,
  });
  expect(result.facets.engine).toContainEqual({
    value: "9.0",
    label: "9.0L",
    count: 0,
  });
  expect(result.facets.seats).toContainEqual({
    value: "9",
    label: "9",
    count: 0,
  });
  expect(applyStockFilters([], filter({ make: "Toyota" })).facets.make).toEqual(
    [{ value: "Toyota", label: "Toyota", count: 0 }],
  );
});

it("requires every search token, searches derivative/colour/year, and keeps compact or spaced registration matching", () => {
  expect(
    ids(cars, { search: "blue toyota design 2020", colour: "Blue" }),
  ).toEqual(["corolla"]);
  expect(ids(cars, { search: "blue diesel", make: "Toyota,Honda" })).toEqual([
    "jazz",
  ]);
  expect(ids(cars, { search: "Toyota Jaguar" })).toEqual([]);
  for (const search of ["AB12CDE", "AB12 CDE", "ab12-cde", "blue AB12CDE"])
    expect(ids(cars, { search })).toEqual(["corolla"]);
  expect(ids(cars, { search: "MA06 LDW" })).toEqual(["yaris"]);
});

it("finds gearboxes by full names and common abbreviations in a keyword search", () => {
  const inventory = [
    ...cars,
    car("golf", { make: "Volkswagen", model: "Golf", transmission: "DSG" }),
    car("a4", { make: "Audi", model: "A4", transmission: "Auto" }),
    car("range", { make: "Land Rover", variant: "Autobiography", transmission: "Manual" }),
  ];
  for (const search of ["BMW automatic", "auto BMW", "BMW AUTOMATIC diesel"]) {
    expect(ids(inventory, { search })).toEqual(["bmw"]);
  }
  expect(ids(inventory, { search: "Corolla DCT" })).toEqual(["corolla"]);
  expect(ids(inventory, { search: "automatic Golf" })).toEqual(["golf"]);
  expect(ids(inventory, { search: "Audi A4 automatic" })).toEqual(["a4"]);
  expect(ids(inventory, { search: "Toyota manual" })).toEqual(["yaris"]);
  expect(ids(inventory, { search: "Land Rover auto" })).toEqual([]);
});

it("uses numeric price/mileage/seat/engine comparisons and does not fabricate missing values", () => {
  expect(
    ids(cars, { maxPrice: "10000", engine: "2L,1.3", seats: "5" }),
  ).toEqual(["corolla", "jazz"]);
  expect(
    ids(cars, { minPrice: "8000", maxPrice: "15000", mileage: "30000" }),
  ).toEqual(["yaris", "electric"]);
  expect(ids(cars, { mileage: "0" })).toEqual(["yaris"]);
  expect(ids(cars, { seats: "7" })).toEqual([]);
  expect(
    ids([car("expensive", { price: 80000 }), ...cars], { maxPrice: "" }),
  ).toContain("expensive");
});

it("prefers cylinder capacity for engine grouping, formats fallback litres, and omits electric/unknown capacity", () => {
  expect(getStockFacetValue(cars[0], "engine")).toBe("2.0");
  expect(getStockFacetValue(car("small", { engineCC: 999 }), "engine")).toBe(
    "1.0",
  );
  expect(
    getStockFacetValue(car("fallback", { engineSize: "1.5L" }), "engine"),
  ).toBe("1.5");
  expect(
    getStockFacetValue(car("cc", { engineSize: "1998cc" }), "engine"),
  ).toBe("2.0");
  expect(getStockFacetValue(cars[5], "engine")).toBeNull();
  expect(getStockFacetValue(car("missing"), "seats")).toBeNull();
  expect(
    getStockFacetValue(
      car("unknown-colour", { colour: "Not specified" }),
      "colour",
    ),
  ).toBeNull();
});

it("retains Hybrid & electric and Automatic variants without a new data-provider assumption", () => {
  expect(ids(cars, { fuel: "Hybrid & electric" })).toEqual([
    "yaris",
    "electric",
  ]);
  expect(ids(cars, { transmission: "automatic" })).toEqual([
    "corolla",
    "bmw",
    "electric",
  ]);
  expect(
    ids(cars, { fuel: "Hybrid & electric,Diesel", transmission: "Manual" }),
  ).toEqual(["yaris", "jazz"]);
  const facets = applyStockFilters(cars, filter({ fuel: "Hybrid & electric" }))
    .facets.fuel;
  expect(facets).toContainEqual({
    value: "Hybrid & electric",
    label: "Hybrid & electric",
    count: 2,
  });
});

it("uses the existing conservative ULEZ decision, with explicit negative source evidence taking priority", () => {
  const negative = car("negative", {
    ...cars[0],
    id: "negative",
    advertId: "80238245",
    sourceExtras: {
      sourcePlatform: "cazoo",
      sourceReport: {
        version: 1,
        platform: "cazoo",
        sourceUrl: "https://www.cazoo.co.uk/cars-for-sale/80238245/",
        capturedAt: "2020-10-24T20:00:00Z",
        ulez: { status: "not_compliant", sourceText: "Not ULEZ compliant" },
        history: null,
      },
    },
  });
  expect(ids([...cars, negative], { ulez: true })).toEqual(["corolla"]);
  expect(
    ids([car("electric-only", { fuel: "Electric" })], { ulez: true }),
  ).toEqual([]);
});

it("filters on an explicit official feed advert claim when emissions data is absent", () => {
  const advert = (id: string, advertDescription: string) => car(id, {
    advertId: id,
    fuel: "Petrol",
    sourceExtras: {
      sourcePlatform: "cazoo",
      officialFeed: true,
      descriptionOrigin: "cazoo-official-csv",
      officialCazooVehicleId: id,
      advertDescription,
    },
  });
  const matches = ids([
    advert("listed", "Full service history. HPI clear ULEZ compliant and MOT until August."),
    advert("question", "Is it ULEZ compliant?"),
    advert("qualified", "Please check if this car is ULEZ compliant."),
    advert("negative", "This car is not ULEZ compliant."),
    advert("conflict", "ULEZ compliant. Previous report says not ULEZ compliant."),
    { ...advert("lower-standard", "ULEZ compliant."), fuel: "Diesel", emissionClass: "Euro 5" },
    { ...advert("different-advert", "ULEZ compliant."), advertId: "other" },
  ], { ulez: true });
  expect(matches).toEqual(["listed"]);
});

it.each([
  "price-asc",
  "price-desc",
  "mileage-asc",
  "mileage-desc",
  "year-asc",
  "year-desc",
] as const)(
  "sorts %s with missing or invalid numeric values last and keeps ties stable",
  (sort) => {
    const field = sort.startsWith("price")
      ? "price"
      : sort.startsWith("year")
        ? "year"
        : "mileage";
    const source = [
      car("unknown"),
      car("high", { [field]: field === "year" ? 2020 : 200 }),
      car("low-a", { [field]: field === "year" ? 2010 : 100 }),
      car("low-b", { [field]: field === "year" ? 2010 : 100 }),
      car("nan", { [field]: NaN }),
    ];
    expect(ids(source, { sort })).toEqual(
      sort.endsWith("asc")
        ? ["low-a", "low-b", "high", "unknown", "nan"]
        : ["high", "low-a", "low-b", "unknown", "nan"],
    );
    expect(source[0].id).toBe("unknown");
  },
);

it("treats zero-price POA as unknown while keeping genuine zero mileage sortable", () => {
  expect(
    ids([car("poa", { price: 0 }), car("priced", { price: 10000 })], {
      sort: "price-asc",
    }),
  ).toEqual(["priced", "poa"]);
  expect(
    ids(
      [
        car("missing"),
        car("driven", { mileage: 10 }),
        car("zero", { mileage: 0 }),
      ],
      { sort: "mileage-asc" },
    ),
  ).toEqual(["zero", "driven", "missing"]);
});

it("sorts recently added using supplied listing dates without substituting an import/creation timestamp", () => {
  expect(ids(cars, { sort: "arrival-desc" }).slice(0, 2)).toEqual([
    "yaris",
    "corolla",
  ]);
  expect(
    ids(cars, { sort: "arrival-desc" }).indexOf("unknown"),
  ).toBeGreaterThan(1);
});

it("ignores malformed direct filter input and never slices the complete result by load-more page", () => {
  expect(
    ids(cars, {
      maxPrice: "NaN",
      mileage: "-1",
      seats: "not known",
      sort: "invalid" as StockFilters["sort"],
    }),
  ).toEqual(cars.map((item) => item.id));
  expect(applyStockFilters(cars, filter({ page: 99 })).total).toBe(cars.length);
});
