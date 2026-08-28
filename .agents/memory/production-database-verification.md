---
name: Production database verification
description: How to prevent development data from being reported as production state.
---

Always run production count and incident queries with the production database target, and compare a non-secret database-resource fingerprint with development when an empty-state discrepancy appears.

**Why:** Development and production can legitimately have identical schemas but different row counts; an unlabeled all-zero query once appeared to show that a republish had erased production audit rows, while the actual production rows were intact.

**How to apply:** Label every reported database result with its environment. For continuity investigations, pair production counts with exact-row checks, managed migration history, live production endpoint checks, and hashed resource fingerprints; never expose connection details.