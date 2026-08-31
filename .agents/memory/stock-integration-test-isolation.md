---
name: Stock integration test isolation
description: Guardrail for running the API stock integration suite without losing mirrored development inventory.
---

The stock integration suite currently uses and cleans the shared development database. Treat a run as destructive to development inventory unless the test database is isolated first.

**Why:** A requested frontend validation run left the public development showroom empty because the suite's cleanup removed the mirrored stock records.

**How to apply:** Before running the suite against a populated development environment, preserve a verified snapshot or configure an isolated test database. Afterward, verify public stock counts and safe vehicle/image fingerprints; restore development only from a read-only verified source if needed.