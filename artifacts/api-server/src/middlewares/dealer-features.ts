import type { RequestHandler } from 'express';
import type { DealerFeatureKey } from '@workspace/vehicle-meta';
import { dealerFeatureEnabled } from '../lib/dealer-features';

export function requireDealerFeature(key: DealerFeatureKey): RequestHandler {
  return async (_req, res, next) => {
    try {
      if (await dealerFeatureEnabled(key)) { next(); return; }
      res.set('Cache-Control', 'no-store').status(403).json({ error: 'This feature is currently unavailable for this dealership. Please contact the showroom.', code: 'FEATURE_DISABLED', feature: key });
    } catch {
      res.set('Cache-Control', 'no-store').status(503).json({ error: 'Feature availability could not be checked. Please try again.', code: 'FEATURE_POLICY_UNAVAILABLE' });
    }
  };
}

/** Only new actions are gated. Reading history, cancelling and revoking remain available. */
export const enforceDealerFeatures: RequestHandler = async (req, res, next) => {
  const route = req.path.toLowerCase().replace(/\/+$/, '');
  if (req.method !== 'POST') { next(); return; }
  let feature: DealerFeatureKey | undefined;
  if (['/enquiries', '/staff/enquiries'].includes(route)) {
    if (req.body?.type === 'viewing') feature = 'testDriveBookings';
    else if (route === '/enquiries') feature = req.body?.type === 'part_exchange' ? 'partExchange' : 'publicEnquiries';
  }
  if (/^\/viewings\/[^/]+\/reschedule$/.test(route) || (/^\/staff\/enquiries\/[^/]+\/appointment$/.test(route) && req.body?.action === 'reschedule')) feature = 'testDriveBookings';
  if (/^\/test-drive-bookings\/[^/]+\/decision$/.test(route) && req.body?.decision === 'confirm') feature = 'testDriveBookings';
  if (/^\/staff\/enquiries\/[^/]+\/email$/.test(route)) feature = 'customerEmails';
  // An embedded trade-in is still a part-exchange request, including on a test drive.
  // Check it independently so choosing another enquiry type cannot bypass the switch.
  if (route === '/enquiries' && (req.body?.type === 'part_exchange' || req.body?.partExchange != null)) {
    try {
      if (!(await dealerFeatureEnabled('partExchange'))) return requireDealerFeature('partExchange')(req, res, next);
      const { pool } = await import('@workspace/db');
      const { currentDealerId } = await import('../lib/tenant-context');
      const row = (await pool.query("SELECT config->'partExchange'->>'enabled' AS enabled FROM dealer_settings WHERE dealer_id=$1", [currentDealerId()])).rows[0];
      if (row?.enabled !== 'true') { res.set('Cache-Control','no-store').status(403).json({error:'Part exchange is not available online. Please contact the showroom.',code:'FEATURE_DISABLED',feature:'partExchange'}); return; }
    } catch { res.set('Cache-Control','no-store').status(503).json({error:'Part-exchange availability could not be checked. Please try again.',code:'FEATURE_POLICY_UNAVAILABLE'}); return; }
  }
  if (!feature) { next(); return; }
  return requireDealerFeature(feature)(req, res, next);
};
