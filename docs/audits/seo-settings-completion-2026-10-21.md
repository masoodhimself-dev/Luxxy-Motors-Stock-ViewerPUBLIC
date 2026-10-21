# SEO and settings completion — 21 October 2026

Scope approved: remaining SEO foundations and unfinished settings/customer-experience work. Marketplace incoming-email processing is on hold. Full public body server rendering is being handled separately and was not implemented here. All changes remain local on `codex/seo-settings-completion`; no merge, push, deployment or production data edit was performed.

## Completed

- Dealer-scoped dynamic robots and sitemaps, correct canonical live domains and explicit exclusions for demos/private areas.
- Route-aware raw HTML head metadata, accurate dealer/car/offer/breadcrumb JSON-LD and actual404 responses for unavailable vehicles.
- Browser navigation retains the chosen canonical domain, removes stale structured data and keeps unavailable/error vehicle pages noindex.
- Removed unsupported generic appointment/delivery claims from search descriptions.
- Owner Search visibility view with published-field checks, seven-day hours completeness and honest unconfirmed external-account status. Failed refreshes hide stale success results.
- Optional manual IndexNow module, disabled by default; no automatic import hooks or external submissions.
- Direct header/footer/logo/favicon/homepage/team-photo uploads with server-side raster decoding, size/dimension/concurrency limits, metadata removal, quotas, tenant isolation and safe retry replay.
- Uploads update only the existing shared website draft. Publication remains an explicit normal settings action. Existing hosted URLs remain usable.

The previous settings/customer simplification commit 9668abf was already complete locally. This work finishes its acknowledged general website-image upload dependency. Private service-book upload rules and stock photography are unchanged. New proposal features such as customer lead parsing, vehicle profit ledgers and after-sales cases were not silently added.

## Verification

- Final full frontend suite: **1667 tests, 160 files passed**. An earlier parallel run had four 5-second timeouts; the complete repeat passed with normal timeouts unchanged.
- Production workspace build and all TypeScript checks passed.
- Backend isolated checks: **19 website asset tests**, **12 crawl/IndexNow tests**, **10 public-page metadata tests**, **9 readiness/tenant/permission tests**. Disposable PGlite databases, fictional dealers and loopback HTTP only; external transports were mocked.
- Image tests exercise real PNG/JPEG/WebP decoding, transparency, metadata removal, input/output size limits, malformed images, pixel bounds, decoder concurrency, owner/origin checks, two dealers, concurrent duplicate requests, quotas, immutable bytes/ETag/HEAD and unchanged stock/published settings.
- Search tests exercise dealer/host spoofing, actual visibility exclusions, demo protection, private indexing controls, price freshness, malicious HTML/JSON escaping, canonical URLs, current stock filtering and unavailable-page statuses.
- Browser layouts inspected at 320, 390, 820 and 1440 CSS pixels for Search visibility, Brand and Photos & visits. Existing image-link disclosure remains usable. No real customer message, enquiry, booking, sale or live setting was submitted.

## Deployment and external limits

- Website asset storage needs additive migration 0047. It has been tested in disposable databases but not run against production.
- The local fixture preview displays controls but cannot persist authenticated image uploads; its refusal leaves the draft image unchanged. Real upload behaviour is covered by the isolated authenticated API tests.
- Google/Bing ownership/index coverage, Business Profile verification, Cloudflare access and physical iPhone/iPad/Android behaviour remain unverified. Browser viewport checks are not physical-device checks.
- IndexNow is manual-only and disabled. Automatic changed/deleted URL jobs and durable provider submission history remain unimplemented.
- Existing eight unrelated modified email/stock files and unrelated untracked work are excluded from this change.

See [search visibility](../features/search-visibility.md) and [website image uploads](../features/website-image-uploads.md) for interfaces and rollout details.
