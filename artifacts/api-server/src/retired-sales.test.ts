import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import router from './routes/retired-sales';

test('retired sales routes cannot reach legacy handlers; unrelated routes continue', async () => {
  const app = express();
  app.use('/api', router);
  app.use((_req, res) => { res.status(204).end(); });
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  const address = server.address() as { port: number };
  try {
    for (const method of ['GET', 'POST', 'PATCH', 'DELETE']) {
      for (const path of ['sales', 'sales/123/complete', 'signing/token/complete', 'customer-intake-sessions/token/complete']) {
        const response = await fetch(`http://127.0.0.1:${address.port}/api/${path}`, { method });
        assert.equal(response.status, 410);
      }
    }
    for (const path of ['stock', 'enquiries', 'reservations', 'leads', 'dealer-settings']) {
      assert.equal((await fetch(`http://127.0.0.1:${address.port}/api/${path}`)).status, 204);
    }
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
});
