import { randomUUID } from "node:crypto";
import { pool } from "@workspace/db";
import {
  escapeEmailHtml,
  formatRegistrationPlate,
  formatVehicleName,
  pickVehicleImage,
  vehicleRegistration,
  type VehicleMetaSource,
} from "@workspace/vehicle-meta";
import type { Logger } from "pino";
import { findPublicVehicle } from "../routes/stock";
import { mailbox } from "./customer-email-replies";
import { dealerIntegrationsStore, effectiveResendSettings } from "./dealer-integrations-store";
import { dealerNotificationRecipient, dealerProfile } from "./enquiry-notifications";
import { emailRetryWindowMs } from "./email-outbox";
import {
  classifyEmailFailure,
  emailAccountHash,
  prepareEmailWithSettings,
  sendPreparedEmail,
  type EmailEnvelope,
  type EmailRequest,
} from "./email-provider";
import { normaliseMotRegistration } from "./mot-history";
import { publicSeoOrigin } from "./public-page-seo";
import { serviceLifecycle, startLifecycleWorker } from "./service-lifecycle";
import { currentDealerId, currentTenant, multiTenantEnabled } from "./tenant-context";
import { forEachActiveDealer } from "./tenant-jobs";
import { permittedVehicleSheetImage } from "./vehicle-sheet-image";

const UK_DATE = new Intl.DateTimeFormat("en-GB", {
  day: "numeric", month: "long", year: "numeric", timeZone: "Europe/London",
});
const MAX_ATTEMPTS = 3;
const STOCK_IS_CURRENT = "v.inventory_status IN ('available','reserved') AND v.source_status='live' AND v.archived_at IS NULL AND v.missing_count=0";
const OWNED_NOTICE = "n.dealer_id=$1 AND n.vehicle_id=$2 AND n.registration=$3 AND n.expiry_date=$4::date AND n.claim_token=$5 AND n.status='sending'";
type Notice = {
  vehicle_id: string;
  registration: string;
  expiry_date: string;
  advisories: string[] | null;
  created_at: Date | string;
  attempts: number;
  payload: string | null;
  account_hash: string | null;
};
type ClaimedNotice = Notice & { dealerId: string; claimToken: string };
type ActiveFeed = { platform: string; retailerId: string; officialCazooFeedId: string | null };
type Registration = { plate: string | null; vrm: string | null; registration: string | null };
type FeedCar = Registration & Pick<VehicleMetaSource, "title" | "make" | "model" | "year"> & {
  hero_image: string | null;
  source_image: string | null;
};

export function renderStockMotRenewalEmail(input: {
  to: string;
  dealerName: string;
  vehicleId: string;
  registration: string;
  expiryDate: string;
  advisories?: readonly string[] | null;
  vehicle: VehicleMetaSource;
  origin: string | null;
  idempotencyKey: string;
}): EmailRequest {
  const name = formatVehicleName(input.vehicle).replace(/[\x00-\x1f\x7f]/g, "").slice(0, 130);
  const registration = formatRegistrationPlate(input.registration) || input.registration;
  const expiry = UK_DATE.format(new Date(input.expiryDate + "T12:00:00Z"));
  const photo = [pickVehicleImage(input.vehicle), ...(input.vehicle.images ?? []).map(image => typeof image === "string" ? image : image?.url)]
    .find(permittedVehicleSheetImage);
  const origin = publicSeoOrigin(input.origin);
  const portal = origin ? new URL("/portal", origin) : null;
  if (portal) {
    portal.searchParams.set("section", "cars");
    portal.searchParams.set("carId", input.vehicleId);
  }
  const view = portal?.href;
  const escape = escapeEmailHtml;
  const advisories = input.advisories ?? [];
  const advisoryHeading = "Advisories from this test";
  const advisoryHtml = advisories.length
    ? `<h2 style="margin:0 0 8px;font-size:18px">${advisoryHeading}</h2>
          <ul style="margin:0 0 16px;padding-left:22px">${advisories.map(advisory =>
            `<li style="margin:0 0 6px">${escape(advisory)}</li>`).join("")}</ul>`
    : "";
  const advisoryText = advisories.length
    ? [advisoryHeading, ...advisories.map(advisory => `- ${advisory}`)].join("\n")
    : "";
  return {
    to: input.to,
    subject: `MOT renewed: ${name} (${registration})`,
    html: `<!doctype html><html lang="en-GB"><meta charset="utf-8"><meta name="viewport" content="width=device-width">
    <body style="margin:0;background:#f6f7f9;color:#182235;font:16px/1.5 Arial,sans-serif">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;margin:0 auto;background:#fff">
        <tr><td style="padding:24px">
          <p style="margin:0 0 10px;font-weight:bold">${escape(input.dealerName)}</p>
          <h1 style="margin:0 0 12px;font-size:24px">MOT renewed</h1>
          ${photo ? `<img src="${escape(photo)}" alt="${escape(name)}" width="512" style="display:block;width:100%;max-width:512px;height:auto;margin:0 0 16px;border-radius:6px">` : ""}
          <p style="margin:0 0 6px"><strong>${escape(name)}</strong> · ${escape(registration)}</p>
          <p style="margin:0 0 16px">New MOT expiry: <strong>${escape(expiry)}</strong></p>
          ${advisoryHtml}
          ${view ? `<p style="margin:0"><a href="${escape(view)}" style="color:#182957">View car in DealerOS</a></p>` : ""}
        </td></tr>
      </table>
    </body></html>`,
    text: [input.dealerName, "MOT renewed", `${name} · ${registration}`, `New MOT expiry: ${expiry}`,
      advisoryText, view && `View car in DealerOS: ${view}`].filter(Boolean).join("\n\n"),
    idempotencyKey: input.idempotencyKey,
  };
}

export function stockMotRenewalRecipient(dealerId: string, contactEmail: string): string | null {
  // The override applies only to MOT notices and only to an exact dealer ID.
  try {
    const configured: unknown = JSON.parse(process.env.MOT_RENEWAL_EMAIL_RECIPIENTS || "{}");
    if (configured && typeof configured === "object" && !Array.isArray(configured) &&
      Object.hasOwn(configured, dealerId)) {
      const value = (configured as Record<string, unknown>)[dealerId];
      const address = mailbox(value);
      if (typeof value === "string" && address && value.trim().toLowerCase() === address) {
        return address;
      }
    }
  } catch {
    // An unreadable override leaves the existing notification address in use.
  }
  return dealerNotificationRecipient(contactEmail);
}

function noticeKey(notice: ClaimedNotice) {
  return [notice.dealerId, notice.vehicle_id, notice.registration, notice.expiry_date, notice.claimToken];
}

async function claimNotice(dealerId: string): Promise<ClaimedNotice | null> {
  const claimToken = randomUUID();
  const { rows } = await pool.query<Notice>(
    `WITH candidate AS (
      SELECT vehicle_id,registration,expiry_date FROM mot_stock_renewal_notices
      WHERE dealer_id=$1 AND ((status='queued' AND next_attempt_at<=now()) OR (status='sending' AND lease_until<=now()))
      ORDER BY next_attempt_at,vehicle_id,registration,expiry_date LIMIT 1 FOR UPDATE SKIP LOCKED
    ) UPDATE mot_stock_renewal_notices n
      SET status='sending',claim_token=$2,lease_until=now()+interval '2 minutes'
      FROM candidate c WHERE n.dealer_id=$1 AND n.vehicle_id=c.vehicle_id
      AND n.registration=c.registration AND n.expiry_date=c.expiry_date
      RETURNING n.vehicle_id,n.registration,n.expiry_date::text AS expiry_date,n.advisories,n.created_at,n.attempts,n.payload,n.account_hash`,
    [dealerId, claimToken],
  );
  return rows[0] ? { ...rows[0], dealerId, claimToken } : null;
}

function sameRegistration(notice: Notice, car: Registration | undefined) {
  try {
    return normaliseMotRegistration(vehicleRegistration(car)) === notice.registration;
  } catch {
    return false;
  }
}

async function readActiveFeed(): Promise<ActiveFeed | null> {
  const tenant = currentTenant();
  if (tenant?.platform === "cazoo") {
    const { rows: [official] } = await pool.query<{ retailer_id: string; feed_id: string; enabled: boolean }>(
      "SELECT retailer_id,feed_id,enabled FROM cazoo_feed_authority WHERE dealer_id=$1",
      [tenant.dealerId],
    );
    if (official) {
      return official.enabled && official.retailer_id === tenant.retailerId
        ? { platform: "cazoo", retailerId: official.retailer_id, officialCazooFeedId: official.feed_id }
        : null;
    }
  }
  const { connection } = await dealerIntegrationsStore.readStockConnection();
  return connection.enabled
    ? { platform: connection.platform, retailerId: connection.retailerId, officialCazooFeedId: null }
    : null;
}

async function findFeedCar(notice: ClaimedNotice, platform: string) {
  const { rows } = await pool.query<FeedCar>(
    `SELECT v.plate,v.vrm,v.registration,coalesce(v.website_title_override,v.title) AS title,v.make,v.model,v.year,
      v.website_hero_image_override AS hero_image,v.source_hero_image AS source_image
      FROM vehicles v WHERE v.dealer_id=$1 AND v.id=$2 AND v.source=$3 AND ${STOCK_IS_CURRENT}`,
    [notice.dealerId, notice.vehicle_id, platform],
  );
  return sameRegistration(notice, rows[0]) ? rows[0]! : null;
}

async function finishNotice(notice: ClaimedNotice, status: "sent" | "failed" | "skipped" | "unknown", providerId: string | null = null) {
  await pool.query(
    `UPDATE mot_stock_renewal_notices n SET status=$6,provider_id=$7,claim_token=NULL,lease_until=NULL,payload=NULL,account_hash=NULL
     WHERE ${OWNED_NOTICE}`,
    [...noticeKey(notice), status, providerId],
  );
}

async function sendNotice(notice: ClaimedNotice, transport: typeof fetch, log: Pick<Logger, "warn">) {
  const retryDeadline = new Date(notice.created_at).getTime() + emailRetryWindowMs;
  if (Date.now() >= retryDeadline || notice.attempts >= MAX_ATTEMPTS) {
    return finishNotice(notice, notice.attempts ? "unknown" : "failed");
  }

  let attemptRecorded = false;
  let guardStopped = false;
  try {
    const tenant = currentTenant();
    const feed = await readActiveFeed();
    if (!feed) return finishNotice(notice, "skipped");
    const { platform, retailerId, officialCazooFeedId } = feed;
    const car = await findFeedCar(notice, platform);
    if (!car) return finishNotice(notice, "skipped");

    const [profile, settings] = await Promise.all([dealerProfile(), dealerIntegrationsStore.readPrivate()]);
    const config = effectiveResendSettings(settings);
    const recipient = stockMotRenewalRecipient(notice.dealerId, profile.contact.email);
    if (!recipient || !config.enabled || !config.apiKey || !config.from) {
      return finishNotice(notice, notice.attempts ? "unknown" : "skipped");
    }

    const idempotencyKey = `mot-stock-renewal:${notice.dealerId}:${notice.vehicle_id}:${notice.registration}:${notice.expiry_date}`;
    const accountHash = emailAccountHash(config);
    let payload = notice.payload;
    if (payload) {
      const body = JSON.parse(payload) as EmailEnvelope;
      if (notice.account_hash !== accountHash || body.to[0] !== recipient ||
        body.from !== config.from || (body.reply_to ?? "") !== config.replyTo) {
        return finishNotice(notice, "unknown");
      }
    } else {
      const publicCar = await findPublicVehicle(notice.vehicle_id);
      const published = publicCar && sameRegistration(notice, publicCar) ? publicCar : null;
      const vehicle = {
        ...(published ?? car),
        heroImage: published?.heroImage ?? car.hero_image,
        images: [...(published?.images ?? []), car.source_image],
      };
      const prepared = await prepareEmailWithSettings(config, renderStockMotRenewalEmail({
        to: recipient, dealerName: profile.identity.name, registration: notice.registration,
        vehicleId: notice.vehicle_id, expiryDate: notice.expiry_date, advisories: notice.advisories, vehicle, idempotencyKey,
        origin: tenant?.canonicalOrigin ?? process.env.PUBLIC_SITE_URL ?? null,
      }));
      payload = JSON.stringify(prepared.body);
    }

    const approvedPayload = payload;
    const guardedTransport: typeof fetch = async (request, init) => {
      // The provider may wait for its rate limiter. Recheck the latest feed and
      // the exact leased notice after that wait, immediately before handing off.
      if (serviceLifecycle.isDraining() || Date.now() >= retryDeadline) {
        return new Response(null, { status: 503, headers: { "Retry-After": "15" } });
      }
      const current = await readActiveFeed();
      if (!current || current.platform !== platform || current.retailerId !== retailerId ||
        current.officialCazooFeedId !== officialCazooFeedId) {
        guardStopped = true;
        return new Response(null, { status: 412 });
      }
      const { rows } = await pool.query<Registration>(
        `UPDATE mot_stock_renewal_notices n SET payload=$7,account_hash=$8,attempts=n.attempts+1
        FROM vehicles v WHERE ${OWNED_NOTICE} AND n.lease_until>now() AND n.attempts<$9
        AND v.id=n.vehicle_id AND v.dealer_id=n.dealer_id AND v.source=$6 AND ${STOCK_IS_CURRENT}
        AND (NOT $10::boolean OR EXISTS (SELECT 1 FROM dealerships d
          WHERE d.id=n.dealer_id AND d.status='active' AND d.stock_platform=$6 AND d.retailer_id=$11
          AND NOT EXISTS (SELECT 1 FROM dealer_demos demos WHERE demos.dealer_id=d.id AND demos.converted_at IS NULL)))
        AND (NOT $10::boolean OR $6<>'cazoo' OR CASE WHEN $12::text IS NULL
          THEN NOT EXISTS (SELECT 1 FROM cazoo_feed_authority a WHERE a.dealer_id=n.dealer_id)
          ELSE EXISTS (SELECT 1 FROM cazoo_feed_authority a
            WHERE a.dealer_id=n.dealer_id AND a.enabled AND a.retailer_id=$11 AND a.feed_id=$12)
        END)
        RETURNING v.plate,v.vrm,v.registration`,
        [...noticeKey(notice), platform, approvedPayload, accountHash, MAX_ATTEMPTS, multiTenantEnabled(), retailerId, officialCazooFeedId],
      );
      attemptRecorded = Boolean(rows[0]);
      if (!sameRegistration(notice, rows[0])) {
        guardStopped = true;
        return new Response(null, { status: 412 });
      }
      return transport(request, init);
    };
    const providerId = await sendPreparedEmail(config, approvedPayload, idempotencyKey, guardedTransport);
    return finishNotice(notice, "sent", providerId);
  } catch (error) {
    if (guardStopped) return finishNotice(notice, "skipped");
    const failure = classifyEmailFailure(error);
    const attempts = notice.attempts + Number(attemptRecorded);
    const seconds = Math.max(60 * 2 ** attempts, failure.retryAfterSeconds ?? 0);
    if (failure.kind === "permanent" || attempts >= MAX_ATTEMPTS || Date.now() + seconds * 1000 >= retryDeadline) {
      log.warn("MOT renewal email could not be confirmed.");
      return finishNotice(notice, failure.kind === "permanent" || !attempts ? "failed" : "unknown");
    }
    await pool.query(
      `UPDATE mot_stock_renewal_notices n SET status='queued',claim_token=NULL,lease_until=NULL,
       next_attempt_at=now()+$6*interval '1 second' WHERE ${OWNED_NOTICE}`,
      [...noticeKey(notice), seconds],
    );
  }
}

export async function deliverStockMotRenewalNotices(
  log: Pick<Logger, "warn">,
  { transport = fetch }: { transport?: typeof fetch } = {},
) {
  if (currentTenant()?.demo) return;
  const dealerId = currentDealerId();
  for (let i = 0; i < 4 && !serviceLifecycle.isDraining(); i++) {
    const notice = await claimNotice(dealerId);
    if (!notice) break;
    await sendNotice(notice, transport, log);
  }
}

export function startStockMotRenewalMailWorker(log: Pick<Logger, "warn" | "info">) {
  return startLifecycleWorker({
    intervalMs: 30_000,
    work: () => forEachActiveDealer(() => deliverStockMotRenewalNotices(log), { name: "mot-stock-renewal-mail" }),
    onError: () => log.warn("The MOT renewal email queue could not be processed."),
  });
}
