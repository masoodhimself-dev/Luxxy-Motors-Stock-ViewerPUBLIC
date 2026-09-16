# Database migrations

Merging code does not apply database changes. `scripts/post-merge.sh` only installs
locked dependencies. The `push-force` script has been removed.

Generate SQL from the committed schema and migration snapshot with:

```sh
DATABASE_URL=postgresql://unused:unused@127.0.0.1:1/unused pnpm --filter @workspace/db run generate
```

Generation does not connect to PostgreSQL. Review the SQL and commit its snapshot
and journal entry together. Do not rewrite migrations that may already be applied.

Apply reviewed migrations manually to an explicitly selected database:

```sh
DATABASE_URL="$LOCAL_DATABASE_URL" pnpm --filter @workspace/db run migrate
```

Do not run this command against Replit production as part of the current milestone.
The migration runner records applied migrations in `drizzle.__drizzle_migrations`;
subsequent runs skip them. Schema `push` is not a replacement for migration history.

## Migration 0011

`0011_reconcile_portal_and_enquiry_events.sql` brings the previous migration
snapshot into line with the current Drizzle schema. It adds:

- `portal_users`, with staff identity indexes;
- `enquiry_events`, its enums, foreign keys and timeline indexes;
- seven enquiry columns: reference, part-exchange registration/mileage/condition,
  cancellation time, manage-token hash and visitor ID;
- unique reference/token indexes and a visitor index.

It replaces the appointment uniqueness index with a partial index excluding
cancelled appointments. It does not drop tables or columns, delete records, or
rewrite commercial data. When applied to an older schema, the new non-null
`reference` column generates a reference for each existing enquiry. Creating
indexes and adding columns still require database locks; a reference collision
would fail the unique index and roll back the migration.

Some Replit databases may already contain these objects because they were created
by schema pushes, without migration journal entries. **Do not blindly run the
historical migrations against such a database.** First back up and restore a copy,
compare its schema and journal to the committed migrations, and reconcile that
copy. Do not drop existing objects to make migrations pass or mark unapplied SQL
as applied without a verified schema comparison. No production baseline is changed
by this commit.

## Isolated verification

Every API integration suite requires `LUXXY_TEST_DATABASE_URL`: a PostgreSQL URL
using `127.0.0.1` or `::1`, a database named `luxxy_test_*`, and no URL query overrides.
An inherited `DATABASE_URL` is never used as a fallback. External HTTP requests are
blocked and synthetic authentication credentials are used.

Create two disposable local databases yourself: one for API tests and a new empty
one for migration verification. Point the following variables at those databases:

```sh
DATABASE_URL="$LOCAL_API_TEST_DATABASE_URL" pnpm --filter @workspace/db run migrate
LUXXY_TEST_DATABASE_URL="$LOCAL_API_TEST_DATABASE_URL" pnpm --filter @workspace/api-server test
LUXXY_TEST_DATABASE_URL="$EMPTY_LOCAL_MIGRATION_TEST_DATABASE_URL" pnpm --filter @workspace/api-server test:migrations
```

The API stock suite truncates data, so its database must be disposable. The migration
suite refuses a database containing public tables. It applies migrations 0000–0010,
seeds synthetic stock and an enquiry, applies 0011, checks data preservation, all
27 tables and their columns/indexes, booking uniqueness, and migration replay.
It leaves the synthetic verification data in the disposable database for inspection.
