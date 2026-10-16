# Master Bot: restricted demo onboarding

This contract is for a server-side bot. It is separate from Clerk administrator access and separate from each dealer's stock-import credential. No bot receives the platform owner's Clerk session.

## Provision once in the platform dashboard

Platform → Demo dealerships → Master Bot access → Create onboarding credential.

An operator chooses a label, lifetime (default 30 days, maximum 90), maximum total demos (default 20, maximum 100), and new demos per UTC day (default 5, maximum 20). The key is stored SHA-256 hashed and shown once. Enter it into the Dealer Demo Setup Bot's secure secret card as `MASTER_BOT_DEMO_ONBOARDING_SECRET`; never chat, URLs, repository files or logs. Save and dismiss the dashboard secret. No live key has been created merely by deploying this feature.

New demos belong to the operator who issued this credential. The bot cannot choose or grant staff access. Removing that operator from the platform-admin allowlist also disables the machine credential. Expiry/revocation stops creation, status queries and replay retrieval. Rotation is a new credential plus explicit revocation of the old one; a new key does not inherit visibility of demos created by an old key.

Revocation does not revoke already issued per-dealer stock credentials. Revoke those separately in each dealership's Stock connection panel if compromise is suspected.

## Destination and authentication

Approved origin: `https://luxxy-shared-staging.onrender.com` (replace only on operator instruction).

All requests:

```http
x-demo-onboarding-secret: <runtime-injected MASTER_BOT_DEMO_ONBOARDING_SECRET>
Content-Type: application/json
```

Send over verified HTTPS to this exact approved host, refuse redirects, and do not forward the header elsewhere. This API refuses browser Origin headers and does not accept a stock secret, Clerk cookie or credentials in a URL.

Store the onboarding credential only in the Dealer Demo Setup Bot’s secure card. Demo creation does not issue or return a stock credential. The operator generates that separately in the platform dashboard and enters it into the dealer bot’s own secure card.

## Read capabilities

`GET /api/demo-onboarding/capabilities`

Returns scope, configured domain, domain/email readiness flags, expiry, quotas and supported operations. No customer data, provider keys, operator email list or live dealers. `emailVerificationKeyConfigured` reports whether a separate server-side status key is present; live permissions still need a real delivery check. If domains or email are not ready, report that and stop creation. The backend rechecks readiness during creation.

## Create (WRITE)

`POST /api/demo-onboarding/demos`

Complete fictional request:

```json
{
  "requestId": "09f247bf-8aa5-4342-b9be-a75e85745743",
  "demo": {
    "slug": "fictional-motors",
    "name": "Fictional Motors",
    "platform": "autotrader",
    "retailerId": "FICTIONAL-RETAILER",
    "sourceUrl": "https://www.autotrader.co.uk/fictional-example",
    "days": 14
  }
}
```

Replace fictional values with an explicitly approved prospect and authorised stock source. This example URL is not a working stock feed.

Contract:

- `requestId`: new UUID per genuinely new onboarding request. Preserve it and the same demo payload on retries.
- `demo.slug`: lowercase letters/numbers/hyphens, first character alphanumeric, length 2–41. Dealer ID becomes `demo-<slug>`. Do not independently invent the returned ID.
- `name`: trimmed, 1–100 characters.
- `platform`: `autotrader` or `cazoo`, exactly one.
- `retailerId`: exact marketplace retailer reference, 1–128 characters.
- `sourceUrl`: HTTPS, no URL credentials or custom port, authorised source on the chosen marketplace's www/non-www hostname.
- `days`: integer 1–90, default 14.
- `recipient`: optional; if omitted, the server chooses the first explicitly allowlisted operator test recipient. If provided, it must already be on that allowlist. The bot cannot add recipients.
- `footerLogoData`: optional separate footer PNG/JPEG data URL, with the same validation as logoData. Both encoded logos together must be under 400,000 characters, and each decoded image under 250 KB.
- `logoData`: optional PNG/JPEG base64 data URL, max 400,000 characters and decoded max 250,000 bytes. Do not send SVG or an arbitrary remote URL. The backend does not fetch remote logo URLs. Resize/compress authorised logos locally.
- `showroomAddress` and `openingHours`: optional sourced business details, following the exact contract below.
- Extra fields, including owner, status, origin, domain and live mode, are rejected.

`201` response contains exactly these fields:

```json
{"dealerId":"demo-fictional-motors","origin":"https://fictional-motors.demo.luxxyexmaplenumber2.uk","status":"created"}
```

Creation, fictional activity and the idempotency record commit in one transaction. No stock credential is generated. The operator generates it in that dealership's **Stock connection** panel and enters it into the dealer bot's secure card. The onboarding credential cannot issue/retrieve stock keys, import stock or call platform administration.

## Optional address and opening hours

Collect these from an authorised dealer/marketplace page. Use the actual showroom address, not a registered office unless confirmed to be the showroom. Do not invent missing information. These objects are optional; omit an unconfirmed address. Each supplied object must include its own HTTPS `sourceUrl` (no credentials/custom port) and actual ISO `checkedAt` with timezone. Keep the original source-check timestamp; do not relabel cached or failed checks as fresh. Future checks beyond five minutes are rejected.

Add these fields inside `demo` in the creation request. This is a **fictional example**, not Autex or Luxxy's real details:

```json
{
  "showroomAddress": {
    "street": "12 Fictional Road",
    "city": "Example Town",
    "region": "",
    "postcode": "AB1 2CD",
    "sourceUrl": "https://dealer.example.test/contact",
    "checkedAt": "2026-10-15T10:00:00Z"
  },
  "openingHours": {
    "timezone": "Europe/London",
    "sourceUrl": "https://dealer.example.test/contact",
    "checkedAt": "2026-10-15T10:00:00Z",
    "days": [
      {"day": 0, "status": "appointment_only"},
      {"day": 1, "status": "open", "open": "09:00", "close": "17:30"},
      {"day": 2, "status": "open", "open": "09:00", "close": "17:30"},
      {"day": 3, "status": "unknown"},
      {"day": 4, "status": "open", "open": "09:00", "close": "17:30"},
      {"day": 5, "status": "open", "open": "09:00", "close": "17:30"},
      {"day": 6, "status": "closed"}
    ]
  }
}
```

Address: `street` 1–160 characters, `city` 1–80, `postcode` 1–20; optional `region` up to 80 (defaults blank), optional `mapsUrl` using the same HTTPS URL restrictions. All objects reject extra fields.

Hours: `timezone` must be `Europe/London` (also the default). Supply exactly seven unique days: 0 Sunday through 6 Saturday. `open` days require 24-hour `HH:mm` open/close, with closing after opening. Other statuses accept only day/status: `closed`, `appointment_only`, `unknown`. Unconfirmed days must be `unknown`, never guessed closed. Split/overnight hours are not supported: ask the operator or leave that day unknown rather than flattening inaccurate times. Omit the hours object if no reliable information is available. Conflicting sources require operator review.

The server populates existing editable website address/hours settings. It retains initial source evidence in `businessDetails` on the own-demo status response. This is collection provenance, not a permanent verification claim. Missing/unknown/appointment-only hours never become an automatic closed claim. Test-drive booking stays disabled until booking capacity and rules are configured separately. Initial baselines include these website settings. Creation does not update existing demos; the bounded PATCH operation below allows corrections before a baseline is saved. After that, use operator settings. Reviews are not part of this contract.

## Retry

Identical requestId + demo data → `200`, `status: replayed`, the same dealerId and origin only; no credential. Quotas are checked only for a new request, not an identical retry. Changed data under the same requestId → `409`. Request IDs are scoped to the onboarding credential; do not retry a timed-out request using a different credential without operator review.

Use bounded backoff for network errors/503 and 429, honour Retry-After. Never generate another requestId just because a response timed out. Do not log authentication headers or secrets. Creation/replay responses contain only dealerId, origin and status. Historical receipts are never returned. A reused slug under a new requestId gets 409, never silently takes over an existing tenant.

## Check only your created demo

`GET /api/demo-onboarding/demos/<returned-dealerId>`

Returns dealership origin/portal URL, status, expiry, baselineSaved and latest import summary. It does not return credentials, customers, invoice/payment state or private integration settings. Demos created manually or by another onboarding key, and all live dealerships, return 404.

There is no list-all, reset, delete, extend, staff, settings, arbitrary email, payment or scheduling capability. The bounded completion operations below apply only to demos created by this same onboarding credential.

## Responses

- 200: capabilities/status or identical request replay.
- 201: new demo created.
- 400: invalid/extra fields, source/logo or recipient not allowed.
- 401: absent/invalid/revoked/expired onboarding credential, or issuing operator no longer authorised.
- 403: browser-origin request; platform administration also rejects this credential.
- 404: unsupported operation or a dealer not created by this credential.
- 409: domains/email not ready, name already used, or conflicting request ID.
- 410: replay requested for an expired demo.
- 413: request exceeds 450 KB.
- 429: quota/rate limit. Per-process request limiter is 60 requests/minute per network identity; persistent creation quotas are transactional per credential. Do not depend on the process limiter as a distributed security boundary.
- 503: transaction/temporary operation failure. Preserve requestId/payload; report if bounded retries fail.

No redirects are generated by these application routes. An intermediary can redirect; the worker must still refuse redirects with credentials.

## End-to-end demo sequence

1. Obtain operator approval for the prospect and authorised source.
2. Check capabilities/readiness; create once; retain the request ID and payload for retries.
3. Ask the operator to generate the stock credential in the dashboard and enter it into the dealer bot’s secure card. Configure the one-dealer worker with delivery OFF. Do not start a schedule.
4. Collect a complete snapshot, verify retailer/platform and deliver only with the operator's approval.
5. Verify `imported`, then identical-stock-payload `replayed`, and inspect your demo status. Public stock visibility can differ from total inventory.
6. Inspect the public site for the correct branding and imported stock. Report any mismatch and stop.
7. Prefer the queued completion operation below after the import/replay and visual checks. Alternatively, use the fixed test-email operation, bounded delivery checks and initial baseline save using the exact latest completed import runId. This initial save recreates fictional activity. Do not call the platform reset controls or replace a saved baseline. Real payments stay blocked.
8. Report prepared/configured/tested/recurring separately. No schedule is created by onboarding.

## One-time live dependencies

Wildcard DNS/HTTPS and Clerk support for `*.demo.luxxyexmaplenumber2.uk`, verified Resend sender domain, approved operator inbox and secure environment configuration. These must be actually verified before readiness flags are set. The existing apex test dealership must not be replaced.


## Automated completion (WRITE, own demo only)

The same onboarding header authenticates these routes. This is **not** the stock-import secret. Keep the onboarding key with the Demo Setup Bot; each stock key stays with its dealer bot. The bots coordinate using dealer ID and import runId, never secret values. No operation starts a schedule.

### Logo upload

For new demos, use the operator-provided header and footer logos. If none are supplied, ask before proceeding with branding. Only generate matching **demo concept** logos when explicitly requested; do not reuse marketplace banners. Keep clean typography, no small taglines, no mockups or heavy backgrounds. Check readability at the real display size. Do not claim that a concept is the dealer's existing official logo.

Include `demo.logoData` for the compact header logo and `demo.footerLogoData` for the matching footer variant in the original creation request. Suggested working canvases: header 600×160, footer 600×200, preserving proportions and leaving padding. Use a transparent PNG where appropriate; JPEG is also supported. Each decoded image must be under 250 KB and their combined encoded data URLs under 400,000 characters (the request limit remains 450 KB). The footer is served at the tenant-scoped `/api/demo-logo?variant=footer`. Keep identical bytes on retries. SVG and remote logo URLs are not accepted. Use the bounded PATCH operation below for corrections to an own demo before saving its baseline; after that, ask the operator.

### Demo collection defaults

Disable number-plate OCR for demo workers (`ocrEnabled: false`, using the worker's actual supported configuration). Continue importing plates explicitly supplied by the source. Leave unavailable plates null; do not guess. Do not alter live-dealer OCR preferences, safeguards, schedules or cache provenance. Confirm the change from the worker configuration/logs; changing backend documentation alone does not configure Grok's worker.

Demo homepages use an illustrative stock car photo when no custom hero is configured, with one quiet preview notice. Do not add repeated demo labels in the dealer name or hero text. Fictional documents and test emails retain their sample labels and delivery/payment protections.

### Fixed test email

After the approved import and identical replay:

```http
POST /api/demo-onboarding/demos/<dealerId>/test-email
Content-Type: application/json
x-demo-onboarding-secret: <secure runtime injection>

{}
```

One fixed, clearly labelled demonstration message goes to the server-stored, allowlisted recipient, from that demo's sender. The bot cannot choose the recipient, subject, body, attachment or sender. A successful complete non-empty stock import is required. Repeated calls reuse a deterministic provider idempotency key, return the saved result and never deliberately create another email. An ambiguous send can be retried for up to 23 hours from the persisted intent; after that operator review is required (409), avoiding the provider's expiring deduplication window. A changed recipient also stops automation. Never change request identity to work around a failed send.

`200 {"dealerId":"demo-fictional-motors","status":"sent","baselineSaved":false}` means accepted by Resend, **not delivered**.

```http
GET /api/demo-onboarding/demos/<dealerId>/test-email
x-demo-onboarding-secret: <secure runtime injection>
```

Returns `not-sent`, `sent`, `pending`, `delivered` or `failed`, with `checkedAt` when checked. Poll no faster than once per minute, maximum 10 checks per attempt, then report pending and stop. Status reads never resend. Delivered results are retained. Bounced/failed/complained/suppressed messages block the baseline. Temporary/read-permission errors return 503; do not respond by sending another email.

**One-time server setup:** `DEMO_RESEND_STATUS_API_KEY` must be stored securely on Render with permission to retrieve sent emails from the same Resend account. It is never sent to Grok or returned by this API. Without it the sender key is tried, but a sending-only key cannot check delivery: automation stops with an explicit 503 setup message. The capabilities field `emailVerificationKeyConfigured` reports only configuration presence, not a tested permission grant. Do not broaden the dealer stock key or give Grok the Resend key.

### Save the initial baseline once

Only after public-site checks, successful import/replay and `status: delivered`:

```http
POST /api/demo-onboarding/demos/<dealerId>/baseline
Content-Type: application/json
x-demo-onboarding-secret: <secure runtime injection>

{"runId":"11111111-1111-4111-8111-111111111111","confirm":"demo-fictional-motors"}
```

Use the actual returned dealer ID and latest completed import runId, not these fictional values. The server locks this demo and its import/sales/settings operations, requires a non-empty complete successful latest import and delivery to the current approved inbox, then saves current branding/stock/photos and recreates fictional enquiries and sample invoices atomically.

`200 status: saved` confirms completion. Identical completion retries return `replayed` without resetting practice activity. Any existing baseline is preserved: `already-saved` means stop, not permission to overwrite it. The bot cannot replace a baseline or reset a demonstration. Failed/missing/newer/quarantined imports return 409; do not bypass them. Credential ownership mismatch/live dealer returns 404, expired/inactive demo 410, invalid fields 400, temporary failure 503.

## Paste-ready instruction for the Demo Setup Bot

The backend now supports logoData during creation, one fixed test email and one initial baseline save for your own created demos. Keep the same onboarding secret and exact approved host; do not log it. Check capabilities first. Follow the create → credential secure-card handoff → complete stock import → identical replay → public-site check → test-email POST → bounded delivery GET checks → initial baseline POST sequence above. Keep delivery off afterwards and create no schedules. Report each stage as passed, pending or blocked. A 503 saying the email-read key is missing is a one-time backend setup blocker, not grounds to resend email or claim success. Do not repeat the already-completed Luxxy Demo test.

## Faster onboarding: preflight, corrections, summary and completion job

These are implemented endpoints, authenticated with the same onboarding header on the approved host. Stock credentials **still come from the operator dashboard into the dealer bot's secure card**. No endpoint here issues a stock credential, accepts arbitrary email content or grants access to live dealers.

### Non-writing preflight and availability

```http
POST /api/demo-onboarding/preflight

{"demo": {"slug":"fictional-motors","name":"Fictional Motors","platform":"autotrader","retailerId":"FICTIONAL-RETAILER","sourceUrl":"https://www.autotrader.co.uk/fictional-example","days":14}}
```

Use the same full `demo` object planned for creation, including any supplied logos/address/hours. Preflight validates the creation contract, domain/email readiness and slug availability; it returns `200 status: ready`, proposed dealerId/origin, `writes:false`, `quotaConsumed:false`, `availabilityReserved:false`. It performs no writes, email sends or creation-quota consumption. It remains authenticated and rate-limited. An existing slug returns 409; invalid data 400; unavailable readiness 409; temporary database error 503. A successful check does not reserve the slug or guarantee a quota remains available when creation runs.

`GET /api/demo-onboarding/slugs/<slug>` returns `200 {"slug":"fictional-motors","available":true,"reserved":false}`. It does not disclose an existing dealership's details. Invalid slug: 400; unconfigured demo domain: 409. Actual creation still enforces uniqueness atomically.

**Do not POST `/demos?dryRun=true`.** Query flags are rejected with 400 to prevent accidentally creating something when a caller intended a dry run. Use `/preflight`.

### Correct your own unsaved demo (WRITE)

Read the demo status first for `revision`. Then:

```http
PATCH /api/demo-onboarding/demos/<dealerId>

{"expectedRevision":0,"changes":{"showroomAddress":{"street":"12 Fictional Road","city":"Example Town","postcode":"AB1 2CD","sourceUrl":"https://dealer.example.test/contact","checkedAt":"2026-10-15T10:00:00Z"}}}
```

`changes` accepts only `logoData`, `footerLogoData`, `showroomAddress`, `openingHours`, with the same creation validation and combined logo limit. At least one is required. Omitted values are preserved. No renaming, source/retailer change, recipient change, expiry extension or settings access is granted. Corrections never enable booking. Use operator-supplied/approved logos, not marketplace banners.

Returns `200 {"dealerId":"…","status":"updated","revision":1}`. An identical retry with the same expectedRevision/changes returns `replayed` while that edit is the latest revision. Stale/conflicting revision returns 409: read status and review rather than overwriting. Saved baselines or active completion jobs block changes with 409. Expired/inactive demo: 410; another key's demo/live dealer: 404. Invalid fields: 400; temporary failure: 503. Saved baseline replacement remains operator-only; there is no automated re-baseline route.

### One status report

`GET /api/demo-onboarding/demos/<dealerId>` now additionally returns:

- `revision`, total `vehicleCount` and `publicVehicleCount` (current website visibility rules, not necessarily the same count).
- `logos.header` / `logos.footer`: uploaded, header-fallback or dealer-name-fallback. This describes asset presence/fallback, **not** proof of ownership or visual quality.
- `businessDetails`: initial/updated source URLs, actual check times and supplied data.
- `email`: `email_status` and available check/completion timestamps; reading summary does not contact Resend or send email.
- `completion`: null or the public job status, history and error.

Existing origin, portalUrl, status, expiry, lastImport and baselineSaved remain. No secrets, customer records, provider API keys or reset data are included.

### Queue completion (WRITE)

First finish collection/import and identical replay using the dealer bot's own stock credential. Then visually inspect the public site. Correct any branding/business details **before** requesting completion.

```http
POST /api/demo-onboarding/demos/<dealerId>/complete

{"runId":"11111111-1111-4111-8111-111111111111","confirm":"demo-fictional-motors","publicSiteChecked":true,"importReplayChecked":true}
```

Use the actual latest complete successful import runId and exact dealer ID. The two confirmations are your record that the checks were performed; the server cannot independently prove a browser inspection or an external replay. It verifies the import in its database.

`202` returns `jobId`, dealerId, runId, `status:queued`, `stage:import-check`, attempts, deliveryChecks, history and timestamps. A repeated identical request returns `200` and the **same job**, without starting another. A different runId for a dealer with a job returns 409. A saved baseline, missing/incomplete/latest failed import or run mismatch returns 409. Ownership mismatch: 404; expired/inactive: 410; invalid confirmations/fields: 400; temporary failure: 503.

The server handles import check → fixed test email → bounded delivery checks → initial baseline. There is no stock collection or stock POST inside this job, and it never replaces a baseline. Existing test-email and baseline routes remain available for the original manual sequence.

```http
GET /api/demo-onboarding/demos/<dealerId>/completion
```

Returns the job's saved stage-by-stage history; it does not trigger work or resend email. `status` is `queued`, `running`, `completed` or `blocked`. Stages are `import-check`, `email-send`, `email-delivery`, `baseline`. `completed` requires a saved/replayed initial baseline. Check the result once after a suitable wait or use normal bounded status checks; Grok no longer needs to poll the email provider itself.

Delivery checks are at least one minute apart, at most ten; total job attempts are limited to fifteen, including temporary retries. Failed delivery, revoked/expired credentials, changed latest import, missing Resend read permissions or exhausted checks leave the job blocked with an explanation. **Blocked is not success.** Report it to the operator; do not create another demo, change request identities, clear blocks or overwrite a baseline. There is no bot restart/override endpoint for a blocked job in this version.

Job state is persisted in PostgreSQL. A small processor in the existing always-on API service checks the queue every 15 seconds; database session locks prevent two instances processing the same job concurrently. After a process restart it resumes saved work; ambiguous email sends retain the same provider idempotency key. It requires the API service and database to be running, does not depend on a chat window, and creates no additional paid Render service. An outage pauses progress until the service returns. No recurring dealer collection schedule is created.

### Updated standard sequence for Grok

Read capabilities → identify dealer and collect sourced address/hours → use supplied logos → preflight → create/replay → operator generates stock key and enters secure card → collect/import/replay → visual check and any pre-baseline corrections → POST complete → check job/summary → report completed or blocked. Keep recurring delivery off and create no schedules unless separately authorised. Existing completed demos need no repeat test.

Raw website HTML now uses the current tenant's name/town for titles and basic link metadata before JavaScript runs. This is not a server-generated screenshot or proof that the visual check passed. Missing/broken logo rendering falls back to readable dealer text; blank legal company names fall back to the dealership name.


## Operator conversion to a live dealership

Only the human platform administrator can promote a demo through the platform dashboard. The onboarding credential cannot convert dealers or manage live settings. After conversion all demo-only bot reads/edits/completion/replays return unavailable (404); do not recreate or re-baseline that dealership. The internal dealer ID, stock-import endpoint and dedicated credential stay the same. The operator supplies the new public domain and separately approves the dealer bot's live configuration/import test and recurring deliveries. No schedule is changed by the backend conversion. See the operator [conversion guide](../features/demo-conversion.md).
