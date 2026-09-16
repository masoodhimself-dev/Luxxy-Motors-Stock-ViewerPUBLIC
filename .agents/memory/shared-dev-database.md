---
name: Shared development database across task environments
description: Shared databases require reviewed migrations; merge hooks no longer change schemas.
---

Never assume a development DATABASE_URL is isolated. Replit task environments may
share a database. The post-merge hook now installs dependencies only; it must not
run schema pushes or migrations. The destructive push-force script was removed.

Use the repository schema and committed migrations as the source of truth. Read
`lib/db/MIGRATIONS.md` before applying changes. A database previously managed by
schema pushes needs a verified schema/journal baseline on a restored copy before
using the migration runner. Do not drop existing objects merely to make SQL pass.

Integration suites require an explicitly supplied loopback LUXXY_TEST_DATABASE_URL
with a luxxy_test_* database name. Never substitute a shared or production database.
