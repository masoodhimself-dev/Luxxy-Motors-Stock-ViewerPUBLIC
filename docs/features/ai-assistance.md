# Optional dealership AI assistance

Production deployment approved by the user on 31 October 2026. These notes describe the implementation and local verification; confirm the specific Render deploy reaches live before reporting rollout complete.

## Customer and staff behaviour

- Homepage: customers describe a budget, gearbox and requirements. Only available cars from the active dealership are candidates. Returned IDs are checked again for availability and explicit budget/gearbox/fuel/equipment constraints. The UI shows up to four cards. The model considers up to 45 cars and never changes stock or reservations.
- Vehicle questions: existing deterministic answers remain. Opening the answer panel can request up to six additional FAQs. Typed questions use only public car/dealer information and an existing unexpired, registration-matched MOT cache record. No extra DVSA lookup is triggered by the AI server.
- Listed equipment: an opt-in explanation dialog is available when structured equipment exists. The server rejects a feature that is not listed for that car. Cars with no structured equipment keep their normal description.
- Staff email editor: authenticated staff with `sales.manage` may generate a reply. The enquiry is read using both dealership ID and enquiry ID. Generating never applies, saves or sends anything. Staff explicitly replace the message text, review, then use the existing normal send process. Recipients, subject, attachments and invoice workflow are unchanged.
- No translation, automatic customer messages, database-writing tools or external browsing.

## Guards and privacy

`AI_ASSISTANCE_ENABLED=true` and a server-only `OPENAI_API_KEY` are both required. Leave the flag false until the migration and credential setup are reviewed for deployment. Never use a VITE variable or save the key in dealership public configuration.

The server reserves US$0.01 before each paid request under a database admission lock. All dealerships and application instances share a US$5 monthly model-usage allowance (London calendar month). A successful request replaces that reservation with conservative measured token cost. Uncertain, rejected or timed-out calls retain their reservation and are never automatically repeated. This protects application spending; it is not a provider billing statement and excludes taxes and unrelated key usage.

Public visitors receive an HttpOnly, SameSite=Strict browser-session cookie and 10 AI requests, with a maximum 24-hour server session. Cached answers count toward ten too. A connection-wide persisted allowance of 30 requests per rolling 24 hours and a short burst limit reduce cookie-reset abuse. Staff allowance is ten per authenticated staff member/dealership/day, separate from public visitors. All of these share the same monthly guard. Normal website functions remain available when any guard blocks AI.

Facts are projected to a public allowlist; private settings, keys, staff notes, invoices, payments and attachments are excluded. Customer name and detected email/phone/postcode text are removed from staff enquiry text, but free text can still contain other personal information: the staff UI says to review it before generating. Responses use `store:false`. Public answer caches are scoped to dealership, task, question and current facts; typed questions and staff replies never use a shared answer cache. Cache TTL is one hour. Request results are cleared after 24 hours; accounting rows and session hashes are pruned after 90 days. No prompt or key logging.

AI wording is not guaranteed correct. Evidence IDs, structured outputs, public-fact constraints and runtime validation reduce errors; the UI asks visitors/staff to confirm important details. Finder post-validation supports explicit budget, automatic/manual, fuel and common equipment constraints; broader suitability preferences are interpreted by the model. Existing saved answers and usual stock filters remain alternatives.

## Database / rollout

Migration: `lib/db/drizzle/0077_ai_assistance.sql` (journal index 77). Uses the existing PostgreSQL pool; no new production dependency. Existing API responses and stock visibility rules are unchanged. New endpoints are `/api/ai/status`, `/api/ai/assist`, `/api/staff/ai/status`, `/api/staff/ai/reply`.

The approved rollout uses migration 77, the private server key and the enable flag on the existing shared service. The retired AI draft flags are not revived; this implementation has its own explicit opt-in flag.

## Local verification

`artifacts/api-server/scripts/local-ai-preview.ts` is a development-only host: it uses a separate PGlite ledger in ignored `.private/ai-preview-db`, public fixture snapshots and the ignored `.private/ai-assistance.json` key. It imports no production database or message services. Staff routes are forbidden in that customer preview. `--proof-only` checks explanation/reply generation using public vehicle facts and a fictional enquiry, under the same local budget ledger.

Commands:

- Backend: `pnpm --filter @workspace/api-server test:ai-assistance`
- Frontend: `pnpm exec vitest run src/lib/ai-assistance.test.tsx src/components/portal/ai-reply-draft.test.tsx src/components/portal/enquiry-email-composer.test.tsx --maxWorkers=2`
- Responsive: `pnpm exec playwright test --config playwright.ai-assistance.config.ts` (frontend working directory, isolated preview on 4286). Calls are intercepted; record writes are blocked. Five WebKit layouts include 320px phone, 390px iPhone, 820px iPad, 1194px landscape and 1440px desktop. HTTP-LAN UUID fallback is forced during these checks.

## Verification recorded 31 October 2026

- Backend: 25 isolated tests passed, including actual migration SQL in PGlite, cookie/origin/authentication boundaries, dealer-scoped enquiry reads and caches, quota, budget, replay, failure, privacy and finder post-validation.
- Frontend: 101 focused tests passed (98 vehicle/editor/FAQ tests plus 3 hook tests). Both TypeScript projects passed. Diff whitespace check passed.
- Responsive: 5 new AI scenarios passed; 5 existing customer popup/contact/gallery/booking/filter scenarios also passed. WebKit device-size emulation, not physical iPhone/iPad testing.
- Real OpenAI checks: vehicle question, generated FAQs, stock finder, equipment explanation and staff reply generation all returned usable results. Staff provider proof used a fictional enquiry; no message or record write service was involved. Initial tests exposed search result overflow and a local MOT-envelope mismatch; both were fixed and repeated successfully. Local ledger spent/reserved was US$0.011848, including the conservative reservation for the initial failed search.
- The local customer preview serves Multi-Choice public snapshots, accepts AI-only POSTs, and blocks all other mutations. Production database, stock, invoices, payments, message recipients and Render configuration were not changed.

Render verification follow-up: production cookies are always Secure, including when TLS ends at Render’s proxy. Visitor guards use a validated Cloudflare edge address only on Render; malformed or missing edge metadata falls back to the anonymous session, never one shared proxy bucket. Forwarded-for chains are not trusted. This does not change authentication or global Express proxy settings.
