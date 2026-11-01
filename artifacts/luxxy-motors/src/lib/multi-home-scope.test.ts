import { expect, it } from "vitest";
import {
  isMultiChoiceHomepage,
  isMultiChoiceWebsite,
} from "./multi-home-scope";
const page = (current: string, canonical?: string) =>
  ({
    location: { origin: current },
    querySelector: () => (canonical ? { content: canonical } : null),
  }) as unknown as Pick<Document, "location" | "querySelector">;
it.each([
  "https://multichoicemotors.co.uk",
  "https://www.multichoicemotors.co.uk",
])("recognises only the resolved Multi-Choice homepage: %s", (origin) => {
  expect(
    isMultiChoiceHomepage("/", page("http://localhost:4294", origin)),
  ).toBe(true);
  expect(isMultiChoiceWebsite(page("http://localhost:4294", origin))).toBe(
    true,
  );
  for (const route of [
    "/stock",
    "/vehicle/car",
    "/portal",
    "/contact",
    "/saved",
    "/enquire",
    "/warranty",
  ])
    expect(isMultiChoiceHomepage(route, page(origin, origin))).toBe(false);
});
it.each([
  "https://shoredrive.uk",
  "https://luxxymotors.uk",
  "https://multichoicemotors.co.uk.evil.test",
  "https://other.multichoicemotors.co.uk",
  "http://multichoicemotors.co.uk",
  "https://multichoicemotors.co.uk:8443",
])("does not apply a dealer-name or similar-host guess to %s", (origin) => {
  expect(isMultiChoiceHomepage("/", page(origin))).toBe(false);
  expect(isMultiChoiceWebsite(page(origin))).toBe(false);
});
it("resolves website-wide branding without widening the homepage layout to another route", () => {
  const resolved = page(
    "http://localhost:4294",
    "https://multichoicemotors.co.uk",
  );
  expect(isMultiChoiceWebsite(resolved)).toBe(true);
  expect(isMultiChoiceHomepage("/stock", resolved)).toBe(false);
  expect(isMultiChoiceHomepage("/vehicle/example", resolved)).toBe(false);
  expect(
    isMultiChoiceWebsite(
      page("http://localhost:4294", "https://shoredrive.uk"),
    ),
  ).toBe(false);
});
it("uses the tenant verified canonical origin in local preview and rejects another dealership", () => {
  expect(
    isMultiChoiceHomepage(
      "/",
      page("http://localhost:4294", "https://multichoicemotors.co.uk"),
    ),
  ).toBe(true);
  expect(
    isMultiChoiceHomepage(
      "/",
      page("http://localhost:4294", "https://shoredrive.uk"),
    ),
  ).toBe(false);
});
