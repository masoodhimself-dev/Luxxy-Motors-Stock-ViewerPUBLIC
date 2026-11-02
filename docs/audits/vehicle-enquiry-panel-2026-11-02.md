# Vehicle context beside the message form — 2 November 2026

The old inline-enquiry grid assigned the disclosure heading and form to separate
columns. The disclosure is now a normal block, with an inner grid that puts the
form on the left and vehicle information on the right from 1000px. Narrower
screens show the information below the form. The existing Montserrat type,
navy, white, pale-blue surfaces and dealership icons are retained.

The information panel mounts only while “Message the showroom” is expanded.
The form remains mounted, so collapsing it preserves the unsent message. The
phone contact strip is hidden while the form is open and returns when closed.

The panel contains the selected car's name, variant, price, registration and up
to ten supplied specification/history facts. MOT expiry comes only from a fresh
matching record whose latest test passed, or an explicit provider first-MOT
date. Stale, conflicting, expired or missing information gets a neutral request
to confirm the current MOT. No failures or advisory lists are added here.

An explicit expansion reuses the existing guarded MOT lookup only if the page
has no usable record. There is no polling or independent lookup controller.

“What's included” uses the existing dealership-wide inclusion helper, including
authoritative empty lists. Dealer claims are hidden until settings load.
Buying reasons use saved whyBuy entries, then saved trust items, then the saved
descriptions of enabled warranty, delivery and part-exchange services. A general
warranty option does not become included cover. Warranty already listed as an
inclusion is not repeated as a fallback reason. Additional saved reasons after
the first three remain available in a disclosure. The component works for all
dealerships without Multi-Choice-specific promises.

Validation:

- 154 tests passed across CarDetail, EnquiryForm, VehicleQuickChecks, the new
  component and data helper, and existing inclusion rules.
- Full workspace TypeScript checks and production build passed.
- 41 browser checks passed across 320px, 486px, 820px and 1440px: layout, no
  overflow, closed-panel absence, retained drafts, mobile strip hide/return,
  correct vehicle identity, MOT freshness/result safety, one-shot lookups,
  missing settings/data, explicit empty inclusions, extra reasons and service
  fallback precedence.
- All browser MOT responses were intercepted mocks. No customer enquiry,
  email, stock update or other data write occurred during verification.

Evidence lives in `output/vehicle-enquiry-panel-2026-11-02/` in the main user
workspace. The browser `final/` folder covers layout and edge cases; `fallback/`
shows real saved dealer settings with mocked MOT data. The displayed test MOT
date in those screenshots is fictional, not a verified stock record.

Changes are local only; this task did not push or deploy to Render.
