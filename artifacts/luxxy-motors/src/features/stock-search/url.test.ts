import { expect, it } from "vitest";
import type { Car } from "@/lib/stock-context";
import {
  createStockFilters,
  parseStockFilters,
  serializeStockFilters,
  splitStockFacetValues,
  updateStockFilters,
} from "./url";

const stock = [
  { make: "Toyota", model: "Corolla" },
  { make: "Toyota", model: "Yaris" },
  { make: "Honda", model: "Jazz" },
  { make: "Toyota", model: "Shared" },
  { make: "Honda", model: "Shared" },
] as Car[];

it("creates independent empty filters and omits every default from the URL", () => {
  const first = createStockFilters(),
    second = createStockFilters();
  expect(first).not.toBe(second);
  expect(serializeStockFilters(first).toString()).toBe("");
  expect(parseStockFilters(new URLSearchParams())).toEqual(first);
  first.make = "Toyota";
  expect(second.make).toBe("");
});

it("round-trips every supported filter with canonical names and stable parameter order", () => {
  const filters = {
    ...createStockFilters(),
    make: "Toyota,Honda",
    model: "Corolla,Jazz",
    minPrice: "5000",
    maxPrice: "30000",
    fuel: "Petrol,Diesel",
    transmission: "Automatic",
    bodyType: "Coupé,SUV",
    colour: "Blue,Red",
    engine: "2.0,1.5",
    seats: "5,7",
    mileage: "100000",
    search: "blue Toyota",
    ulez: true,
    sort: "year-asc" as const,
    page: 2,
  };
  const query = serializeStockFilters(filters);
  expect([...query.keys()]).toEqual([
    "make",
    "model",
    "minPrice",
    "maxPrice",
    "fuel",
    "transmission",
    "bodyType",
    "colour",
    "engine",
    "seats",
    "mileage",
    "search",
    "ulez",
    "sort",
    "page",
  ]);
  expect(parseStockFilters(query)).toEqual(filters);
  expect(serializeStockFilters(parseStockFilters(query)).toString()).toBe(
    query.toString(),
  );
});

it("accepts new reference aliases without changing existing shared-link contracts", () => {
  const filters = parseStockFilters(
    new URLSearchParams("make=Toyota&body=SUV&gearbox=automatic&q=blue+toyota"),
  );
  expect(filters).toMatchObject({
    make: "Toyota",
    bodyType: "SUV",
    transmission: "automatic",
    search: "blue toyota",
  });
  const query = serializeStockFilters(filters);
  expect(query.get("bodyType")).toBe("SUV");
  expect(query.get("transmission")).toBe("automatic");
  expect(query.get("search")).toBe("blue toyota");
  for (const alias of ["body", "gearbox", "q"])
    expect(query.has(alias)).toBe(false);
  expect(
    parseStockFilters(
      new URLSearchParams(
        "bodyType=Estate&body=SUV&search=&q=hidden&transmission=Manual&gearbox=automatic",
      ),
    ),
  ).toMatchObject({ bodyType: "Estate", search: "", transmission: "Manual" });
});

it("deduplicates CSV and repeated facets case-insensitively while preserving supplied labels", () => {
  expect(
    splitStockFacetValues(" Toyota, Honda,toyota, ,HONDA, Coupé,coupe "),
  ).toEqual(["Toyota", "Honda", "Coupé"]);
  expect(
    parseStockFilters(
      new URLSearchParams(
        "make=Toyota,Honda&make=toyota&model=Jazz&model=Corolla",
      ),
    ).make,
  ).toBe("Toyota,Honda");
});

it("normalises numeric engine/seat groups and preserves a genuine zero-mileage limit", () => {
  const filters = parseStockFilters(
    new URLSearchParams("engine=1998cc,2L,1.5L&seats=05,5,7&mileage=0&page=01"),
  );
  expect(filters).toMatchObject({
    engine: "2.0,1.5",
    seats: "5,7",
    mileage: "0",
    page: 1,
  });
  expect(serializeStockFilters(filters).toString()).toBe(
    "engine=2.0%2C1.5&seats=5%2C7&mileage=0",
  );
});

it.each(["-1", "NaN", "Infinity", "1e8", "10000001", "10.123"])(
  "ignores an invalid price bound %s",
  (value) => {
    expect(
      parseStockFilters(new URLSearchParams({ maxPrice: value })).maxPrice,
    ).toBe("");
  },
);
it.each(["-1", "1.5", "Infinity", "100001", "0"])(
  "ignores an invalid batch page %s",
  (page) => {
    expect(parseStockFilters(new URLSearchParams({ page })).page).toBe(1);
  },
);

it("drops unsupported hidden filters and invalid sort/numeric fields instead of retaining invisible state", () => {
  const result = parseStockFilters(
    new URLSearchParams(
      "sort=secret&engine=garbage&seats=0,101,NaN&mileage=-1&monthly=100&catS=true&lowMileage=true",
    ),
  );
  expect(result).toEqual(createStockFilters());
  expect(serializeStockFilters(result).toString()).toBe("");
  expect(
    parseStockFilters(new URLSearchParams({ search: "x".repeat(500) })).search,
  ).toHaveLength(200);
  expect(
    splitStockFacetValues(
      Array.from({ length: 100 }, (_, index) => `Make ${index}`).join(","),
    ),
  ).toHaveLength(50);
});

it("resolves an invalid linked price range and honours the most recently edited budget control", () => {
  expect(
    parseStockFilters(new URLSearchParams("minPrice=20000&maxPrice=10000")),
  ).toMatchObject({ minPrice: "", maxPrice: "10000" });
  const first = updateStockFilters(
    { ...createStockFilters(), maxPrice: "10000" },
    { minPrice: "20000" },
  );
  expect(first).toMatchObject({ minPrice: "20000", maxPrice: "" });
  expect(updateStockFilters(first, { maxPrice: "5000" })).toMatchObject({
    minPrice: "",
    maxPrice: "5000",
  });
});

it("resets revealed batches for a filter/sort change but permits a page-only Show more update", () => {
  const filters = { ...createStockFilters(), page: 3 };
  expect(updateStockFilters(filters, { colour: "Blue" }).page).toBe(1);
  expect(updateStockFilters(filters, { sort: "price-desc" }).page).toBe(1);
  expect(updateStockFilters(filters, { page: 4 }).page).toBe(4);
  expect(updateStockFilters(filters, { colour: "Blue", page: 4 }).page).toBe(1);
  expect(updateStockFilters(filters, { make: "" }).page).toBe(3);
});

it("removes only incompatible models when a make is unticked and keeps models shared by another selected make", () => {
  const filters = {
    ...createStockFilters(),
    make: "Toyota,Honda",
    model: "Corolla,Jazz,Shared",
    colour: "Blue",
  };
  const next = updateStockFilters(filters, { make: "honda" }, stock);
  expect(next).toMatchObject({
    make: "honda",
    model: "Jazz,Shared",
    colour: "Blue",
  });
  expect(filters.model).toBe("Corolla,Jazz,Shared");
  expect(updateStockFilters(next, { make: "" }, stock).model).toBe("");
});

it("does not erase a selected model just because inventory is missing, unavailable or has not loaded", () => {
  const filters = {
    ...createStockFilters(),
    make: "Toyota",
    model: "Rare model",
  };
  expect(updateStockFilters(filters, { make: "Honda" }, []).model).toBe(
    "Rare model",
  );
  expect(updateStockFilters(filters, { make: "Honda" }).model).toBe(
    "Rare model",
  );
  expect(updateStockFilters(filters, { make: "toyota" }, stock).model).toBe(
    "Rare model",
  );
});

it("keeps spaces while editing search, while canonical URLs omit empty searches", () => {
  const filters = updateStockFilters(createStockFilters(), { search: "blue " });
  expect(filters.search).toBe("blue ");
  expect(serializeStockFilters(filters).get("search")).toBe("blue");
  expect(
    serializeStockFilters({ ...filters, search: "  " }).has("search"),
  ).toBe(false);
});
