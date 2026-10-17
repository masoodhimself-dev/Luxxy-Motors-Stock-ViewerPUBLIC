type ReadinessClient = {
  query(query: { text: string; query_timeout: number }): Promise<unknown>;
  release(destroy?: boolean): void;
};
type ReadinessPool = { connect(): Promise<ReadinessClient> };

/**
 * At most one real probe is outstanding, even after its public deadline. The
 * acquisition is not cancellable in pg, so a late client must be discarded.
 */
export function createDatabaseReadiness(pool: ReadinessPool, options: { timeoutMs?: number; cacheMs?: number; now?: () => number } = {}) {
  const timeoutMs = options.timeoutMs ?? 2_000;
  const cacheMs = options.cacheMs ?? 5_000;
  const now = options.now ?? Date.now;
  let cached: { ready: boolean; at: number } | undefined;
  let active: Promise<boolean> | undefined;
  let underlyingActive = false;

  return function databaseReady(): Promise<boolean> {
    if (active) return active;
    if (underlyingActive) return Promise.resolve(false);
    if (cached && now() - cached.at < cacheMs) return Promise.resolve(cached.ready);

    underlyingActive = true;
    active = new Promise<boolean>(resolve => {
      let settled = false;
      let client: ReadinessClient | undefined;
      let released = false;
      const release = (destroy: boolean) => {
        if (client && !released) {
          released = true;
          try { client.release(destroy); } catch { /* A disconnected client is already gone. */ }
        }
      };
      const finish = (ready: boolean) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        cached = { ready, at: now() };
        resolve(ready);
      };
      const timer = setTimeout(() => { release(true); finish(false); }, timeoutMs);
      // Every rejection is consumed, including failures after the deadline.
      void (async () => {
        try {
          client = await pool.connect();
          if (settled) { release(true); return; }
          await client.query({ text: 'SELECT 1', query_timeout: timeoutMs });
          if (settled) return;
          release(false);
          finish(true);
        } catch {
          release(true);
          finish(false);
        } finally {
          underlyingActive = false;
        }
      })();
    }).finally(() => { active = undefined; });
    return active;
  };
}
