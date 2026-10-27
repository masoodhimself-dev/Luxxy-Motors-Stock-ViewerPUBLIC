/** Staff history reads only deliberately selected public conversation fields, never session secrets. */
export async function readDealerChatRecords(
  dealerId: string,
  database: {
    query: (sql: string, parameters?: any[]) => Promise<{ rows: any[] }>;
  },
) {
  try {
    const result = await database.query(
      `SELECT record->'conversation' AS conversation,record->'messages' AS messages
      FROM dealer_chat CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(state->'records')='array' THEN state->'records' ELSE '[]'::jsonb END) record
      WHERE dealer_id=$1`,
      [dealerId],
    );
    return result.rows.map((record) => ({
      conversation: record.conversation,
      messages: Array.isArray(record.messages) ? record.messages : [],
    })) as Array<{ conversation: Record<string, any>; messages: any[] }>;
  } catch (error) {
    if ((error as { code?: string }).code === "42P01") return [];
    throw error;
  }
}
