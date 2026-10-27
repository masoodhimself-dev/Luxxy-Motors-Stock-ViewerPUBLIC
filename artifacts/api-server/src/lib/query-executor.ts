import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
/** Bind numbered SQL parameters through the caller's existing transaction. */
export const executorQuery =
  (
    executor:
      | Pick<typeof db, "execute">
      | {
          query: (
            text: string,
            values?: any[],
          ) => Promise<{ rows: Record<string, any>[] }>;
        },
  ) =>
  async (text: string, values: unknown[] = []) => {
    if (!("execute" in executor)) return executor.query(text, values);
    const chunks = text
      .split(/(\$[1-9][0-9]*)/g)
      .filter(Boolean)
      .map((chunk) =>
        /^\$[1-9][0-9]*$/.test(chunk)
          ? sql`${values[Number(chunk.slice(1)) - 1]}`
          : sql.raw(chunk),
      );
    const result = await executor.execute(sql.join(chunks, sql``));
    return { rows: result.rows as Record<string, any>[] };
  };
