# Vehicle details PDF — 18 September 2026

Vehicle detail pages now offer **View vehicle PDF** and **Download** beneath the comparison controls. The view link opens a separate tab, retaining the customer's place in the showroom. Both links have descriptive accessible names, visible keyboard focus and 44px minimum height.

The A4 PDF contains the current public vehicle name, variant, price, key facts, full specification, supplied description/features, insurance category, buyer information, showroom contact details and a link back to the vehicle. A large complete-frame cover photograph is followed by the remaining photographs, six per page with their supplied captions. Missing information and failed photographs are explicitly labelled. No history, warranty or condition claims are invented. Local preview documents are marked as archived/sample information on every page.

## Read-only endpoint

`GET /api/vehicles/:id/brochure.pdf`

- Success: `200 application/pdf`, with `Content-Disposition: inline` and a safe vehicle-based filename. The separate HTML download link saves the same bytes.
- Invalid identifier: `400`; unavailable/hidden vehicle: `404`; temporary failure or concurrency limit: `503` (busy responses include `Retry-After: 10`). Error bodies are short plain-text messages with no internal error details.
- Uses the existing public stock projection and visibility predicate for the configured `STOCK_DEALER_ID`, including Auto Trader and Grok imports. The new read-only lookup has no source restriction, matching `/stock`. Existing single-vehicle and sharing endpoints retain their original behaviour.
- Reads only public stock and the dealer's name, telephone, email and address. It deliberately avoids the settings getter that creates default records. No schema, migration, authentication, sales or import behaviour is changed.
- A small five-minute in-memory cache is keyed by vehicle content, dealership details and URL. Current visibility is checked before every cache lookup; content changes create a new key. The cache holds at most four PDFs / 32MB. Responses use `Cache-Control: no-store`.
- The browser navigates directly to this binary endpoint; existing generated JSON API clients and contracts remain unchanged. This document describes the additional binary contract.

## Photograph loading and bounds

The server embeds photographs because the current stock CDN does not permit browser canvas/fetch access. [jsPDF](https://github.com/parallax/jsPDF) 4.2.1 is a server dependency; it is not added to the customer JavaScript bundle. Its transitive `core-js` installation script is explicitly disabled.

Default approved HTTPS hosts are `m.atcdn.co.uk` and `images.autotrader.co.uk`. A business with another trusted stock-image CDN can set `VEHICLE_PDF_IMAGE_HOSTS` to comma-separated **exact hostnames**, for example `images.dealer.example,cdn.dealer.example`. Wildcards, arbitrary caller-provided image URLs, credentials, redirects, IP literals and private/reserved DNS addresses are rejected. The validated DNS address is pinned for the HTTPS connection while retaining hostname certificate validation.

Generation is limited to two concurrent requests, four concurrent image fetches, an 18-second image deadline, 2MB per photograph, 24MB combined input, 8192px maximum dimension / 20 million pixels, and 80 photographs per PDF. JPEG and PNG are supported. Failed, oversized, blocked or unsupported photographs receive labelled placeholders; the document discloses when the gallery is capped. The latest full gallery remains on the vehicle page.

## Validation and evidence

- **129 frontend tests passed**, including the correct view/download URLs and accessible labels.
- **Nine brochure tests passed:** supplied/missing data, zero values, deduplication, long descriptions and pagination, insurance history, safe filenames, image URL/DNS/dimension checks, visibility before cache reuse, updated prices, friendly errors and bounded concurrency.
- **Four settings compatibility tests and two database-safety tests passed.** No production or local database was contacted for these checks.
- Full browser suite: **56 passed, two opt-in whole-site screenshot captures skipped**. The three PDF browser checks were repeated after the final download refinement and all passed. They exercise keyboard opening, PDF response/filename, 58 embedded images, actual downloading, 390px/1440px layout and unavailable vehicles.
- **Workspace typechecking and all workspace production builds passed**, repeated after the final code change. Existing tooltip sourcemap diagnostics and the approximately 528KB main-chunk advisory remain.
- Rendered and reviewed every page of the Jeep sample PDF; 13 pages, 58 embedded photographs, approximately 7MB. Checked readable text, pound signs, specifications, image proportions, captions, page breaks and footers. Fresh [desktop/mobile screenshots and PDF page renders](screenshots/vehicle-pdf/) accompany this report.

Commands used from the workspace root:

```sh
NODE_OPTIONS=--no-experimental-webstorage pnpm --filter @workspace/luxxy-motors test
pnpm --filter @workspace/api-server run test:brochure
pnpm --filter @workspace/api-server run test:settings
pnpm --filter @workspace/api-server run test:safety
LUXXY_LOCAL_PREVIEW=1 pnpm --filter @workspace/luxxy-motors test:mobile-layout --workers=2
LUXXY_LOCAL_PREVIEW=1 CAPTURE_VEHICLE_PDF=1 pnpm --filter @workspace/luxxy-motors test:mobile-layout tests/vehicle-pdf.spec.ts --workers=1
PORT=4175 BASE_PATH=/ NODE_ENV=production pnpm run build
```

The local environment used `npm_config_store_dir="$PWD/.local/pnpm-store"` and the installed Google Chrome executable for Playwright. Rendered samples are generated under ignored `output/pdf/`; intermediate images are under ignored `tmp/pdfs/`.

## Remaining limits

Codex's embedded browser did not display its native PDF viewer during manual review. The separate Download action is provided for browsers without a working inline PDF viewer; actual downloads passed the Chrome tests. Physical iOS/Android devices have not been checked. The document has selectable text but is not a tagged PDF/UA document, and standard PDF fonts are intended for the English/Western European stock content used here.

Database integration suites were not run: there is no prepared disposable local database, and no migrations were run. The new SQL read path still needs a staging/disposable-database integration check before a separately approved release. Local preview exercises the same PDF generator with archived records and never imports the database module. No production database, Replit deployment, merge, push or deployment was touched.
