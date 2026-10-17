import { sql } from "drizzle-orm";
import { z } from "zod/v4";
import { db } from "@workspace/db";

/** Follow only saved merge relationships; matching contact details never joins cases. */
export async function enquiryCaseIds(
  dealerId: string,
  enquiryId: string,
): Promise<string[]> {
  if (!z.string().uuid().safeParse(enquiryId).success) return [];
  // UNION removes revisited IDs, including malformed cycles in historical data.
  // Both directions find ancestors, descendants and siblings from any case member.
  const result = await db.execute(sql`WITH RECURSIVE enquiry_case AS (
    SELECT id, merged_into_id FROM enquiries WHERE dealer_id=${dealerId} AND id=${enquiryId}::uuid
    UNION
    SELECT e.id, e.merged_into_id FROM enquiries e JOIN enquiry_case c
      ON e.id=c.merged_into_id OR e.merged_into_id=c.id
      WHERE e.dealer_id=${dealerId}
  ) SELECT id::text AS id FROM enquiry_case ORDER BY id`);
  return result.rows.map((row) => String(row.id));
}
