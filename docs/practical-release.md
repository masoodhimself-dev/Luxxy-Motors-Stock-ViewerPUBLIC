# Practical dealer release

Website chat, online card reservations, vehicle comparison and the public recent-handovers section are withdrawn from this release. Their settings controls and the primary Chat portal tab are hidden. Saved cars, enquiries, callbacks, appointments, staff deposits, manual reservation holds, sales and customer/vehicle history remain available.

The shared release policy lives in `lib/vehicle-meta/src/customer-feature-policy.ts`. It applies above saved dealership settings, so an existing enabled flag or an old browser cannot start a new chat or checkout. The real API and local development service use the same guard. Reintroduction requires a reviewed code release rather than a dealer changing a hidden setting.

This is not a data deletion. Existing settings and records remain stored. Authenticated staff can still open historical chat records from History, manage existing reservations and payments, and cancel a hold. Stripe status links, webhooks and recovery continue to handle already-created payments. No existing invoice, receipt, payment or deposit is erased, and staff can still reserve a vehicle by recording a deposit through Sales.

The public API returns `410` for withdrawn chat writes and new reservation submissions. Payment readiness reports `enabled: false`; the public handover endpoint returns an empty list. These responses require no changes to existing database rows or migrations.

The sales workspace is rebuilt around three steps: Deal details, Payments and Completion. Confirming a deposit reserves the vehicle and issues a receipt; subsequent confirmed payments each receive their own receipt. Pending entries do not reduce the balance. Completing a fully paid sale issues the invoice, approved sale terms and vehicle disclosures, and marks the vehicle sold so it leaves public stock. Collection or delivery is recorded separately afterwards.

The live document preview and newly archived PDFs share one renderer. Issued documents always open their original archive; existing PDFs are not regenerated. See [Sales workspace and invoices](sales-invoice-editor.md) for the workflow and implementation details.
