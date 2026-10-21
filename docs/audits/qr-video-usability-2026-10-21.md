# QR and vehicle video usability audit - 21 October 2026

Scope: record/share videos, the car recording page, WhatsApp QR preparation, phone handoff, customer confirmation and sign-in return. Live pages were inspected read-only. Implementation and verification used local previews, fictional customers and isolated tests; no real customer was messaged and no video was published. Changes are local and have not been deployed.

## Findings and changes

| Finding | Change |
|---|---|
| Recording opened inside the entire portal, with navigation and unrelated actions above the recording task. | Authenticated recording mode uses a focused page with a compact car/photo/registration header, return-to-car control and record/review/publish sequence. Normal portal navigation remains unchanged. |
| Capture controls appeared after large old video previews. | Recording mode puts capture/upload first. Camera activity and local clip review hide previous drafts/published clips temporarily. Draft and published footage have separate labels. |
| Clicking Use recording discarded the local clip before the upload outcome. | Recorder awaits the upload result, retains its exact file through failures/busy states and allows retry. Ordinary failed file uploads also offer Retry upload with the same UUID and bytes. |
| Late camera-permission responses could stop a newer session. | Generation checks and recorder-identity checks prevent stale events from interrupting a current camera. Background permission grants are released. Permission/interruption messages give recovery steps. |
| Phone sign-in could drop the car and recordVideo query. | Validated same-origin portal return paths are preserved through Clerk sign-in/sign-up. External origins, non-portal paths and malformed return targets are rejected. |
| WhatsApp preparation mixed customer selection, message, QR, revocation and confirmation in a long dialog. | Customer selection precedes sharing; selected identity collapses into a summary. Message preview and link administration are secondary. QR/open actions sit before the final sent confirmation. |
| Selecting a history record after entering a recipient could silently change the number. | Selection only fills an empty phone field. Different normalised recipient/history numbers require an explicit acknowledgement. QR readiness waits for a successful lookup; uncertain confirmation retries retain their original payload. |
| An expired AI draft could block a fresh template during QR preparation. | The current draft is saved and validated before preparing WhatsApp sharing. Template replacement clears obsolete provenance through the existing protected save path; actual AI-derived edits retain freshness checks. |
| QR preparation errors hid email recovery. | Email fallback remains available after preparation failure. The subsequent Quick Enquiry work below replaces the sharing mailto action with internal email preparation. |
| Phone handoff used generic device sharing as its main action. | A valid WhatsApp recipient is shown prominently with Open WhatsApp first. Other sharing methods remain secondary. Staff are told to return to the signed-in sharing window to record the sent outcome. |
| Already-open private packs could keep showing an expired action. | Expiry is checked while open; expired phone packs hide content/download/send controls and require a new link. |
| Local recording QRs looked usable from another phone. | Loopback recording links visibly explain that a phone needs the live HTTPS site. No insecure camera or permission bypass was added. |

## Verification

- Full frontend suite: **1,760 tests passed across 167 files** before the final selected-customer-summary polish.
- Final focused QR/confirmation/editor/recorder/portal/phone tests: **98 passed**, including that final polish and one added regression.
- Recorder lifecycle tests: **21 passed**, including pause/resume timing, rotation, permission races, interruption and failed upload retention.
- Isolated video/media/QR HTTP tests: **19 passed** with actual local compression and a disposable database.
- Backend AI provenance tests: **30 passed**, plus **2 preview tests**.
- Frontend typechecking and full workspace production build: passed. Existing large-bundle warnings remain non-blocking.
- Browser: inspected the live old recording page, then the local revised page/QR at desktop, 820px tablet, 390px and 320px phone widths; no horizontal overflow observed. Landscape layout was checked separately. Viewport testing uses the desktop browser agent, not real phone camera hardware.
- Explicit review-before-publish, tenant/role checks, immutable document links and no automatic WhatsApp/email send are preserved. No migrations, live schedules or live stock-update configuration changes.

## Remaining physical-device verification

Real iPhone/Android camera permission, capture codec behaviour, orientation and pause/resume, native QR scanning, WhatsApp opening and sending need a physical handset on the deployed HTTPS origin. Desktop viewport checks do not establish these results. The anonymous phone sharing page cannot write authenticated customer history; staff confirm from their signed-in sharing window. WhatsApp confirmation records staff attestation, not independent delivery verification.

Evidence screenshots are local fictional previews under `/private/tmp/qr-video-audit-*`.

## Quick Enquiry media and internal email follow-up

Implemented locally after the audit, following the user's additional request:

- Sharing fallback uses the dealership email system. Customer/message/video contexts use the reviewed internal composer; invoice and reservation fallbacks open their existing internal controls without automatically sending. Sharing/video components no longer use mailto. Public contact-address links are unchanged.
- Quick Enquiry has separate **Save enquiry** and **Save & message** actions. The latter saves once, retains the customer/car context, then offers **Send photos or video**. Closing the message returns to the saved enquiry; no duplicate enquiry or appointment is created.
- The message composer supports up to four existing public car-photo links, a published video link and two custom JPEG attachments. Unpublished video drafts are excluded. Media is validated again when reviewing/sending and included in the immutable preview.
- Custom photos are compressed to at most 500 KB each and stripped of camera metadata. Staff can choose files locally or create a private phone-upload QR. Upload capability lasts 15 minutes, is revocable, is stored hashed, checks the issuing staff member's continuing permission and is scoped to one dealership/enquiry. Exact upload retries do not duplicate photos.
- **See car details** opens photos, description, specifications, equipment, running costs and recorded history in a nested panel without navigating away or clearing the enquiry. Only existing recorded facts are shown. Mobile photo controls are stacked to avoid wrapped, oversized buttons.
- Migration **0050_enquiry_photos** is registered in the Drizzle journal and tested incrementally on a disposable database. It has not been applied to production.

Validation:

- Full frontend suite: **1,792 passed across 171 files**. Further focused vehicle-facts checks are recorded in the final task response.
- Backend: **86 passed** across media/QR/migration (25), email workspace/scope (9), recovery (20) and AI provenance/preview (32). Email delivery is mocked; no customer messages were sent.
- Local communications preview: **3 passed**, including gallery URLs rendered as usable strings rather than object labels.
- Workspace typechecking and production build passed; existing bundle-size warnings remain.
- Actual browser inspections covered Quick Enquiry save/message handoff, retained customer fields after opening details, desktop and narrow-phone vehicle panels, 390px phone and 820px tablet upload layouts, token removal from the URL and no portal chrome on the upload page. No horizontal page overflow observed. A gallery min-content overflow and wrapping mobile action buttons were found and corrected.
- The browser file-picker automation stalled and could not complete the manual file selection check. Compression, HTTP upload, attachment email, replay and limits passed isolated tests. Physical handset camera, QR scan and native WhatsApp sending remain unverified.

These changes remain local. Production delivery, stock schedules, vehicle publication, agreed prices, deposits and issued invoices were not changed. Evidence: `/private/tmp/quick-enquiry-phone-photo-upload.png`.
