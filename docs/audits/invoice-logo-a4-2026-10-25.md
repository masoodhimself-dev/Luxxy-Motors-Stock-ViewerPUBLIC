# Uploaded dealership logos in new invoice PDFs

Date: 25 October 2026

## Problem and change

Shore Drive's new website logo is stored as an immutable uploaded website asset. Invoice PDF renderers accept embedded PNG/JPEG image bytes, so saving the asset URL in invoice branding did not put the logo into the PDF.

When issuing a new sale document, the server now reads the logo from `dealer_website_assets`, scoped by both the current dealer ID and asset UUID, and embeds a raster copy in that document's branding snapshot before archiving the PDF. Canonical same-origin uploaded-asset URLs and the corresponding relative asset paths are supported. No arbitrary URL is fetched. Existing valid inline PNG/JPEG logos remain supported; WebP is converted to PNG. Image size, dimensions, MIME and decoding are bounded and validated. An unusable optional logo retains the dealer-name fallback.

The same freezing step covers new Stripe reservation deposit/refund documents. Invoice calculations, payment commands, lifecycle rules and PDF layout code are unchanged.

## Preservation

- Issued documents and their archived PDF bytes are not rehydrated or regenerated with the new logo.
- Draft saves and idempotent retries do not read the logo or rewrite old documents.
- Download, email attachment and WhatsApp attachment links continue to use the saved document archive.
- No live invoices, payments or customer messages were created or changed during this work.
- No migration is required. This code change has not been deployed to Render.

## Verification

All 144 relevant checks passed:

| Checks | Passed |
| --- | ---: |
| Invoice verification, settings, PDF layouts, sales domain/HTTP and uploaded-logo regression suite | 91 |
| Connected sales, Stripe deposits/refunds, rollback and concurrent-payment protection | 7 |
| Archived invoice email attachments and road-tax-guide selection | 3 |
| Media/QR sharing, frozen invoice attachments, customer matching and tenant isolation | 38 |
| Two-dealer tenancy regression suite | 2 |
| Bounded public history and protected financial records | 3 |

The API production build, TypeScript check and `git diff --check` also passed. Native canvas is externalized in the affected test builders, matching the existing production build. Two pre-existing stale test expectations were corrected: the protected but unmounted `/viewing/:token/change` route remains a 404, and sale history already returns `emptyDraftDeletable: false` for records containing invoices/payments. The latter failure was independently reproduced against baseline commit `2d009e5` before changing its test expectation.

## A4 review

Generated fictional deposit and full-payment invoices through the existing Classic Ledger renderer with Shore Drive's actual uploaded 1200 × 320 logo, car photo, badge-free registration plate and 14 confirmed payments. Both PDFs were rendered and visually inspected. Each is exactly one A4 page (595.28 × 841.89 points), with no clipping, overlapping sections or text outside the page. The logo retains its proportions at approximately 38 × 10.1 mm.

- `output/pdf/shore-drive-logo-deposit-sample.pdf`: £24,950 sale, £1,400 received, £23,550 remaining.
- `output/pdf/shore-drive-logo-full-sample.pdf`: £24,950 sale, £24,950 received, £0 remaining.

These are marked fictional samples, not issued invoices. PDF geometry and rendered output were verified; a physical printer was not tested.
