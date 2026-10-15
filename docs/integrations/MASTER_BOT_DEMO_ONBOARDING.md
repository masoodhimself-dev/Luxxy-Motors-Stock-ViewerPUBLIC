# Master Bot: restricted demo onboarding

This contract is for a server-side bot. It is separate from Clerk administrator access and separate from each dealer's stock-import credential. No bot receives the platform owner's Clerk session.

## Provision once in the platform dashboard

Platform → Demo dealerships → Master Bot access → Create onboarding credential.

An operator chooses a label, lifetime (default 30 days, maximum 90), maximum total demos (default 20, maximum 100), and new demos per UTC day (default 5, maximum 20). The key is stored SHA-256 hashed and shown once. Enter it into Master Bot's secure secret card as `MASTER_BOT_DEMO_ONBOARDING_SECRET`; never chat, URLs, repository files or logs. Save and dismiss the dashboard secret. No live key has been created merely by deploying this feature.

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

Before starting, verify the worker supports secure storage of both the onboarding credential and returned dealer stock credentials. If it cannot store a returned secret without exposing it in a chat/tool transcript, STOP. Use operator-driven tenant/key creation plus the dealer bot's secure card instead. This is a required runtime capability, not assumed to exist.

## Read capabilities

`GET /api/demo-onboarding/capabilities`

Returns scope, configured domain, domain/email readiness flags, expiry, quotas and supported operations. No customer data, provider keys, operator email list or live dealers. If domains or email are not ready, report that and stop creation. The backend rechecks readiness during creation.

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
- `logoData`: optional PNG/JPEG base64 data URL, max 400,000 characters and decoded max 250,000 bytes. Do not send SVG or an arbitrary remote URL. The backend does not fetch remote logo URLs. Resize/compress authorised logos locally.
- Extra fields, including owner, status, origin, domain and live mode, are rejected.

`201` response: `status: created`, requestId, dealerId, origin, portalUrl, expiresAt, email sender/restricted recipient, baselineSaved false, and `stockImport: { endpoint, header, keyId, secret }`.

Creation, fictional activity, dedicated stock key and encrypted retry receipt commit in ONE transaction. A failed transaction cannot leave a half-created dealer. Request replay uses a per-credential row lock, so concurrent retries cannot create duplicate dealers/keys. The reply containing the stock secret is encrypted at rest using the application's existing 32-byte integration encryption key, authenticated to that credential/request ID. Keys/secrets are never included in status/list responses or logs.

Store the returned stock secret securely under the new dealer's distinct secret name. Use it ONLY for the exact returned stock endpoint. The onboarding credential cannot import stock or call platform-administration routes; the stock credential cannot create demos.

## Retry

Identical requestId + demo data → `200`, `status: replayed`, same dealer and same dedicated stock credential. Quotas are checked only for a new request, not an identical retry. Changed data under the same requestId → `409`. Request IDs are scoped to the onboarding credential; do not retry a timed-out request using a different credential without operator review.

Use bounded backoff for network errors/503 and 429, honour Retry-After. Never generate another requestId just because a response timed out. Do not log the response body: it contains a credential. A reused slug under a new requestId gets 409, never silently takes over an existing tenant.

## Check only your created demo

`GET /api/demo-onboarding/demos/<returned-dealerId>`

Returns dealership origin/portal URL, status, expiry, baselineSaved and latest import summary. It does not return credentials, customers, invoice/payment state or private integration settings. Demos created manually or by another onboarding key, and all live dealerships, return 404.

There is no list-all, reset, delete, extend, staff, settings, email-send, payment or scheduling capability on this API.

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
- 503: transaction/encryption/temporary operation failure. Preserve requestId/payload; report if bounded retries fail.

No redirects are generated by these application routes. An intermediary can redirect; the worker must still refuse redirects with credentials.

## End-to-end demo sequence

1. Obtain operator approval for the prospect and authorised source.
2. Check capabilities/readiness; create once; store both request and credential securely.
3. Configure the one-dealer worker with delivery OFF. Do not start a schedule.
4. Collect a complete snapshot, verify retailer/platform and deliver only with the operator's approval.
5. Verify `imported`, then identical-stock-payload `replayed`, and inspect your demo status. Public stock visibility can differ from total inventory.
6. Ask the operator to inspect the site/portal and Save starting point in Demo controls. This is deliberately unavailable to Master Bot because saving/replacing the baseline resets practice activity.
7. Test website-generated demo email through the portal, with operator approval. It is Resend, not the bot's own email draft tool. Real payments stay blocked.
8. Report prepared/configured/tested/recurring separately. No schedule is created by onboarding.

## One-time live dependencies

Wildcard DNS/HTTPS and Clerk support for `*.demo.luxxyexmaplenumber2.uk`, verified Resend sender domain, approved operator inbox and secure environment configuration. These must be actually verified before readiness flags are set. The existing apex test dealership must not be replaced.
