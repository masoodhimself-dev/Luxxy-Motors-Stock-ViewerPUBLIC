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
- Provider input is a bounded allowlist of public vehicle facts and up to 100 equipment strings. No enquiry/customer records or original free-text advert are sent to OpenAI. Output is plain text, capped at 4,000 characters, with no tools, storage, redirects or automatic retries. Model matches the existing economical reply integration.
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
