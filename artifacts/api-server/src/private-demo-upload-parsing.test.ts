import assert from 'node:assert/strict';
import { request as httpRequest } from 'node:http';
import test from 'node:test';
// Load the real app with isolated database/auth adapters and no log transport.
process.env.NODE_ENV = 'production';
process.env.LOG_LEVEL = 'silent';
const { default: app } = await import('./app');
const { platformStockUploadLimit } = await import('./lib/platform-stock-upload');
const { engine } = await import('./test/tenant-test-db');

test('production app accepts demo JSON larger than 8 KB and rejects an oversized body before receiving it', async () => {
  process.env.MULTI_TENANT_ENABLED = 'true';
  process.env.PLATFORM_ADMIN_HOST = 'admin.example.test';
  process.env.PLATFORM_ADMIN_USER_IDS = 'user_admin';
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve, reject) => { server.once('listening', resolve); server.once('error', reject); });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No isolated test address');
  const { port } = address;
  function post(path: string, body: string, advertisedBytes = Buffer.byteLength(body), finish = true) {
    return new Promise<{ status: number; body: string }>((resolve, reject) => {
      const request = httpRequest({ hostname: '127.0.0.1', port, path, method: 'POST',
        headers: { host: 'admin.example.test', 'content-type': 'application/json', 'content-length': advertisedBytes },
      }, response => {
        let text = '';
        response.on('data', chunk => { text += chunk; });
        response.once('end', () => { request.destroy(); resolve({ status: response.statusCode!, body: text }); });
      });
      request.once('error', reject);
      request.setTimeout(5000, () => request.destroy(new Error('The app waited for the oversized request body')));
      if (finish) request.end(body);
      else { request.flushHeaders(); request.write(body); }
    });
  }
  try {
    const body = JSON.stringify({ sourceUrl: 'https://www.autotrader.co.uk/dealers/example-motors-654321', stock: { description: 'x'.repeat(500_000) } });
    for (const path of ['/api/platform/demos/from-autotrader', '/api/platform/demos/from-cazoo']) {
      const accepted = await post(path, body);
      assert.equal(accepted.status, 403, accepted.body); // Authentication follows successful parsing.
      assert.match(accepted.body, /administrator|admin|sign in/i);
      const oversized = await post(path, '{', platformStockUploadLimit + 410001, false);
      assert.equal(oversized.status, 413, oversized.body);
      assert.match(oversized.body, /5 MB/);
    }
  } finally {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
    await engine.close();
  }
});
