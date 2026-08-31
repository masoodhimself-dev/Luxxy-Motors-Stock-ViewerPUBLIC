/**
 * Replit Publish currently derives PostgreSQL changes with drizzle-kit push.
 * drizzle-kit 0.31.x adds altered-table foreign keys before altered-table
 * UNIQUE constraints, so Phase 2A must be published in two dependency-safe
 * stages. Runtime code and normal development commands always use "final".
 */
export const includeCompositeTenantForeignKeys =
  process.env.PHASE2A_SCHEMA_MODE !== "parent-keys";