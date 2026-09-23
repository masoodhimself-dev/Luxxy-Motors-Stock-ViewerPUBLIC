# Dealership onboarding and customisation blueprint

Repository audit: 23 September 2026, based on `f41ac18` on `codex/luxxy-premium-ui-redesign`.

This is the proposed product and implementation specification. It does not claim that the new onboarding, shared tenancy, uploads or operational configuration have been implemented. No application code, hosting, production database or authentication has been changed for this audit.

## Recommended product model

Maintain one application codebase and deploy it separately for each dealership initially. Each deployment has its own domain, database, staff access configuration, integration credentials and dealer identifier. Customisation belongs in versioned settings, not a fork of the React application for every customer. Maintain an inventory of deployed software versions so improvements can be rolled out consistently.

Luxxy Motors becomes one example profile. A new dealership starts from neutral copy and empty business details. It must never inherit Luxxy's telephone, WhatsApp, legal identity, customer records or illustrative showroom photographs by accident.

A shared SaaS deployment is a separate architectural milestone. The current system selects a dealership through the deployment-level `STOCK_DEALER_ID`; staff membership and first-account setup are not safely scoped for unrelated dealers sharing one deployment. A dealer dropdown alone would not provide isolation. The separate-versus-shared operating model is the outstanding decision presented to the user.

UK dealerships are the initial scope. Retain GBP/UK terminology and the current date/time assumptions until internationalisation is designed and tested explicitly.

## The onboarding experience

Provide a guided **Set up your dealership** flow and a persistent **Website settings** editor backed by the same field definitions. Do not maintain two different forms or settings models. Owners should be able to revisit any step without restarting.

Desktop: narrow step navigation, focused editor, and a switchable desktop/mobile preview. Mobile: one step at a time, clear Back/Continue controls, and a separate preview view. Avoid a giant form with every field visible at once.

| Step | Dealer supplies or chooses | Result |
| --- | --- | --- |
| 1. Business profile | Trading name, legal name, company/VAT identifiers if applicable, town, description, showroom or appointment-based operation | One consistent business identity throughout the product |
| 2. Brand and style | Logo variants, text fallback, favicon, primary/accent colours, approved typography/style preset | Branded website and portal with validated contrast and consistent controls |
| 3. Contact and visiting | Phone, WhatsApp, public email, address, postcode, map link, displayed opening hours, appointments, entrance, parking and access instructions | Contact page, footer, visit section and enquiry contact routes |
| 4. Photos | Hero, showroom, exterior, forecourt, reception, team and social-sharing images, alternative text and crop focus | Each placement can be changed independently |
| 5. Website pages | Homepage introduction, section headings, page introductions, CTA wording, featured stock order and relevant page visibility | A bespoke customer experience using the shared page layouts |
| 6. Services and warranty | Offered services, service descriptions, delivery information, part-exchange instructions, genuine warranty provider/policy details and FAQs | Accurate dealership-specific service pages without invented claims |
| 7. Trust and company information | Team introduction, reasons to buy, genuine review links, social profiles, legal/privacy/cookie links | Credible supporting content and consistent legal identity |
| 8. Customer journeys | Enquiry guidance, handover/preparation information, support contacts, finder presentation and confirmed operational setup status | Consistent wording across vehicle, enquiry and customer screens |
| 9. Preview and readiness | Review each key page, sample-content checks, required-field checks, integration test results and change summary | Deliberate publication of a reviewed profile |

Integrations, staff access, domains and actual booking rules appear in a separate **Operational setup** area. They are not ordinary public website content and should not be exposed in the public settings response.

Every field should explain where it appears. Each optional feature should explain what happens when left blank or disabled. Completion means required information is ready, not that every optional field has been filled.

## What can be bespoke

### Brand and layout

- Dealer name, logo, light/dark logo treatment, favicon, colour palette and social-share image.
- A small set of typography and visual-style presets; restrained choices for corners, density and hero layout.
- Shared responsive behaviour and spacing rules remain intact. Validate colour contrast rather than accepting an unreadable brand combination.
- Do not offer arbitrary CSS, JavaScript or HTML through marketing settings.

### Pages and navigation

- Homepage: headline, supporting copy, CTA labels, hero image, featured stock, introduction heading/body, why-buy points, trust statements, services heading, visit copy and handover visibility.
- Contact: title, introduction, response guidance, contact methods, visit paragraph, address/hours, directions, parking/access instructions, exterior and reception photos.
- Warranty: title/introduction, provider, policy link, vehicle eligibility wording, term summary, inclusions/exclusions summary, upgrade information, FAQs and claims/aftercare contact. Blank information stays unconfirmed; selecting a vehicle never asserts coverage.
- Vehicle pages: dealer-wide preparation/handover information, viewing reassurance, support wording and action labels. Price, mileage, MOT, keys, condition and actual vehicle coverage come from stock records.
- Finder: introduction, supported budget bands and help wording. Changes to bands must be validated against the actual matching logic; do not merely change displayed labels.
- Part exchange: page introduction, photo instructions and available contact routes. Existing registration/condition/keys/V5C fields and submission semantics remain consistent.
- Enquiry/viewing screens: dealer-aware headings, explanatory copy and confirmation/contact wording. Visible promises must match actual backend behaviour.
- Staff/customer screens: business identity and support treatment. Signed document terms and sales-state transitions do not become editable marketing copy.
- Navigation: supported page visibility and labels. Clearly distinguish hiding a marketing link from turning off an operational capability.
- Metadata: default title/description, page-derived dealer names, sharing image and verified website URL.

### Photography

Use separate named slots rather than reusing a single showroom image for unrelated pages. Each slot should support URL/asset selection, descriptive alternative text, preview and optional focal position. Start with the existing HTTPS image-URL capability; direct uploads require a real media-storage implementation, size/type limits and asset lifecycle management.

Store an explicit sample-content status. Do not decide whether to show demo photography solely by comparing the dealer name with “Luxxy Motors”. Templates can demonstrate composition, but illustrative people, premises or stock must not become factual business claims.

### Operational settings, handled separately

| Area | Desired setup | Current boundary |
| --- | --- | --- |
| Booking | Real appointment days/hours, slot length, lead time, closed dates, capacity and timezone | Current availability is fixed; changing displayed hours does not alter it |
| Notifications | Verified sender, private enquiry recipient, sending status and a controlled test | Current Resend integration uses Replit connector/environment configuration |
| Stock | Dealer source, authenticated import, credentials, last successful import and validation | Tokens and import safeguards are private deployment settings |
| Staff | Authorised staff membership and configuration/publishing permissions | Current staff access is single-dealership, not shared-tenancy membership |
| Domain | Verified domain, canonical website URL and certificate status | Deployment provisioning, not a text field that claims to activate a domain |
| Documents | Branded vehicle brochure and correct business identity on new customer documents | Brochure uses contact identity; sales documents need a separate reviewed milestone |

API keys, database URLs, mail credentials, import tokens, private notification recipients and staff permissions must never be placed in the publicly readable dealer settings object.

## Current implementation: reuse and gaps

The existing `DealerSettingsPanel` already edits identity, colours, contact/address, hours, homepage copy, featured vehicles, services, trust points, legal/social links and basic photographs. Reuse its controls and server-side staff protection.

The profile is JSONB in `dealer_settings.config`. Additive optional public-content fields can be added without a SQL migration, through the OpenAPI schema followed by generated client/Zod models. Older clients must preserve omitted optional groups; explicit clearing should remain possible.

Current gaps that must be resolved:

1. Frontend fallback configuration includes Luxxy's real telephone and WhatsApp. A new dealer or failed settings load needs neutral/unavailable fallbacks.
2. Finder metadata, the viewing eyebrow, some staff-access text and base HTML metadata still contain fixed Luxxy references.
3. Photography only has hero/showroom/team settings; exterior, forecourt and reception cannot yet be independently configured.
4. Several page headings, instructions and warranty FAQs are fixed in components.
5. The current draft lasts 24 hours in a browser tab. There is no server-saved draft, reviewable revision history or rollback.
6. “Publish showroom” immediately updates the live profile. The preview link shows the published site, not the edited draft.
7. Current completeness checks only six non-empty values. Sample content can look complete without being ready for a real business.
8. Displayed opening hours are separate from actual booking availability. Current booking rules are Monday–Saturday, 10:00–18:00, 30-minute slots, a 30-day horizon and Europe/London.
9. Service flags primarily control marketing visibility; they do not reliably disable every direct enquiry path.
10. Contact page map validation is more complete than the homepage/footer handling. All location surfaces should share validation.

Internal CSS class names containing `luxxy` are not customer branding and do not require a risky cosmetic mass rename. Visible content, destinations, metadata, documents and actual data isolation take priority.

## Drafts, preview and publishing

Recommended lifecycle: **Unpublished draft → preview → review → published revision**.

- Autosave drafts privately with a visible saved/error state. Keep a local recovery copy when appropriate; distinguish device-local recovery from server persistence.
- Public visitors continue seeing the last published revision while someone edits.
- Preview the actual customer components with draft settings in an authenticated preview context. Do not publish a draft just to inspect it.
- Preview enquiries, bookings and document actions must not send real messages or create customer records.
- Show a change summary before publication and a separate explanation of missing/optional information.
- Prevent stale editors silently overwriting newer settings through revision checks.
- Keep revision history and allow restoration of an earlier public-content revision. Restoring branding must not rewrite existing signed documents or customer records.
- Publication is a website-content operation. It does not deploy software, move hosting or claim operational integrations are configured.

Persistent drafts/history need additional private storage/API work. Prepare additive schema changes if necessary, and run them only in a disposable local/test database during development. Do not apply migrations to production as part of this onboarding work.

## Readiness checks

Separate three statuses: **Ready**, **Needs attention**, **Optional**. Do not call a filled field “verified” without an actual verification step.

- Required: business identity, at least one usable contact route, coherent site copy and the information required by enabled pages.
- Location: real address and a safe map link where public visiting is offered; alternative appointment instructions when an address is intentionally not public.
- Media: valid image source and alternative text; no inherited dealer logo or unmarked demo imagery.
- Content: detect obvious sample/example placeholders, mismatched business names, broken links and unsupported promises.
- Warranty: display only supplied provider/policy information. A generic enquiry-only warranty page can remain valid without invented terms.
- Integrations: report actual connection/test status, not “complete” because a credential field is non-empty.
- Optional: team photo, review URL, social links, featured-stock selection and other nonessential content.
- Authorised business review remains distinct from technical checks. The application cannot verify factual claims merely by checking a box.

## Implementation milestones

### 1. Guided public-content onboarding

Extract the existing form into reusable sections; add a stepper, focused navigation, progress/readiness and a review step. Extend the typed public-content model for independent images and supported page copy. Remove visible Luxxy leakage, introduce explicit demo mode and preserve existing settings compatibility. Wire every new control to an actual customer-facing placement.

### 2. Draft preview and controlled publishing

Add persistent private drafts, real draft previews, revision conflict handling, publication history and content rollback. Strengthen URL/contact/colour/media validation on both client and server. Use local/test storage only while implementing.

### 3. Operational setup

Make booking rules genuinely configurable end to end, configure notification/import connections privately, expose reliable setup status and test the resulting behaviour. Changes here need their own focused validation and must not alter existing production settings automatically.

### 4. Repeatable dealer provisioning

Create a repeatable isolated-deployment procedure, neutral profile initialisation, environment/secret configuration, domain checks and release tracking. No hosting migration or production deployment is implied by this specification.

### 5. Shared SaaS, if selected

Design tenant/domain resolution, tenant-scoped authorisation and staff membership, scoped queries and background jobs, asset/secret isolation and cross-tenant security tests before allowing unrelated dealers to share a runtime/database. This replaces, rather than merely renames, the existing single-dealership assumptions.

## Acceptance criteria

1. Set up two fictional dealers with distinct names, colours, contact methods, photos and service settings without editing application code.
2. Review homepage, stock, vehicle, contact, warranty, finder, enquiry and staff entry screens for each. No unintended Luxxy text, imagery, links or contacts appear.
3. A draft is recoverable and does not change the public site. Preview shows the draft accurately. Publication changes only the chosen dealer's public profile.
4. Disabled pages and unavailable settings have truthful states; visible availability and operational behaviour are not contradictory.
5. Existing saved cars, comparisons, enquiries, bookings, stock imports, brochures and customer journeys retain their contracts and behaviour.
6. Keyboard access, screen-reader labels, contrast, validation errors and 320–1536px layouts are checked with long dealer names and copy.
7. Server validation, settings round trips, older-client preservation, preview isolation and failed-save recovery have meaningful tests.
8. Private integration data never appears in public responses or browser bundles.
9. For any shared-platform milestone, explicit tests prove one dealer cannot read or modify another dealer's data.

## Main source references

- `artifacts/luxxy-motors/src/components/dealer-settings-panel.tsx`
- `artifacts/luxxy-motors/src/lib/settings-draft.ts`
- `artifacts/luxxy-motors/src/lib/dealer-settings-context.tsx`
- `artifacts/luxxy-motors/src/lib/dealership-photography.ts`
- `artifacts/luxxy-motors/src/pages/{home,contact,warranty,enquire,find-my-car,portal,staff-access}.tsx`
- `artifacts/api-server/src/routes/dealer-settings.ts`
- `artifacts/api-server/src/lib/settings-content.ts`
- `artifacts/api-server/src/lib/booking-slots.ts`
- `lib/api-spec/openapi.yaml`
- `lib/db/src/schema/dealer-settings.ts`
