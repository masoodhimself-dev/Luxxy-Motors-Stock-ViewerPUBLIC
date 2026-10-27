import test from "node:test";
import assert from "node:assert/strict";
import {
  publishedDescription,
  retainedOriginals,
  descriptionDisclosures,
} from "./lib/published-vehicle-description";
test("published copy retains original descriptions and every important disclosure without an AI generation path", () => {
  const car = {
    websiteDescription: "Staff approved wording.",
    writeOffCategory: "S",
    rawSourceData: {
      description: "Original advert. Air conditioning does not work.",
      features: [
        ...Array.from({ length: 101 }, (_, i) => "Feature " + i),
        "Navigation not working.",
      ],
      sourceExtras: { serviceHistory: "Part service history" },
    },
    auditMetadata: {},
  };
  const output = publishedDescription("Staff approved wording.", car);
  assert.match(output, /Air conditioning does not work/);
  assert.match(output, /Navigation not working/);
  assert.match(output, /Recorded write-off category: S/);
  assert.match(output, /Recorded service history: Part service history/);
  assert.ok(
    retainedOriginals(car).some((text) => text.includes("Original advert.")),
  );
  assert.ok(descriptionDisclosures(car).every((text) => output.includes(text)));
  assert.doesNotMatch(output, /certified|passed safety|roadworthy/i);
});
test("previous published body stays readable and disclosure wording is not repeated unnecessarily", () => {
  const car = {
    rawSourceData: { description: "Category N. Scratch on rear bumper." },
    websiteDescription: "A retained published description.",
    auditMetadata: {},
  };
  const body = "Category N. Scratch on rear bumper.";
  assert.equal(publishedDescription(body, car), body);
});
