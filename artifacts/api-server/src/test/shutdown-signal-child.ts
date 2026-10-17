import type { Server } from 'node:http';
import { createServiceLifecycle } from '../lib/service-lifecycle';
import { createShutdown, installShutdownSignals } from '../lib/shutdown';
const lifecycle = createServiceLifecycle();
const emit = (event: string, complete?: () => void) => {
  if (process.send) { if (complete) process.send(event, complete); else process.send(event); }
  else process.stdout.write(`${event}\n`, complete);
};
let finish!: () => void;
const work = new Promise<void>(resolve => { finish = resolve; });
void lifecycle.track(async () => { await work; emit('work-finished'); });
process.on('message', message => { if (message === 'finish-work') finish(); });
if (!process.send) process.stdin.on('data', data => { if (String(data).includes('finish-work')) finish(); });
const server = {
  close(callback: () => void) { emit('http-closed'); setImmediate(callback); return this; },
  closeIdleConnections() {}, closeAllConnections() {},
} as unknown as Pick<Server, 'close' | 'closeIdleConnections' | 'closeAllConnections'>;
installShutdownSignals(createShutdown({
  server, lifecycle, stopWorkers: [() => { emit('workers-stopped'); }],
  closePool: () => new Promise<void>(resolve => { emit('pool-closed', () => resolve()); }),
  log: { info() {}, warn() {} },
  exit: code => { emit(`exit-${code}`, () => process.exit(code)); }, deadlineMs: 2_000,
}));
if (!process.send) emit(`pid:${process.pid}`);
emit('ready');
