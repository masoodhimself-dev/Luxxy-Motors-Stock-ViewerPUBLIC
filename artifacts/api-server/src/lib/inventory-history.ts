import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { historyCursor, type HistoryCursor } from "./history-cursor";


/** Compact activity projections only: never transfer enquiry contacts, source
 * payloads or gallery URLs into each staff inventory row. All joins use v's
 * dealer, including change provenance, so a shared advert cannot cross tenants. */
export const inventoryActivityFields = sql`activity.enquiry_count,activity.upcoming_test_drive_count,activity.next_test_drive_at,
  jsonb_build_object('checkedAt',latest_import.received_at,'items',
    coalesce(price_change.item,'[]'::jsonb)||coalesce(photo_change.item,'[]'::jsonb)||coalesce(detail_change.item,'[]'::jsonb)) AS stock_changes`;
export const inventoryActivityJoins = sql`
  LEFT JOIN LATERAL (
    SELECT count(*)::int AS enquiry_count,
      count(*) FILTER (WHERE e.appointment_cancelled_at IS NULL AND e.appointment_at>=now()
        AND e.attendance IN ('scheduled','arrived') AND (e.appointment_status IN ('pending','confirmed') OR e.appointment_status IS NULL))::int AS upcoming_test_drive_count,
      min(e.appointment_at) FILTER (WHERE e.appointment_cancelled_at IS NULL AND e.appointment_at>=now()
        AND e.attendance IN ('scheduled','arrived') AND (e.appointment_status IN ('pending','confirmed') OR e.appointment_status IS NULL)) AS next_test_drive_at
    FROM enquiries e WHERE e.dealer_id=v.dealer_id AND e.vehicle_id=v.id AND e.status<>'closed' AND e.merged_into_id IS NULL
  ) activity ON true
  LEFT JOIN stock_import_runs latest_import ON latest_import.id=v.import_run_id AND latest_import.dealer_id=v.dealer_id
    AND latest_import.status='completed' AND latest_import.complete=true
  LEFT JOIN LATERAL (
    SELECT CASE WHEN v.currency='GBP' AND jsonb_typeof(c.old_value)='number' AND jsonb_typeof(c.new_value)='number'
      AND c.new_value=to_jsonb(coalesce(v.website_price_override,v.source_price))
      AND c.old_value<>c.new_value
      THEN CASE WHEN (c.old_value#>>'{}')::numeric BETWEEN 1 AND 2147483647 AND (c.new_value#>>'{}')::numeric BETWEEN 1 AND 2147483647 THEN jsonb_build_array(jsonb_build_object('kind','price','changedAt',c.changed_at,'previousPrice',c.old_value,'currentPrice',c.new_value)) ELSE '[]'::jsonb END ELSE '[]'::jsonb END AS item
    FROM vehicle_changes c WHERE c.vehicle_id=v.id AND c.import_run_id=latest_import.id AND c.field_name='websitePublishedPrice'
      AND c.audit_metadata->>'dealerId'=v.dealer_id
      AND c.audit_metadata->>'fromCurrency'='GBP' AND c.audit_metadata->>'toCurrency'='GBP'
    ORDER BY c.changed_at DESC,c.id DESC LIMIT 1
  ) price_change ON true
  LEFT JOIN LATERAL (
    SELECT CASE WHEN jsonb_typeof(c.old_value)='array' AND jsonb_typeof(c.new_value)='array' AND c.old_value<>c.new_value
      THEN jsonb_build_array(jsonb_build_object('kind','photos','changedAt',c.changed_at,
        'previousPhotoCount',jsonb_array_length(c.old_value),'currentPhotoCount',jsonb_array_length(c.new_value))) ELSE '[]'::jsonb END AS item
    FROM vehicle_changes c WHERE c.vehicle_id=v.id AND c.import_run_id=latest_import.id AND c.field_name='sourceImages' AND v.first_seen_at<v.last_seen_at
    ORDER BY c.changed_at DESC,c.id DESC LIMIT 1
  ) photo_change ON true
  LEFT JOIN LATERAL (
    SELECT CASE WHEN count(*)>0 THEN jsonb_build_array(jsonb_build_object('kind','details','changedAt',max(detail.changed_at),
      'fields',jsonb_agg(DISTINCT detail.label))) ELSE '[]'::jsonb END AS item
    FROM (
      SELECT c.changed_at,CASE c.field_name
        WHEN 'title' THEN 'Name' WHEN 'make' THEN 'Make' WHEN 'model' THEN 'Model' WHEN 'variant' THEN 'Trim' WHEN 'trim' THEN 'Trim'
        WHEN 'year' THEN 'Year' WHEN 'mileage' THEN 'Mileage' WHEN 'fuel' THEN 'Fuel' WHEN 'transmission' THEN 'Gearbox'
        WHEN 'bodyType' THEN 'Body type' WHEN 'engineSize' THEN 'Engine' WHEN 'engineCC' THEN 'Engine'
        WHEN 'colour' THEN 'Colour' WHEN 'doors' THEN 'Doors' WHEN 'seats' THEN 'Seats' END AS label
      FROM vehicle_changes c WHERE c.vehicle_id=v.id AND c.import_run_id=latest_import.id AND v.first_seen_at<v.last_seen_at
        AND c.old_value IS DISTINCT FROM c.new_value
        AND c.field_name IN ('title','make','model','variant','trim','year','mileage','fuel','transmission','bodyType','engineSize','engineCC','colour','doors','seats')
      UNION ALL
      SELECT c.changed_at,known.label FROM vehicle_changes c
      CROSS JOIN LATERAL (VALUES
        ('Description',ARRAY['specifications','description']),('Description',ARRAY['sourceExtras','description']),('Description',ARRAY['sourceExtras','advertDescription']),
        ('Features',ARRAY['specifications','features']),('Features',ARRAY['sourceExtras','features']),('Features',ARRAY['sourceExtras','featureList'])
      ) known(label,path)
      WHERE c.vehicle_id=v.id AND c.import_run_id=latest_import.id AND v.first_seen_at<v.last_seen_at AND c.field_name='rawSourceData'
        AND CASE WHEN known.label='Description' THEN
          (CASE WHEN jsonb_typeof(c.old_value#>known.path)='string' THEN btrim(c.old_value#>>known.path) ELSE '' END)
          IS DISTINCT FROM (CASE WHEN jsonb_typeof(c.new_value#>known.path)='string' THEN btrim(c.new_value#>>known.path) ELSE '' END)
        ELSE (CASE WHEN jsonb_typeof(c.old_value#>known.path)='array' THEN c.old_value#>known.path ELSE '[]'::jsonb END)
          IS DISTINCT FROM (CASE WHEN jsonb_typeof(c.new_value#>known.path)='array' THEN c.new_value#>known.path ELSE '[]'::jsonb END) END
    ) detail
  ) detail_change ON true`;

export async function inventoryHistory(dealerId: string, input: { scope: "current" | "archived"; q: string; cursor: HistoryCursor | null }, database: Pick<typeof db, "execute"> = db) {
  const archived = sql`(v.archived_at IS NOT NULL OR v.inventory_status='archived')`;
  const scope = input.scope === "archived" ? archived : sql`v.archived_at IS NULL AND v.inventory_status<>'archived'`;
  const search = input.q ? sql`AND concat_ws(' ',v.website_title_override,v.title,v.plate,v.vrm,v.registration) ILIKE ${`%${input.q}%`}` : sql``;
  const cursor = input.cursor ? sql`AND (v.first_seen_at < ${input.cursor.at}::timestamptz OR (v.first_seen_at = ${input.cursor.at}::timestamptz AND v.id < ${input.cursor.id}::uuid))` : sql``;
  const [rows, counts, matched] = await Promise.all([
    database.execute(sql`SELECT v.id,coalesce(v.website_title_override,v.title) AS title,v.make,v.model,v.variant,v.trim,coalesce(v.website_price_override,v.source_price) AS price,v.plate,v.vrm,v.registration,v.year,v.mileage,v.fuel,v.transmission,v.body_type,v.engine_size,v.engine_cc,v.colour,v.doors,v.seats,v.inventory_status,v.source_status,v.missing_count,v.archived_at,
      coalesce(v.website_hero_image_override,(SELECT source_url FROM vehicle_images i WHERE i.vehicle_id=v.id AND i.is_active=true ORDER BY i.is_hero DESC,i.sort_order LIMIT 1)) AS photo,
      (SELECT count(*)::int FROM vehicle_service_photos photos WHERE photos.vehicle_id=v.id AND photos.dealer_id=v.dealer_id AND photos.category='service_book') AS service_photo_count,
      ${inventoryActivityFields},p.tasks,p.due_date,p.assigned_to_id,to_char(v.first_seen_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor_at
      FROM vehicles v LEFT JOIN vehicle_preparation p ON p.vehicle_id=v.id AND p.dealer_id=v.dealer_id ${inventoryActivityJoins}
      WHERE v.dealer_id=${dealerId} AND ${scope} ${search} ${cursor}
      ORDER BY v.first_seen_at DESC,v.id DESC ${input.scope === "archived" ? sql`LIMIT 51` : sql``}`),
    database.execute(sql`SELECT count(*) FILTER (WHERE ${archived})::int AS archived,count(*) FILTER (WHERE NOT ${archived})::int AS current FROM vehicles v WHERE v.dealer_id=${dealerId}`),
    database.execute(sql`SELECT count(*)::int AS count FROM vehicles v WHERE v.dealer_id=${dealerId} AND ${scope} ${search}`),
  ]);
  const page = input.scope === "archived" ? rows.rows.slice(0, 50) : rows.rows;
  const last = page.at(-1);
  return {
    dealerId,
    cars: page.map(({ cursor_at: _cursor, ...row }) => row),
    scope: input.scope,
    counts: { current: Number(counts.rows[0]?.current ?? 0), archived: Number(counts.rows[0]?.archived ?? 0) },
    matchedCount: Number(matched.rows[0]?.count ?? 0),
    nextCursor: input.scope === "archived" && rows.rows.length > 50 && last ? historyCursor({ at: String(last.cursor_at), id: String(last.id) }) : null,
  };
}
