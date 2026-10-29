import { stockPayloadHash } from "./stock-payload-hash";
import { createHash } from "node:crypto";
import type { CazooCsvResult } from "./cazoo-csv";

export type FeedSqlClient = {
  query(
    sql: string,
    values?: unknown[],
  ): Promise<{ rows: any[]; rowCount?: number | null }>;
  release(): void;
};
export type FeedSqlPool = { connect(): Promise<FeedSqlClient> };
export class CazooApplyError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
  }
}
/** Authority survives restarts and blocks old workers even while automatic application is paused. */
export async function officialCazooEnabled(
  dealerId: string,
  pool: FeedSqlPool,
) {
  const client = await pool.connect();
  try {
    return Boolean(
      (
        await client.query(
          "SELECT dealer_id FROM cazoo_feed_authority WHERE dealer_id=$1",
          [dealerId],
        )
      ).rows.length,
    );
  } finally {
    client.release();
  }
}
export function catalogueFingerprint(
  rows: readonly { id: string; inventory_status: string }[],
) {
  return createHash("sha256")
    .update(
      JSON.stringify(
        rows
          .map((r) => [r.id, r.inventory_status])
          .sort((a, b) => a[0].localeCompare(b[0])),
      ),
    )
    .digest("hex");
}
const columns: Record<string, string> = {
  title: "title",
  variant: "variant",
  make: "make",
  model: "model",
  trim: "trim",
  year: "year",
  price: "source_price",
  priceType: "price_type",
  currency: "currency",
  mileage: "mileage",
  mileageText: "mileage_text",
  registration: "registration",
  registrationBand: "registration_band",
  plate: "plate",
  vrm: "vrm",
  vrmVerified: "vrm_verified",
  fuel: "fuel",
  transmission: "transmission",
  bodyType: "body_type",
  engineSize: "engine_size",
  engineCC: "engine_cc",
  doors: "doors",
  seats: "seats",
  colour: "colour",
  emissionClass: "emission_class",
  drivetrain: "drivetrain",
  owners: "owners",
  writeOffCategory: "write_off_category",
  advertUrl: "advert_url",
  dealerName: "dealer_name",
  dealerLocation: "dealer_location",
  imageCount: "image_count",
  heroImage: "source_hero_image",
};
const fail = (code: string, message: string): never => {
  throw new CazooApplyError(code, message);
};
/** A single dealer-scoped transaction. Replacement is operator-only, never a scheduled option. */
export async function applyOfficialCazooFeed(
  pool: FeedSqlPool,
  input: {
    dealerId: string;
    candidate: CazooCsvResult;
    now?: Date;
    replace?: { expectedFingerprint: string; expectedFileHash: string };
  },
) {
  const { dealerId, candidate, replace } = input,
    now = input.now ?? new Date(),
    meta = candidate.metadata;
  if (
    meta.dealerId !== dealerId ||
    !/^AETA\d+$/.test(meta.feedId) ||
    !/^[a-f0-9]{64}$/.test(meta.sha256) ||
    meta.count !== candidate.cars.length ||
    !meta.count
  )
    fail(
      "invalid_candidate",
      "The complete official feed does not match this dealership.",
    );
  const capturedAt = new Date(meta.capturedAt);
  if (
    !Number.isFinite(capturedAt.getTime()) ||
    now.getTime() - capturedAt.getTime() > 86400000 ||
    capturedAt.getTime() > now.getTime() + 300000
  )
    fail("stale_file", "A fresh official file is required.");
  const ids = new Set<string>();
  for (const car of candidate.cars) {
    if (
      !/^AETV\d+$/.test(car.advertId) ||
      ids.has(car.advertId) ||
      car.sourceExtras?.officialFeed !== true ||
      car.sourceExtras?.sourcePlatform !== "cazoo"
    )
      fail("invalid_candidate", "Official vehicle identities must be unique.");
    if (
      car.price === null ||
      !Number.isInteger(car.price) ||
      car.price < 500 ||
      car.price > 10000000
    )
      fail("price_review", "An official vehicle price requires review.");
    ids.add(car.advertId);
  }
  if (replace && replace.expectedFileHash !== meta.sha256)
    fail(
      "file_changed",
      "The approved file changed. Prepare a new replacement preview.",
    );
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
      `stock-import:${dealerId}`,
    ]);
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
      `sale-workspace:${dealerId}`,
    ]);
    const dealer = (
      await client.query(
        "SELECT id,status,stock_platform,retailer_id FROM dealerships WHERE id=$1 FOR UPDATE",
        [dealerId],
      )
    ).rows[0];
    if (
      !dealer ||
      dealer.status !== "active" ||
      dealer.stock_platform !== "cazoo" ||
      dealer.retailer_id !== meta.retailerId
    )
      fail(
        "dealer_mismatch",
        "The active dealer connection does not match this file.",
      );
    const runId = `cazoo-csv:${dealerId}:${meta.capturedAt}:${meta.sha256}`;
    const prior = (
      await client.query(
        "SELECT id,status FROM stock_import_runs WHERE dealer_id=$1 AND run_id=$2",
        [dealerId, runId],
      )
    ).rows[0];
    if (prior) {
      if (prior.status !== "completed")
        fail("run_conflict", "The previous official import requires review.");
      await client.query("ROLLBACK");
      return {
        status: "replayed" as const,
        runId,
        created: 0,
        updated: 0,
        missing: 0,
        deleted: 0,
      };
    }
    const latest = (
      await client.query(
        "SELECT scraped_at FROM stock_import_runs WHERE dealer_id=$1 AND source='cazoo' AND status='completed' ORDER BY scraped_at DESC LIMIT 1",
        [dealerId],
      )
    ).rows[0];
    if (latest && new Date(latest.scraped_at).getTime() > capturedAt.getTime())
      fail("superseded", "A newer stock snapshot has already been applied.");
    const authority = (
      await client.query(
        "SELECT retailer_id,feed_id FROM cazoo_feed_authority WHERE dealer_id=$1",
        [dealerId],
      )
    ).rows[0];
    if (
      authority &&
      (authority.retailer_id !== meta.retailerId ||
        authority.feed_id !== meta.feedId)
    )
      fail("authority_mismatch", "The official feed identity has changed.");
    let existing = (
      await client.query(
        "SELECT * FROM vehicles WHERE dealer_id=$1 AND source='cazoo' FOR UPDATE",
        [dealerId],
      )
    ).rows;
    const legacy = existing.filter((r) => !/^AETV\d+$/.test(r.advert_id));
    if (legacy.length && !replace)
      fail(
        "replacement_required",
        "The initial catalogue replacement must be completed first.",
      );
    if (
      !replace &&
      existing.filter((r) => r.source_status === "live").length * 0.7 >
        candidate.cars.length
    )
      fail("stock_drop", "A large stock reduction requires review.");
    let deleted = 0;
    const backup = replace
      ? {
          vehicles: existing,
          images: (
            await client.query(
              "SELECT i.* FROM vehicle_images i JOIN vehicles v ON v.id=i.vehicle_id WHERE v.dealer_id=$1",
              [dealerId],
            )
          ).rows,
        }
      : undefined;
    if (replace) {
      if (catalogueFingerprint(existing) !== replace.expectedFingerprint)
        fail(
          "inventory_changed",
          "The catalogue changed after the replacement preview.",
        );
      const financial = (
        await client.query(
          "SELECT (SELECT count(*) FROM sale_workspace WHERE dealer_id=$1)+(SELECT count(*) FROM sales WHERE dealer_id=$1) AS count",
          [dealerId],
        )
      ).rows[0];
      if (Number(financial.count) > 0)
        fail(
          "business_records_changed",
          "New sales appeared after the zero-sales replacement preview.",
        );
      if (
        (
          await client.query(
            "SELECT count(*) AS count FROM customer_intake_sessions WHERE dealer_id=$1",
            [dealerId],
          )
        ).rows[0].count > 0
      )
        fail(
          "intake_changed",
          "Customer intake records require a fresh replacement review.",
        );
      // Explicitly replace the entire old catalogue; enquiry/lead snapshots survive SET NULL foreign keys.
      await client.query(
        "UPDATE customer_phone_shares SET revoked_at=$2 WHERE dealer_id=$1 AND revoked_at IS NULL",
        [dealerId, now],
      );
      await client.query("DELETE FROM vehicle_videos WHERE dealer_id=$1", [
        dealerId,
      ]);
      deleted = (
        await client.query(
          "DELETE FROM vehicles WHERE dealer_id=$1 AND source='cazoo' RETURNING id",
          [dealerId],
        )
      ).rows.length;
      existing = [];
      await client.query(
        "INSERT INTO cazoo_feed_authority(dealer_id,retailer_id,feed_id,enabled,activated_at) VALUES($1,$2,$3,true,$4) ON CONFLICT(dealer_id) DO UPDATE SET retailer_id=excluded.retailer_id,feed_id=excluded.feed_id,enabled=true,activated_at=excluded.activated_at",
        [dealerId, meta.retailerId, meta.feedId, now],
      );
    }
    const snapshot = {
      schemaVersion: 1,
      source: "cazoo-official-csv",
      retailerId: meta.retailerId,
      dealerName: candidate.cars[0].dealerName,
      scrapedAt: meta.capturedAt,
      count: meta.count,
      expectedAdvertCount: meta.count,
      complete: true,
      cars: candidate.cars,
      ...(backup ? { replacementBackup: backup } : {}),
    };
    const run = (
      await client.query(
        "INSERT INTO stock_import_runs(run_id,dealer_id,source,retailer_id,schema_version,scraped_at,expected_count,received_count,complete,status,raw_snapshot,payload_hash) VALUES($1,$2,'cazoo',$3,'1',$4,$5,$5,true,'processing',$6::jsonb,$7) RETURNING id",
        [
          runId,
          dealerId,
          meta.retailerId,
          capturedAt,
          meta.count,
          JSON.stringify(snapshot),
          stockPayloadHash(snapshot),
        ],
      )
    ).rows[0];
    let created = 0,
      updated = 0;
    const byId = new Map(existing.map((r) => [r.advert_id, r]));
    for (const car of candidate.cars) {
      const before = byId.get(car.advertId);
      if (
        before &&
        before.source_price > 0 &&
        Math.abs(car.price! - before.source_price) / before.source_price > 0.5
      )
        fail("price_change", "A large price change requires review.");
      const names = Object.values(columns),
        values = Object.keys(columns).map((k) => (car as any)[k] ?? null);
      const extras = {
        officialCazooFeed: {
          vehicleId: car.advertId,
          feedId: meta.feedId,
          fileHash: meta.sha256,
          capturedAt: meta.capturedAt,
        },
      };
      const fields = [
        ...names,
        "raw_source_data",
        "audit_metadata",
        "import_run_id",
        "last_seen_at",
      ];
      const params = [
        ...values,
        JSON.stringify(car),
        JSON.stringify(extras),
        run.id,
        now,
      ];
      const marks = params.map((_, i) => `$${i + 1}`);
      let saved;
      if (before) {
        const assignments = fields.map(
          (k, i) =>
            `${k}=${marks[i]}${k === "raw_source_data" || k === "audit_metadata" ? "::jsonb" : ""}`,
        );
        const auditIndex = fields.indexOf("audit_metadata");
        assignments[auditIndex] =
          `audit_metadata=coalesce(audit_metadata,'{}'::jsonb)||${marks[auditIndex]}::jsonb`;
        saved = (
          await client.query(
            `UPDATE vehicles SET ${assignments.join(",")},website_price_override=NULL,website_title_override=NULL,website_description=NULL,website_hero_image_override=NULL,pending_source_price=NULL,price_review_required=false,source_status=CASE WHEN inventory_status IN ('sold','hidden','archived') THEN source_status ELSE 'live' END,missing_count=0,updated_at=$${params.length} WHERE dealer_id=$${params.length + 1} AND id=$${params.length + 2} RETURNING *`,
            [...params, dealerId, before.id],
          )
        ).rows[0];
        updated++;
        if (
          before.source_price !== car.price &&
          ["available", "reserved"].includes(before.inventory_status) &&
          before.source_status === "live" &&
          !before.archived_at
        ) {
          await client.query(
            "INSERT INTO vehicle_changes(vehicle_id,import_run_id,field_name,old_value,new_value,audit_metadata) VALUES($1,$2,'websitePublishedPrice',$3::jsonb,$4::jsonb,$5::jsonb)",
            [
              saved.id,
              run.id,
              JSON.stringify(
                before.website_price_override ?? before.source_price,
              ),
              JSON.stringify(car.price),
              JSON.stringify({
                reason: "Official Cazoo CSV price change",
                dealerId,
                fromCurrency: "GBP",
                toCurrency: "GBP",
              }),
            ],
          );
        }
      } else {
        saved = (
          await client.query(
            `INSERT INTO vehicles(${fields.join(",")},dealer_id,source,advert_id,first_seen_at) VALUES(${marks.map((m, i) => m + (["raw_source_data", "audit_metadata"].includes(fields[i]) ? "::jsonb" : "")).join(",")},$${params.length + 1},'cazoo',$${params.length + 2},$${params.length}) RETURNING *`,
            [...params, dealerId, car.advertId],
          )
        ).rows[0];
        created++;
      }
      await client.query(
        "UPDATE vehicle_images SET is_active=false WHERE vehicle_id=$1 AND origin='source' AND NOT(source_url=ANY($2::text[]))",
        [saved.id, car.images.map((i) => i.url)],
      );
      const images = car.images.map((image, i) => ({
        url: image.url,
        caption: image.caption ?? null,
        sort_order: i,
        is_hero: i === 0,
      }));
      if (images.length)
        await client.query(
          "INSERT INTO vehicle_images(vehicle_id,origin,source_url,caption,sort_order,is_hero,is_active) SELECT $1,'source',x.url,x.caption,x.sort_order,x.is_hero,true FROM jsonb_to_recordset($2::jsonb) AS x(url text,caption text,sort_order integer,is_hero boolean) ON CONFLICT(vehicle_id,source_url) DO UPDATE SET caption=excluded.caption,sort_order=excluded.sort_order,is_hero=excluded.is_hero,is_active=true,last_seen_at=$3 WHERE vehicle_images.origin='source'",
          [saved.id, JSON.stringify(images), now],
        );
    }
    const missing = (
      await client.query(
        "UPDATE vehicles SET source_status='missing',missing_count=missing_count+1,import_run_id=$2 WHERE dealer_id=$1 AND source='cazoo' AND NOT(advert_id=ANY($3::text[])) RETURNING id",
        [dealerId, run.id, [...ids]],
      )
    ).rows.length;
    await client.query(
      "UPDATE stock_import_runs SET status='completed',added_count=$2,changed_count=$3,missing_count=$4 WHERE id=$1",
      [run.id, created, updated, missing],
    );
    await client.query("COMMIT");
    return {
      status: "imported" as const,
      runId,
      created,
      updated,
      missing,
      deleted,
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

/** Restart-safe apply retry using the saved private candidate. No SFTP secrets or customer messages. */
export async function applyCollectedOfficialCazoo(pool: FeedSqlPool) {
  const connection = await pool.connect();
  let dealers: string[];
  try {
    dealers = (
      await connection.query(
        "SELECT dealer_id FROM cazoo_feed_authority WHERE enabled=true",
      )
    ).rows.map((row) => row.dealer_id);
  } finally {
    connection.release();
  }
  if (dealers.length > 20)
    fail("configuration", "Too many official Cazoo apply dealerships.");
  const results = [];
  for (const dealerId of dealers) {
    const client = await pool.connect();
    let check;
    try {
      check = (
        await client.query(
          "SELECT * FROM cazoo_feed_checks WHERE dealer_id=$1 ORDER BY received_at DESC LIMIT 1",
          [dealerId],
        )
      ).rows[0];
      if (check?.status === "unchanged" && check.based_on_check_id)
        check = (
          await client.query(
            "SELECT * FROM cazoo_feed_checks WHERE dealer_id=$1 AND id=$2",
            [dealerId, check.based_on_check_id],
          )
        ).rows[0];
    } finally {
      client.release();
    }
    if (
      !check?.candidate ||
      !["ready", "blocked"].includes(check.status) ||
      (check.status === "blocked" && check.error_code !== "identity_review")
    )
      continue;
    results.push({
      dealerId,
      ...(await applyOfficialCazooFeed(pool, {
        dealerId,
        candidate: check.candidate,
      })),
    });
  }
  return results;
}
