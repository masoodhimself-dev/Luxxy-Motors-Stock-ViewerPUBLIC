import { createHash, randomUUID } from 'node:crypto';
import { db, stockAlertsTable, stockAlertDeliveriesTable, stockAlertRateLimitsTable } from '@workspace/db';
import { escapeEmailHtml, formatVehiclePrice, vehicleDetailPath } from '@workspace/vehicle-meta';
import { createStockMatcher, stockAlertCriteriaLabel, type StockFilters } from '@workspace/vehicle-meta/stock-filters';
import { and, asc, eq, gt, inArray, isNotNull, isNull, lte, or } from 'drizzle-orm';
import type { Logger } from 'pino';
import { findPublicVehicle, readPublicStockCars, type PublicVehicle } from '../routes/stock';
import { getBookingPolicy } from './booking-store';
import { dealerFeatureEnabled } from './dealer-features';
import { dealerIntegrationsStore, effectiveResendSettings } from './dealer-integrations-store';
import {
  classifyEmailFailure, emailAccountHash, prepareEmailWithSettings, sendEmailWithSettings,
  sendPreparedEmail, type EmailRequest,
} from './email-provider';
import { emailRetryWindowMs } from './email-outbox';
import { dealerProfile } from './enquiry-notifications';
import { startLifecycleWorker } from './service-lifecycle';
import { getStockAlertOrigin, stockAlertConfirmationMs, stockAlertSettingEnabled, stockAlertsEnabled, stockAlertToken } from './stock-alerts';
import { currentDealerId } from './tenant-context';
import { forEachActiveDealer } from './tenant-jobs';

const dayMs = 24 * 60 * 60 * 1000;
const minuteMs = 60 * 1000;
const batchSize = 10;
const maxCarsPerDigest = 5;
const retentionBatch = 250;
const londonDate = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit',
});

type Alert = typeof stockAlertsTable.$inferSelect;
type Delivery = typeof stockAlertDeliveriesTable.$inferSelect;

function alertLink(origin: string, action: 'confirm' | 'stop' | 'renew', token: string) {
  const url = new URL('/stock-alerts/' + action, origin);
  url.hash = new URLSearchParams({ token }).toString();
  return url.href;
}

function emailLink(label: string, url: string) {
  return `<a href="${escapeEmailHtml(url)}" style="color:#182957">${escapeEmailHtml(label)}</a>`;
}

function emailContent(dealerName: string, paragraphs: string) {
  return `<!doctype html><html lang="en-GB"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><body style="margin:0;background:#f6f7f9;color:#182235;font:16px/1.5 Arial,sans-serif"><div style="margin:0 auto;max-width:560px;padding:24px;background:white"><p style="margin-top:0;font-weight:bold">${escapeEmailHtml(dealerName)}</p>${paragraphs}</div></body></html>`;
}

function emailSettings() {
  return dealerIntegrationsStore.readPrivate().then(effectiveResendSettings);
}

export async function sendStockAlertConfirmation(
  input: { id: string; email: string; token: string },
  origin: string,
  transport: typeof fetch = fetch,
) {
  if (getStockAlertOrigin() !== origin || !(await stockAlertsEnabled())) throw new Error('Stock alert email is unavailable.');
  const { identity } = await dealerProfile();
  const link = alertLink(origin, 'confirm', input.token);
  const manageToken = stockAlertToken(input.id, 'manage');
  const stop = alertLink(origin, 'stop', manageToken);
  const renew = alertLink(origin, 'renew', manageToken);
  const message = 'Confirm your email to get alerts when a car matches your search.';
  return sendEmailWithSettings(await emailSettings(), {
    to: input.email,
    subject: 'Confirm your stock alert',
    html: emailContent(identity.name, `<h1 style="font-size:24px">Confirm your stock alert</h1><p>${message}</p><p>${emailLink('Confirm my alert', link)}</p><p>${emailLink('Renew after confirming', renew)} · ${emailLink('Stop stock alerts', stop)}</p>`),
    text: `${identity.name}\n\n${message}\n\nConfirm my alert: ${link}\nRenew after confirming: ${renew}\nStop stock alerts: ${stop}`,
    idempotencyKey: `stock-alert-confirm:${input.id}:${createHash('sha256').update(input.token).digest('hex')}`,
  }, transport);
}

function photoUrl(car: PublicVehicle, origin: string) {
  if (!car.heroImage) return null;
  try {
    const url = new URL(car.heroImage, origin);
    return !url.username && !url.password && (url.protocol === 'https:' || url.origin === origin) ? url.href : null;
  } catch {
    return null;
  }
}

function digestEmail(alert: Alert, delivery: Delivery, cars: PublicVehicle[], origin: string, dealerName: string, bookingsEnabled: boolean): EmailRequest {
  const token = stockAlertToken(alert.id, 'manage');
  const stop = alertLink(origin, 'stop', token);
  const renew = alertLink(origin, 'renew', token);
  const { filters } = createStockMatcher(alert.criteria as Partial<StockFilters>);
  const label = stockAlertCriteriaLabel(filters, false);
  const heading = cars.length === 1 ? 'A car matches your search' : `${cars.length} cars match your search`;
  const adverts = cars.map(car => ({
    name: [car.make, car.model].filter(Boolean).join(' ') || car.title || 'View car',
    price: formatVehiclePrice(car.price, car.currency) ?? 'Ask for price',
    url: new URL(vehicleDetailPath(car), origin).href,
    photo: photoUrl(car, origin),
    booking: bookingsEnabled ? new URL(`/enquire?type=viewing&vehicleId=${encodeURIComponent(car.id)}`, origin).href : null,
  }));
  const html = adverts.map(({ name, price, url, photo, booking }) => (
    `<div style="border-top:1px solid #d9dee6;padding:16px 0">${photo ? `<img src="${escapeEmailHtml(photo)}" alt="" width="240" style="display:block;width:240px;max-width:100%;height:auto;margin-bottom:8px">` : ''}<p style="margin:0">${emailLink(name, url)}</p><p style="margin:0">${escapeEmailHtml(price)}</p>${booking ? `<p style="margin:6px 0 0">${emailLink('Book a test drive', booking)}</p>` : ''}</div>`
  )).join('');
  return {
    to: alert.email,
    subject: heading,
    html: emailContent(dealerName, `<h1 style="font-size:24px">${heading}</h1>${label ? `<p>${escapeEmailHtml(label)}</p>` : ''}${html}<p>${emailLink('Renew alert', renew)} · ${emailLink('Stop alerts', stop)}</p>`),
    text: [dealerName, heading, label, ...adverts.map(({ name, price, url, booking }) => `${name} · ${price}\n${url}${booking ? `\nBook a test drive: ${booking}` : ''}`), `Renew alert: ${renew}\nStop alerts: ${stop}`].filter(Boolean).join('\n\n'),
    idempotencyKey: `stock-alert-digest:${delivery.id}`,
  };
}

function activeAlert(dealerId: string, now: Date) {
  return and(
    eq(stockAlertsTable.dealerId, dealerId), isNotNull(stockAlertsTable.confirmedAt),
    isNull(stockAlertsTable.unsubscribedAt), gt(stockAlertsTable.expiresAt, now),
  );
}

function dueDelivery(dealerId: string, now: Date) {
  return and(eq(stockAlertDeliveriesTable.dealerId, dealerId), or(
    and(eq(stockAlertDeliveriesTable.status, 'queued'), lte(stockAlertDeliveriesTable.retryAt, now)),
    and(eq(stockAlertDeliveriesTable.status, 'sending'), lte(stockAlertDeliveriesTable.leaseUntil, now)),
  ));
}

function isNewMatch(car: PublicVehicle, confirmedAt: Date, matches: (car: PublicVehicle) => boolean) {
  return car.inventoryStatus === 'available' && Date.parse(car.listedAt) >= confirmedAt.getTime() && matches(car);
}

async function queueMatches(dealerId: string, now: Date) {
  const due = and(activeAlert(dealerId, now), lte(stockAlertsTable.nextCheckAt, now));
  const candidates = await db.select({ id: stockAlertsTable.id }).from(stockAlertsTable)
    .where(due).orderBy(asc(stockAlertsTable.nextCheckAt), asc(stockAlertsTable.id)).limit(batchSize);
  if (!candidates.length) return;
  const available = await readPublicStockCars();
  const digestDate = londonDate.format(now);
  for (const { id } of candidates) {
    await db.transaction(async tx => {
      // Advancing the date locks the subscription and gives one worker this check.
      const [alert] = await tx.update(stockAlertsTable)
        .set({ nextCheckAt: new Date(now.getTime() + dayMs) })
        .where(and(due, eq(stockAlertsTable.id, id))).returning();
      if (!alert) return;
      const { matches } = createStockMatcher(alert.criteria as Partial<StockFilters>);
      const prior = await tx.select({ vehicleIds: stockAlertDeliveriesTable.vehicleIds }).from(stockAlertDeliveriesTable)
        .where(and(eq(stockAlertDeliveriesTable.dealerId, dealerId), eq(stockAlertDeliveriesTable.alertId, id), or(
          gt(stockAlertDeliveriesTable.attempts, 0),
          eq(stockAlertDeliveriesTable.status, 'queued'),
          eq(stockAlertDeliveriesTable.status, 'sending'),
        )));
      const alreadySelected = new Set(prior.flatMap(row => row.vehicleIds));
      const vehicleIds = available.filter(car => !alreadySelected.has(car.id) && isNewMatch(car, alert.confirmedAt!, matches))
        .slice(0, maxCarsPerDigest).map(car => car.id);
      if (!vehicleIds.length) return;
      await tx.insert(stockAlertDeliveriesTable).values({
        dealerId, alertId: id, digestDate, vehicleIds, status: 'queued', retryAt: now, createdAt: now,
      }).onConflictDoNothing();
    });
  }
}

async function claimDelivery(dealerId: string, id: string, now: Date) {
  const [claimed] = await db.update(stockAlertDeliveriesTable).set({
    status: 'sending', claimToken: randomUUID(), leaseUntil: new Date(now.getTime() + 2 * minuteMs),
  }).where(and(dueDelivery(dealerId, now), eq(stockAlertDeliveriesTable.id, id))).returning();
  return claimed;
}

function claimedRow(delivery: Delivery) {
  return and(
    eq(stockAlertDeliveriesTable.dealerId, delivery.dealerId),
    eq(stockAlertDeliveriesTable.id, delivery.id),
    eq(stockAlertDeliveriesTable.status, 'sending'),
    eq(stockAlertDeliveriesTable.claimToken, delivery.claimToken!),
  );
}

function finishDelivery(delivery: Delivery, providerId: string | null, attempts?: number) {
  return db.update(stockAlertDeliveriesTable).set({
    status: providerId ? 'sent' : 'failed', providerId,
    claimToken: null, leaseUntil: null, payload: null, accountHash: null,
    ...(attempts === undefined ? {} : { attempts }),
  }).where(claimedRow(delivery));
}

async function deliverDigest(delivery: Delivery, origin: string, dealerName: string, bookingsEnabled: boolean, clock: () => Date, transport: typeof fetch) {
  const now = clock();
  const retryDeadline = delivery.createdAt.getTime() + emailRetryWindowMs;
  if (now.getTime() >= retryDeadline) return finishDelivery(delivery, null);

  let providerStarted = false;
  let canCountAttempt = false;
  try {
    const [alert] = await db.select().from(stockAlertsTable).where(and(
      activeAlert(delivery.dealerId, now), eq(stockAlertsTable.id, delivery.alertId),
    ));
    if (!alert || alert.confirmedAt! > delivery.createdAt || getStockAlertOrigin() !== origin || !(await stockAlertsEnabled())) {
      return finishDelivery(delivery, null);
    }
    const { matches } = createStockMatcher(alert.criteria as Partial<StockFilters>);
    const confirmedAt = alert.confirmedAt!;
    const cars: PublicVehicle[] = [];
    for (const vehicleId of delivery.vehicleIds) {
      const car = await findPublicVehicle(vehicleId);
      if (!car || !isNewMatch(car, confirmedAt, matches)) {
        if (delivery.payload) return finishDelivery(delivery, null);
        continue;
      }
      cars.push(car);
    }
    if (!cars.length) return finishDelivery(delivery, null);

    const request = digestEmail(alert, delivery, cars, origin, dealerName, bookingsEnabled);
    const { config, body } = await prepareEmailWithSettings(await emailSettings(), request);
    const payload = JSON.stringify(body);
    const accountHash = emailAccountHash(config);
    if (delivery.payload && (delivery.payload !== payload || delivery.accountHash !== accountHash)) {
      return finishDelivery(delivery, null);
    }
    const [record] = await db.update(stockAlertDeliveriesTable).set({
      payload, accountHash, vehicleIds: cars.map(car => car.id), attempts: delivery.attempts + 1,
    }).where(claimedRow(delivery)).returning();
    if (!record) return;
    const guardedTransport: typeof fetch = async (input, init) => {
      // The provider can wait for its rate limiter. Recheck the stock and consent after that wait.
      for (const car of cars) {
        const current = await findPublicVehicle(car.id);
        if (!current || !isNewMatch(current, confirmedAt, matches) || current.price !== car.price || current.currency !== car.currency) {
          return new Response(null, { status: 412 });
        }
      }
      const [lease] = await db.select({ id: stockAlertDeliveriesTable.id }).from(stockAlertDeliveriesTable).where(and(
        claimedRow(delivery), gt(stockAlertDeliveriesTable.leaseUntil, clock()),
      ));
      if (!lease || !(await stockAlertSettingEnabled())) return new Response(null, { status: 412 });
      const [stillActive] = await db.select({ id: stockAlertsTable.id }).from(stockAlertsTable).where(and(
        activeAlert(delivery.dealerId, clock()), eq(stockAlertsTable.id, alert.id),
        eq(stockAlertsTable.confirmedAt, confirmedAt),
      ));
      if (!stillActive) return new Response(null, { status: 412 });
      providerStarted = true;
      return transport(input, init);
    };
    canCountAttempt = true;
    const providerId = await sendPreparedEmail(config, payload, request.idempotencyKey, guardedTransport);
    return finishDelivery(delivery, providerId);
  } catch (error) {
    const failure = classifyEmailFailure(error);
    const retryDelay = Math.max(Math.min(60, 5 * 2 ** Math.min(delivery.attempts, 4)) * minuteMs, (failure.retryAfterSeconds ?? 0) * 1000);
    const retryAt = new Date(now.getTime() + retryDelay);
    const attempts = canCountAttempt && !providerStarted ? delivery.attempts : undefined;
    if (failure.kind === 'permanent' || retryAt.getTime() >= retryDeadline) {
      return finishDelivery(delivery, null, attempts);
    }
    return db.update(stockAlertDeliveriesTable).set({
      status: 'queued', retryAt, leaseUntil: null, claimToken: null,
      ...(attempts === undefined ? {} : { attempts }),
    }).where(claimedRow(delivery));
  }
}

export async function processStockAlertDigests(options: { now?: Date; transport?: typeof fetch } = {}) {
  const clock = () => options.now ?? new Date();
  const now = clock();
  const origin = getStockAlertOrigin();
  if (!origin || !(await stockAlertsEnabled())) return;
  const dealerId = currentDealerId();
  await queueMatches(dealerId, now);
  const due = await db.select({ id: stockAlertDeliveriesTable.id }).from(stockAlertDeliveriesTable)
    .where(dueDelivery(dealerId, now))
    .orderBy(asc(stockAlertDeliveriesTable.retryAt), asc(stockAlertDeliveriesTable.id)).limit(batchSize);
  if (!due.length) return;
  const [{ identity }, bookingPolicy, bookingFeature] = await Promise.all([
    dealerProfile(), getBookingPolicy(dealerId), dealerFeatureEnabled('testDriveBookings'),
  ]);
  for (const { id } of due) {
    const claimed = await claimDelivery(dealerId, id, clock());
    if (claimed) await deliverDigest(claimed, origin, identity.name, bookingPolicy.enabled && bookingFeature, clock, options.transport ?? fetch);
  }
}

export async function pruneStockAlertData(now = new Date()) {
  const confirmationCutoff = new Date(now.getTime() - stockAlertConfirmationMs);
  const endedCutoff = new Date(now.getTime() - 30 * dayMs);
  const staleConfirmation = lte(stockAlertsTable.requestedAt, confirmationCutoff);
  const ended = and(
    or(lte(stockAlertsTable.expiresAt, endedCutoff), lte(stockAlertsTable.unsubscribedAt, endedCutoff)),
    or(isNull(stockAlertsTable.pendingCriteria), staleConfirmation),
  );
  const prunable = or(and(isNull(stockAlertsTable.confirmedAt), staleConfirmation), ended);
  const staleReplacement = and(isNotNull(stockAlertsTable.pendingCriteria), staleConfirmation);
  const expiredBucket = lte(stockAlertRateLimitsTable.expiresAt, now);
  await db.delete(stockAlertsTable).where(and(prunable, inArray(stockAlertsTable.id, db
    .select({ id: stockAlertsTable.id }).from(stockAlertsTable)
    .where(prunable).limit(retentionBatch))));
  await db.update(stockAlertsTable).set({ pendingCriteria: null }).where(and(staleReplacement, inArray(stockAlertsTable.id, db
    .select({ id: stockAlertsTable.id }).from(stockAlertsTable)
    .where(staleReplacement).limit(retentionBatch))));
  await db.delete(stockAlertRateLimitsTable).where(and(expiredBucket, inArray(stockAlertRateLimitsTable.key, db
    .select({ key: stockAlertRateLimitsTable.key }).from(stockAlertRateLimitsTable)
    .where(expiredBucket).limit(retentionBatch))));
}

export function startStockAlertWorker(log: Pick<Logger, 'info' | 'warn'>) {
  let nextPrune = 0;
  return startLifecycleWorker({
    intervalMs: 5 * minuteMs,
    async work() {
      const now = new Date();
      if (now.getTime() >= nextPrune) {
        await pruneStockAlertData(now);
        nextPrune = now.getTime() + 60 * minuteMs;
      }
      if (process.env.STOCK_ALERT_EMAIL_ENABLED === 'true') {
        await forEachActiveDealer(processStockAlertDigests, { name: 'stock-alerts', log });
      }
    },
    onError: () => log.warn('Stock alert check could not complete. Queued alerts remain available for retry.'),
  });
}
