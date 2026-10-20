# Sales VIN and Road Tax guide

VIN and guide options appear only on step 5, Review & create, for a full invoice. Deposit invoices keep their existing flow. VIN and route preference are saved; old sales may omit VIN. No existing issued invoices are changed.

Staff can choose the green V5C/2 slip or no-logbook / V62 guidance. The A4 PDF has dealer branding, registration, VIN when supplied, numbered instructions and official links. The green slip reference is validated as 12 digits, masked on screen, never stored with sale state, never added to invoice snapshots or URLs, and cleared after download or successful email acceptance.

Download runs in the browser. Email requires an explicit checkbox confirming the saved customer recipient and that the green slip reference will be included, if applicable. `POST /api/sale-workspace/:id/road-tax-guide/email` requires the existing staff session, same-origin write protections, sales.manage permission and customerEmails feature. It accepts expectedRevision, requestId, reference, route and confirmedRecipient. It generates the PDF from the saved tenant-scoped sale, not an uploaded attachment. The reference passes transiently through the API to the email provider and customer attachment; only recipient, route and delivery-attempt metadata are saved. No AI is used.

Provider acceptance is reported as accepted, not delivered. Replays of successful requests do not send again. Unconfirmed attempts can retry within 20 hours using the same provider idempotency key and deterministic attachment bytes. Fixed error messages avoid recording provider request details. Three new requests per sale per minute are allowed. Local preview never sends emails.

## No-logbook wording (checked 20 October 2026)

Do not promise every new buyer that a V62 permits immediate vehicle tax. GOV.UK distinguishes an existing registered keeper (replacement V5C and tax together, including eligible Post Office applications) from a new keeper without the green slip (apply by post for V5C first). The UI and PDF explain both. They include MOT/payment requirements and Northern Ireland insurance evidence, and state that the guide/application is not proof of tax.

Sources:
- https://www.gov.uk/tax-vehicle-without-v11-reminder
- https://www.gov.uk/government/publications/application-for-a-vehicle-registration-certificate
- https://www.postoffice.co.uk/identity/vehicle-tax

## Verification

65 frontend tests cover guide controls, confirmation, download, clearing the reference, VIN/choice persistence, deposit/full paths and existing invoices. Four email-service tests cover saved-recipient restrictions, stale requests, validation, duplicate replay, no-reference V62 PDFs, no secret persistence and deterministic provider retry. The 22 existing sale-workspace tests also pass. Chrome viewport walkthroughs at 390, 820 and 1440 pixels verify both downloads, conditional fields, email enablement, final-step placement and no horizontal overflow. Both sample PDFs were rendered and visually checked on A4. Typechecking and production builds pass. No real emails were sent; live provider delivery is not verified by these local tests.
