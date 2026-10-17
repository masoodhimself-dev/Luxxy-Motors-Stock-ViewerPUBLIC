import test from 'node:test';
import assert from 'node:assert/strict';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { communicationsPreview } from './communications';

async function call(path: string, method = 'GET', host = '127.0.0.1:4186', remoteAddress = '127.0.0.1', origin?: string) {
  let body = '';
  const headers: Record<string, string> = {};
  const req = { method, headers: { host, origin }, socket: { remoteAddress } } as unknown as IncomingMessage;
  const res = {
    statusCode: 200,
    setHeader(name: string, value: string) { headers[name.toLowerCase()] = value; },
    end(value: string) { body = value; },
  } as unknown as ServerResponse;
  const handled = await communicationsPreview(req, res, new URL(path, `http://${host}`));
  return { handled, status: res.statusCode, headers, data: JSON.parse(body) };
}

test('preview AI stays disabled even if provider credentials and enable flags exist', async t => {
  const fetchMock = t.mock.method(globalThis, 'fetch', async () => { throw new Error('Preview must never contact a provider'); });
  const previous = Object.fromEntries(['OPENAI_API_KEY', 'AI_DRAFTS_ENABLED', 'AI_DRAFTS_DEALER_IDS'].map(key => [key, process.env[key]]));
  Object.assign(process.env, { OPENAI_API_KEY: 'fictional-preview-only', AI_DRAFTS_ENABLED: 'true', AI_DRAFTS_DEALER_IDS: 'local-preview' });
  try {
    const config = await call('/api/staff/ai-drafts/config');
    assert.equal(config.handled, true);
    assert.equal(config.status, 200);
    assert.equal(config.data.available, false);
    assert.equal(config.data.enabled, false);
    assert.equal(config.headers['cache-control'], 'no-store');
    assert.match(config.data.reason, /never contacts OpenAI/);
    assert.equal(JSON.stringify(config.data).includes('fictional-preview-only'), false);
    const generate = await call('/api/staff/enquiries/fictional/ai-draft', 'POST');
    assert.equal(generate.handled, true);
    assert.equal(generate.status, 503);
    assert.equal(fetchMock.mock.callCount(), 0);
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});

test('preview AI config and generation reject remote access and cross-origin calls', async () => {
  for (const [path, method] of [['/api/staff/ai-drafts/config', 'GET'], ['/api/staff/enquiries/fictional/ai-draft', 'POST']]) {
    assert.equal((await call(path, method, 'dealer.example')).status, 403);
    assert.equal((await call(path, method, '127.0.0.1:4186', '192.168.1.20')).status, 403);
    assert.equal((await call(path, method, '127.0.0.1:4186', '127.0.0.1', 'https://dealer.example')).status, 403);
  }
});
