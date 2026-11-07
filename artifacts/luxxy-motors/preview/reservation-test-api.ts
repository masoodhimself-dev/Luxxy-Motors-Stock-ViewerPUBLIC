import { randomBytes } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';

const depositPence = 9900;
const terms = 'This test simulates a fully refundable £99 deposit. In the live flow, the £99 goes towards the price if you buy the car. Contact the dealership to cancel before you buy and get the full £99 back.';
const settingsPath = '/api/staff/reservations/settings';
type FixtureCar = {
  id: string;
  title: string | null;
  make?: string | null;
  model?: string | null;
  price: number | null;
  currency?: string | null;
  inventoryStatus?: string;
  sourceStatus?: string;
  registration?: string | null;
  plate?: string | null;
  vrm?: string | null;
  heroImage?: string | null;
  images?: Array<string | { url: string }>;
};
type Checkout = {
  vehicleId: string;
  vehicleTitle: string;
  registration: string | null;
  photo: string | null;
  pricePence: number;
  state: 'pending' | 'paid' | 'cancelled' | 'refunded';
};

const endpoints = new Set([
  settingsPath,
  '/api/reservations/payment-readiness',
  '/api/reservations/checkout',
  '/api/reservations/test-checkout',
]);

function send(res: ServerResponse, statusCode: number, value: unknown) {
  res.writeHead(statusCode, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(value));
}

async function readBody(req: IncomingMessage) {
  let data = '';
  for await (const chunk of req) {
    data += chunk.toString();
    if (Buffer.byteLength(data) > 4096) return null;
  }
  try { return JSON.parse(data); } catch { return null; }
}

/** Local fixture only. No credentials, file writes, payment provider, or production stock API. */
export function createReservationTestPreview(cars: FixtureCar[]) {
  let enabled = true;
  const sessions = new Map<string, Checkout>();
  const attempts = new Map<string, string>();
  const settings = () => ({ enabled, paymentReady: true, supported: true });
  function withReservationStatus<T extends FixtureCar>(car: T): T {
    return (car.inventoryStatus ?? 'available') === 'available'
      && [...sessions.values()].some(entry => entry.vehicleId === car.id && entry.state === 'paid')
      ? { ...car, inventoryStatus: 'reserved' }
      : car;
  }

  async function handle(req: IncomingMessage, res: ServerResponse, path: string) {
    if (!endpoints.has(path)) return false;
    const host = req.headers.host ?? '';
    const isLocal = /^127\.0\.0\.1:\d+$/.test(host) && req.socket.remoteAddress === '127.0.0.1';
    if (!isLocal || ((req.method === 'POST' || req.method === 'PUT') && req.headers.origin !== `http://${host}`)) {
      send(res, 403, { error: 'Test payments are available only on this computer.' });
      return true;
    }
    if (path === settingsPath) {
      if (req.method === 'GET') {
        send(res, 200, settings());
        return true;
      }
      if (req.method !== 'PUT' || !req.headers['content-type']?.startsWith('application/json')) {
        send(res, 405, { error: 'This test request is unavailable.' });
        return true;
      }
      const input = await readBody(req);
      if (!input || typeof input.enabled !== 'boolean' || Object.keys(input).length !== 1) {
        send(res, 400, { error: 'Choose whether to accept new reservations.' });
        return true;
      }
      enabled = input.enabled;
      send(res, 200, settings());
      return true;
    }
    if (path === '/api/reservations/payment-readiness' && req.method === 'GET') {
      send(res, 200, enabled ? { enabled, depositPence, terms, test: true } : { enabled });
      return true;
    }
    if (req.method !== 'POST' || !req.headers['content-type']?.startsWith('application/json')) {
      send(res, 405, { error: 'This test request is unavailable.' });
      return true;
    }
    const body = await readBody(req);
    if (!body || typeof body !== 'object') {
      send(res, 400, { error: 'Open the test payment again from the car page.' });
      return true;
    }
    if (path === '/api/reservations/checkout') {
      if (!enabled) {
        send(res, 503, { error: 'Online reservations are currently unavailable.' });
        return true;
      }
      const car = cars.find(item => item.id === body.vehicleId);
      const pricePence = Math.round((car?.price ?? 0) * 100);
      if (!car || car.sourceStatus === 'missing' || (car.currency && car.currency.toUpperCase() !== 'GBP')
        || pricePence < depositPence || body.expectedPricePence !== pricePence || body.expectedDepositPence !== depositPence
        || body.termsAccepted !== true || body.terms !== terms
        || typeof body.idempotencyKey !== 'string' || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(body.idempotencyKey)) {
        send(res, 409, { error: 'The test quote has changed. Refresh the car page and try again.' });
        return true;
      }
      const key = body.idempotencyKey.toLowerCase();
      const previousToken = attempts.get(key);
      const token = previousToken ?? randomBytes(24).toString('hex');
      if (previousToken) {
        const previous = sessions.get(previousToken);
        if (previous?.vehicleId !== car.id || previous.pricePence !== pricePence) {
          send(res, 409, { error: 'Open a new test checkout for this car.' });
          return true;
        }
      } else {
        if ((withReservationStatus(car).inventoryStatus ?? 'available') !== 'available') {
          send(res, 409, { error: 'This car already has a test reservation.' });
          return true;
        }
        const image = car.images?.[0];
        sessions.set(token, {
          vehicleId: car.id, vehicleTitle: [car.make, car.model].filter(Boolean).join(' ') || car.title || 'Test vehicle',
          registration: car.plate || car.vrm || car.registration || null,
          photo: car.heroImage || (typeof image === 'string' ? image : image?.url) || null, pricePence, state: 'pending',
        });
        attempts.set(key, token);
      }
      send(res, 200, { checkoutUrl: `/reservation-test-checkout#${token}` });
      return true;
    }

    const checkout = typeof body.token === 'string' ? sessions.get(body.token) : undefined;
    if (!checkout) {
      send(res, 404, { error: 'This test checkout expired. Open a new one from the car page.' });
      return true;
    }
    if (body.action === 'pay' && checkout.state === 'pending') {
      if ([...sessions.values()].some(entry => entry.vehicleId === checkout.vehicleId && entry.state === 'paid')) {
        send(res, 409, { error: 'This car already has a test reservation.' });
        return true;
      }
      checkout.state = 'paid';
    }
    if (body.action === 'cancel' && checkout.state === 'pending') checkout.state = 'cancelled';
    if (body.action === 'refund' && checkout.state === 'paid') checkout.state = 'refunded';
    send(res, 200, { ...checkout, depositPence });
    return true;
  }

  return { handle, withReservationStatus };
}
