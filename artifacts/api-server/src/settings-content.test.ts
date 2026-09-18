import assert from "node:assert/strict";
import { test } from "node:test";
import {
  UpdateDealerSettingsBody,
  GetDealerSettingsResponse,
} from "@workspace/api-zod";
import { preservePresentation } from "./lib/settings-content";

const service = {
  enabled: false,
  title: "Service",
  description: "Ask for details",
  ctaLabel: "Enquire",
};
const legacy = {
  identity: {
    name: "Example Motors",
    logoText: "",
    logoAsset: "",
    brandColors: { primaryHsl: "170 15% 14%", accentHsl: "31 45% 35%" },
  },
  contact: { phone: "", email: "", whatsapp: "" },
  address: { street: "", city: "", region: "", postcode: "", mapsUrl: "" },
  hours: [],
  legal: {
    companyName: "",
    companyNumber: "",
    vatNumber: "",
    termsUrl: "",
    privacyUrl: "",
    cookieUrl: "",
  },
  social: { instagram: "", facebook: "", twitter: "" },
  hero: {
    announcement: "",
    copy: "Cars",
    subcopy: "Browse stock",
    primaryCta: "Stock",
    secondaryCta: "Find a car",
  },
  featuredVehicleIds: [],
  warranty: service,
  delivery: service,
  partExchange: service,
  bookViewing: {
    title: "Visit",
    description: "Arrange a visit",
    ctaLabel: "Book",
  },
  recentHandovers: { enabled: false, count: 3 },
  trustItems: [],
  whyBuy: [],
};

test("existing settings records need no migration or new fields", () => {
  assert.equal(GetDealerSettingsResponse.parse(legacy).presentation, undefined);
});
test("onboarding content survives JSON storage and response validation", () => {
  const presentation = {
    parkingInstructions: "Customer parking beside reception.",
    reviewsUrl: "https://example.com/reviews",
    showroomImageUrl: "https://example.com/showroom.jpg",
    showroomImageAlt: "The forecourt",
  };
  const parsed = UpdateDealerSettingsBody.parse({ ...legacy, presentation });
  assert.deepEqual(
    GetDealerSettingsResponse.parse(JSON.parse(JSON.stringify(parsed)))
      .presentation,
    presentation,
  );
});
test("legacy updates and partial new updates preserve unrelated onboarding content", () => {
  const previous = {
    presentation: {
      parkingInstructions: "Parking",
      reviewsUrl: "https://example.com/reviews",
    },
  };
  assert.deepEqual(
    preservePresentation(UpdateDealerSettingsBody.parse(legacy), previous)
      .presentation,
    previous.presentation,
  );
  assert.deepEqual(
    preservePresentation(
      UpdateDealerSettingsBody.parse({
        ...legacy,
        presentation: { parkingInstructions: "" },
      }),
      previous,
    ).presentation,
    { parkingInstructions: "", reviewsUrl: previous.presentation.reviewsUrl },
  );
});
test("new link and image fields reject executable and non-HTTPS URLs", () => {
  for (const value of [
    "javascript:alert(1)",
    "data:text/html,unsafe",
    "http://example.com",
    "https://example.com/bad path",
  ]) {
    assert.equal(
      UpdateDealerSettingsBody.safeParse({
        ...legacy,
        presentation: { reviewsUrl: value },
      }).success,
      false,
    );
  }
});
