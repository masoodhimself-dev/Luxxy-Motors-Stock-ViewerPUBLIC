# Enquiry workspace simplification — 23 October 2026

Branch: `codex/tidy-enquiry-workspace`. Deployed with user approval.

## Release

- Commit `500ad14624e22f6e42866d27195fa26a90669d5a` fast-forwarded to the existing release branch; includes the previously approved insurance-history filter removal and stock-based budget limits.
- Render deploy `dep-dbdr2267bikc73857gug` reached `live` on 23 October 2026 at 19:12:59 UTC (20:12:59 UK).
- Both dealership health endpoints returned `status: ok`; no error-level logs were returned for the release interval checked.
- Visually verified the actual Shore Drive part-exchange enquiry: compact queue/header, grouped actions, part-exchange facts and original-message disclosure. Read-only check; no customer communications or record updates.
- No new migration or environment change required.

## Changes

- Narrow desktop enquiry queue with a one-line message preview; more space for the selected customer.
- Contact and assignment share a compact header where space permits.
- WhatsApp moved into the everyday action group alongside reply, follow-up and booking. The recommended action retains the existing priority and handler.
- Removed generic instructions from new-enquiry prompts. Urgent, booking and follow-up explanations remain.
- Recognised website part-exchange messages display the customer's car as labelled facts, including all current-car notes. Repeated stock and contact text is available under the unchanged full original enquiry. Unknown formats remain untouched; no stored message is rewritten.
- Shorter conversation helper text and responsive action layouts.

## Verification

- 97 tests passed across enquiry usability, original-message rendering, conversation history, context, email workspace, email composer and calendar suites.
- Three browser checks passed at 390, 834 and 1440 pixel widths with fictional part-exchange data: facts visible, original expands intact, conversation form opens, no horizontal overflow or page errors. Test writes were blocked.
- Inspected screenshots at all three widths and opened the running local portal in the browser.
- Typecheck and production build passed (existing bundle-size warnings remain).
- No API, database, permission, assignment, booking or message-delivery rule changes. No real customers contacted. Physical iOS/Android testing remains for the operator.
