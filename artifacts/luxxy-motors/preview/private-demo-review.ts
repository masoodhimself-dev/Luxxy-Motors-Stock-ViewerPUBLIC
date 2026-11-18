import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { resolveDealerFeatures, stockDescriptionExtras } from '@workspace/vehicle-meta';
import { autoTraderDealerLink } from '@workspace/vehicle-meta';
import { applyDemoDealershipDetails, demoDealershipDetails } from '../../api-server/src/lib/demo-business-details';
import { previewSettings } from './settings';
import type { Car } from '../src/lib/stock-context';

const reviewedUploads = new Map<string, Record<string, any>>();

/** Opt-in, loopback-only visual review using an operator-supplied stock export. */
export async function privateDemoReview(req: IncomingMessage, res: ServerResponse, url: URL) {
  const file = process.env.PRIVATE_DEMO_REVIEW_FILE;
  const match = /^\/platform\/preview\/(demo-cazoo-review|demo-cazoo-sparse-review|demo-autotrader-review)\/api(\/.*)$/.exec(url.pathname);
  const upload = url.pathname === '/api/platform/demos/from-autotrader';
  if (!file || (!match && !upload)) return false;
  const host = new URL(`http://${req.headers.host}`).hostname;
  const remote = (req.socket.remoteAddress ?? '').replace(/^::ffff:/, '');
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(host) || !['127.0.0.1', '::1'].includes(remote)
    || (req.headers.origin && req.headers.origin !== `http://${req.headers.host}`)) {
    res.statusCode = 403;
    res.end();
    return true;
  }
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', 'application/json');
  if (upload && req.method === 'POST') {
    try {
      let raw = '';
      for await (const chunk of req) {
        raw += chunk;
        if (Buffer.byteLength(raw) > 8 * 1024 * 1024) throw new Error('Choose a smaller JSON export.');
      }
      const input = JSON.parse(raw);
      const expected = JSON.parse(await readFile(file, 'utf8'));
      const dealer = autoTraderDealerLink(input.sourceUrl);
      const details = input.dealershipDetails == null ? undefined : demoDealershipDetails.parse(input.dealershipDetails);
      const detailsDealer = details ? autoTraderDealerLink(details.sourceUrl) : dealer;
      const stock = input.stock;
      if (!stock || typeof stock !== 'object' || !Array.isArray(stock.cars)
        || !Array.isArray(stock.errors) || !Array.isArray(stock.failedAdvertIds)) {
        throw new Error('Use the complete stock export prepared for this local review.');
      }
      if (!dealer || detailsDealer?.retailerId !== dealer.retailerId || stock.retailerId !== dealer.retailerId
        || !stock.complete || stock.count !== stock.cars.length || stock.expectedAdvertCount !== stock.count
        || stock.errors.length || stock.failedAdvertIds.length
        || JSON.stringify(input.stock) !== JSON.stringify(expected.stock)) {
        throw new Error('Use the stock export prepared for this local review.');
      }
      if (input.logoData && (typeof input.logoData !== 'string' || input.logoData.length > 400000
        || !/^data:image\/(png|jpeg);base64,[A-Za-z0-9+/]+={0,2}$/.test(input.logoData))) throw new Error('Choose a PNG or JPEG logo.');
      reviewedUploads.set(file, { stock: input.stock, dealershipDetails: details, logoData: input.logoData });
      res.statusCode = 201;
      res.end(JSON.stringify({ dealerId: 'demo-autotrader-review', dealerName: stock.dealerName,
        previewPath: '/platform/preview/demo-autotrader-review', received: stock.count, hasLogo: Boolean(input.logoData) }));
    } catch (error) {
      res.statusCode = 400;
      res.end(JSON.stringify({ error: error instanceof Error ? error.message : 'Check the local review JSON.' }));
    }
    return true;
  }
  if (req.method !== 'GET') {
    res.statusCode = 405;
    res.end(JSON.stringify({ error: 'This local review is read only.' }));
    return true;
  }
  if (!match) { res.statusCode = 405; res.end(JSON.stringify({ error: 'Upload stock JSON for the local review.' })); return true; }
  const data = reviewedUploads.get(file) ?? JSON.parse(await readFile(file, 'utf8'));
  const sparse = match[1] === 'demo-cazoo-sparse-review';
  const details = sparse || !data.dealershipDetails ? undefined : demoDealershipDetails.parse(data.dealershipDetails);
  const name = data.stock.dealerName;
  const config = applyDemoDealershipDetails({
    ...previewSettings,
    identity: { ...previewSettings.identity, name, logoText: name, logoAsset: data.logoData ? '/api/demo-logo' : '' },
    contact: { phone: '', email: '', whatsapp: '' },
    address: { street: '', city: '', region: '', postcode: '', mapsUrl: '' },
    hours: [],
    legal: { companyName: name },
    presentation: {},
    social: {},
    trustItems: [],
    whyBuy: [],
    warranty: { ...previewSettings.warranty, enabled: false },
    delivery: { ...previewSettings.delivery, enabled: false },
    partExchange: { ...previewSettings.partExchange, enabled: false },
    testDriveBooking: { ...previewSettings.testDriveBooking, enabled: false },
    publicOnlineReservations: false,
  }, details);
  const cars: Car[] = data.stock.cars.map((car: Car) => {
    const digest = createHash('sha256').update(car.advertId).digest('hex');
    const id = `${digest.slice(0, 8)}-${digest.slice(8, 12)}-4${digest.slice(13, 16)}-8${digest.slice(17, 20)}-${digest.slice(20, 32)}`;
    const sourceExtras = { ...stockDescriptionExtras(car), publicVehicleCode: digest.slice(0, 8) };
    return {
      ...car, id, sourceExtras, inventoryStatus: 'available', listedAt: data.stock.scrapedAt,
      ...(sparse ? {
        variant: null, trim: null, year: null, mileage: null, mileageText: null, fuel: null,
        transmission: null, engineSize: null, engineCC: null, bodyType: null,
        doors: null, seats: null, colour: null, specifications: null,
        sourceExtras: { sourcePlatform: 'cazoo', publicVehicleCode: digest.slice(0, 8) },
      } : {}),
    };
  });
  const path = match[2];
  const vehicle = /^\/vehicles\/(?:short\/)?([^/]+)$/.exec(path);
  let body: unknown;
  if (path === '/stock') body = { schemaVersion: 1, dealerName: name, dealerLocation: details?.showroomAddress?.city ?? null, count: cars.length, cars, scrapedAt: data.stock.scrapedAt };
  else if (path === '/dealer-settings') body = config;
  else if (path === '/features') body = { features: Object.fromEntries(resolveDealerFeatures({}, {}).map(feature => [feature.key, feature.enabled])) };
  else if (path === '/reservations/payment-readiness') body = { enabled: false, mode: null, prepared: false };
  else if (path === '/demo-status') body = { demo: true, emailRestricted: true, paymentsDisabled: true };
  else if (/^\/vehicles\/[^/]+\/mot-history$/.test(path)) body = { status: 'uncached' };
  else if (vehicle) body = cars.find(car => car.id === vehicle[1] || car.sourceExtras?.publicVehicleCode === vehicle[1]);
  else if (path === '/demo-logo' && typeof data.logoData === 'string') {
    const artwork = /^data:image\/(png|jpeg);base64,([A-Za-z0-9+/]+={0,2})$/.exec(data.logoData);
    if (artwork) {
      res.setHeader('Content-Type', `image/${artwork[1]}`);
      res.end(Buffer.from(artwork[2], 'base64'));
      return true;
    }
  }
  if (!body) {
    res.statusCode = 404;
    body = { error: 'This action is unavailable in the local review.' };
  }
  res.end(JSON.stringify(body));
  return true;
}
