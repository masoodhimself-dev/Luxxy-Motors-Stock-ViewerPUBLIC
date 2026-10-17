# Calendar and staff device alerts — 17 October 2026

Implementation and operating instructions: [staff calendar and device alerts](../features/staff-calendar-and-device-alerts.md).

## Verified locally

- Full frontend suite: **759 tests across 103 files pass**. Includes the sales, customer website and existing staff workspace regressions.
- Focused calendar/notification integration: **94 tests pass** (a subset of the full frontend suite).
- Isolated Web Push backend: **25 tests pass**, using PGlite, fictional staff/dealers and mocked push/HTTPS transport.
- No-send local preview push controls: **3 tests pass**.
- Existing booking policy and preview lifecycle: **18 tests pass**, including capacity, stale changes, exceptions and London clock changes.
- Existing staff enquiry access: **3 tests pass**.
- Frontend static serving/email portability: **5 tests pass**, including real JavaScript/manifest serving and cache headers. Provider email calls are mocked.
- Frontend/API TypeScript and both production builds pass. Vite retains existing sourcemap/chunk-size warnings; they do not fail the build.
- `git diff --check` passes.

Browser review covered the month and day layouts, week cards, search/clear filters, appointment detail sheet and its close control, and the unconfigured device-alert screen. Phone/tablet layout checks included containment of the calendar and alert controls. Browser responsive emulation is not an actual Safari/Android notification test. Existing preview records were only read; no appointment/customer data was created or changed by this task.

Useful captures:

- `output/ui/calendar-2026-10-17/calendar-tablet.png`
- `output/ui/calendar-2026-10-17/calendar-phone-capture.png`

## Issues corrected during verification

- Normalise browser subscription JSON so its optional `expirationTime` cannot cause a strict API rejection.
- Claim a queue job immediately before delivery so a slow batch cannot outlive all its leases.
- Keep retained appointments/follow-ups on merged records eligible, while resolving customer navigation to the surviving case.
- Move pending reminders in both directions when their lead time changes, preserving provider retry backoff and terminal-job deduplication.
- Require current verification for both canonical and alias dealership origins before sending.
- Restore a Retry appointments control when a calendar query fails.
- Reduce repeated headings/actions and navigation height while the calendar is open.

## Not commissioned by these checks

No production or staging deployment, database migration, VAPID credential setup or real notification send took place. Local preview explicitly returns `configured:false` and refuses every push mutation. Migration 0038 and the server-only environment examples are prepared.

Live activation needs the ordered database migration, secure VAPID configuration, HTTPS deployment and explicit staff opt-in. Confirm actual background/locked-screen delivery on desktop, iPhone/iPad Home Screen apps and Android before describing those devices as tested. Provider acceptance is not proof of delivery/read status.
