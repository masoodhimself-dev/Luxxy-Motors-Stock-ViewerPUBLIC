# Enquiry and history usability browser checks — 20 October 2026

Branch: `codex/enquiry-workspace-simplification`.

The React application was checked in Chrome at desktop, tablet and phone viewport sizes against the local preview on port 4196. The tests use fictional enquiries, vehicles and history records. All non-GET/HEAD API requests are blocked and recorded; no email was sent and no saved application data was changed.

## Results

| Area | 390 × 1000 | 820 × 1000 | 1440 × 1000 |
| --- | --- | --- | --- |
| Enquiry queue, record and customer context | Passed | Passed | Passed |
| Vehicle and customer history | Passed | Passed | Passed |

The final seven browser scenarios passed in 22.0 seconds after the compact toolbar, queue-preservation and merged-task fixes. This includes the six responsive scenarios and an additional phone regression for a closed merged case with an outstanding task on an original record. No runtime exceptions, unexpected writes or horizontal page overflow were recorded.

## What was checked

- Overdue work appears before a future visit, a new enquiry and a closed record.
- Needs reply, Follow-ups, Test drives and No task scheduled each isolate the correct fictional record; All enquiries restores the whole queue.
- All five queue buttons fit within the phone viewport. Queue buttons and mobile contact links have touch targets at least 44px high.
- Opening a record preserves the four-item queue and does not silently replace the search with its customer name. Desktop staff can select another record directly.
- The original question, request source, status and recommended next action are visible in the selected record.
- The response action opens the conversation editor for the selected customer. Cancelling it sends no request.
- Customer history opens and closes without leaving the enquiry. The phone/tablet Back to enquiries action returns to the list.
- Name search narrows the queue and clearing it restores the list.
- Unassigned ownership produces the expected empty queue. Closing Filters & tools leaves an active indication visible. An overdue-only filter also retains that indication; resetting both filters restores the list and clears it.
- A closed root case with an overdue merged original shows the overdue state and remains in Follow-ups. Its linked-task button opens the correct original, including that record's next action. No task scheduled excludes the case while any original still has work outstanding.
- Vehicle and customer history deep links resolve the intended profile from the vehicle or source-record key.
- History shows the related enquiry and appointment, with internal enquiry references hidden.
- Appointment filtering hides enquiry events; All activity restores them.
- Customer history supports phone-number search, a clear empty state and recovery with Clear search.
- Long email addresses remain contained at every viewport size.

## Findings addressed during the review

The initial phone toolbar pushed the first enquiry far down the page, and horizontal queue navigation concealed several useful filters. The revised toolbar leads with search and keeps occasional tools inside a disclosure. All five queue options now remain visible on phones.

Selecting a record previously applied its customer name as a search, hiding the remaining desktop queue. Internal record selection now preserves the existing queue and search. The duplicate conversation button was also removed when the primary action already opens the same editor.

## Screenshots

The following local screenshots were refreshed after the final layout changes:

| Screen | Phone | Tablet | Desktop |
| --- | --- | --- | --- |
| Enquiry queue | [390px](../../output/enquiry-simplification/enquiries-390.png) | [820px](../../output/enquiry-simplification/enquiries-820.png) | [1440px](../../output/enquiry-simplification/enquiries-1440.png) |
| Selected enquiry | [390px](../../output/enquiry-simplification/detail-390.png) | [820px](../../output/enquiry-simplification/detail-820.png) | [1440px](../../output/enquiry-simplification/detail-1440.png) |
| Vehicle history | [390px](../../output/enquiry-simplification/vehicle-history-390.png) | [820px](../../output/enquiry-simplification/vehicle-history-820.png) | [1440px](../../output/enquiry-simplification/vehicle-history-1440.png) |
| Customer history | [390px](../../output/enquiry-simplification/customer-history-390.png) | [820px](../../output/enquiry-simplification/customer-history-820.png) | [1440px](../../output/enquiry-simplification/customer-history-1440.png) |

Additional regression: [Closed merged case with an overdue original, 390px](../../output/enquiry-simplification/merged-overdue-390.png).

## Reproduce

From `artifacts/luxxy-motors`:

```sh
node node_modules/@playwright/test/cli.js test --config playwright.enquiry-simplification.config.ts
```

The configuration reuses the local preview on port 4196, or starts it when unavailable. It uses the installed Google Chrome application unless `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` is provided.

## Limits

These are responsive Chrome viewport checks, not tests on physical iPhones, iPads or Android devices. Actual email delivery, production permissions and saved booking mutations were intentionally outside these read-only browser scenarios. Related unit and integration checks are reported separately by the implementation owner. Nothing was deployed during this review.

## Final implementation checks

- 104 related unit/component tests passed across 11 files, covering presentation, navigation, history, contact confirmation, merged originals, attendance and reviewed email drafting.
- Workspace typechecking and the complete production build passed. Existing sourcemap/chunk-size warnings remain.
- Website-chat previews show the visitor's exact messages first only when the stored transcript matches the known format. Unknown formats use the full text; conversation history retains the unchanged original transcript.
