# Sales VIN and invoice tax-guide attachment

VIN and the optional Road Tax guide question appear only on step 5, Review & create, for a full invoice. Deposit invoices keep their existing flow. VIN and the attachment preference are saved; old sales may omit both. Existing issued invoices and all calculations remain unchanged.

There is only a green V5C/2 new keeper slip guide. No no-logbook / V62 guide, standalone email endpoint or guide download control is available. The designed A4 guide retains dealership branding, registration, VIN when supplied, numbered instructions and official tax-service links.

Selecting Yes means the guide will accompany the full invoice when staff choose **Email invoice & tax guide** after issuing it. Creating the invoice, printing it or downloading its PDF does not generate or send a guide. Staff can enter the reference at review or after issuance. The number survives that transition only in page memory. Reloading requires re-entry. A valid 12-digit reference is required before the combined email can be sent.

`POST /api/sale-workspace/:id/documents/:documentId/email` retains its existing staff session, tenant scoping, same-origin protections and payments.record permission, and checks the customerEmails feature before work. The optional taxGuide.reference request value is used transiently to generate the additional PDF only when the immutable issued document is a full invoice with roadTaxGuide enabled. All vehicle details, VIN, branding and the email recipient come from the issued snapshot. The archived invoice bytes are attached unchanged. The guide is not archived or saved in the sale, request replay ledger, invoice snapshot or URLs. The reference is shared with the intended customer and email provider as part of the attachment; no AI is involved.

The existing invoice email idempotency and status handling remain in place. The guide uses the email request ID and attempt timestamp to produce deterministic attachment bytes. Provider acceptance is not described as confirmed delivery. Fixed guide-email error messages avoid copying provider request details into sale history. Local preview validates the same attachment requirements but never sends real emails.

## Verification

64 relevant frontend tests cover final-step placement, masked reference entry, preference/VIN persistence, absence of standalone controls, invoice creation/download without sending, and the single combined invoice-email request. Three attachment tests cover exact archived invoice bytes, unchanged snapshots, deterministic guide bytes, invalid references, opt-out, deposits, receipts and historical documents. The 22 existing sale-workspace tests also pass. Chrome viewport checks at 390, 820 and 1440 pixels confirm the simplified layout and no horizontal overflow. Typechecking and both production builds pass. No real customer emails were sent; provider delivery remains unverified by these local tests.
