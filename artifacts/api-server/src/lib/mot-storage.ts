import { pool } from "@workspace/db";
import { createMotService } from "./mot-history";
import type { MotHistory } from "@workspace/vehicle-meta";
let pruned = 0;

// All tenants share public DVSA records and the platform credential, never customer data.
export async function reserveMotBudget(
  database: Pick<typeof pool, "query"> = pool,
) {
  const result = await database.query(`WITH buckets AS (
    SELECT 'second:' || floor(extract(epoch FROM now()))::text AS key, 4 AS maximum
    UNION ALL SELECT 'day:' || to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD'), 100000
  ), claimed AS (
    INSERT INTO mot_api_usage(bucket,count) SELECT key,1 FROM buckets ORDER BY key
    ON CONFLICT(bucket) DO UPDATE SET count=mot_api_usage.count+1
    WHERE mot_api_usage.count<(SELECT maximum FROM buckets WHERE key=excluded.bucket)
    RETURNING bucket
  ) SELECT count(*)::int AS claimed FROM claimed`);
  return result.rows[0]?.claimed === 2;
}
export async function readCachedMot(
  registration: string,
): Promise<MotHistory | null> {
  const result = await pool.query(
    "SELECT data FROM mot_history_cache WHERE registration=$1 AND expires_at>now()",
    [registration],
  );
  return (result.rows[0]?.data as MotHistory | null) ?? null;
}
export const motService = createMotService({
  credentials: () => {
    const clientId = process.env.DVSA_MOT_CLIENT_ID?.trim(),
      clientSecret = process.env.DVSA_MOT_CLIENT_SECRET?.trim(),
      apiKey = process.env.DVSA_MOT_API_KEY?.trim(),
      tokenUrl = process.env.DVSA_MOT_TOKEN_URL?.trim();
    return clientId && clientSecret && apiKey && tokenUrl
      ? { clientId, clientSecret, apiKey, tokenUrl }
      : null;
  },
  cache: {
    read: readCachedMot,
    async write(record) {
      await pool.query(
        "INSERT INTO mot_history_cache(registration,data,expires_at) VALUES($1,$2,now()+interval '24 hours') ON CONFLICT(registration) DO UPDATE SET data=excluded.data,expires_at=excluded.expires_at",
        [record.registration, record],
      );
      if (Date.now() - pruned > 3600000) {
        pruned = Date.now();
        await pool.query(
          "DELETE FROM mot_history_cache WHERE registration IN (SELECT registration FROM mot_history_cache WHERE expires_at<now() LIMIT 1000)",
        );
        await pool.query(
          "DELETE FROM mot_api_usage WHERE bucket NOT IN ('second:' || floor(extract(epoch FROM now()))::text,'day:' || to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD'))",
        );
      }
    },
  },
  reserve: () => reserveMotBudget(),
});
