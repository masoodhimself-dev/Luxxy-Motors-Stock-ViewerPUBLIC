# Phone settings workspace — 14 October 2026

Settings below 768px now opens a grouped menu rather than an editor/dropdown. Everyday settings contains Website, Email templates and Sales documents (plus chat only when the existing feature policy enables it). Connections, staff access and publication history sit in a collapsed Advanced settings group.

Website settings opens its own quick menu for showroom/contact/hours, photographs and booking visits, homepage and review/publish. Less frequent brand, page wording, services, brochure and business settings stay in a collapsed Website customisation group. Each section opens as a focused editor with a back control. URL parameters preserve navigation and support browser Back. Drafts continue to use the existing draft store; publication still validates the complete draft and requires review first. Validation opens the section containing the error. Back controls in the hub retain the existing unsaved-change confirmation for editors that discard changes when unmounted.

Phone rows have generous tap areas, controls are at least 48px tall, form text is 16px, and website publish actions are stacked in document flow rather than covering fields. Redundant headings and wizard navigation are hidden on phone. Desktop/tablet retain their existing layout and access checks. No backend configuration, credentials, stock or financial records were changed.

## Verification

- 20 tests passed across settings hub, website draft/publication, integration settings, sales paperwork, stock connection, reviews and settings preview.
- Added phone tests for collapsed advanced settings, opening/back navigation, protecting unsaved edits, preserving contact edits and a single reviewed publication using an isolated mocked API.
- TypeScript check and production frontend build passed. Build retains existing large-chunk/sourcemap warnings.
- Browser checked at 375×812 and 390×844: Settings menu, website menu, contact editor, browser Back and advanced connection screen; document width equals viewport width. Contact inputs measured 48px high with 16px text.
- At 820×1180 the wider settings navigation remains, with no document overflow.
- Screenshot: output/audits/settings-phone-2026-10-14.jpg (local fixture portal).

Physical iPhone Safari and authenticated live settings writes have not been exercised. Publishing tests used fixtures; no customer email, payment or live settings edit was submitted.
