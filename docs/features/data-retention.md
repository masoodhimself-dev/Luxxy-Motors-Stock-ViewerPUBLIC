# Automatic data retention

The shared API runs maintenance on startup and hourly, with database locks for each active dealership. It needs no new Render service, disk, cron subscription or external storage. Migration `0025_data_retention` adds persisted retirement/archive timestamps and explicitly keeps PostgreSQL's `EXTENDED` storage for large vehicle JSON and sale state. PostgreSQL TOAST can compress sufficiently large JSON values automatically; JPEGs and PDFs may already be compressed and further savings are not guaranteed. Archiving does not delete a vehicle or its photos and does not rewrite invoices.

## Vehicles

A sold car, or an available car confirmed missing by the configured stock-feed threshold, becomes a retirement candidate. Maintenance records when it first observes that state and archives it after seven full days, checked hourly. Old records with no reliable retirement date start their clock on the first check; dates are not guessed from an unrelated edit. Reserved cars are excluded. Cars that become available/live again before archiving have their clock cleared.

Archived cars move out of the normal All cars list and remain in the Archived filter, with full details and private photos retained. `inventory_status` remains sold/available rather than being overwritten, so late payments and historical sale ownership checks continue to work. Public stock excludes archived rows. A later accepted import clears archive/retirement timestamps for a reappearing source car unless it is dealer-controlled sold or manually archived. It does not mark a missing advert sold or undo dealer-controlled sold status.

## Financial records

Issued invoices, PDF archives/checksums, terms snapshots, payment/refund entries and numbering counters are never deleted or rewritten by this worker. The policy records a conservative seven-year financial review horizon; this is not an automatic deletion deadline. UK accounting/VAT minimums, a dealer's financial-year end and any investigation/dispute hold must be considered before eventual disposal. There is no automatic financial purge.

## Abandoned drafts

Only a sale workspace untouched for more than 90 days can be deleted, and only with explicitly empty payment/document arrays, no PDF archives, provider payments, email deliveries, customer access/link, completion, retention hold, source enquiry/reservation, appointment or completed fulfilment. Nonzero legacy deposits and any connected reserved/sold vehicle or active reservation lead also prevent deletion. A maximum of 100 drafts per dealer is removed per check. Invoice/reference counters remain unchanged.

## Temporary data

Expired phone-upload sessions are removed after another seven days; uploaded photographs are retained. File cleanup only targets the exact UUID temporary-file naming pattern used by our private integration-settings atomic writer, after 24 hours. Normal settings files, current temporary files, symbolic links and unrelated OS temporary files are excluded. Application image/PDF processing uses memory and does not leave an on-disk photo cache for this worker to purge.

## Recovery and backups

This is an operational retention feature, not an independent backup implementation. Render's paid PostgreSQL recovery remains separate. The proposed nightly off-provider backup and restore drill are not configured by this change. Archived vehicle records remain in the same protected database.

## Verification

Isolated PostgreSQL-compatible tests check seven-day eligibility, the day-seven boundary, dealer separation, repeated runs, reserved/live protection, original financial records, abandoned draft pruning and conservative file deletion. Stock-import tests check reappearance clears the operational archive without losing staff plate overrides. Sales/inventory UI regression tests and builds also run before release. No customer emails or payments are sent by maintenance.
