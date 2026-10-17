import { Router, type IRouter } from "express";
import { HealthCheckResponse } from "@workspace/api-zod";
import { pool } from '@workspace/db';
import { createDatabaseReadiness } from '../lib/database-readiness';
import { serviceLifecycle } from '../lib/service-lifecycle';

export const databaseReady = createDatabaseReadiness(pool);
export function createHealthRouter(checkDatabase = databaseReady, lifecycle = serviceLifecycle): IRouter {
const router: IRouter = Router();

router.get("/healthz", (_req, res) => {
  res.set('Cache-Control', 'no-store');
  const data = HealthCheckResponse.parse({ status: "ok" });
  res.json(data);
});

// Connectivity readiness is separate from liveness. It deliberately excludes
// internal database errors, capacity figures, hostnames and customer data.
router.get('/readyz', async (_req, res) => {
  res.set('Cache-Control', 'no-store');
  let ready = false;
  try { ready = !lifecycle.isDraining() && await checkDatabase(); } catch { /* Readiness must fail closed. */ }
  if (!ready) res.set('Retry-After', '5');
  res.status(ready ? 200 : 503).json({ status: ready ? 'ready' : 'not_ready' });
});
return router;
}

export default createHealthRouter();
