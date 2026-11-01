import { readFileSync } from "node:fs";
import { render } from "@testing-library/react";
import { expect, it } from "vitest";
import { MultiBodyShape } from "./multi-body-shape";

const supplied = [
  ["Hatchback", "hatchback"],
  ["SUV", "suv"],
  ["Estate", "estate"],
  ["Saloon", "saloon"],
  ["Coupé", "coupe"],
  ["Convertible", "convertible"],
  ["MPV", "mpv"],
  ["4x4", "4x4"],
] as const;

it.each(supplied)(
  "uses the supplied %s silhouette as a decorative image",
  (type, asset) => {
    const { container } = render(<MultiBodyShape type={type} />);
    const image = container.querySelector("img")!;
    expect(image).toHaveAttribute(
      "src",
      `/brand/multi-choice-motors/body-types/bodytype-${asset}.svg`,
    );
    expect(image).toHaveAttribute("alt", "");
    expect(image).toHaveAttribute("aria-hidden", "true");
    expect(image).toHaveAttribute("width", "88");
    expect(image).toHaveAttribute("height", "36");
    expect(image).toHaveStyle({ objectFit: "contain" });
  },
);

it.each([
  ["  COUPÉ  ", "coupe"],
  ["coupe", "coupe"],
  ["4×4", "4x4"],
  ["4 x 4", "4x4"],
  ["4WD", "4x4"],
  ["Sedan", "saloon"],
  ["Station wagon", "estate"],
  ["People carrier", "mpv"],
  ["Cabriolet", "convertible"],
  ["Convertable", "convertible"],
])(
  "maps the explicit %s body-type alias without confusing SUV and 4x4",
  (type, asset) => {
    const { container } = render(<MultiBodyShape type={type} />);
    expect(container.querySelector("img")).toHaveAttribute(
      "src",
      `/brand/multi-choice-motors/body-types/bodytype-${asset}.svg`,
    );
  },
);

it.each([
  "Pickup",
  "Pick-up",
  "Van",
  "Unknown",
  "",
  "SUV pickup",
  "custom body type",
  "constructor",
])(
  "uses a generic outline for %j rather than guessing a hatchback silhouette",
  (type) => {
    const { container } = render(<MultiBodyShape type={type} />);
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("svg")).toHaveClass("lucide-car");
    expect(container.querySelector("svg")).toHaveAttribute(
      "aria-hidden",
      "true",
    );
    expect(container.querySelector("svg")).toHaveAttribute(
      "focusable",
      "false",
    );
  },
);

it.each(supplied)("ships a valid, passive local SVG for %s", (_type, asset) => {
  const source = readFileSync(
    `${process.cwd()}/public/brand/multi-choice-motors/body-types/bodytype-${asset}.svg`,
    "utf8",
  );
  const document = new DOMParser().parseFromString(source, "image/svg+xml");
  expect(document.querySelector("parsererror")).toBeNull();
  expect(document.documentElement.tagName).toBe("svg");
  expect(document.documentElement.hasAttribute("viewBox")).toBe(true);
  expect(document.querySelectorAll("path").length).toBeGreaterThan(0);
  for (const element of document.querySelectorAll("*")) {
    expect(["svg", "path"]).toContain(element.tagName);
    for (const attribute of element.getAttributeNames()) {
      expect(attribute).not.toMatch(/^on|href|style/i);
    }
  }
  expect(source).not.toMatch(/(?:javascript:|url\s*\(|\bnan\b|\binfinity\b)/i);
});
