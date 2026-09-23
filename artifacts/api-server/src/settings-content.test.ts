import assert from "node:assert/strict";
import { test } from "node:test";
import {
  UpdateDealerSettingsBody,
  GetDealerSettingsResponse,
} from "@workspace/api-zod";
import { preserveOnlineReservation, preservePresentation, reservationSettingsError } from "./lib/settings-content";

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
  assert.equal(GetDealerSettingsResponse.parse(legacy).onlineReservation, undefined);
});

test("old settings clients retain reservation settings while an explicit switch-off is honoured", () => {
  const onlineReservation = { enabled: true, depositPence: 25000, terms: "Contact us to discuss your reservation." };
  const previous = { onlineReservation };
  assert.deepEqual(preserveOnlineReservation(UpdateDealerSettingsBody.parse(legacy), previous).onlineReservation, onlineReservation);
  const disabled = { ...onlineReservation, enabled: false };
  assert.deepEqual(preserveOnlineReservation(UpdateDealerSettingsBody.parse({ ...legacy, onlineReservation: disabled }), previous).onlineReservation, disabled);
});

test("reservation settings require integer pence within bounds and terms before enabling", () => {
  for (const depositPence of [0, 99, 100.5, 1000001]) {
    assert.equal(UpdateDealerSettingsBody.safeParse({ ...legacy, onlineReservation: { enabled: false, depositPence, terms: "" } }).success, false);
  }
  assert.equal(reservationSettingsError({ enabled: false, depositPence: 10000, terms: "" }), null);
  assert.match(reservationSettingsError({ enabled: true, depositPence: 10000, terms: " \n " }) ?? "", /reservation terms/);
  assert.equal(reservationSettingsError({ enabled: true, depositPence: 10000, terms: "Terms supplied by the dealership." }), null);
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
