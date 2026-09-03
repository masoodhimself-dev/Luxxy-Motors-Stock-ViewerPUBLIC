---
name: Shared development database across task environments
description: The dev DATABASE_URL is shared by every parallel task environment, and post-merge push-force drops anything not in that branch's schema.
---

Every parallel task environment for this project points `DATABASE_URL` at the **same** development Postgres database. There is no per-task database.

**Why it matters:** the post-merge script runs `drizzle-kit push --force`, which drops tables, enums and columns that are absent from the schema of whichever branch just merged. A branch that adds new tables will therefore see them vanish whenever a sibling branch merges or pushes, and a sibling's new tables will vanish when yours does. This is expected, not corruption.

**How to apply:**
- The repo schema is the source of truth, never the live dev database. If a table you added disappears mid-task, re-apply your generated migration; do not re-generate the schema to match the database.
- `pnpm --filter @workspace/db run push` needs a TTY for rename prompts and fails in agent shells. `push-force` is non-interactive but **destructive to a sibling's tables**. To apply your own migration without collateral damage, run the generated SQL by hand in one transaction:
  `psql "$DATABASE_URL" -v ON_ERROR_STOP=1 --single-transaction -f <(sed 's/--> statement-breakpoint//' lib/db/drizzle/<migration>.sql)`
- Objects your interrupted push already created must be dropped first; drop only the empty, colliding ones and verify unrelated tables afterwards.
- Never assume dev data belongs to you. Integration suites must namespace by `STOCK_DEALER_ID` and delete only their own rows.
- Everything lands properly at merge time anyway, because post-merge `push-force` recreates the merged schema.
