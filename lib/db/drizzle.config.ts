import { defineConfig } from "drizzle-kit";
import path from "path";

// Replit's schema-diff publisher loads this config directly. Keep the next
// production publish on the parent-key stage; package scripts explicitly set
// PHASE2A_SCHEMA_MODE=final for normal development and migration generation.
process.env.PHASE2A_SCHEMA_MODE ??= "parent-keys";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL, ensure the database is provisioned");
}

export default defineConfig({
  schema: path.join(__dirname, "./src/schema/index.ts"),
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL,
  },
});
