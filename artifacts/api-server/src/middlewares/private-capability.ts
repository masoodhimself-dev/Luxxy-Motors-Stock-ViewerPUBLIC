import type { Express, RequestHandler } from 'express';

const privateCapabilityPaths = ['/staff-upload', '/my-purchase', '/verify-invoice', '/reserve/payment-return', '/viewing', '/api/viewings'];
const privateCapabilityHeaders: RequestHandler = (_req, res, next) => {
  res.set({ 'Referrer-Policy': 'no-referrer', 'X-Robots-Tag': 'noindex, nofollow', 'Cache-Control': 'no-store' });
  next();
};

/** Apply before API/SPA handlers so failures and public HTML share the same protections. */
export function protectPrivateCapabilityPages(app: Express) {
  app.use(privateCapabilityPaths, privateCapabilityHeaders);
}

/** Never record URL-borne customer access credentials in request logs. */
export function privateRequestLogUrl(url: string | undefined) {
  return url?.split('?')[0]
    .replace(/\/(?:api\/invoice-verification|verify-invoice)\/[^?]*/i, '/invoice-verification/[private]')
    .replace(/(\/api\/customer-sale\/|\/my-purchase\/)[^/]+/i, '$1[private]')
    .replace(/(\/api\/viewings\/|\/viewing\/)[^/]+/i, '$1[private]')
    .replace(/(\/api\/(?:customer-intake-sessions|signing)\/|\/sign\/)[^/]+/i, '$1[private]');
}
