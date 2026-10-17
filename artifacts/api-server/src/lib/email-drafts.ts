import { sql } from "drizzle-orm";
import { db } from "@workspace/db";

// No provider/AI client is imported here. A draft can never send an email.
export async function readEmailDraft(
  dealer: string,
  enquiry: string,
  executor: typeof db = db,
) {
  const result = await executor.execute(
    sql`SELECT version,status,source,content,ai_generation_id AS "aiGenerationId",updated_at AS "updatedAt" FROM enquiry_email_drafts WHERE dealer_id=${dealer} AND enquiry_id=${enquiry}::uuid`,
  );
  const row = result.rows[0];
  return {
    version: Number(row?.version ?? 0),
    savedDraft:
      row && ["draft", "sending", "unknown"].includes(String(row.status))
        ? row
        : null,
  };
}
