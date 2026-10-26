import {preserveGoogleReviewUrl} from './lib/settings-content';
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  UpdateDealerSettingsBody,
  GetDealerSettingsResponse,
} from "@workspace/api-zod";
import { preserveBrochure, preserveOnlineReservation, preservePresentation, reservationSettingsError } from "./lib/settings-content";

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

test('website templates are opt-in, validated and survive JSON settings storage', () => {
  for (const websiteTemplate of ['existing', 'classic', 'premium', 'focused']) {
    const parsed = UpdateDealerSettingsBody.parse({ ...legacy, presentation: { websiteTemplate } });
    assert.equal(GetDealerSettingsResponse.parse(JSON.parse(JSON.stringify(parsed))).presentation?.websiteTemplate, websiteTemplate);
  }
  for (const websiteTemplate of ['', 'unknown', 'Classic', true, null]) {
    assert.equal(UpdateDealerSettingsBody.safeParse({ ...legacy, presentation: { websiteTemplate } }).success, false);
  }
  assert.equal(GetDealerSettingsResponse.parse({ ...legacy, presentation: {} }).presentation?.websiteTemplate, undefined);
  assert.equal('websiteTemplate' in (preservePresentation({ presentation: {} }, legacy).presentation), false);
});

test('older settings clients keep the saved website template and explicit choices can restore the current website', () => {
  const previous = { presentation: { websiteTemplate: 'premium', heroImagePosition: 'right' } };
  for (const incoming of [legacy, { ...legacy, presentation: {} }, { ...legacy, presentation: { websiteTemplate: undefined } }]) {
    const merged = preservePresentation(UpdateDealerSettingsBody.parse(incoming), previous);
    assert.equal(GetDealerSettingsResponse.parse(merged).presentation?.websiteTemplate, 'premium');
    assert.equal(merged.presentation?.heroImagePosition, 'right');
  }
  const restored = preservePresentation(UpdateDealerSettingsBody.parse({ ...legacy, presentation: { websiteTemplate: 'existing' } }), previous);
  assert.equal(GetDealerSettingsResponse.parse(restored).presentation?.websiteTemplate, 'existing');
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


test('brochure settings accept legacy records, preserve omitted options and validate limits', () => {
  assert.equal(GetDealerSettingsResponse.parse(legacy).brochure, undefined);
  const brochure = { title: 'Your car', includeGallery: false, photoLimit: 6, accentColour: '#123456' };
  assert.deepEqual(preserveBrochure(UpdateDealerSettingsBody.parse(legacy), {brochure}).brochure, brochure);
  assert.deepEqual(preserveBrochure({brochure:{title:''}}, {brochure}).brochure, {...brochure,title:''});
  for (const photoLimit of [0, 81, 2.5]) assert.equal(UpdateDealerSettingsBody.safeParse({...legacy,brochure:{photoLimit}}).success,false);
  for (const accentColour of ['red','#fff','url(test)']) assert.equal(UpdateDealerSettingsBody.safeParse({...legacy,brochure:{accentColour}}).success,false);
  assert.equal(UpdateDealerSettingsBody.safeParse({...legacy,brochure:{title:'a'.repeat(61)}}).success,false);
  assert.deepEqual(GetDealerSettingsResponse.parse({...legacy,brochure}).brochure,brochure);
});

 test("comparison settings survive older clients and accept explicit off", () => {
  const previous = { presentation: { comparisonEnabled: true } };
  assert.deepEqual(preservePresentation({ presentation: {} }, previous).presentation, { comparisonEnabled: true });
  const disabled = preservePresentation({ ...legacy, presentation: { comparisonEnabled: false } }, previous);
  assert.equal(UpdateDealerSettingsBody.parse(disabled).presentation?.comparisonEnabled, false);
 });

test("review settings validate and survive older-client updates", () => {
  const reviews = [{ rating: 5, review: "Helpful service.", name: "J.", date: "September 2026", source: "Google" }];
  const settings = { ...legacy, presentation: { reviewsEnabled: true, reviews } };
  assert.equal(UpdateDealerSettingsBody.safeParse(settings).success, true);
  assert.equal(UpdateDealerSettingsBody.safeParse({ ...settings, presentation: { reviews: [{ ...reviews[0], rating: 6 }] } }).success, false);
  const preserved = preservePresentation({ ...legacy, presentation: {} }, settings);
  assert.deepEqual(preserved.presentation, settings.presentation);
  const cleared = preservePresentation({ ...legacy, presentation: { reviews: [] } }, settings);
  assert.deepEqual(cleared.presentation.reviews, []);
});

test('onboarding appearance and page copy round-trip without a migration', () => {
  const presentation = { footerLogoUrl: 'https://example.com/logo.svg', faviconUrl: 'https://example.com/icon.png', contactImageUrl: 'https://example.com/contact.jpg', contactImageAlt: 'Our entrance', heroImagePosition: 'right', pageColour: '#fafafa', featuredEnabled: false, websiteCopy: { stockTitle: 'Our used cars', contactTitle: 'Meet our team' } };
  const parsed = UpdateDealerSettingsBody.parse({ ...legacy, presentation });
  assert.deepEqual(GetDealerSettingsResponse.parse(parsed).presentation, presentation);
  assert.equal(UpdateDealerSettingsBody.safeParse({ ...legacy, presentation: { faviconUrl: 'javascript:alert(1)' } }).success, false);
  assert.equal(UpdateDealerSettingsBody.safeParse({ ...legacy, presentation: { pageColour: 'red;display:none' } }).success, false);
  assert.equal(UpdateDealerSettingsBody.safeParse({ ...legacy, presentation: { websiteCopy: { stockTitle: 'x'.repeat(1001) } } }).success, false);
});

test('partial page edits preserve other pages and allow explicit reset', () => {
  const previous = { presentation: { heroImagePosition: 'right', websiteCopy: { stockTitle: 'Stock', contactTitle: 'Visit' } } };
  const updated = preservePresentation({ presentation: { websiteCopy: { stockTitle: '' } } }, previous);
  assert.deepEqual(updated.presentation, { heroImagePosition: 'right', websiteCopy: { stockTitle: '', contactTitle: 'Visit' } });
});


test('vehicle-sheet website inheritance survives validation, compatibility merge and reload while retaining the custom colour', () => {
  const previous = GetDealerSettingsResponse.parse({...legacy,brochure:{accentColour:'#123456',footerNote:'Keep this note',photoLimit:6}});
  const submitted = UpdateDealerSettingsBody.parse({...previous,brochure:{...previous.brochure,useWebsiteColour:true}});
  const stored = UpdateDealerSettingsBody.parse(preserveBrochure(submitted,previous));
  const reloaded = GetDealerSettingsResponse.parse(JSON.parse(JSON.stringify(stored)));
  assert.deepEqual(reloaded.brochure,{accentColour:'#123456',useWebsiteColour:true,footerNote:'Keep this note',photoLimit:6});
  const legacyClientUpdate = UpdateDealerSettingsBody.parse({...legacy,brochure:{footerNote:'Edited by an older client'}});
  const compatible = GetDealerSettingsResponse.parse(preserveBrochure(legacyClientUpdate,reloaded));
  assert.equal(compatible.brochure?.useWebsiteColour,true);
  assert.equal(compatible.brochure?.accentColour,'#123456');
  const returnToCustom = GetDealerSettingsResponse.parse(preserveBrochure(UpdateDealerSettingsBody.parse({...compatible,brochure:{useWebsiteColour:false}}),compatible));
  assert.equal(returnToCustom.brochure?.useWebsiteColour,false);
  assert.equal(returnToCustom.brochure?.accentColour,'#123456');
  assert.equal(UpdateDealerSettingsBody.safeParse({...legacy,brochure:{useWebsiteColour:'yes'}}).success,false);
});

test('shared Google review links survive older clients but explicit empty clears them',()=>{
 const old={contact:{googleReviewUrl:'https://g.page/r/example/review'}};
 assert.equal(preserveGoogleReviewUrl({contact:{googleReviewUrl:undefined}},old).contact.googleReviewUrl,old.contact.googleReviewUrl);
 assert.equal(preserveGoogleReviewUrl({contact:{googleReviewUrl:''}},old).contact.googleReviewUrl,'');
});

test('shared review link survives the published settings schema round-trip',()=>{
 const config={...legacy,contact:{...legacy.contact,googleReviewUrl:'https://g.page/r/example/review'}};
 assert.equal(GetDealerSettingsResponse.parse(UpdateDealerSettingsBody.parse(config)).contact.googleReviewUrl,config.contact.googleReviewUrl);
});
