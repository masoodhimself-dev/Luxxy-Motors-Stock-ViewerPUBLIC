import { backfillLuxxyTenant, db, pool } from "@workspace/db";

try {
  await backfillLuxxyTenant(db);
  process.stdout.write("Luxxy tenant foundation backfill complete.\n");
} finally {
  await pool.end();
}