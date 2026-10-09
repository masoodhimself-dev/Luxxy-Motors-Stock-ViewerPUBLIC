/** Separate fixture-only service: no database, auth, secrets, local preview or write handlers. */
import express from 'express';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import sample from '../../../demos/cazoo/stock.json';
import { ImportGrokStockBody, GetStockResponse, GetVehicleResponse } from '@workspace/api-zod';
import { stockDescriptionExtras } from '@workspace/vehicle-meta';
import dealerConfig from '../../../demos/cazoo/base-settings.json';
import { serveFrontend } from './lib/serve-frontend';

const data = ImportGrokStockBody.parse(sample);
const cars = data.cars.map(car => {
  const h = createHash('sha256').update(`cazoo-demo:${data.retailerId}:${car.advertId}`).digest('hex');
  return { ...car, id: `${h.slice(0,8)}-${h.slice(8,12)}-4${h.slice(13,16)}-8${h.slice(17,20)}-${h.slice(20,32)}`, inventoryStatus: 'available' as const, sourceExtras: stockDescriptionExtras(car) };
});
const stock = GetStockResponse.parse({ schemaVersion: 1, dealerName: data.dealerName, dealerLocation: cars[0]?.dealerLocation ?? null, scrapedAt: data.scrapedAt, count: cars.length, cars });
const settings = {
  ...dealerConfig, identity: { ...dealerConfig.identity, name: 'Cazoo stock demo', logoText: 'CAZOO DEMO', logoAsset: '' }, contact: { phone: '', whatsapp: '', email: '' }, address: { street: '', city: '', region: '', postcode: '', mapsUrl: '' }, hours: [], legal: { companyName: '', companyNumber: '', vatNumber: '', termsUrl: '', privacyUrl: '', cookieUrl: '' }, social: { instagram: '', facebook: '', twitter: '' },
  hero: { ...dealerConfig.hero, announcement: 'Read-only Cazoo example', copy: 'Browse the Cazoo example.', subcopy: 'A fixed sample of 33 cars collected on 8 October 2026.', primaryCta: 'Browse Stock', secondaryCta: 'Browse Stock' }, featuredVehicleIds: [],
  warranty: { enabled: false, title: '', description: '', ctaLabel: '' }, delivery: { enabled: false, title: '', description: '', ctaLabel: '' }, partExchange: { enabled: false, title: '', description: '', ctaLabel: '' }, onlineReservation: { enabled: false, depositPence: 10000, terms: '' }, recentHandovers: { enabled: false, count: 0 }, trustItems: [], whyBuy: [],
  presentation: { reviewsEnabled: false, reviews: [], comparisonEnabled: true, heroImageUrl: cars[0]?.heroImage ?? '', heroImageAlt: 'Photograph from the supplied Cazoo snapshot', showroomImageUrl: '', includedInformation: '', teamIntroduction: '', visitInstructions: '', parkingInstructions: '', reviewsUrl: '' },
};
export function createCazooDemoApp(directory = resolve('artifacts/luxxy-motors/dist/cazoo-demo/public')) {
  const app = express();
  app.disable('x-powered-by');
  app.use((_req, res, next) => { res.set({ 'X-Robots-Tag': 'noindex, nofollow', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff' }); next(); });
  app.use('/api', (req, res, next) => { res.set('Cache-Control', 'no-store'); if (req.method !== 'GET' && req.method !== 'HEAD') { res.status(405).json({ error: 'Read-only display test: no enquiry, booking, payment or stock import has been submitted.' }); return; } next(); });
  app.get('/api/healthz', (_req, res) => { res.json({ status: 'ok', mode: 'cazoo-readonly-demo' }); });
  app.get('/api/stock', (_req, res) => { res.json(stock); });
  app.get('/api/vehicles/:id', (req, res) => { const car = cars.find(c => c.id === req.params.id); if (!car) { res.status(404).json({ error: 'Vehicle not found' }); return; } res.json(GetVehicleResponse.parse(car)); });
  app.get('/api/dealer-settings', (_req, res) => { res.json(settings); });
  app.get('/api/recent-handovers', (_req, res) => { res.json({ schemaVersion: 1, handovers: [] }); });
  app.get('/api/chat/config', (_req, res) => { res.json({ settings: { enabled: false } }); });
  app.get('/api/reservations/payment-readiness', (_req, res) => { res.json({ enabled: false, mode: null }); });
  app.use('/api', (_req, res) => { res.status(404).json({ error: 'Not available in this read-only display test.' }); });
  serveFrontend(app, directory);
  return app;
}
if (process.argv[1]?.endsWith('/dist-cazoo/server.mjs') && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const port = Number(process.env.PORT ?? 4180); if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid PORT');
  createCazooDemoApp().listen(port, '0.0.0.0', () => console.log(`Cazoo read-only demo listening on ${port}`));
}
