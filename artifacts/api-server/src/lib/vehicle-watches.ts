import { vehicleWatchHistoryId } from "./vehicle-watch-history";
import { renderEmailTemplate } from "@workspace/vehicle-meta";
import {
  claimPriceUpdate,
  finishPriceUpdate,
  watchPriceIdentity,
  type PriceUpdateIdentity,
} from "./price-update-dedup";
import { createHash, createHmac, randomBytes, randomUUID } from "node:crypto";
import { pool } from "@workspace/db";
import {
  dealerIntegrationsStore,
  effectiveResendSettings,
  integrationReadiness,
} from "./dealer-integrations-store";
import { currentDealerId, multiTenantEnabled } from "./tenant-context";
import { dealerFeatureEnabled } from "./dealer-features";
import { siteUrl } from "./enquiry-links";
import { sendEmailWithSettings, EmailProviderError } from "./email-provider";
import { replyConfiguration } from "./customer-email-replies";
import { recordStockChangeContact } from "./stock-change-tasks";
import { activeStockPlatform } from "./stock-change-tasks";
import {
  vehicleWatchEventIsCurrent,
  vehicleWatchRecipientHasCommitment,
} from "./vehicle-watch-events";
type Row = Record<string, any>;
export type WatchQuery = {
  query: (query: string, params?: unknown[]) => Promise<{ rows: Row[] }>;
};
export class VehicleWatchError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}
export const watchTokenHash = (token: string) =>
  createHash("sha256").update(token).digest("hex");
export const validWatchToken = (token: unknown): token is string =>
  typeof token === "string" && /^[A-Za-z0-9_-]{43}$/.test(token);
export const normalWatchEmail = (value: string) => value.trim().toLowerCase();
const safeTitle = (v: Row) =>
  String(
    v.website_title_override ||
      v.title ||
      [v.make, v.model].filter(Boolean).join(" ") ||
      "This car",
  );
const iso = (v: unknown) => (v ? new Date(v as string).toISOString() : null);
async function watchHtml(subject: string, message: string) {
  const settings = await dealerIntegrationsStore.readPrivate();
  const dealer = (
    await pool.query("SELECT name FROM dealerships WHERE id=$1", [
      currentDealerId(),
    ])
  ).rows[0];
  return renderEmailTemplate(
    {
      subject: "Vehicle update",
      body: "{{message}}",
      headline: "{{vehicle_title}}",
    },
    {
      message,
      vehicle_title: subject,
      dealer_name: String(dealer?.name || "Your dealership"),
    },
    [],
    settings.appearance,
    { layoutVersion: "correspondence-v1" },
  ).html;
}
export async function watchEmailSettings() {
  const saved = await dealerIntegrationsStore.readPrivate();
  const config = effectiveResendSettings(saved);
  return {
    config,
    emailReady:
      integrationReadiness({ ...saved, resend: config }).resend.ready &&
      config.enabled &&
      (!multiTenantEnabled() || (await dealerFeatureEnabled("customerEmails"))),
  };
}
export async function readVehicleWatchSettings(query: WatchQuery = pool) {
  const row = (
    await query.query(
      "SELECT enabled,revision FROM vehicle_watch_settings WHERE dealer_id=$1",
      [currentDealerId()],
    )
  ).rows[0];
  const { emailReady } = await watchEmailSettings();
  return {
    enabled: row?.enabled ?? true,
    revision: Number(row?.revision ?? 0),
    emailReady,
    repliesReady: Boolean(replyConfiguration()),
  };
}
export async function saveVehicleWatchSettings(
  enabled: boolean,
  revision: number,
) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
      `watch-settings:${currentDealerId()}`,
    ]);
    const row = (
      await client.query(
        "SELECT revision FROM vehicle_watch_settings WHERE dealer_id=$1 FOR UPDATE",
        [currentDealerId()],
      )
    ).rows[0];
    if (Number(row?.revision ?? 0) !== revision)
      throw new VehicleWatchError(
        409,
        "These settings changed. Refresh before saving.",
      );
    await client.query(
      "INSERT INTO vehicle_watch_settings(dealer_id,enabled,revision) VALUES($1,$2,$3) ON CONFLICT(dealer_id) DO UPDATE SET enabled=excluded.enabled,revision=excluded.revision,updated_at=now()",
      [currentDealerId(), enabled, revision + 1],
    );
    await client.query("COMMIT");
    return readVehicleWatchSettings();
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}
/** Durable shared-process limit; keys contain only one-way address/IP hashes. */
export async function allowWatchRequest(
  email: string,
  ip: string,
  query: WatchQuery = pool,
) {
  const dealer = currentDealerId();
  for (const [kind, value, max] of [
    ["address", email, 5],
    ["network", ip, 60],
  ] as const) {
    const window = kind === "network" ? 3600000 : 86400000;
    const key = `${dealer}:${kind}:${watchTokenHash(value)}:${Math.floor(Date.now() / window)}`;
    const row = (
      await query.query(
        "INSERT INTO vehicle_watch_rate_limits(key,count,expires_at) VALUES($1,1,now()+interval '2 days') ON CONFLICT(key) DO UPDATE SET count=vehicle_watch_rate_limits.count+1 RETURNING count",
        [key],
      )
    ).rows[0];
    if (Number(row?.count) > max) return false;
  }
  await query.query(
    "DELETE FROM vehicle_watch_rate_limits WHERE expires_at<now()",
  );
  return true;
}
async function suppressed(email: string, query: WatchQuery = pool) {
  return Boolean(
    (
      await query.query(
        "SELECT 1 FROM enquiry_emails m JOIN email_delivery_checks c ON c.dealer_id=m.dealer_id AND c.message_key='enquiry:'||m.id::text AND c.provider_id=m.provider_id WHERE m.dealer_id=$1 AND lower(m.recipient)=$2 AND c.last_event IN ('bounced','complained','suppressed') LIMIT 1",
        [currentDealerId(), email],
      )
    ).rows.length,
  );
}
async function issueToken(
  email: string,
  purpose: "verify" | "manage",
  watchId: string | null,
  query: WatchQuery = pool,
) {
  const token = randomBytes(32).toString("base64url"),
    expiresAt = new Date(
      Date.now() + (purpose === "verify" ? 86400000 : 90 * 86400000),
    );
  await query.query(
    "INSERT INTO vehicle_watch_tokens(dealer_id,email,watch_id,purpose,token_hash,expires_at) VALUES($1,$2,$3,$4,$5,$6)",
    [
      currentDealerId(),
      email,
      watchId,
      purpose,
      watchTokenHash(token),
      expiresAt,
    ],
  );
  return { token, expiresAt: expiresAt.toISOString() };
}
export async function requestVehicleWatch(
  vehicleId: string,
  email: string,
  transport: typeof fetch = fetch,
) {
  const settings = await readVehicleWatchSettings();
  if (!settings.enabled || !settings.emailReady || (await suppressed(email)))
    return;
  const vehicle = (
    await pool.query(
      "SELECT * FROM vehicles WHERE id=$1 AND dealer_id=$2 AND inventory_status IN ('available','reserved') AND archived_at IS NULL AND missing_count<$3 AND source_status='live' AND source=$4",
      [
        vehicleId,
        currentDealerId(),
        Number(process.env.STOCK_MISSING_HIDE_THRESHOLD) || 2,
        await activeStockPlatform(),
      ],
    )
  ).rows[0];
  if (!vehicle) return;
  const client = await pool.connect();
  let token: { token: string; expiresAt: string } | undefined;
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
      `watch:${currentDealerId()}:${vehicleId}:${email}`,
    ]);
    const row = (
      await client.query(
        "INSERT INTO vehicle_watches(dealer_id,vehicle_id,email) VALUES($1,$2,$3) ON CONFLICT(dealer_id,vehicle_id,email) DO UPDATE SET updated_at=now() RETURNING id",
        [currentDealerId(), vehicleId, email],
      )
    ).rows[0];
    await client.query(
      "UPDATE vehicle_watch_tokens SET used_at=now() WHERE dealer_id=$1 AND email=$2 AND watch_id=$3 AND purpose='verify' AND used_at IS NULL",
      [currentDealerId(), email, row.id],
    );
    token = await issueToken(email, "verify", String(row.id), client);
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
  const { config } = await watchEmailSettings();
  const subject = `Confirm updates for ${safeTitle(vehicle)}`.slice(0, 200);
  const message = `You asked to watch ${safeTitle(vehicle)}.\n\nConfirm your email to receive price and availability updates for this car. No account is needed.\n\n${siteUrl("/watch")}#${token.token}\n\nThis confirmation link expires in 24 hours. If you did not request it, ignore this email. Nothing has been subscribed until you confirm.`;
  try {
    await sendEmailWithSettings(
      config,
      {
        to: email,
        subject,
        text: message,
        html: await watchHtml(subject, message),
        idempotencyKey: `watch-verification:${watchTokenHash(token.token)}`,
      },
      transport,
    );
  } catch {
    await pool.query(
      "UPDATE vehicle_watch_tokens SET used_at=now() WHERE dealer_id=$1 AND token_hash=$2",
      [currentDealerId(), watchTokenHash(token.token)],
    );
  }
}
export async function requestWatchManageLink(
  email: string,
  transport: typeof fetch = fetch,
) {
  const { config, emailReady } = await watchEmailSettings();
  if (!emailReady || (await suppressed(email))) return;
  const has = (
    await pool.query(
      "SELECT 1 FROM vehicle_watches WHERE dealer_id=$1 AND email=$2 AND email_verified_at IS NOT NULL LIMIT 1",
      [currentDealerId(), email],
    )
  ).rows.length;
  if (!has) return;
  const issued = await issueToken(email, "manage", null);
  const subject = "Manage your watched cars",
    message = `Use this private link to manage or stop the car updates you requested.\n\n${siteUrl("/watch")}#${issued.token}\n\nThis link expires in 90 days. If you did not request it, ignore this email.`;
  try {
    await sendEmailWithSettings(
      config,
      {
        to: email,
        subject,
        text: message,
        html: await watchHtml(subject, message),
        idempotencyKey: `watch-manage:${watchTokenHash(issued.token)}`,
      },
      transport,
    );
  } catch {
    await pool.query(
      "UPDATE vehicle_watch_tokens SET used_at=now() WHERE token_hash=$1",
      [watchTokenHash(issued.token)],
    );
  }
}
async function tokenRecord(
  token: string,
  query: WatchQuery = pool,
  lock = false,
) {
  if (!validWatchToken(token))
    throw new VehicleWatchError(
      410,
      "This private link is invalid or has expired. Request another link.",
    );
  const row = (
    await query.query(
      `SELECT * FROM vehicle_watch_tokens WHERE dealer_id=$1 AND token_hash=$2 AND used_at IS NULL AND expires_at>now()${lock ? " FOR UPDATE" : ""}`,
      [currentDealerId(), watchTokenHash(token)],
    )
  ).rows[0];
  if (!row)
    throw new VehicleWatchError(
      410,
      "This private link is invalid or has expired. Request another link.",
    );
  return row;
}
const hint = (email: string) => `${email.slice(0, 1)}…@${email.split("@")[1]}`;
export async function readVehicleWatches(token: string) {
  const capability = await tokenRecord(token);
  if (capability.purpose === "verify") {
    const v = (
      await pool.query(
        "SELECT v.* FROM vehicle_watches w JOIN vehicles v ON v.id=w.vehicle_id AND v.dealer_id=w.dealer_id WHERE w.id=$1 AND w.dealer_id=$2",
        [capability.watch_id, currentDealerId()],
      )
    ).rows[0];
    return {
      verificationRequired: true,
      vehicleTitle: v ? safeTitle(v) : "this car",
      emailHint: hint(capability.email),
    };
  }
  const rows = (
    await pool.query(
      "SELECT w.*,v.title,v.website_title_override,v.make,v.model,v.source_hero_image,v.website_hero_image_override,coalesce(v.website_price_override,v.source_price) AS current_price,v.currency FROM vehicle_watches w JOIN vehicles v ON v.id=w.vehicle_id AND v.dealer_id=w.dealer_id WHERE w.dealer_id=$1 AND w.email=$2 AND w.email_verified_at IS NOT NULL ORDER BY w.created_at DESC",
      [currentDealerId(), capability.email],
    )
  ).rows;
  return {
    verificationRequired: false,
    emailHint: hint(capability.email),
    expiresAt: iso(capability.expires_at),
    watches: rows.map((w) => ({
      id: w.id,
      vehicleId: w.vehicle_id,
      vehicleTitle: safeTitle(w),
      vehicleUrl: siteUrl(`/vehicle/${w.vehicle_id}`),
      imageUrl: w.website_hero_image_override || w.source_hero_image || null,
      currentPrice: w.current_price,
      currency: w.currency,
      status: w.status,
      verifiedAt: iso(w.email_verified_at),
    })),
  };
}
export async function verifyVehicleWatch(token: string) {
  const platform = await activeStockPlatform();
  const client = await pool.connect();
  let issued: { token: string; expiresAt: string };
  try {
    await client.query("BEGIN");
    const capability = await tokenRecord(token, client, true);
    if (capability.purpose !== "verify")
      throw new VehicleWatchError(
        409,
        "Use this link to manage your watched cars.",
      );
    const settings = (
      await client.query(
        "SELECT enabled FROM vehicle_watch_settings WHERE dealer_id=$1",
        [currentDealerId()],
      )
    ).rows[0];
    if (settings?.enabled === false)
      throw new VehicleWatchError(
        409,
        "Car updates are currently unavailable.",
      );
    const vehicle = (
      await client.query(
        "SELECT v.id FROM vehicle_watches w JOIN vehicles v ON v.id=w.vehicle_id AND v.dealer_id=w.dealer_id WHERE w.id=$1 AND w.dealer_id=$2 AND v.inventory_status IN ('available','reserved') AND v.archived_at IS NULL AND v.source_status='live' AND v.source=$3 AND v.missing_count<$4",
        [
          capability.watch_id,
          currentDealerId(),
          platform,
          Number(process.env.STOCK_MISSING_HIDE_THRESHOLD) || 2,
        ],
      )
    ).rows[0];
    if (!vehicle)
      throw new VehicleWatchError(
        409,
        "This car is no longer available for updates. Browse the current stock instead.",
      );
    await client.query(
      "UPDATE vehicle_watches SET status='active',email_verified_at=CASE WHEN status='active' THEN email_verified_at ELSE now() END,stopped_at=NULL,updated_at=now() WHERE id=$1 AND dealer_id=$2",
      [capability.watch_id, currentDealerId()],
    );
    await client.query(
      "UPDATE vehicle_watch_tokens SET used_at=now() WHERE id=$1",
      [capability.id],
    );
    issued = await issueToken(capability.email, "manage", null, client);
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
  return {
    verified: true,
    token: issued!.token,
    ...(await readVehicleWatches(issued!.token)),
  };
}
export async function stopVehicleWatch(token: string, id: string) {
  const capability = await tokenRecord(token);
  if (capability.purpose !== "manage")
    throw new VehicleWatchError(403, "Confirm your email first.");
  await pool.query(
    "UPDATE vehicle_watches SET status='stopped',stopped_at=now(),updated_at=now() WHERE id=$1 AND dealer_id=$2 AND email=$3",
    [id, currentDealerId(), capability.email],
  );
  await pool.query(
    "UPDATE vehicle_watch_tokens SET used_at=now() WHERE dealer_id=$1 AND watch_id=$2 AND email=$3 AND purpose='verify' AND used_at IS NULL",
    [currentDealerId(), id, capability.email],
  );
  return { stopped: true };
}
const pounds = (n: number | null) =>
  n == null
    ? ""
    : new Intl.NumberFormat("en-GB", {
        style: "currency",
        currency: "GBP",
        maximumFractionDigits: 0,
      }).format(n);
export function defaultWatchMessage(
  event: Row,
  vehicleTitle: string,
  vehicleUrl: string,
) {
  const line =
    event.kind === "price_drop"
      ? `The ${vehicleTitle} you are watching has been reduced from ${pounds(event.previous_price)} to ${pounds(event.current_price)} — a saving of ${pounds(event.previous_price - event.current_price)}.`
      : event.kind === "reserved"
        ? `The ${vehicleTitle} you are watching is currently reserved. You can keep watching and we will let you know if it becomes available again.`
        : event.kind === "available_again"
          ? `The ${vehicleTitle} you are watching is available again.`
          : `The ${vehicleTitle} you were watching has now sold. We will close updates for this car after this message.`;
  return {
    subject:
      `${vehicleTitle} — ${event.kind === "price_drop" ? "price reduced" : event.kind === "available_again" ? "available again" : event.kind}`.slice(
        0,
        200,
      ),
    message: `Hello,\n\n${line}\n\nView the car: ${vehicleUrl}\n\nIf you have any questions, reply to this email.`,
  };
}
async function eventCurrent(e: Row, platform?: string) {
  return vehicleWatchEventIsCurrent(
    {
      kind: e.kind,
      status: e.status,
      currentPrice: e.current_price,
      currentStatus: e.current_status,
    },
    {
      id: e.vehicle_id,
      dealerId: e.dealer_id,
      inventoryStatus: e.inventory_status,
      sourceStatus: e.source_status,
      source: e.source,
      archivedAt: e.archived_at,
      missingCount: Number(e.missing_count),
      currency: e.currency,
      websitePriceOverride: e.website_price_override,
      sourcePrice: e.source_price,
      priceReviewRequired: e.price_review_required,
    },
    {
      activePlatform: platform ?? (await activeStockPlatform()),
      missingThreshold: Number(process.env.STOCK_MISSING_HIDE_THRESHOLD) || 2,
    },
  );
}
async function readEvent(
  id: string,
  query: WatchQuery = pool,
  platform?: string,
) {
  const row = (
    await query.query(
      "SELECT e.*,v.title,v.website_title_override,v.make,v.model,v.inventory_status,v.source_price,v.website_price_override,v.currency,v.archived_at,v.missing_count,v.source_status,v.source,v.price_review_required FROM vehicle_watch_events e JOIN vehicles v ON v.id=e.vehicle_id AND v.dealer_id=e.dealer_id WHERE e.id=$1 AND e.dealer_id=$2",
      [id, currentDealerId()],
    )
  ).rows[0];
  if (!row || !(await eventCurrent(row, platform)))
    throw new VehicleWatchError(
      409,
      "This car or update has changed. Refresh and review the latest information.",
    );
  return row;
}
async function recipients(e: Row, query: WatchQuery = pool) {
  const rows = (
    await query.query(
      `SELECT w.id,w.email,coalesce(d.status,'pending') AS status,d.sent_at,d.request_id FROM vehicle_watches w LEFT JOIN vehicle_watch_deliveries d ON d.watch_id=w.id AND d.event_id=$1 AND d.dealer_id=w.dealer_id WHERE w.dealer_id=$2 AND w.vehicle_id=$3 AND w.status='active' AND w.email_verified_at<=$4 AND NOT EXISTS(SELECT 1 FROM enquiry_emails m JOIN email_delivery_checks c ON c.dealer_id=m.dealer_id AND c.message_key='enquiry:'||m.id::text AND c.provider_id=m.provider_id WHERE m.dealer_id=w.dealer_id AND lower(m.recipient)=w.email AND c.last_event IN ('bounced','complained','suppressed')) AND NOT EXISTS(SELECT 1 FROM stock_change_contact_events c JOIN stock_change_tasks t ON t.id=c.task_id AND t.dealer_id=c.dealer_id WHERE c.dealer_id=w.dealer_id AND c.vehicle_id=w.vehicle_id AND c.customer_email=w.email AND c.contacted_at>=$4 AND $5='price_drop' AND t.current_price=$6) AND ($5<>'price_drop' OR NOT EXISTS(SELECT 1 FROM price_update_recipient_claims c WHERE c.dealer_id=w.dealer_id AND c.vehicle_id=w.vehicle_id AND c.email=w.email AND c.change_key=$7 AND (d.id IS NULL OR c.source_key<>'watch:'||d.id::text||':'||d.request_id::text))) ORDER BY CASE WHEN coalesce(d.status,'pending') IN ('pending','failed') THEN 0 ELSE 1 END,w.created_at,w.id`,
      [
        e.id,
        currentDealerId(),
        e.vehicle_id,
        e.occurred_at,
        e.kind,
        e.current_price,
        String(e.change_key).replace(/^price:/, ""),
      ],
    )
  ).rows;
  const eligible = [];
  for (const row of rows)
    if (
      !(await vehicleWatchRecipientHasCommitment(
        (q, p) => query.query(q, p),
        currentDealerId(),
        String(e.vehicle_id),
        String(row.email),
      ))
    )
      eligible.push(row);
  return eligible;
}
export async function readVehicleWatchTasks() {
  const events = (
    await pool.query(
      "SELECT e.*,v.title,v.website_title_override,v.make,v.model,v.inventory_status,v.source_price,v.website_price_override,v.currency,v.archived_at,v.missing_count,v.source_status,v.source,v.price_review_required FROM vehicle_watch_events e JOIN vehicles v ON v.id=e.vehicle_id AND v.dealer_id=e.dealer_id WHERE e.dealer_id=$1 AND e.status='open' AND EXISTS(SELECT 1 FROM vehicle_watches w LEFT JOIN vehicle_watch_deliveries d ON d.watch_id=w.id AND d.event_id=e.id AND d.dealer_id=w.dealer_id WHERE w.dealer_id=e.dealer_id AND w.vehicle_id=e.vehicle_id AND w.status='active' AND w.email_verified_at<=e.occurred_at AND coalesce(d.status,'pending') NOT IN ('sent','skipped')) ORDER BY e.created_at DESC",
      [currentDealerId()],
    )
  ).rows;
  const tasks = [];
  for (const e of events) {
    if (!(await eventCurrent(e))) continue;
    const people = await recipients(e),
      pendingCount = people.filter((p) =>
        ["pending", "failed"].includes(p.status),
      ).length,
      uncertainCount = people.filter((p) =>
        ["uncertain", "processing"].includes(p.status),
      ).length;
    if (!pendingCount && !uncertainCount) continue;
    const vehicleTitle = safeTitle(e),
      vehicleUrl = siteUrl(`/vehicle/${e.vehicle_id}`);
    tasks.push({
      id: e.id,
      vehicleId: e.vehicle_id,
      vehicleTitle,
      vehicleUrl,
      kind: e.kind,
      revision: e.revision,
      previousPrice: e.previous_price,
      currentPrice: e.current_price,
      createdAt: iso(e.created_at),
      ...defaultWatchMessage(e, vehicleTitle, vehicleUrl),
      recipients: people.slice(0, 100).map((p) => ({
        id: p.id,
        email: p.email,
        status: p.status === "processing" ? "uncertain" : p.status,
        sentAt: iso(p.sent_at),
      })),
      pendingCount,
      uncertainCount,
      totalCount: people.length,
    });
    if (tasks.length >= 100) break;
  }
  return { tasks, total: tasks.length };
}
export async function readVehicleWatchCounts() {
  return {
    counts: (
      await pool.query(
        "SELECT vehicle_id,count(*)::integer AS count FROM vehicle_watches WHERE dealer_id=$1 AND status='active' AND email_verified_at IS NOT NULL GROUP BY vehicle_id",
        [currentDealerId()],
      )
    ).rows.map((r) => ({ vehicleId: r.vehicle_id, count: r.count })),
  };
}
export type WatchPreview = {
  subject: string;
  message: string;
  expectedRevision: number;
  watchIds: string[];
};
function previewHash(e: Row, input: WatchPreview, people: Row[]) {
  const secret = process.env.SESSION_SECRET;
  if (!secret)
    throw new VehicleWatchError(
      503,
      "Message review is temporarily unavailable.",
    );
  return createHmac("sha256", secret)
    .update(
      JSON.stringify([
        currentDealerId(),
        e.id,
        e.revision,
        input.subject,
        input.message,
        people
          .map((p) => [p.id, p.email])
          .sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
      ]),
    )
    .digest("hex");
}
export async function previewVehicleWatchTask(id: string, input: WatchPreview) {
  const e = await readEvent(id);
  if (e.revision !== input.expectedRevision)
    throw new VehicleWatchError(
      409,
      "This update changed. Refresh before sending.",
    );
  const requested = new Set(input.watchIds);
  const people = (await recipients(e)).filter(
    (p) => requested.has(p.id) && ["pending", "failed"].includes(p.status),
  );
  if (people.length !== requested.size)
    throw new VehicleWatchError(
      409,
      "The customer list changed. Refresh and review it again.",
    );
  const settings = await readVehicleWatchSettings();
  return {
    subject: input.subject,
    message: input.message,
    recipients: people.map((p) => ({ id: p.id, email: p.email })),
    previewHash: previewHash(e, input, people),
    expectedRevision: e.revision,
    ready: settings.enabled && settings.emailReady && people.length > 0,
  };
}
/** Recover post-acceptance history without contacting the provider again. */
async function repairWatchDelivery(id: string, staffName: string) {
  const d = (
    await pool.query(
      "SELECT d.*,w.vehicle_id,w.email,e.kind,e.change_key,e.current_price FROM vehicle_watch_deliveries d JOIN vehicle_watches w ON w.id=d.watch_id AND w.dealer_id=d.dealer_id JOIN vehicle_watch_events e ON e.id=d.event_id AND e.dealer_id=d.dealer_id WHERE d.id=$1 AND d.dealer_id=$2 AND d.status='sent'",
      [id, currentDealerId()],
    )
  ).rows[0];
  if (!d) return;
  if (d.kind === "price_drop")
    await finishPriceUpdate(
      (q, p) => pool.query(q, p),
      watchPriceIdentity(
        {
          dealer_id: String(d.dealer_id),
          vehicle_id: String(d.vehicle_id),
          change_key: String(d.change_key),
        },
        String(d.email),
      ),
      `watch:${d.id}:${d.request_id}`,
      "sent",
    );
  const enquiries = (
    await pool.query(
      "SELECT e.id,t.id AS task_id FROM enquiries e LEFT JOIN stock_change_tasks t ON t.dealer_id=e.dealer_id AND t.vehicle_id=e.vehicle_id AND t.kind='price_drop' AND t.change_key=$4 WHERE e.dealer_id=$1 AND e.vehicle_id=$2 AND lower(e.email)=$3 AND e.merged_into_id IS NULL",
      [
        currentDealerId(),
        d.vehicle_id,
        d.email,
        String(d.change_key).replace(/^price:/, ""),
      ],
    )
  ).rows;
  for (const enq of enquiries) {
    const eventId = vehicleWatchHistoryId(String(d.id), String(enq.id));
    const inserted = (
      await pool.query(
        "INSERT INTO enquiry_events(id,dealer_id,enquiry_id,kind,actor,summary,detail,occurred_at) VALUES($1,$2,$3,'conversation_logged','dealer','Car watch update emailed',$4::jsonb,$5) ON CONFLICT(id) DO NOTHING RETURNING id",
        [
          eventId,
          currentDealerId(),
          enq.id,
          JSON.stringify({
            channel: "email",
            direction: "outbound",
            note: String(d.message),
            vehicleWatchDeliveryId: d.id,
          }),
          d.sent_at,
        ],
      )
    ).rows.length;
    if (inserted)
      await pool.query(
        "UPDATE enquiries SET workspace_revision=workspace_revision+1,updated_at=now() WHERE id=$1 AND dealer_id=$2",
        [enq.id, currentDealerId()],
      );
    if (d.kind === "price_drop" && enq.task_id)
      await recordStockChangeContact({
        dealerId: currentDealerId(),
        taskId: enq.task_id,
        enquiryId: enq.id,
        channel: "email",
        eventKey: `vehicle-watch:${d.id}:${enq.id}`,
        staffName,
        now: new Date(d.sent_at),
      });
  }
  if (d.kind === "sold")
    await pool.query(
      "UPDATE vehicle_watches SET status='stopped',stopped_at=coalesce(stopped_at,$3),updated_at=now() WHERE id=$1 AND dealer_id=$2",
      [d.watch_id, currentDealerId(), d.sent_at],
    );
}
export async function sendVehicleWatchTask(
  id: string,
  input: WatchPreview & { previewHash: string; requestId: string },
  staffName: string,
  transport: typeof fetch = fetch,
) {
  const result = {
    sentCount: 0,
    skippedCount: 0,
    failedCount: 0,
    uncertainCount: 0,
    message: "Messages are sent only after staff approval.",
  };
  const prior = (
    await pool.query(
      "SELECT id,status FROM vehicle_watch_deliveries WHERE dealer_id=$1 AND event_id=$2 AND request_id=$3",
      [currentDealerId(), id, input.requestId],
    )
  ).rows;
  if (prior.length) {
    for (const p of prior)
      if (p.status === "sent") {
        result.sentCount++;
        await repairWatchDelivery(String(p.id), staffName).catch(() => {});
      } else if (p.status === "failed") result.failedCount++;
      else if (p.status === "skipped") result.skippedCount++;
      else result.uncertainCount++;
    return result;
  }
  const approved = await previewVehicleWatchTask(id, input);
  if (approved.previewHash !== input.previewHash || !approved.ready)
    throw new VehicleWatchError(
      409,
      "Review this message again before sending.",
    );
  for (const person of approved.recipients) {
    const platform = await activeStockPlatform();
    const client = await pool.connect();
    let delivery: Row | undefined;
    let priceIdentity: PriceUpdateIdentity | undefined;
    let claimSource = "";
    let capability: { token: string; expiresAt: string } | undefined;
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
        `watch-send:${currentDealerId()}:${id}:${person.id}`,
      ]);
      const e = await readEvent(id, client, platform);
      if (e.revision !== input.expectedRevision)
        throw new VehicleWatchError(409, "This update changed.");
      const eligible = (await recipients(e, client)).some(
        (p) => p.id === person.id && ["pending", "failed"].includes(p.status),
      );
      if (!eligible) {
        await client.query("COMMIT");
        result.skippedCount++;
        continue;
      }
      delivery = (
        await client.query(
          "INSERT INTO vehicle_watch_deliveries(dealer_id,event_id,watch_id,request_id,status,subject,message) VALUES($1,$2,$3,$4,'processing',$5,$6) ON CONFLICT(dealer_id,event_id,watch_id) DO UPDATE SET request_id=excluded.request_id,status='processing',subject=excluded.subject,message=excluded.message,error=NULL,updated_at=now() WHERE vehicle_watch_deliveries.status='failed' RETURNING *",
          [
            currentDealerId(),
            id,
            person.id,
            input.requestId,
            input.subject,
            input.message,
          ],
        )
      ).rows[0];
      if (!delivery) {
        await client.query("COMMIT");
        result.skippedCount++;
        continue;
      }
      if (e.kind === "price_drop") {
        priceIdentity = watchPriceIdentity(
          {
            dealer_id: String(e.dealer_id),
            vehicle_id: String(e.vehicle_id),
            change_key: String(e.change_key),
          },
          person.email,
        );
        claimSource = `watch:${delivery.id}:${input.requestId}`;
        if (
          !(await claimPriceUpdate(
            (q, p) => client.query(q, p),
            priceIdentity,
            claimSource,
          ))
        ) {
          await client.query("ROLLBACK");
          result.skippedCount++;
          continue;
        }
      }
      capability = await issueToken(person.email, "manage", null, client);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      if (
        result.sentCount +
          result.skippedCount +
          result.failedCount +
          result.uncertainCount >
        0
      ) {
        result.message =
          "Sending stopped because the car or customer changed. Review the remaining customers.";
        return result;
      }
      throw error;
    } finally {
      client.release();
    }
    let providerAccepted = false,
      providerStarted = false;
    try {
      const config = (await watchEmailSettings()).config;
      const reply = replyConfiguration();
      let replyTo: string | undefined;
      if (reply) {
        replyTo = `w-${randomBytes(24).toString("hex")}@${reply.domain}`;
        await pool.query(
          "INSERT INTO vehicle_watch_reply_routes(dealer_id,watch_id,delivery_id,reply_address,recipient) VALUES($1,$2,$3,$4,$5) ON CONFLICT(dealer_id,delivery_id) DO UPDATE SET delivery_id=excluded.delivery_id RETURNING reply_address",
          [currentDealerId(), person.id, delivery!.id, replyTo, person.email],
        );
        replyTo = String(
          (
            await pool.query(
              "SELECT reply_address FROM vehicle_watch_reply_routes WHERE dealer_id=$1 AND delivery_id=$2",
              [currentDealerId(), delivery!.id],
            )
          ).rows[0].reply_address,
        );
      }
      const e = await readEvent(id);
      const vehicleUrl = siteUrl(`/vehicle/${e.vehicle_id}`);
      const text = `${input.message}${input.message.includes(vehicleUrl) ? "" : `\n\nView the car: ${vehicleUrl}`}\n\nManage updates or stop watching: ${siteUrl("/watch")}#${capability!.token}`;
      if (
        e.revision !== input.expectedRevision ||
        !(await recipients(e)).some(
          (p) => p.id === person.id && p.status === "processing",
        )
      )
        throw new VehicleWatchError(
          409,
          "The car or customer changed before sending.",
        );
      const providerId = await sendEmailWithSettings(
        config,
        {
          to: person.email,
          subject: input.subject,
          text,
          html: await watchHtml(input.subject, text),
          replyTo,
          idempotencyKey: `vehicle-watch:${delivery!.id}:${input.requestId}`,
        },
        async (url, options) => {
          const latestSettings = await readVehicleWatchSettings();
          const latestEvent = await readEvent(id);
          if (
            !latestSettings.enabled ||
            !latestSettings.emailReady ||
            latestEvent.revision !== input.expectedRevision ||
            !(await recipients(latestEvent)).some(
              (p) => p.id === person.id && p.status === "processing",
            )
          )
            throw new VehicleWatchError(
              409,
              "This update or customer changed before sending. Review it again.",
            );
          providerStarted = true;
          return transport(url, options);
        },
      );
      await pool.query(
        "UPDATE vehicle_watch_deliveries SET status='sent',provider_id=$1,sent_at=now(),updated_at=now() WHERE id=$2 AND dealer_id=$3",
        [providerId, delivery!.id, currentDealerId()],
      );
      providerAccepted = true;
      result.sentCount++;
      if (priceIdentity)
        await finishPriceUpdate(
          (q, p) => pool.query(q, p),
          priceIdentity,
          claimSource,
          "sent",
        );
      await repairWatchDelivery(String(delivery!.id), staffName);
    } catch (error) {
      if (providerAccepted) continue;
      const knownNoSend =
        !providerStarted ||
        error instanceof VehicleWatchError ||
        (error instanceof EmailProviderError &&
          (!error.attempted ||
            (error.httpStatus >= 400 &&
              error.httpStatus < 500 &&
              error.httpStatus !== 408 &&
              error.httpStatus !== 409)));
      const status = knownNoSend ? "failed" : "uncertain";
      if (priceIdentity)
        await finishPriceUpdate(
          (q, p) => pool.query(q, p),
          priceIdentity,
          claimSource,
          knownNoSend ? "release" : "uncertain",
        );
      await pool.query(
        "UPDATE vehicle_watch_deliveries SET status=$1,error=$2,updated_at=now() WHERE id=$3 AND dealer_id=$4",
        [
          status,
          knownNoSend
            ? "Delivery was not accepted. Review before trying again."
            : "Acceptance is uncertain. Do not send again until checked.",
          delivery!.id,
          currentDealerId(),
        ],
      );
      if (knownNoSend) result.failedCount++;
      else result.uncertainCount++;
    }
  }
  return result;
}
