import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { historyCursor, type HistoryCursor } from "./history-cursor";

export async function inventoryHistory(dealerId: string, input: { scope: "current" | "archived"; q: string; cursor: HistoryCursor | null }, database: Pick<typeof db, "execute"> = db) {
  const archived = sql`(v.archived_at IS NOT NULL OR v.inventory_status='archived')`;
  const scope = input.scope === "archived" ? archived : sql`v.archived_at IS NULL AND v.inventory_status<>'archived'`;
  const search = input.q ? sql`AND concat_ws(' ',v.website_title_override,v.title,v.plate,v.vrm,v.registration) ILIKE ${`%${input.q}%`}` : sql``;
  const cursor = input.cursor ? sql`AND (v.first_seen_at < ${input.cursor.at}::timestamptz OR (v.first_seen_at = ${input.cursor.at}::timestamptz AND v.id < ${input.cursor.id}::uuid))` : sql``;
  const [rows, counts, matched] = await Promise.all([
    database.execute(sql`SELECT v.id,coalesce(v.website_title_override,v.title) AS title,coalesce(v.website_price_override,v.source_price) AS price,v.plate,v.vrm,v.registration,v.year,v.mileage,v.fuel,v.transmission,v.inventory_status,v.source_status,v.missing_count,v.archived_at,
      coalesce(v.website_hero_image_override,(SELECT source_url FROM vehicle_images i WHERE i.vehicle_id=v.id AND i.is_active=true ORDER BY i.is_hero DESC,i.sort_order LIMIT 1)) AS photo,
      (SELECT count(*)::int FROM vehicle_service_photos photos WHERE photos.vehicle_id=v.id AND photos.dealer_id=v.dealer_id AND photos.category='service_book') AS service_photo_count,
      p.tasks,p.due_date,p.assigned_to_id,to_char(v.first_seen_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor_at
      FROM vehicles v LEFT JOIN vehicle_preparation p ON p.vehicle_id=v.id AND p.dealer_id=v.dealer_id
      WHERE v.dealer_id=${dealerId} AND ${scope} ${search} ${cursor}
      ORDER BY v.first_seen_at DESC,v.id DESC ${input.scope === "archived" ? sql`LIMIT 51` : sql``}`),
    database.execute(sql`SELECT count(*) FILTER (WHERE ${archived})::int AS archived,count(*) FILTER (WHERE NOT ${archived})::int AS current FROM vehicles v WHERE v.dealer_id=${dealerId}`),
    database.execute(sql`SELECT count(*)::int AS count FROM vehicles v WHERE v.dealer_id=${dealerId} AND ${scope} ${search}`),
  ]);
  const page = input.scope === "archived" ? rows.rows.slice(0, 50) : rows.rows;
  const last = page.at(-1);
  return {
    cars: page.map(({ cursor_at: _cursor, ...row }) => row),
    scope: input.scope,
    counts: { current: Number(counts.rows[0]?.current ?? 0), archived: Number(counts.rows[0]?.archived ?? 0) },
    matchedCount: Number(matched.rows[0]?.count ?? 0),
    nextCursor: input.scope === "archived" && rows.rows.length > 50 && last ? historyCursor({ at: String(last.cursor_at), id: String(last.id) }) : null,
  };
}
