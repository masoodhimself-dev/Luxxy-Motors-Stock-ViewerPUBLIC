# Website and portal popup review — 2 November 2026

## Scope and design direction

Reviewed the active public and staff popup families: contact/callback, WhatsApp,
answers, MOT/delivery, feature help, gallery, print, filters, navigation, enquiry
capture/editing, vehicle information, email preparation and delivery, appointments,
declarations, merging/deletion, payments/refunds, handover and sale confirmation.
Shared dialog, alert, menu, select, popover and sheet primitives were included.

The approved showroom identity remains the reference: Montserrat, navy ink
`#192a36`, white panels `#ffffff`, pale blue `#eef9fc`, grey rules `#e1e5e8`,
muted text `#59656e` and gold focus `#a47a2b`. The layout uses a concise heading,
one scrolling body and reachable actions. Confirmation actions wrap where needed.
This deliberately extends the existing site rather than introducing another
palette, font, icon family or collection of decorative cards.

Initial browser review rejected a proposed two-column native date layout on small
phones because the calendar control clipped. Dates remain stacked below 480px.
It also found an obsolete answers-panel layout rule and a crowded email action
row; those were replaced with a shrinking scroll body and a 2×2 phone action grid.

## Changes

- Consistent left-aligned headings, less redundant spacing, lighter close controls,
  wrapping 44px footer actions, viewport-bounded submenus and corrected select
  height. Reduced-motion handling includes backdrops.
- Dialogs can explicitly disable dismissal during requests. Keyboard focus returns
  to ordinary openers as well as Radix triggers; explicit focus handlers retain
  control. Phone dialogs initially focus the heading instead of opening a keyboard.
- Text-entry dialogs follow the visual viewport when a software keyboard reduces
  the available height. The existing enquiry sheet retains its own viewport logic.
  Viewport listeners/styles are removed when the popup closes.
- Public WhatsApp drafts survive closing and belong to one vehicle. Late AI answers
  and equipment explanations cannot appear for a different question or vehicle.
  MOT state is vehicle-scoped. Callback validation focuses the telephone field and
  all callback navigation is locked while sending.
- Answers, WhatsApp, print and feature panels have a single scroll area with their
  heading/actions retained. Staff registration lookup keeps its heading, input and
  close button visible while a long MOT history scrolls.
- Staff notes, conversations, appointments, merging, emails and sales forms protect
  unsaved edits with an inline Keep editing / Discard choice. Pending requests also
  remain locked while their completion callbacks refresh the parent workspace.
- Staff vehicle information presents six key facts first, with remaining facts on
  demand. MOT history loads when its section opens. Private email-photo attachments
  are optional and collapsed initially.
- Payment/refund/handover forms have compact fields and reachable sticky actions.
  Invalid refund dates and amounts have inline guidance; handover submission
  enforces its recipient and balance checks, including non-button submission paths.
- Closing an accepted customer email via X, Escape or the backdrop now reports
  `sent`, matching Done. Uncertain delivery continues to report `draft`.

Existing saved-car deletion defaults, irreversible financial/deletion safeguards,
calendar/history views and gallery focus handoffs were retained. Native safeguards
for leaving the full invoice editor and administrative/settings operations remain.
The unreferenced legacy LeadCapture component was not rewritten.

## Verification

Evidence directory:
`output/popup-review-2026-11-02/` in the main user workspace.

- Consolidated regression run: 408 passing tests in 30 suites.
  `final-regression-tests.log` and `targeted-test-files.txt` identify the selected
  public, staff, sales and shared suites. The final keyboard refinement additionally
  passed all 16 shared/MOT tests in `shared/dialog-tests.log`.
- Full workspace production build, including TypeScript, passed:
  `production-build.log`.
- Public browser matrix: 78 checks at 320×668, 393×852, 820×1180, 1440×1000 and
  760×360. `public/browser-checks.json` and screenshots.
- Portal capture/booking/MOT matrix: 15 checks across the same sizes.
  `portal/results.json` and screenshots.
- Portal editor/vehicle/email matrix: 14 checks at phone and short landscape sizes,
  including dirty-close flows. `portal-editors/checks.json` and screenshots.
- Sales matrix: 17 checks at 320px, 393px, desktop and short landscape sizes,
  including focus return after discarding. `sales/checks.json` and screenshots.
- Two simulated visual-viewport keyboard checks for staff MOT and public WhatsApp:
  `shared/keyboard-checks.json`, including focused-field visibility and reset after
  closing. These are browser simulations, not physical iOS/Android device tests.

Checks covered bounds, horizontal overflow, title/close overlap, close target size,
scrolling, action visibility, focus containment/return, Escape, dirty edits, pending
saves, validation and stale asynchronous results. Provider responses were mocked
and browser data writes were blocked. No real customer messages, stock changes,
financial records, credentials, schedules or production configuration were changed.

This review prepares local code. It does not deploy the changes to Render.
