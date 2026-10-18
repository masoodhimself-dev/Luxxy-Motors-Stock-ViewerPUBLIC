import { expect, it } from "vitest";
import { isFrontPhoto, plateEntryPhotos } from "./plate-entry-photo";

it("puts an exact front view before front corners while keeping other photos available for manual review", () => {
  const photos = plateEntryPhotos([
    { url: "/rear.jpg", caption: "Rear" },
    { url: "/front-left.jpg", caption: "Front Left" },
    { url: "/front-seat.jpg", caption: "Front seats" },
    { url: "/front.jpg", caption: "Front" },
    { url: "/front-right.jpg", caption: "Front Right" },
    { url: "/dashboard.jpg", caption: "Interior dashboard" },
  ]);
  expect(photos.map(photo => photo.url)).toEqual(["/front.jpg", "/front-left.jpg", "/front-right.jpg", "/rear.jpg", "/front-seat.jpg", "/dashboard.jpg"]);
});

it.each(["Front", "Front view", "Exterior Front", "Front-on", "Head on", "Front Left", "Front_Right"])("recognises %s as a useful front exterior photo", caption => {
  expect(isFrontPhoto({ url: "/car.jpg", caption })).toBe(true);
});

it.each(["Front seats", "Front left wheel", "Front tyre", "Front interior", "Driver dashboard", "Front grille", "Passenger seat", "Rear", null])("does not mistake %s for a front exterior view", caption => {
  expect(isFrontPhoto({ url: "/car.jpg", caption })).toBe(false);
});

it("keeps a fallback/manual photo once and accepts either supported stock image shape", () => {
  expect(plateEntryPhotos(["https://images.example.test/a.jpg", { url: "/b.jpg", caption: "Rear" }, { url: "/b.jpg", caption: "Rear duplicate" }], "https://images.example.test/a.jpg")).toEqual([
    { url: "https://images.example.test/a.jpg", caption: null },
    { url: "/b.jpg", caption: "Rear" },
  ]);
  expect(plateEntryPhotos(null, "/fallback.jpg")).toEqual([{ url: "/fallback.jpg", caption: null }]);
});

it("rejects unsupported and malformed image URLs instead of rendering them as links or images", () => {
  const invalid = [null, 22, {}, { url: 22 }, "", "javascript:alert(1)", "data:image/png;base64,abc", "//untrusted.example.test/car.jpg", "file:///tmp/car.jpg", "https://", "https://images.example.test/\ncar.jpg", "https://user:secret@images.example.test/car.jpg", "/\\evil.example.test/car.jpg"];
  expect(plateEntryPhotos([...invalid, { url: "/valid.jpg", caption: "Front" }])).toEqual([{ url: "/valid.jpg", caption: "Front" }]);
});
