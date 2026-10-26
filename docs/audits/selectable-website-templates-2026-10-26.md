# Selectable customer website templates — 26 October 2026

Branch: `codex/selectable-website-templates`. Implemented and verified locally; not deployed.

## Behaviour and compatibility

Website → Homepage now offers Current website, Classic Showroom, Premium and Stock Focused. The optional `presentation.websiteTemplate` preference uses the existing tenant-scoped JSON settings, permission checks, revision checks, publication history and shared draft. No database migration or backfill is required. Omitted settings keep the existing website, and unrelated Settings saves by older clients preserve an already selected template. Current website is an explicit supported return option.

Selection and read-only preview never publish. The preview uses the actual React homepage, stock and vehicle components with the complete draft, current public stock and current customer feature access. Phone, iPad portrait, iPad landscape and desktop sizes are available. Links, forms, analytics and messages remain disabled in these snapshots. This is separate from the supplied interactive design prototype.

The new designs reuse existing Inter typography, solid icons, dealer logos, configured colours, hero photograph/focus, wording and public page sections. No temporary package icons, Georgia/Arial replacement fonts, prototype fixture data, provider adapter or mock contact/booking code was imported into the application.

- Classic: split photograph/search hero, balanced cards and a conventional vehicle summary.
- Premium: broad photograph, search strip, larger spacing and two-column catalogue.
- Stock Focused: search-led hero and compact catalogue with a desktop sidebar. An explicitly saved Grid/List preference takes priority; late-loading settings do not overwrite that preference.

The existing stock-derived budgets, manual featured selection, highest/lowest/middle automatic order, source/photo eligibility, filters, sorting, saved cars, comparison, watch confirmation flow, vehicle sheet, share tools, disclosures, richer Vehicle checks and booking/contact eligibility remain in the shared components. Styles are opt-in on the three showroom routes; staff, invoice, payment and enquiry workflows retain their existing styling and logic. The normal header theme contract and contrast adjustments are reused.

## Issues corrected

- The supplied combined review file's iframe blocked its own local form submissions. Its corrected copy permits forms while retaining the no-network policy.
- The supplied stock mock discarded sorting when applying filters. Sorting now survives submission.
- The supplied enlarged gallery and main photograph could lose synchronisation. Both counters, main photo and thumbnail now stay aligned. The real React gallery was retained and separately regression-tested.
- Legacy unpublished Settings drafts missing the new optional preference could be discarded after a different staff member selected the first template. Those edits and their original revision/baseline now survive; publishing is blocked by the existing conflict safeguard.
- Custom dark-page/light-panel colours exposed unreadable Premium toolbar/shortcut text and weak focus/description contrast. Template-specific surface bindings now keep these readable without altering saved colours or the existing website design.

Corrected prototype: `/private/tmp/luxxy-website-design-review-2026-10-26/Luxxy-Website-Design-Package-corrected.zip`. Original Downloads files were untouched. Its reports distinguish targeted correction checks from original screenshots/measurements.

## Verification

| Check | Result |
| --- | --- |
| Complete frontend suite | 206 files, 2,305 tests passed |
| API Settings content/validation | 16 tests passed |
| API publication/revision/restore | 7 tests passed |
| Root workspace typecheck and production build | Passed |
| Corrected prototype offline checks | 7 passed; JavaScript syntax and ZIP integrity passed |
| Actual draft pages at 390, 820, 1194, 1440 CSS px | 3 templates × 3 pages × 4 widths = 36 rendered snapshots; correct selected template, expected heading, no horizontal overflow |
| Preview/publish boundary | Separate local customer tab retained the original website while all templates were previewed; review showed only one template change before explicit local publication |
| Persistence/return | Published Stock Focused in the fictional local demo, reopened the homepage and confirmed selection; restored Current website and confirmed no template styling remained |
| Real stock search/sort | Searched from the new homepage, chose descending price, applied £5,000 advanced budget; sort remained descending and prices were £3,975, £3,875, £2,750 |
| Real gallery | Fullscreen next → close retained photograph 2/54; next inline advanced to 3/54 |
| Custom colours | Premium stock preview with dark page/light panels had readable toolbar and shortcut text on their actual white surfaces |
| Corrected combined prototype | Automatic filter submitted and returned two cars; price sort retained; enlarged gallery next/close/main next produced photographs 2 then 3 |
| Scope | No production settings, customer records, stock imports, invoices, payments, credentials, schedules or customer messages changed |

Browser evidence is under `output/website-templates/`, including the 36 checks and the Settings picker screenshot. These are responsive Chromium browser checks, not physical iPhone/iPad Safari tests. Provider delivery, physical touch/camera behaviour and cross-browser/device testing remain outside this local verification. The new preference is not enabled for any live dealership.
