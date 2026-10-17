import type { Server } from 'node:http';
import type { createServiceLifecycle } from './service-lifecycle';

type Lifecycle = ReturnType<typeof createServiceLifecycle>;
type ShutdownLog = { info: (fields: object, message: string) => void; warn: (fields: object, message: string) => void };
export const shutdownDeadlineMs = 25_000;

export function createShutdown(options: {
  server: Pick<Server, 'close' | 'closeIdleConnections' | 'closeAllConnections'>;
  lifecycle: Lifecycle; stopWorkers: Array<() => void>; closePool: () => Promise<void>;
  log: ShutdownLog; exit: (code: number) => void; deadlineMs?: number;
}) {
  let pending: Promise<void> | undefined;
  return (signal: string): Promise<void> => {
    if (pending) return pending;
    options.lifecycle.beginDrain();
    pending = (async () => {
      options.log.info({ signal }, 'API shutdown started');
      for (const stop of options.stopWorkers) {
        try { stop(); } catch { options.log.warn({}, 'A background timer could not be stopped'); }
      }
      let timer: ReturnType<typeof setTimeout>;
      const deadline = new Promise<'deadline'>(resolve => { timer = setTimeout(() => resolve('deadline'), options.deadlineMs ?? shutdownDeadlineMs); });
      try {
        const serverClosed = new Promise<void>((resolve, reject) => {
          options.server.close(error => { if (error && (error as NodeJS.ErrnoException).code !== 'ERR_SERVER_NOT_RUNNING') reject(error); else resolve(); });
          options.server.closeIdleConnections();
        });
        const drained = Promise.all([serverClosed, options.lifecycle.waitForIdle()]).then(() => 'drained' as const);
        if (await Promise.race([drained, deadline]) === 'deadline') {
          options.log.warn(options.lifecycle.snapshot(), 'Shutdown deadline reached; unfinished durable work will recover on restart');
          options.server.closeAllConnections();
          options.exit(1);
          return;
        }
        // No pool closure while a tracked operation or uncertain HTTP handler can
        // still execute SQL. The same deadline also bounds pool shutdown itself.
        if (await Promise.race([options.closePool().then(() => 'closed' as const), deadline]) === 'deadline') {
          options.log.warn({}, 'Database close exceeded the shutdown deadline');
          options.server.closeAllConnections();
          options.exit(1);
          return;
        }
        options.log.info({}, 'API shutdown completed');
        options.exit(0);
      } catch {
        options.log.warn(options.lifecycle.snapshot(), 'API shutdown could not complete safely');
        options.server.closeAllConnections();
        options.exit(1);
      } finally { clearTimeout(timer!); }
    })();
    return pending;
  };
}

export function installShutdownSignals(shutdown: (signal: string) => Promise<void>, target: Pick<NodeJS.Process, 'on' | 'off'> = process) {
  const term = () => { void shutdown('SIGTERM'); }, interrupt = () => { void shutdown('SIGINT'); };
  // Keep a handler for repeated signals: re-entry joins the same drain rather
  // than restoring Node's default termination halfway through a transaction.
  target.on('SIGTERM', term); target.on('SIGINT', interrupt);
  return () => { target.off('SIGTERM', term); target.off('SIGINT', interrupt); };
}
