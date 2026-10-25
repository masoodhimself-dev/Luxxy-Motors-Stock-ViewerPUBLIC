# Website audit follow-up

Date: 25 October 2026. Branch: `codex/full-website-audit-2026-10-25`.

This completes the remaining settings usability work and the compact Inbox refinement requested after the [full audit](full-website-audit-2026-10-25.md). Code changes are local and have not been pushed to Render. No migration is required.

## Changes

| Area | Result |
| --- | --- |
| Settings review | Exact changed fields are grouped by Dealership, Website and Bookings. Each expands to show published and draft values and an edit link. The comparison uses the latest loaded public settings; existing complete-draft publication and revision protection are retained. |
| Setting destinations | Relevant settings and wording controls link to their published customer pages. Conditional visibility hints explain hidden sections. Draft preview is separately labelled, avoiding a claim that these links show unpublished edits. |
| Availability notices | Effective test-drive/part-exchange/email availability is explained beside affected controls. Loading/error states remain unconfirmed, with a read-only retry. A false effective flag does not invent who disabled it or why. |
| Hours | Read-only warnings identify appointments on closed days or outside confirmed showroom intervals. Unknown/custom hours are explicitly unconfirmed. Booking and showroom rules remain independent. |
| Discard draft | An accessible application dialog replaces native confirmation. Focus starts on “Keep editing”; cancel preserves edits, confirm clears only the shared unpublished draft and restores the loaded publication. Upload/publication pending guards remain. |
| Customer preview | Home, Stock, Vehicle, Contact and Warranty render from the actual React pages, current public stock, effective features and the unpublished settings. Device sizes are 390 × 844, 820 × 1180 and 1440 × 900. Scaling follows the available container width. |
| Preview safety | Isolated public-data query cache; static rendering with no effects; opaque sandbox and CSP; scripts, links, submissions and embedded media disabled. Native information disclosures remain keyboard accessible. No saved-car, recent-view or private enquiry draft is read from the viewer’s browser storage. No message, booking, publication or website analytics event is triggered by preview interactions. |
| Preview defects found during browser testing | Prevented a new page/device/vehicle frame from initially mounting the previous snapshot. Corrected measurement after the dialog portal mounts and on resize. Removed forced horizontal clipping, suppressed the static gallery’s permanent loading label and added a clear message if refreshed stock leaves no vehicle to preview. |
| Compact Inbox | Desktop view tabs and Quick enquiry share a row; duplicate visual heading is removed while its accessible heading remains. Conversations start closer to navigation. Phone/tablet selected-customer and Back to enquiries behaviour remains. |
| Home attention | Failed/uncertain email delivery has a visible link to existing delivery history while detailed records stay collapsed. No automatic retry/send action. |
| Small clarity fixes | Opening a newly saved enquiry/booking dismisses its success banner. Removed obsolete “preparation” wording from vehicle history. A genuinely empty Inbox explains Quick enquiry and incoming website enquiries; filtered-empty and custom messages remain distinct. |

## Shore Drive public setup

Masood explicitly supplied and approved the following values; they were saved through the live Settings UI and checked on the rendered contact page:

| Setting | Confirmed published value |
| --- | --- |
| Phone | 07388 831790 |
| WhatsApp destination | 447388831790; the visible customer link was checked |
| Public email | sales@shoredrive.uk |
| Address line | Unit 3, Rear of 18, 20 Village Way East, Rayners Lane |
| Town | Pinner, Harrow |
| Postcode | HA2 7LU |
| Monday–Saturday | 10:00–18:00 |
| Sunday | Closed |

Website checks reported no missing details after publication. Actual live opening-hour rows were rechecked after an automation time-input fill failed to update the React values; native keyboard entry corrected all six days before final verification. Booking availability, Resend credentials, reply routing and sending behaviour were not changed.

## Browser checks

- Five draft-preview pages at all three internal device widths: **15 page/width states**. Each displayed the selected page, had no horizontal overflow, no active form controls, no script elements and no active navigation links. Every vehicle preview lacked the stale loading label.
- Preview dialog itself at 390, 820 and 1440 widths: no document overflow. A desktop preview scaled to its measured 334 / 752 / 1372 pixel containers respectively. A second real vehicle selection showed the correct MINI page rather than the previous Ford page.
- Native warranty details opened with Enter and retained summary keyboard focus inside the sandbox.
- Local Quick enquiry captured a fictional customer and a subsequent staff-booked test drive against the expected records. Selected-customer views were inspected at phone, iPad and desktop widths; phone Back to enquiries returned to the list. No external customer message was sent.
- The discard dialog defaulted to Keep editing; cancellation retained the test warranty title; confirmation restored zero changes with Publish disabled. The unpublished audit title was not published.
- The two known fictional local enquiry/booking records were removed after verification, leaving the local enquiry list empty with its correct onboarding message. A temporary local backup exists outside Git. No production customer record was removed.

Evidence is in `output/full-website-audit-2026-10-25/` in the original workspace: `draft-preview-browser-checks.json`, `draft-preview-dialog-browser-checks.json`, `draft-preview-*.png`, `compact-inbox-*-final.png` and `shore-confirmed-contact-live.png`.

## Verification and limits

- Full frontend suite: **195 files / 2,096 tests passed**, with two workers (107.44 seconds). This includes the page/device snapshot-binding and portal-mount/resize regressions.
- After the final empty-stock message/test, the final preview run passed **19/19** across the renderer, modal and settings-preview suites. This adds the last-stock-removal regression; it is not counted as a new full-suite run.
- Full workspace production build and typechecking passed. Existing large-bundle and dependency sourcemap warnings remain; no dependency or database migration was added.
- Independent read-only reviews checked preview isolation, effective feature notices and settings integrations. No outstanding blocker remains; the review’s empty-stock edge was corrected and regression tested.
- `git diff --check` passed. Verification logs are copied beside the screenshots as `follow-up-frontend-tests.log`, `follow-up-preview-tests.log` and `follow-up-workspace-build.log`.

The original audit’s backend settings, feature-policy and SEO suites remain applicable; this follow-up changes no backend handler or schema. Physical iPhone/iPad hardware, camera permissions/native recording and real email/WhatsApp delivery remain unverified in this pass. Local sharing customer lookup intentionally returns its configured preview guard response because private media sharing is not enabled; no fresh production “I’ve sent it” claim is made. Existing financial, booking, permissions and message rules are preserved.

The full preview is visual, not a booking or sending simulator: live time availability, video playback and operational demo banners are excluded and explained in the dialog. External images/fonts can load as passive resources. New direct customer part-exchange photo uploads remain a separate future proposal rather than an audit defect.
