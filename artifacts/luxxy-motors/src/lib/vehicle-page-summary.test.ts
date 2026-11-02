import { describe, expect, it } from "vitest";
import type { Car } from "./stock-context";
import {
  vehiclePageInclusions,
  vehiclePageSummary,
} from "./vehicle-page-summary";

const car = (data: Partial<Car> = {}) =>
  ({ id: "lexus-a", make: "Lexus", model: "IS", ...data }) as Car;

describe("compact, supplied vehicle facts", () => {
  it("uses the description's one owner, 12 Lexus services and two keys ahead of structured alternatives", () => {
    expect(
      vehiclePageSummary(
        car({
          description:
            "Only one owner from new. Full service history (12 Lexus services). Two remote keys.",
          owners: 4,
          numberOfKeys: 1,
          serviceHistory: "Partial service history",
        }),
      ),
    ).toEqual([
      { id: "owners", text: "1 owner from new" },
      { id: "service", text: "12 Lexus services" },
      { id: "keys", text: "2 keys" },
    ]);
  });

  it("keeps previous owners and previous keepers distinct from total owners", () => {
    expect(
      vehiclePageSummary(car({ description: "One previous keeper." })),
    ).toEqual([{ id: "owners", text: "1 previous keeper" }]);
    expect(
      vehiclePageSummary(car({ description: "Two previous owners." })),
    ).toEqual([{ id: "owners", text: "2 previous owners" }]);
    expect(
      vehiclePageSummary(car({ description: "One owner from new." })),
    ).toEqual([{ id: "owners", text: "1 owner from new" }]);
  });

  it("falls back to supplied structured records without converting previous keepers into total owners", () => {
    expect(
      vehiclePageSummary(
        car({
          owners: 1,
          numberOfKeys: 2,
          serviceHistory: "Full service history",
        }),
      ),
    ).toEqual([
      { id: "owners", text: "1 recorded owner" },
      { id: "service", text: "Full service history" },
      { id: "keys", text: "2 keys" },
    ]);
    expect(
      vehiclePageSummary(
        car({
          sourceExtras: {
            historyExtras: {
              ownersData: { label: "Previous keepers", value: 2 },
            },
          },
        }),
      ),
    ).toEqual([{ id: "owners", text: "2 previous keepers" }]);
  });

  it("understands a named manufacturer in an explicit full history claim", () => {
    expect(
      vehiclePageSummary(
        car({ description: "Full Lexus service history (12 Lexus services)." }),
      ),
    ).toEqual([{ id: "service", text: "12 Lexus services" }]);
  });

  it("does not attribute another manufacturer's service count to the vehicle make", () => {
    expect(
      vehiclePageSummary(
        car({ description: "Full service history (12 Toyota services)." }),
      ),
    ).toEqual([{ id: "service", text: "Full service history" }]);
  });

  it("does not turn stamps, mileage, years or an uncounted history into a service count", () => {
    expect(
      vehiclePageSummary(
        car({
          description:
            "Full service history with six stamps. Last serviced at 82,000 miles in 2026.",
        }),
      ),
    ).toEqual([{ id: "service", text: "Full service history" }]);
    expect(
      vehiclePageSummary(
        car({
          description:
            "Recently serviced. Twelve years old. Two previous keepers.",
        }),
      ),
    ).toEqual([{ id: "owners", text: "2 previous keepers" }]);
  });

  it.each([
    "No service history is available. No keys supplied. Ownership is unknown.",
    "Full service history is unconfirmed. Two keys may be available. One owner from new is unverified.",
    "Full service history. It is incomplete.",
    "Full service history cannot be verified.",
    "Full service history is uncertain.",
    "Full service history is disputed.",
    "Full service history? Two keys? One owner from new?",
  ])(
    "does not promote qualified, negative or unknown statements: %s",
    (description) => {
      expect(vehiclePageSummary(car({ description }))).toEqual([]);
    },
  );

  it.each([
    "One owner from new. Three previous keepers.",
    "Two keys are included. One key is supplied.",
    "Full service history (12 Lexus services). Full service history (8 Lexus services).",
  ])(
    "does not choose a positive count from contradictory same-source claims: %s",
    (description) => {
      expect(vehiclePageSummary(car({ description }))).toEqual([]);
    },
  );

  it("does not fall back to structured positive facts when the description explicitly qualifies them", () => {
    expect(
      vehiclePageSummary(
        car({
          description:
            "Service history is unknown. One key is missing. The previous owner count is unconfirmed.",
          owners: 1,
          numberOfKeys: 2,
          serviceHistory: "Full service history",
        }),
      ),
    ).toEqual([]);
  });

  it("never fills missing facts or copies them between cars", () => {
    vehiclePageSummary(
      car({
        description: "One owner from new. Full service history. Two keys.",
      }),
    );
    expect(
      vehiclePageSummary(car({ id: "another-car", make: "Ford" })),
    ).toEqual([]);
    expect(
      vehiclePageSummary(
        car({
          numberOfKeys: "Unknown",
          owners: null,
          serviceHistory: "Not supplied",
        }),
      ),
    ).toEqual([]);
  });

  it.each([
    { ownersData: { value: 'One owner from new is unverified' } },
    { serviceHistory: { description: 'Full service history? It is unconfirmed.' } },
    { historyItems: [{ key: 'KEYS', value: 'Two keys?' }] },
    { historyItems: [{ key: 'KEYS', value: 'Two keys. One key is supplied.' }] },
  ])('checks the original structured history before shortening it: %j', historyExtras => {
    expect(vehiclePageSummary(car({ sourceExtras: { historyExtras } }))).toEqual([]);
  });
});

describe("explicit vehicle inclusions", () => {
  it("keeps an explicit warranty duration and supplied included items", () => {
    expect(
      vehiclePageInclusions(
        car({
          description: "6 months warranty included.",
          includedItems: ["Two keys", "Owner handbook"],
        }),
      ),
    ).toEqual(["6-month warranty included", "Two keys · Owner handbook"]);
  });

  it.each([
    "Warranty available.",
    "Warranty may be available at extra cost.",
    "6 months warranty.",
    "No warranty is included.",
    "Warranty included. It costs an additional £300.",
  ])("does not invent included warranty from %s", (description) => {
    expect(vehiclePageInclusions(car({ description }))).toEqual([]);
  });

  it("does not invent warranty or extras from missing data", () => {
    expect(vehiclePageInclusions(car())).toEqual([]);
  });
});


describe("dealership-wide vehicle inclusions", () => {
  it("uses the saved dealership list for cars with different inferred warranties and extras", () => {
    const presentation = { includedItems: ["6 months warranty", "12 months roadside assistance"] };
    const source = car({ description: "3 months warranty included.", includedItems: ["Owner handbook"] });
    expect(vehiclePageInclusions(source, presentation)).toEqual(presentation.includedItems);
    expect(vehiclePageInclusions(car({ id: "another-car", make: "Ford", description: "12 months warranty included.", includedItems: ["Charging cable"] }), presentation)).toEqual(presentation.includedItems);
  });

  it("treats an explicitly empty saved list as authoritative rather than restoring inferred inclusions", () => {
    expect(vehiclePageInclusions(car({ description: "6 months warranty included.", includedItems: ["Two keys"] }), { includedItems: [] })).toEqual([]);
  });

  it("keeps the per-car fallback when the dealership has never configured an inclusion list", () => {
    const source = car({ description: "6 months warranty included.", includedItems: ["Owner handbook"] });
    expect(vehiclePageInclusions(source, {})).toEqual(vehiclePageInclusions(source));
    expect(vehiclePageInclusions(source)).toEqual(["6-month warranty included", "Owner handbook"]);
  });

  it("uses only the supplied dealership configuration and returns a new list without changing saved settings or car facts", () => {
    const first = { includedItems: Object.freeze(["6 months warranty"]) };
    const second = { includedItems: Object.freeze(["Fresh MOT"]) };
    const source = car({ description: "3 months warranty included.", includedItems: ["Two keys"] });
    const before = JSON.stringify({ source, first, second });
    const result = vehiclePageInclusions(source, first);
    result.push("Unpublished draft");
    expect(vehiclePageInclusions(source, second)).toEqual(["Fresh MOT"]);
    expect(vehiclePageInclusions(source, {})).toEqual(["3-month warranty included", "Two keys"]);
    expect(vehiclePageInclusions(source, first)).toEqual(["6 months warranty"]);
    expect(JSON.stringify({ source, first, second })).toBe(before);
  });

  it("does not promote general handover notes into the dealership inclusion list", () => {
    const presentation: { includedInformation: string; includedItems?: string[] } = { includedInformation: "Confirm the handover documents with our team." };
    expect(vehiclePageInclusions(car(), presentation)).toEqual([]);
  });
});
