import type { Express, RequestHandler } from 'express';

const privateCapabilityPaths = ['/join','/api/account-invitations','/enquiry-photo-upload','/api/enquiry-photo-upload','/phone-share', '/api/phone-shares','/staff-upload', '/my-purchase', '/verify-invoice', '/reserve/payment-return', '/viewing', '/api/viewings', '/test-drive-declaration', '/api/test-drive-declarations'];
const privateCapabilityHeaders: RequestHandler = (_req, res, next) => {
  res.set({ 'Referrer-Policy': 'no-referrer', 'X-Robots-Tag': 'noindex, nofollow', 'Cache-Control': 'no-store' });
  next();
};

/** Apply before API/SPA handlers so failures and public HTML share the same protections. */
export function protectPrivateCapabilityPages(app: Express) {
  app.use(privateCapabilityPaths, privateCapabilityHeaders);
}

/** Body-parser errors may contain the original JSON body, including tokens and typed names. */
export function isPrivateTestDriveDeclarationPath(path: string): boolean {
  const pathname = path.split('?')[0];
  return /^\/api\/test-drive-declarations(?:\/|$)/i.test(pathname)
    || /^\/api\/staff\/enquiries\/[^/]+\/test-drive-declarations(?:\/|$)/i.test(pathname);
}

/** Never record URL-borne customer access credentials in request logs. */
export function privateRequestLogUrl(url: string | undefined) {
  return url?.split('?')[0]
    .replace(/\/(?:api\/invoice-verification|verify-invoice)\/[^?]*/i, '/invoice-verification/[private]')
    .replace(/(\/api\/customer-sale\/|\/my-purchase\/)[^/]+/i, '$1[private]')
    .replace(/(\/api\/viewings\/|\/viewing\/)[^/]+/i, '$1[private]')
    .replace(/(\/api\/test-drive-declarations\/|\/test-drive-declaration\/)[^/]+/i, '$1[private]')
    .replace(/(\/api\/(?:customer-intake-sessions|signing)\/|\/sign\/)[^/]+/i, '$1[private]');
}
