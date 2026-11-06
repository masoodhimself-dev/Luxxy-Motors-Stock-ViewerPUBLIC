import { describe, expect, it } from "vitest";
import type { CarImage } from "./stock-context";
import {
  getPhotoShortcuts,
  orderVehiclePhotos,
  photoGroup,
} from "./vehicle-photography";

const photo = (url: string, caption: string | null = null): CarImage => ({
  url,
  caption,
});
const urls = (images: CarImage[]) =>
  images.map((image) => (typeof image === "string" ? image : image.url));

describe("caption-based photo groups", () => {
  it.each([
    ["Steering wheel", "Interior"],
    ["Rear seats", "Interior"],
    ["Front passenger seat", "Interior"],
    ["Dashboard", "Interior"],
    ["Interior front", "Interior"],
    ["Boot space", "Interior"],
    ["Rear-view camera", "Details"],
    ["Reversing camera screen", "Details"],
    ["Alloy wheel", "Details"],
    ["Front right tyre", "Details"],
    ["Service book", "Details"],
    ["Rear exterior", "Exterior"],
    ["Front passenger side", "Exterior"],
    ["Rear alloy scuff", "Condition"],
    ["Seat wear", "Condition"],
    ["Paint damage", "Condition"],
    ["Condition photo", "Condition"],
    ["Image 12", "Other"],
    ["BMW 320d", "Other"],
    ["New arrival", "Other"],
    ["Seat Driver", "Interior"],
    ["Seats Rear", "Interior"],
    ["Seat Front Passenger", "Interior"],
    ["Driver Instruments", "Interior"],
    ["Misc Controls", "Interior"],
    ["Infotainment System", "Details"],
    ["Wing Mirror", "Exterior"],
    ["Second row", "Interior"],
    ["Cracked headlight", "Condition"],
  ])("classifies %s from its supplied caption", (caption, expected) => {
    expect(photoGroup(photo("image", caption))).toBe(expected);
  });

  it("never infers a category from a URL or a missing caption", () => {
    expect(photoGroup("/photos/rear-seats.jpg")).toBe("Other");
    expect(photoGroup(photo("/photos/boot.jpg"))).toBe("Other");
  });
});

describe("photo ordering", () => {
  it("keeps the hero, then shows labelled interior variety before the remaining supplied sequence", () => {
    const input = [
      photo("side", "Side left"),
      photo("unknown-a"),
      photo("rear", "Rear exterior"),
      photo("boot", "Boot space"),
      photo("hero", "Front right"),
      photo("rear-seats", "Rear seats"),
      photo("dash", "Dashboard"),
      photo("front-seats", "Front seats"),
      photo("unknown-b"),
      photo("seat-wear", "Rear seat wear"),
      photo("second-dash", "Dashboard"),
    ];
    expect(urls(orderVehiclePhotos(input, "hero"))).toEqual([
      "hero",
      "dash",
      "front-seats",
      "rear-seats",
      "boot",
      "side",
      "unknown-a",
      "rear",
      "unknown-b",
      "seat-wear",
      "second-dash",
    ]);
    expect(urls(input)).toEqual([
      "side",
      "unknown-a",
      "rear",
      "boot",
      "hero",
      "rear-seats",
      "dash",
      "front-seats",
      "unknown-b",
      "seat-wear",
      "second-dash",
    ]);
  });

  it("preserves unlabelled source order and the first image when no hero is supplied", () => {
    expect(orderVehiclePhotos(["first", "second", "third"])).toEqual([
      "first",
      "second",
      "third",
    ]);
    expect(orderVehiclePhotos(["first", "second", "third"], "third")).toEqual([
      "third",
      "first",
      "second",
    ]);
    expect(
      urls(
        orderVehiclePhotos([
          photo("cover", "Rear seats"),
          photo("dash", "Dashboard"),
          "last",
        ]),
      ),
    ).toEqual(["cover", "dash", "last"]);
  });

  it("deduplicates URLs, retains useful supplied captions and can add an external hero", () => {
    const labelled = photo("rear", "Rear seats");
    const result = orderVehiclePhotos(
      ["rear", labelled, photo("", "Dashboard"), "last", "last"],
      "hero",
    );
    expect(result).toEqual(["hero", labelled, "last"]);
    expect(orderVehiclePhotos([])).toEqual([]);
    expect(orderVehiclePhotos([], "hero")).toEqual(["hero"]);
  });

  it("does not promote damage shots as early interior views", () => {
    expect(
      urls(
        orderVehiclePhotos(
          [
            "hero",
            "side",
            photo("wear", "Front seat wear"),
            photo("dash", "Dashboard"),
          ],
          "hero",
        ),
      ),
    ).toEqual(["hero", "dash", "side", "wear"]);
  });

  it("uses specific imported labels with reversed word order without mistaking generic interior for dashboard", () => {
    const input = [
      "hero",
      photo("generic", "Interior Front"),
      photo("rear", "Seats Rear"),
      photo("driver", "Seat Driver"),
      photo("instruments", "Driver Instruments"),
      photo("passenger", "Seat Front Passenger"),
    ];
    expect(urls(orderVehiclePhotos(input, "hero"))).toEqual([
      "hero",
      "instruments",
      "driver",
      "rear",
      "generic",
      "passenger",
    ]);
    expect(getPhotoShortcuts(input)).toEqual([
      { label: "Rear seats", index: 2 },
    ]);
  });
});

describe("photo shortcuts", () => {
  it("points to actual indices in the provided gallery, with at most one shortcut per subject", () => {
    const images = [
      "hero",
      photo("camera", "Rear-view camera screen"),
      photo("boot", "Boot space"),
      photo("rear", "Rear seats"),
      photo("rear2", "Rear seats"),
      photo("boot2", "Boot space"),
    ];
    expect(getPhotoShortcuts(images)).toEqual([
      { label: "Boot space", index: 2 },
      { label: "Rear seats", index: 3 },
      { label: "Parking camera", index: 1 },
    ]);
  });

  it("does not invent shortcuts for unknown photos, exterior angles, damage or absent equipment", () => {
    expect(
      getPhotoShortcuts([
        "/boot.jpg",
        photo("unknown"),
        photo("rear", "Rear exterior"),
        photo("lid", "Boot lid"),
        photo("badge", "Boot badge"),
        photo("seat", "Rear seat stain"),
        photo("absent", "No rear camera"),
        photo("broken", "Parking camera not working"),
      ]),
    ).toEqual([]);
  });

  it("accepts precise alternative caption labels", () => {
    expect(
      getPhotoShortcuts([
        photo("cargo", "Cargo area"),
        photo("row", "Second row seats"),
        photo("camera", "360 camera"),
      ]),
    ).toEqual([
      { label: "Boot space", index: 0 },
      { label: "Rear seats", index: 1 },
      { label: "Parking camera", index: 2 },
    ]);
  });
});
