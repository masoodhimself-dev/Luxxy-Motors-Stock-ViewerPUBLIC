import { describe, expect, it } from "vitest";
import { buyerInformation } from "./buyer-information";
import { orderVehiclePhotos, photoGroup } from "./vehicle-photography";
import type { Car } from "./stock-context";

describe("buyer information preserves the source of a claim", () => {
  it("does not invent history, condition, keys or warranty for incomplete stock", () => {
    expect(
      buyerInformation({
        specifications: null,
        sourceExtras: null,
      } as Car).every((item) => item.value === null),
    ).toBe(true);
  });
  it("reads supplied fields, preserves zero keys and ignores unsupported objects", () => {
    const result = buyerInformation({
      serviceHistory: "Partial history",
      specifications: {
        numberOfKeys: 0,
        motExpiry: "2027-02-10",
        warranty: { assumed: true },
        includedItems: ["V5C", "Handbook"],
      },
    } as unknown as Car);
    expect(result.map((item) => item.value)).toEqual([
      "Partial history",
      "2027-02-10",
      "0 keys",
      null,
      null,
      null,
      "V5C · Handbook",
    ]);
  });
});
describe("vehicle photography", () => {
  it("keeps the chosen hero first and groups other supplied captions without dropping images", () => {
    const input = [
      { url: "wheel", caption: "Alloy wheel" },
      { url: "cabin", caption: "Interior Front" },
      { url: "side", caption: "Side Left" },
      { url: "hero", caption: "Front Right" },
      { url: "unknown", caption: null },
    ];
    expect(
      orderVehiclePhotos(input, "hero").map((image) =>
        typeof image === "string" ? image : image.url,
      ),
    ).toEqual(["hero", "side", "cabin", "wheel", "unknown"]);
    expect(photoGroup(input[1])).toBe("Interior");
    expect(input[0].url).toBe("wheel");
  });
  it("deduplicates photographs without requiring captions", () => {
    expect(orderVehiclePhotos(["a", "a", "b"], "c")).toEqual(["c", "a", "b"]);
  });
});
