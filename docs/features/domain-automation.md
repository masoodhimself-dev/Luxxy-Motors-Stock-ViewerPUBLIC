# Cloudflare and Render domain setup

Platform administration → select dealership → **Domains**.

The operator can enter a dealer's hostname and request its setup on the existing shared Render service. The backend manages the Cloudflare website records, the application's ownership TXT record, Render registration and verification, and an HTTPS check. Progress is saved in the application database so leaving the dashboard does not cancel it.

This is domain connection only. It does not buy a domain, transfer a registration, change nameservers, change the dealership's canonical origin, activate a draft dealer, convert a demo, configure Clerk, configure email, start Grok or enable payments. Demo-to-live conversion remains a separate reviewed action in [the conversion guide](./demo-conversion.md).

## When entering a hostname is enough

The domain must already be an active DNS zone accessible to the configured Cloudflare API token, within either the approved account or explicit zone allowlist. The operator must have the dealer's permission to connect it.

For domains in the operator's Cloudflare account, configure its account ID and a token scoped to that account's zones once. Newly purchased and active zones in that approved account can then be connected just by entering the hostname. Alternatively, approve individual zones for a narrower scope. If both the account ID and zone allowlist are configured, both restrictions apply. For a dealer-owned Cloudflare account, arrange authorized access to the specific zone first. Typing a domain does not grant permission to manage it. The first version uses one server-side Cloudflare token, not per-dealer OAuth or credentials entered in the dealer portal.

If the domain is with another registrar, it can remain registered there. If its DNS is also elsewhere, moving DNS to Cloudflare and changing the registrar's nameservers is a separate task. Preserve the existing mail and other DNS records during that move. The application does not perform the move.

Existing websites need a planned cutover: conflicting records stop this automation for manual review instead of being replaced. This avoids silently taking an existing site offline.

## Server configuration

Disabled by default. Set these only in the API service's secure environment configuration; never in browser environment variables, repository files, the Grok prompt, URLs or chat:

| Variable | Purpose |
| --- | --- |
| `DOMAIN_AUTOMATION_ENABLED` | Set to `true` to permit the feature. |
| `CLOUDFLARE_DNS_API_TOKEN` | Scoped Cloudflare API token with DNS Edit and Zone Read for the approved account's zones or individual zones. Use an API token, not the global API key. |
| `RENDER_DOMAINS_API_KEY` | Render API credential able to manage custom domains on the configured service. Treat this as a platform credential; Render may grant it wider account access than domain setup needs. |
| `DOMAIN_AUTOMATION_RENDER_SERVICE_ID` | The existing shared web service's ID. No new web service is provisioned. |
| `DOMAIN_AUTOMATION_RENDER_TARGET` | That service's exact `*.onrender.com` hostname, without a scheme or path. |
| `DOMAIN_AUTOMATION_CLOUDFLARE_ACCOUNT_ID` | Approved Cloudflare account's 32-character hexadecimal ID. Account mode checks the returned zone's account, active status and full DNS hosting before any provider write. Use this for newly added domains without editing a per-domain allowlist. |
| `DOMAIN_AUTOMATION_ZONES` | Alternative or additional comma-separated allowlist of approved Cloudflare DNS zone names, such as `fictional-motors.example,another-fictional.example`. Required if no account ID is configured; when set it remains restrictive even in account mode. These are examples, not working destinations. |

At least one of account ID and zone allowlist is required. The existing multi-tenant, approved platform-host and Clerk platform-admin configuration is also required. An ordinary dealership staff account or onboarding bot credential cannot run this operation.

The dashboard shows configuration readiness without exposing either provider credential. Disabling the feature stops new provider work; it does not remove already-created DNS or Render records.

The queue runner lives in the existing API process and checks for work every 15 seconds. It needs that service running; it is not an external wake-up scheduler. Saved jobs survive a restart, but an extended outage can exhaust the verification deadline and require the operator to retry.

## Operator workflow

1. Confirm permission and configure Cloudflare access within the approved account or zone allowlist.
2. In the dealership's Domains panel, enter the exact hostname, for example `www.fictional-motors.example`, then start setup. Use a hostname only, without `https://`, a port, path or wildcard.
3. Review the recorded progress. The backend checks the tenant mapping, approved Cloudflare zone, existing DNS records and Render configuration before creating website records.
4. The worker registers the hostname on the existing Render service, ensures the approved website CNAME and ownership TXT record, checks public ownership DNS, requests Render verification and waits for working HTTPS.
5. If DNS propagation or certificate issuance is pending, the job records that stage and checks again about a minute later, for up to 30 minutes or 30 attempts. Closing the page is safe; return to the same panel for its saved status.
6. If the job is blocked, read the reason and resolve the underlying issue. Retry resumes the same setup and rechecks existing resources. Do not delete email records or loosen permissions to bypass a block.
7. After domain setup completes, test the real hostname and portal sign-in. Configure Clerk and the dealer's real email sender separately, then finish the launch checklist. For a demo, select this verified domain during live conversion. For a draft regular dealer, complete its existing activation process.

For the zone's apex or its `www` hostname, setup covers the pair, such as `fictional-motors.example` and `www.fictional-motors.example`. Both are reserved for the same dealership before provider writes, checked for conflicts and connected together. This matches Render's paired-domain behaviour and prevents a counterpart being assigned to another tenant while setup runs. Other subdomains are connected individually. The dealer's selected canonical origin still changes only through its separate launch/conversion action.

Use the setup job's requested hostname as the primary live origin. Its Render companion can redirect to it; conversion excludes that companion from eligible main addresses. If the current canonical origin is already one of the pair, setup requires it as the requested primary. The primary must return the application's healthy HTTPS response itself, while an alias can pass only a valid HTTPS redirect to that primary. The checks never follow redirects to prove readiness.

## Safeguards and failure behaviour

- Only authenticated platform administrators on the approved platform host can read or mutate the setup. The existing origin guard applies.
- Reserved administration, import and demo hosts, Render service hostnames, wildcards, IP addresses and private/local names are not dealer-domain targets. A hostname registered to another tenant is rejected.
- The provider API hosts are fixed in server code. Tokens are sent only to their respective provider, and provider redirects are refused. The Render service must be a web service whose returned URL matches the configured target. Provider credentials are never sent to the dealer website or included in a job response.
- Cloudflare changes are confined to an approved active, fully hosted DNS zone and the requested website/ownership names. Account mode independently checks that the returned zone belongs to the approved account; a similarly named zone in another account is refused. Existing conflicting records are never overwritten or deleted. MX records, unrelated TXT records and existing email configuration remain intact.
- Desired records already present are reused where safe. An unexpected target, incompatible record or ownership conflict blocks the job for review. Stale IPv6 records and restrictive certificate-authority records require review; the application does not automatically remove them or rewrite the zone's certificate policy.
- Public DNS and HTTPS are checked separately from provider API acceptance. A valid TLS connection alone does not establish tenant ownership or make an unconfigured login ready.
- Jobs are durable and serialized with database locks for each job and Cloudflare zone to prevent concurrent workers from applying conflicting domain setup. A restart can resume saved work. The UI reports `queued`, `running`, `waiting`, `blocked` or `completed`, with the current stage and history. An accepted provider request is not described as completed setup.
- Cloudflare, Render and the database cannot share a single transaction. If a later step fails, records created earlier can remain, including an unverified application domain reservation. Retry reconciles those resources; there is no automatic destructive rollback across providers. A saved job cannot silently switch to a different Render service/target if the server configuration changes.
- Completion does not update the canonical origin, activate a tenant, mark Clerk/email launch checks done, convert a demo, delete a demo alias or create a schedule.

The worker checks the configured hostname over HTTPS without provider secrets. Redirects are not followed as proof of readiness, and private-address destinations are refused. Domain setup is not a general URL-fetching feature.

## Operator API

The endpoints use the existing platform session and platform-admin authorization, not a Grok import secret:

- `GET /api/platform/dealers/:id/domain-automation` — read-only configuration readiness and saved job status.
- `POST /api/platform/dealers/:id/domain-automation` — **WRITE: register a domain/setup job and allow configured Cloudflare/Render changes**. Body: `{"hostname":"www.fictional-motors.example"}`.
- `POST /api/platform/dealers/:id/domain-automation/:jobId/retry` — **WRITE: retry a blocked job after the operator resolves its cause**. Send an empty JSON object. It belongs to the selected dealer and configured Render destination; a different dealer cannot reuse it.

Start/retry returns HTTP 202 with a saved job; reading status returns 200. Invalid hostname/request bodies return 400, unauthorized callers 403, an unknown dealer 404, and configuration/ownership/retry conflicts 409. A queue database error returns 503. Provider problems appear in the saved job rather than turning its initial acceptance into proof of success.

Use the status response to determine completion. An accepted start request is not proof of live DNS, a certificate or a working dealer website. There is no automatic purchase or billable service-creation endpoint in this flow. Existing provider custom-domain limits or charges still apply under the operator's plan.

## Verification before enabling

Use fake provider responses and an isolated database for automated tests. Do not run test mutations against the live Luxxy, Paramount or demo domains.

- Disabled or incomplete configuration performs no provider mutations and returns an actionable setup message.
- Non-admin, wrong-host and wrong-origin callers are rejected; cross-dealer job/domain use is rejected.
- Unapproved zones, wrong/ambiguous Cloudflare accounts, inactive or partially hosted zones, invalid hostnames, another tenant's domain and private-address HTTPS destinations fail closed.
- Provider credentials are absent from logs, browser responses, DNS values and HTTPS probes; provider redirects are refused.
- Existing desired DNS and Render registrations are reused; conflicting website records block; MX/email TXT records are preserved.
- DNS propagation and certificate delays report waiting. Permanent permission and ownership errors report a block or failure, without endless retries.
- A restart and two simultaneous worker attempts do not create duplicate domain work. A partial provider success can be retried safely.
- Success requires the ownership TXT check, Render verification and HTTPS check. It leaves the canonical origin, tenant status, demo state, staff, email, billing, payments and Grok configuration unchanged.

After those tests, run one separately approved setup for an unused test hostname in an approved zone. Confirm it visually and test Clerk before relying on it for a dealer launch. Implementation and local tests alone do not establish that provider credentials are configured or that any real domain has been connected.

## Provider references

- [Cloudflare API token permissions and scopes](https://developers.cloudflare.com/fundamentals/api/get-started/create-token/)
- [Render custom-domain DNS and HTTPS setup](https://render.com/docs/custom-domains)
- [Render API: add a custom domain](https://api-docs.render.com/reference/create-custom-domain)
- [Render API: verify DNS configuration](https://api-docs.render.com/reference/refresh-custom-domain)
