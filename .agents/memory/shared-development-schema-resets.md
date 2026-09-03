---
name: Shared development schema resets
description: Environment-specific precautions for schema changes in the shared development database.
---

The shared development database can be re-synced while work is in progress, leaving columns present but newly added tables missing. Apply only the verified missing DDL when that happens; do not use a broad schema push if unrelated branch tables are present.

**Why:** A re-sync removed the enquiry timeline table while retaining the enquiry columns, causing availability and enquiry creation to fail even though the application code and most of the schema looked correct.

**How to apply:** Before end-to-end verification, check both new columns and tables. If a table is missing, recreate that table and its indexes in a transaction, then rerun the affected API flow without touching stock or unrelated tables.