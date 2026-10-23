# Enquiry workspace simplification — 23 October 2026

Local branch: `codex/tidy-enquiry-workspace`. Not deployed.

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
- No API, database, permission, assignment, booking or message-delivery rule changes. No real customers contacted. Physical iOS/Android testing and deployment were not performed.
