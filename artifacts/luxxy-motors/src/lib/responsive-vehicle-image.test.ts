import { expect, it } from "vitest";
import {
  responsiveVehicleImage,
  retryOriginalImage,
} from "./responsive-vehicle-image";
it("resizes only recognised unsigned stock URLs without upscaling", () => {
  expect(
    responsiveVehicleImage(
      "https://m.atcdn.co.uk/a/media/w1024/photo.jpg",
      "100px",
    ).srcSet,
  ).toContain("/w340/photo.jpg 340w");
  expect(
    responsiveVehicleImage("https://dealer.example/photo.jpg", "100px"),
  ).toEqual({});
  expect(
    responsiveVehicleImage(
      "https://m.atcdn.co.uk/a/media/w1024/photo.jpg?token=secret",
      "100px",
    ),
  ).toEqual({});
  expect(
    responsiveVehicleImage(
      "https://m.atcdn.co.uk/a/media/w340/photo.jpg",
      "100px",
    ).srcSet,
  ).not.toContain("600w");
});
it("retries original only once so a real failure can reach the placeholder", () => {
  const img = document.createElement("img");
  img.src = "https://example.test/original.jpg";
  img.srcset = "https://example.test/small.jpg 340w";
  expect(retryOriginalImage(img)).toBe(true);
  expect(img.src).toBe("https://example.test/original.jpg");
  expect(retryOriginalImage(img)).toBe(false);
});
