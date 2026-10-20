# Staff-reviewed vehicle descriptions

Implemented on `codex/vehicle-ai-descriptions`. No database migration. No deployment or live vehicle writes are part of the implementation check.

## Staff workflow

Cars → open car → Write description → Generate AI description → review/edit → Save draft or confirm review and Publish description. Restore original advert restores the website description that existed before this workflow (or the imported advert if there was no override).

- Generating and saving a draft never publishes.
- The original imported payload is not changed. Original descriptions, including an existing website override, are retained in `vehicles.audit_metadata.vehicleDescription`.
- Published copy uses existing `vehicles.website_description`; normal imports preserve this field and merge, rather than replace, audit metadata.
- The public projection exposes reviewed copy consistently through specifications and sourceExtras, with original advert information available below it.
- History/damage/fault disclosures detected in the original text and recorded write-off category are appended server-side even when absent from the staff text. Full originals are also kept and exposed. Pattern matching is not an exhaustive legal classifier: staff must review the complete original and recorded facts before publishing.
- Source changes invalidate an outstanding draft. Staff must reload, review and save a new draft before publication.
- Version hashes and row locks prevent one editor overwriting a newer change. A request ID prevents an identical immediate generation retry from making another provider call.
- Provider input is a bounded allowlist of public vehicle facts and up to 100 equipment strings. No enquiry/customer records are sent to OpenAI. Up to 8,000 characters of the original public advert and bounded protected disclosure notes are included as untrusted source material. Structured facts and adverse disclosures take precedence over unsupported advert assurances. Output is plain text, capped at 4,000 characters, with no tools, storage, redirects or automatic retries. Model matches the existing economical reply integration.
- Each dealer is limited to 30 generation admissions per UTC day, with a one-minute per-car cooldown and a two-minute pending-request recovery window. Failed requests count. Limits are durable in the existing metadata, admitted under a per-dealer database advisory lock. A completed suggestion is not requested on page views.
- Sales-manage permission and same-dealership write-origin checks apply. Cross-dealer lookups return 404.

## Configuration

`OPENAI_API_KEY` remains server-only. A dealer must be listed in `AI_VEHICLE_DESCRIPTIONS_DEALER_IDS` (comma-separated IDs). When absent, the existing `AI_DRAFTS_DEALER_IDS` allowlist is reused. An explicitly empty description allowlist disables everyone. `AI_VEHICLE_DESCRIPTIONS_ENABLED=false` disables generation while keeping manual editing and saved descriptions available. Otherwise the configured and allowlisted dealer can generate. This does not enable AI email/enquiry drafts or change their platform default.

The live provider call has not been exercised by the local test run; it uses a stub provider. Check one explicitly requested draft after deployment before wider rollout.

## API

All routes use the dealer's existing staff session, `sales.manage`, and no-store responses.

| Method | Path                                           | Purpose                                                                                                    |
| ------ | ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| GET    | `/api/staff/vehicle-descriptions/:id`          | Version, published copy, saved draft, complete originals, protected notes, facts and AI availability       |
| POST   | `/api/staff/vehicle-descriptions/:id/generate` | `{expectedVersion, requestId}`; generate a saved draft without publishing                                  |
| PUT    | `/api/staff/vehicle-descriptions/:id`          | `save-draft` with version/text; `publish` with version/text and `reviewed:true`; or `restore` with version |

## Verification and example

- `pnpm --filter @workspace/api-server test:vehicle-descriptions`
- `NODE_OPTIONS=--no-experimental-webstorage pnpm exec vitest run src/components/portal/vehicle-description-editor.test.tsx src/components/portal/staff-inventory.test.tsx src/pages/car-detail.test.tsx src/lib/vehicle-content.test.ts` (frontend directory)
- `pnpm typecheck`
- `pnpm exec playwright test --config playwright.descriptions.config.ts` (frontend directory)

The opt-in local preview uses `PORT=4196 VEHICLE_DESCRIPTION_PREVIEW=true pnpm --filter @workspace/luxxy-motors dev:preview`, then `/portal?section=inventory`. It contains a clearly labelled, pre-written Ford Focus example from archived stock, with memory-only draft/publish/restore. It makes no OpenAI call and does not alter a real website. Other inventory preview mutations remain refused by the preview backend. Production never imports this fixture.

Browser screenshots are in `output/vehicle-ai-descriptions-2026-10-20/` for 390, 820, 1024 and 1440px widths. These checks use Chrome viewports, not physical Safari/iOS or Android devices.

## Original advert, running costs and disclosure layout (local update 20 October 2026)

- The AI now combines original advert wording with recorded facts/equipment, highlighting practical benefits and recorded mileage. It cannot invent road-test impressions, certification, inspection results or accident-free claims. Existing advert assertions are not independent inspection evidence.
- A recorded, unambiguous MPG figure can be used, labelled as reported fuel economy with actual consumption varying. Unknown or conflicting figures are omitted.
- Description options provide `inline` or `separate` history placement. There is no hidden/tiny-print option. The separate block is visible, labelled and readable, not inside a collapsed disclosure.
- Both placements retain full protected notes in the API description, specification description and sales-document input. The public vehicle page can lay the narrative and notes out separately using the published body and published disclosure metadata.
- Staff can record the confirmed full annual vehicle-tax rate (including supplements) and its GOV.UK source, confirming that they checked it today. This is staff attestation, not an automated DVLA rate lookup. The server calculates an indicative monthly Direct Debit payment including the current 5% surcharge, with penny rounding. £195/year gives approximately £17.06/month. Actual DVLA instalments can differ. Zero annual tax does not imply a monthly Direct Debit payment is needed.
- Tax figures are shown as a separate exact server-rendered cost note; the AI must not invent or calculate money amounts. Verification expires after 30 days. The currently checked DD rule also expires at 1 April 2027; review current guidance before extending this bound. Expired notes are omitted from the public view until the rate is checked again.
- Saving context/options is draft-only. Publishing snapshots the context, so changing a draft tax figure or layout does not silently change an already published advert. Context changes invalidate an existing generated draft; regenerate or review/save it before publishing.
- `PUT /api/staff/vehicle-descriptions/:id` also accepts `{action:'save-context',expectedVersion,context:{placement,annualTaxGbp,confirmedCurrentRate,sourceUrl}}`. A null annual rate removes the draft tax record. All original tenant, role, origin and concurrency checks remain.

References checked: [monthly Direct Debit surcharge](https://www.gov.uk/vehicle-tax-direct-debit/setting-up), [clear and prominent history disclosure](https://www.businesscompanion.info/focus/car-traders-and-consumer-law/part-1-digital-markets-competition-and-consumers-act), [MOT and continuing roadworthiness](https://www.gov.uk/government/publications/making-changes-to-a-vehicle-and-registering-kit-built-kit-converted-and-reconstructed-classic-vehicles-inf318/making-changes-to-a-vehicle-and-registering-kit-built-kit-converted-and-reconstructed-classic-vehicles-inf318).

Verification: 13 backend tests, 60 relevant frontend tests, and four Chrome viewport walkthroughs (390, 820, 1024, 1440px) pass. Typechecking passes. The live MG draft was not regenerated, published, or modified during this update. The revised provider prompt has been tested with stub responses, not a new live OpenAI request.
