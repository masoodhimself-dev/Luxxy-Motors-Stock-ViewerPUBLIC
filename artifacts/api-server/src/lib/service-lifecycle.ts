import type { Request, RequestHandler } from 'express';

export class ServiceDrainingError extends Error {
  constructor() { super('The service is restarting. Retry shortly.'); }
}

export function createServiceLifecycle() {
  let draining = false;
  const operations = new Set<symbol>();
  // Do not retain abandoned request bodies/customer data in a process-global
  // Map. Only the count survives an uncertain disconnect; the weak lease can
  // still be completed by a known outer operation if that request is alive.
  const requests = new WeakMap<Request, () => void>();
  let activeRequests = 0;
  const idleWaiters = new Set<() => void>();
  const notify = () => {
    if (operations.size || activeRequests) return;
    for (const resolve of idleWaiters) resolve();
    idleWaiters.clear();
  };
  const finishRequest = (req: Request) => requests.get(req)?.();
  const middleware: RequestHandler = (req, res, next) => {
    const health = /^\/api\/(healthz|readyz)\/?$/.test(req.path);
    if (draining && (!health || !['GET', 'HEAD'].includes(req.method))) {
      res.set({ 'Cache-Control': 'no-store', 'Retry-After': '15', Connection: 'close' });
      if (/^\/api\/stock\/imports(?:\/|$)/.test(req.path)) {
        res.status(503).json({ status: 'busy', runId: null, retailerId: null, errors: [{ code: 'service_restarting', message: 'The service is restarting. Retry the same runId and identical body after Retry-After.', path: null, advertId: null }] });
      } else res.status(503).json({ error: 'The service is restarting. Retry shortly.' });
      return;
    }
    if (health) { next(); return; }
    let complete = false;
    const finish = () => {
      if (complete) return;
      complete = true;
      requests.delete(req);
      activeRequests--;
      notify();
    };
    requests.set(req, finish);
    activeRequests++;
    res.once('finish', finish);
    // A socket close does not prove that its asynchronous handler finished.
    // Keep an uncertain handler until the hard deadline, unless its outer
    // operation (the importer, for example) explicitly calls finishRequest.
    next();
  };
  async function track<T>(work: () => Promise<T>): Promise<T> {
    const token = Symbol();
    operations.add(token);
    try { return await work(); }
    finally { operations.delete(token); notify(); }
  }
  return {
    middleware, finishRequest, track,
    run<T>(work: () => Promise<T>): Promise<T> { return draining ? Promise.reject(new ServiceDrainingError()) : track(work); },
    isDraining: () => draining,
    beginDrain() { draining = true; },
    waitForIdle(): Promise<void> { return operations.size || activeRequests ? new Promise(resolve => idleWaiters.add(resolve)) : Promise.resolve(); },
    snapshot: () => ({ draining, activeOperations: operations.size, activeRequests }),
  };
}

export const serviceLifecycle = createServiceLifecycle();

/** Stops ticks immediately, while an accepted invocation remains tracked to completion. */
export function startLifecycleWorker(options: { intervalMs: number; work: () => Promise<unknown>; enabled?: () => boolean; onError: () => void; lifecycle?: ReturnType<typeof createServiceLifecycle> }) {
  const lifecycle = options.lifecycle ?? serviceLifecycle;
  let stopped = false, running = false;
  const tick = async () => {
    if (stopped || running || lifecycle.isDraining()) return;
    running = true;
    try {
      await lifecycle.run(async () => { if (!options.enabled || options.enabled()) await options.work(); });
    } catch { options.onError(); }
    finally { running = false; }
  };
  const timer = setInterval(() => void tick(), options.intervalMs);
  timer.unref();
  void tick();
  return () => { stopped = true; clearInterval(timer); };
}
