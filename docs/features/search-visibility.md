# Dealer search visibility

This release adds crawl/indexing foundations and owner guidance. It does not implement full public-page body server rendering; that work remains a separate integration. The existing React body, APIs, stock publication rules, bookings and sales are preserved.

## Public crawl routes

- `/robots.txt` uses the verified dealer's canonical live origin. Public pages are allowed, with private API and staff/customer areas excluded. Public `/api/website-assets/` images and retained `/api/demo-logo` images are explicitly allowed.
- `/sitemap.xml` includes the homepage, stock, contact, enabled warranty page and the current public vehicle IDs. It uses the same dealer, marketplace and visibility rules as the stock API.
- Demos do not expose a public sitemap and retain their noindex protection. Expired demos retain the existing expiry response.
- Vehicle `lastmod` is deliberately omitted: existing stock timestamps can change when an unchanged import is checked. Settings-backed pages use the persisted publication timestamp when valid.
- Private portal, platform, sign-in and customer capability pages receive noindex headers. These are indexing controls, not authentication controls.

## Metadata and structured data

The production frontend handler writes route-specific titles, descriptions, canonical URLs, sharing metadata and JSON-LD into the HTML head. The rewrite is limited to the head and preserves the body for the separate server-rendering work.

Structured data uses public fields only: AutoDealer, Car/Offer and BreadcrumbList. It omits unsupported location/hours, private notes, credentials, VINs and aggregate review ratings. Reserved cars are not advertised as immediately available. Unknown or unavailable cars receive a real HTTP 404 and noindex. Browser navigation removes stale vehicle JSON-LD and keeps the configured canonical origin.

Generic page metadata no longer claims appointment viewings or nationwide delivery regardless of the dealer's settings. Dealer-authored page wording is preserved.

## Owner interface

Open Settings → Advanced → Search visibility. The read-only `/api/staff/search-visibility` endpoint requires `settings.publish`, uses published settings and reports field completeness. Sample addresses, unknown hours and incomplete/conflicting weekly schedules do not pass. This does not verify the factual accuracy of the dealer's information.

Search Console ownership, Bing indexing, Google Business Profile ownership and firewall access are explicitly unconfirmed. A failed refresh hides previous success results. The local preview is labelled as sample data and does not advertise production sitemap endpoints.

## Optional manual IndexNow

IndexNow is disabled by default. No stock import, settings save or background job submits anything automatically.

The operator can later configure `INDEXNOW_ENABLED=true` and an independent `INDEXNOW_SECRET` containing 32 random bytes encoded as 64 hexadecimal characters or canonical base64. Do not reuse an OpenAI, Resend, stock import or integrations-encryption credential. No secret values were created or configured in this change.

When enabled on a verified live dealer domain:

- The server derives a dealer/domain-bound public verification key and serves its UTF8 key file at `/<key>.txt`.
- `GET /api/staff/search-visibility/indexnow` reports preparation status to an authorised owner.
- `POST /api/staff/search-visibility/indexnow` requires owner permission, normal origin checks and exactly `{ "confirmed": true }`.
- The server sends only its current public sitemap URLs to the fixed official endpoint, with a five-second timeout, redirects refused and a 500-URL limit.
- The interface requires explicit confirmation before submitting. A provider acceptance is not proof of indexing. This does not submit URLs to Google.
- A five-minute per-process cooldown is a bounded local guard, not a durable cross-instance quota. Automatic change/deletion notifications and durable submission history are not implemented.

No real IndexNow submission occurred during development or testing. Tests inject a fake provider transport.

## Live checks still required

After deploying the reviewed code and completing body rendering:

1. Verify each live domain in Google Search Console and Bing Webmaster Tools, then submit that domain's sitemap.
2. Inspect raw HTML and Google's rendered page for a homepage, stock page and vehicle. Confirm correct dealer, current price, disclosures, canonical URL and public images.
3. Confirm live Cloudflare/firewall rules allow intended search crawlers. Robots rules alone do not establish this.
4. Verify the dealer's Google Business Profile and correct its address, opening hours and website link.
5. Measure search visits and resulting enquiries. No ranking, indexing or AI citation is guaranteed.

Official guidance: [Google JavaScript SEO](https://developers.google.com/search/docs/crawling-indexing/javascript/javascript-seo-basics), [Google AI search](https://developers.google.com/search/docs/appearance/ai-features), [OpenAI crawlers](https://developers.openai.com/api/docs/bots), [IndexNow protocol](https://www.indexnow.org/documentation).
