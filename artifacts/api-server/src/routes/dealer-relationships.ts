import { currentDealerId } from "../lib/tenant-context";
import { Router, type IRouter } from 'express';
import { pool } from '@workspace/db';
import type { DealerRelationships } from '@workspace/vehicle-meta';
import { requireStaff } from '../middlewares/staff-auth';
import { readDealerRelationships } from '../lib/dealer-relationships';

export function createDealerRelationshipsRouter(options: { dealerId?: () => string; read?: (dealerId: string) => Promise<DealerRelationships> } = {}): IRouter {
  const router = Router();
  const dealerId = options.dealerId ?? (() => currentDealerId());
  const read = options.read ?? (id => readDealerRelationships(id, pool));
  router.get('/staff/relationships', (_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); }, requireStaff, async (req, res): Promise<void> => {
    try { res.json(await read(dealerId())); }
    catch (error) {
      req.log.error({ err: error }, 'Staff relationship history read failed');
      res.status(500).json({ error: 'Customer and vehicle history could not be loaded. Please try again.' });
    }
  });
  router.all('/staff/relationships', (_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); }, requireStaff, (_req, res) => {
    res.set('Allow', 'GET').status(405).json({ error: 'Customer and vehicle history is read-only.' });
  });
  return router;
}

export default createDealerRelationshipsRouter();
