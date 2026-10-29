# All-dealership fresh-start preflight

This is an operator-only, read-only inventory of what a portal fresh start would affect. It does not authorize or execute deletion. There is no apply/reset/delete switch, HTTP endpoint, background worker or migration in this tool.

## Run the report

From the repository root in the existing service's internal Render shell:

```sh
node scripts/fresh-start-preflight.mjs --all-dealers --output /tmp/luxxy-fresh-start-preflight-2026-10-29.json
```

Use a fresh output name for another inspection. An existing file is never overwritten. The existing private `DATABASE_URL` supplies the connection; do not paste it into shell commands or chat. The script resolves the already-installed `pg` dependency from `lib/db`, without importing the database pool, application entrypoint, workers or tenant backfill. It requires no new dependency and does not alter external database access.

The database transaction is explicitly **read only / repeatable read**, verified before inspecting any business records. It uses a 60-second statement timeout, three-second lock timeout and a 60-second idle transaction timeout. It takes no row/advisory write locks and always ends with `ROLLBACK`. A timeout, schema mismatch, malformed count or database error stops the report; a partial result is not presented as a successful inspection.

The optional output file is created exclusively with owner-only `0600` permissions. It contains opaque record IDs, revisions and fingerprints, so keep it private. Stdout includes only per-dealership counts and a report fingerprint. The script does not log credentials, customer names/contact details, messages, document contents, provider tokens, raw SQL errors or database connection details.

Without `--output`, the script prints the aggregate summary without saving an exact-scope report. Use `--help` for the accepted arguments. The tool deliberately rejects `--apply` and other unrecognised arguments.

## What is counted

All registered dealerships are listed, including those with no enquiries or sales. Operational rows belonging to an unregistered tenant are surfaced separately, never silently assigned to another dealership. Counts include genuine, sample and test records; a name or test label is not proof that a record can be removed.

For each dealership the report includes:

- Enquiries, future appointments, booking history and known references to sales, deposits, declarations, merges, emails, replies, outbox work, sharing links, watch replies, push work and historical chat.
- Current `sale_workspace` sales, payment entries, issued document/invoice entries, reservations/sold status, source enquiry/reservation links, archives and customer access.
- Legacy sales, invoices, payments, documents, revisions, signatures, acknowledgements, fulfilments and vault artifacts.
- Customer records, leads/deposit history, historical online reservations, stock records, photos and invoice-number counters.
- Row counts and stable content fingerprints for the explicitly enumerated operational/protected tables, plus current foreign-key dependencies.

Exact enquiry/sale IDs, revisions and row fingerprints are included only in the private report. No list of eligible deletion candidates is produced. Every such record is marked `deletionEligibility: not_assessed`.

Malformed or missing sale ledger/document arrays, non-object states/drafts, malformed payment/document entries, mismatched duplicated payment ledgers and unknown lifecycle states are flagged. Unknown JSON is never treated as an empty financial history. Counts of known entries do not make a malformed record safe to delete.

## Protected scope and the remaining decision

The requested fresh start applies to **all dealerships**. An empty portal and retention of existing financial/customer history are different outcomes: issued invoices, payments and their linked sales cannot be removed merely by clearing a screen.

This tool does not delete, archive, hide, rewrite, void or renumber anything. It leaves invoices and archived PDFs, receipts, refunds, payment history, customer records, stock/status, reservations, counters, settings and staff access unchanged. It sends no messages and performs no stock import. It cannot establish that every existing sale is fictional.

Review the private report before agreeing the next scope:

1. Identify genuinely unused drafts and unlinked enquiries that staff intend to remove.
2. Retain financial sales and their linked customer/booking evidence. If a clean everyday view is desired, agree an explicit archive design that retains access to this history.
3. Review future bookings before any removal; deleting an enquiry can free its appointment slot without notifying the customer.
4. Review customer email reply routes and sharing links; enquiry deletion can remove routing/history or leave references outside foreign keys.
5. Keep invoice counters and all vehicle sale/reservation ownership unchanged. Never make sold/reserved cars available as a side effect of cleanup.

A future cleanup needs its own exact IDs, affected dependencies, unchanged revisions/fingerprints, recovery plan and transaction guards. This report is a consistent snapshot, not a durable backup or authorization token; records may change immediately after it completes. A later operation must recheck current state under the existing tenant locks.

## Verification

Lightweight mocked tests cover read-only transaction enforcement, rollback on failure/schema drift, all-dealership scope, unknown tenants, protected ledger counts, malformed JSON classification and redaction of command-line errors:

```sh
node --test scripts/fresh-start-preflight.test.mjs
```

These tests do not connect to any live or local database. Database SQL compatibility should additionally be verified against disposable fixtures before using the report on a service. Running the report itself never changes records.

The actual SQL is also checked against a disposable in-memory PGlite fixture with valid and malformed sale JSON, including scalar states and null/scalar payment/document entries. This exercises PostgreSQL operators and confirms the business rows are unchanged; it does not certify a live database's migration state:

```sh
node --test scripts/fresh-start-preflight-sql.test.mjs
```

For an existing internal SQL session that cannot run the new CLI before deployment, `scripts/fresh-start-counts.sql` provides the aggregate inspection only. It includes its own read-only repeatable-read transaction and rollback, returns counts without exact record IDs, and must not be modified into a cleanup script. The CLI's schema check and exact private scope report remain the fuller inspection.
