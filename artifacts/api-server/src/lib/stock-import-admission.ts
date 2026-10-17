import type { NextFunction, Request, Response } from 'express';

type Lease = { startedAt: number; processing: boolean; released: boolean; release: () => void };

/** Reject excess uploads before buffering JSON. This bounds one API process,
 * not the whole fleet; the collector must also pace and retry immutable runs. */
export function createStockImportAdmission(maximum = 2, now: () => number = Date.now) {
  maximum = Number.isInteger(maximum) && maximum >= 1 && maximum <= 4 ? maximum : 2;
  const leases = new Set<Lease>();
  const requests = new WeakMap<Request, Lease>();
  let accepted = 0, rejected = 0, completed = 0, peakActive = 0;
  function middleware(req: Request, res: Response, next: NextFunction) {
    if (req.method !== 'POST' || !/^\/api\/stock\/imports(?:\/|$)/i.test(req.path)) { next(); return; }
    if (leases.size >= maximum) {
      rejected++;
      res.set({ 'Retry-After': '15', 'Cache-Control': 'no-store' });
      res.status(503).json({ status: 'busy', runId: null, retailerId: null, errors: [{ code: 'import_capacity_busy', message: 'Stock import capacity is busy. Retry the same runId and identical body after Retry-After.', path: null, advertId: null }] });
      return;
    }
    const lease: Lease = { startedAt: now(), processing: false, released: false, release: () => {
      if (lease.released) return;
      lease.released = true; leases.delete(lease); completed++;
    } };
    accepted++; leases.add(lease); peakActive = Math.max(peakActive, leases.size); requests.set(req, lease);
    // Body/authentication errors never reach the importer. A disconnected
    // active transaction keeps its permit until the operation actually ends.
    const ended = () => { if (!lease.processing) lease.release(); };
    res.once('finish', ended); res.once('close', ended);
    req.once('aborted', ended);
    next();
  }
  async function run(req: Request, res: Response, operation: () => Promise<void>) {
    const lease = requests.get(req);
    if (lease?.released || res.destroyed) return;
    if (lease) lease.processing = true;
    try { await operation(); }
    finally { lease?.release(); }
  }
  function status() {
    const oldest = [...leases].reduce((value, lease) => Math.min(value, lease.startedAt), now());
    return { active: leases.size, maximum, accepted, rejected, completed, peakActive, oldestActiveMs: Math.max(0, now() - oldest) };
  }
  return { middleware, run, status };
}

export const importAdmission = createStockImportAdmission(Number(process.env.STOCK_IMPORT_CONCURRENCY ?? 2));
