import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash, randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { createServer, request as httpRequest } from 'node:http';
import express from 'express';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { db, engine, portalUsersTable, dealerSettingsTable } from './test/tenant-test-db';
import { runWithTenant } from './lib/tenant-context';
import { normaliseWebsiteImage, websiteImageHeader, WebsiteAssetError, websiteAssetLimits } from './lib/website-asset-image';
import router from './routes/dealer-website-assets';

process.env.MULTI_TENANT_ENABLED = 'true';
const a = { dealerId: 'website-a', canonicalOrigin: 'https://a.example.test', platform: 'autotrader' as const, retailerId: 'fictional-a', sourceUrl: 'https://www.autotrader.co.uk/cars/retailer/stock?retailerId=fictional-a', kind: 'website' as const };
const b = { ...a, dealerId: 'website-b', canonicalOrigin: 'https://b.example.test' };
const image = (type: 'png' | 'jpeg' | 'webp' = 'png', colour = '#b78822') => {
  const canvas = createCanvas(24, 12), ctx = canvas.getContext('2d');
  ctx.fillStyle = colour; ctx.fillRect(0, 0, 12, 12);
  const bytes = type === 'png' ? canvas.toBuffer('image/png') : canvas.toBuffer(type === 'jpeg' ? 'image/jpeg' : 'image/webp', 90);
  return { bytes, dataUrl: `data:image/${type};base64,${bytes.toString('base64')}` };
};

test('website image parsing decodes raster bytes, strips metadata and bounds processing', async t => {
  await t.test('roundtrips PNG transparency and all three supported formats', async () => {
    for (const type of ['png', 'jpeg', 'webp'] as const) {
      const result = await normaliseWebsiteImage(image(type).dataUrl);
      assert.equal(result.width, 24); assert.equal(result.height, 12); assert.equal(result.mimeType, `image/${type}`);
      assert.equal(result.digest, createHash('sha256').update(result.bytes).digest('hex'));
      assert.deepEqual(websiteImageHeader(result.bytes, result.mimeType), { width: 24, height: 12 });
      const decoded = await loadImage(result.bytes);
      assert.equal(decoded.width, 24);
      if (type !== 'jpeg') {
        const canvas = createCanvas(24, 12), ctx = canvas.getContext('2d'); ctx.drawImage(decoded, 0, 0);
        assert.equal(ctx.getImageData(20, 6, 1, 1).data[3], 0);
      }
    }
  });
  await t.test('strips JPEG comments rather than retaining the original uploaded bytes', async () => {
    const { bytes } = image('jpeg'), comment = Buffer.from('private-filename-and-location-GPS');
    const marker = Buffer.alloc(4); marker[0] = 255; marker[1] = 254; marker.writeUInt16BE(comment.length + 2, 2);
    const annotated = Buffer.concat([bytes.subarray(0, 2), marker, comment, bytes.subarray(2)]);
    const result = await normaliseWebsiteImage(`data:image/jpeg;base64,${annotated.toString('base64')}`);
    assert.equal(result.bytes.includes(comment), false);
  });
  await t.test('rejects unsupported formats, mislabeled files, malformed and noncanonical base64', async () => {
    const png = image();
    for (const value of [
      `data:image/svg+xml;base64,${Buffer.from('<svg/>').toString('base64')}`,
      `data:image/png;base64,${Buffer.from('<script>malicious()</script>').toString('base64')}`,
      `data:image/jpeg;base64,${png.bytes.toString('base64')}`,
      `data:image/png;base64,${png.bytes.subarray(0, -1).toString('base64')}`,
      'data:image/png;base64,AAAA===', 'data:image/png;base64,AAAA\n', 'https://example.test/image.png',
    ]) await assert.rejects(normaliseWebsiteImage(value), WebsiteAssetError);
  });
  await t.test('rejects dimensions before decode and checks compressed payload size', async () => {
    const huge = Buffer.from(image().bytes); huge.writeUInt32BE(100_000, 16);
    await assert.rejects(normaliseWebsiteImage(`data:image/png;base64,${huge.toString('base64')}`), /4096/);
    const excessivePixels = Buffer.from(image().bytes); excessivePixels.writeUInt32BE(4096, 16); excessivePixels.writeUInt32BE(4096, 20);
    await assert.rejects(normaliseWebsiteImage(`data:image/png;base64,${excessivePixels.toString('base64')}`), /12 megapixels/);
    await assert.rejects(normaliseWebsiteImage(`data:image/png;base64,${Buffer.alloc(websiteAssetLimits.bytes + 1).toString('base64')}`), WebsiteAssetError);
  });
  await t.test('rejects a raster header whose image data cannot actually decode', async () => {
    const source = image();
    // Header alone looks plausible; remove the IDAT payload while retaining a well-shaped PNG envelope.
    const end = source.bytes.subarray(source.bytes.length - 12);
    const corrupt = Buffer.concat([source.bytes.subarray(0, 33), end]);
    await assert.rejects(normaliseWebsiteImage(`data:image/png;base64,${corrupt.toString('base64')}`), WebsiteAssetError);
  });
  await t.test('enforces the processed output size as well as the compressed input size', async () => {
    const canvas = createCanvas(2800, 2800), ctx = canvas.getContext('2d'), pixels = ctx.createImageData(2800, 2800);
    let state = 12987;
    for (let i = 0; i < pixels.data.length; i += 4) {
      for (let channel = 0; channel < 3; channel++) { state ^= state << 13; state ^= state >>> 17; state ^= state << 5; pixels.data[i + channel] = state & 255; }
      pixels.data[i + 3] = 255;
    }
    ctx.putImageData(pixels, 0, 0);
    const compressed = canvas.toBuffer('image/jpeg', 20);
    assert.ok(compressed.length < websiteAssetLimits.bytes);
    await assert.rejects(normaliseWebsiteImage(`data:image/jpeg;base64,${compressed.toString('base64')}`), (error: unknown) => error instanceof WebsiteAssetError && error.status === 413);
  });
  await t.test('caps simultaneous decoder work instead of queuing unlimited images', async () => {
    const dataUrl = image().dataUrl;
    const first = normaliseWebsiteImage(dataUrl), second = normaliseWebsiteImage(dataUrl);
    await assert.rejects(normaliseWebsiteImage(dataUrl), (error: unknown) => error instanceof WebsiteAssetError && error.status === 429);
    await Promise.all([first, second]);
    assert.equal((await normaliseWebsiteImage(dataUrl)).width, 24);
  });
});

test('website asset HTTP flow is tenant-scoped, immutable, permission-checked and publication-free', async t => {
  for (const file of (await readdir('../../lib/db/drizzle')).filter(name => /^\d+.*\.sql$/.test(name)).sort()) await engine.exec(await readFile(join('../../lib/db/drizzle', file), 'utf8'));
  await db.insert(portalUsersTable).values([
    { dealerId: a.dealerId, authUserId: 'website-owner-a', role: 'owner' },
    { dealerId: b.dealerId, authUserId: 'website-owner-b', role: 'owner' },
    { dealerId: a.dealerId, authUserId: 'website-sales-a', role: 'salesperson' },
    { dealerId: a.dealerId, authUserId: 'website-accounts-a', role: 'accounts' },
    { dealerId: a.dealerId, authUserId: 'website-disabled-a', role: 'owner', disabledAt: new Date() },
  ]);
  const config = { identity: { name: 'Fictional A', logoAsset: 'https://old.example.test/logo.png' }, hours: [] };
  await db.insert(dealerSettingsTable).values({ dealerId: a.dealerId, config, revision: 4 });
  const app = express();
  app.use(express.json({ limit: '3mb' }));
  app.use((req, _res, next) => {
    (req as any).log = { error() {}, warn() {} };
    runWithTenant(req.get('host') === 'b.example.test' ? b : req.get('host') === 'demo-a.example.test' ? { ...a, demo: true } : a, next);
  });
  app.use('/api', router);
  const server = createServer(app); await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('Test HTTP server unavailable');
  const request = (path: string, { method = 'GET', body, user = 'website-owner-a', host = 'a.example.test', origin, headers = {} }: { method?: string; body?: unknown; user?: string; host?: string; origin?: string; headers?: Record<string, string> } = {}): Promise<{ status: number; headers: Record<string, any>; bytes: Buffer; json: any }> => new Promise((resolve, reject) => {
    const req = httpRequest(`http://127.0.0.1:${address.port}/api${path}`, { method, headers: { host, ...(user ? { 'x-test-user': user } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}), ...(origin ? { origin } : {}), ...headers } }, res => {
      const buffers: Buffer[] = []; res.on('data', chunk => buffers.push(Buffer.from(chunk))); res.on('end', () => {
        const bytes = Buffer.concat(buffers); resolve({ status: res.statusCode!, headers: res.headers, bytes, json: res.headers['content-type']?.includes('json') ? JSON.parse(bytes.toString()) : null });
      });
    }); req.on('error', reject); req.end(body ? JSON.stringify(body) : undefined);
  });
  const payload = { requestId: randomUUID(), image: image().dataUrl };
  let uploaded: any;
  try {
    await t.test('requires existing authorized owner and rejects sibling-origin writes', async () => {
      for (const [user, expected] of [['', 401], ['website-owner-b', 403], ['website-sales-a', 403], ['website-accounts-a', 403], ['website-disabled-a', 403]] as const) assert.equal((await request('/staff/website-assets', { method: 'POST', body: payload, user })).status, expected);
      assert.equal((await request('/staff/website-assets', { method: 'POST', body: payload, origin: b.canonicalOrigin })).status, 403);
      assert.equal((await request('/staff/website-assets', { method: 'POST', body: payload, headers: { 'sec-fetch-site': 'same-site' } })).status, 403);
      const count = await engine.query<{ n: number }>('SELECT count(*)::integer AS n FROM dealer_website_assets'); assert.equal(count.rows[0]?.n, 0);
    });
    await t.test('returns only safe metadata and canonical URL without publishing or changing stock', async () => {
      const result = await request('/staff/website-assets', { method: 'POST', body: payload, origin: a.canonicalOrigin });
      assert.equal(result.status, 201); uploaded = result.json;
      assert.match(uploaded.id, /^[0-9a-f-]{36}$/); assert.equal(uploaded.url, `${a.canonicalOrigin}/api/website-assets/${uploaded.id}`);
      assert.deepEqual(Object.keys(uploaded).sort(), ['byteSize', 'height', 'id', 'mimeType', 'replayed', 'url', 'width']);
      assert.equal(uploaded.replayed, false); assert.equal(uploaded.width, 24); assert.equal(uploaded.height, 12);
      assert.match(result.headers['cache-control'], /no-store/);
      const saved = await engine.query('SELECT config,revision FROM dealer_settings WHERE dealer_id=$1', [a.dealerId]);
      assert.deepEqual(saved.rows[0], { config, revision: 4 });
      assert.equal((await engine.query<{ n: number }>('SELECT count(*)::integer AS n FROM dealer_settings_versions WHERE dealer_id=$1', [a.dealerId])).rows[0]?.n, 0);
      assert.equal((await engine.query<{ n: number }>('SELECT count(*)::integer AS n FROM vehicles WHERE dealer_id=$1', [a.dealerId])).rows[0]?.n, 0);
    });
    await t.test('replays the identical request after a lost response and rejects changed content', async () => {
      const replay = await request('/staff/website-assets', { method: 'POST', body: payload });
      assert.equal(replay.status, 200); assert.equal(replay.json.id, uploaded.id); assert.equal(replay.json.replayed, true);
      const conflict = await request('/staff/website-assets', { method: 'POST', body: { ...payload, image: image('png', '#000').dataUrl } });
      assert.equal(conflict.status, 409); assert.equal(conflict.json.code, 'WEBSITE_IMAGE_REQUEST_CONFLICT');
      assert.equal((await engine.query<{ n: number }>('SELECT count(*)::integer AS n FROM dealer_website_assets WHERE dealer_id=$1', [a.dealerId])).rows[0]?.n, 1);
    });
    await t.test('serves sanitized public bytes with immutable caching, ETag and HEAD', async () => {
      const response = await request(`/website-assets/${uploaded.id}`, { user: '' });
      assert.equal(response.status, 200); assert.equal(response.headers['content-type'], 'image/png');
      assert.equal(response.headers['x-content-type-options'], 'nosniff'); assert.match(response.headers['cache-control'], /immutable/);
      assert.equal(response.bytes.length, uploaded.byteSize); assert.equal((await loadImage(response.bytes)).width, 24);
      assert.equal(response.headers.etag, `"${createHash('sha256').update(response.bytes).digest('hex')}"`);
      assert.equal((await request(`/website-assets/${uploaded.id}`, { user: '', headers: { 'if-none-match': response.headers.etag } })).status, 304);
      const head = await request(`/website-assets/${uploaded.id}`, { method: 'HEAD', user: '' }); assert.equal(head.status, 200); assert.equal(head.bytes.length, 0);
      assert.equal((await request('/website-assets/not-a-uuid', { user: '' })).status, 404);
      const demo = await request(`/website-assets/${uploaded.id}`, { host: 'demo-a.example.test', user: '' });
      assert.equal(demo.status, 200); assert.equal(demo.headers['cache-control'], 'no-store');
    });
    await t.test('the same public ID is unavailable on another dealership; request IDs are tenant-local', async () => {
      assert.equal((await request(`/website-assets/${uploaded.id}`, { host: 'b.example.test', user: '' })).status, 404);
      const other = await request('/staff/website-assets', { method: 'POST', host: 'b.example.test', user: 'website-owner-b', body: payload, origin: b.canonicalOrigin });
      assert.equal(other.status, 201); assert.notEqual(other.json.id, uploaded.id); assert.match(other.json.url, /^https:\/\/b\.example\.test\//);
      assert.equal((await request(`/website-assets/${other.json.id}`, { user: '' })).status, 404);
    });
    await t.test('simultaneous identical uploads reserve one tenant-scoped asset', async () => {
      const parallel = { ...payload, requestId: randomUUID() };
      const results = await Promise.all([1, 2].map(() => request('/staff/website-assets', { method: 'POST', host: 'b.example.test', user: 'website-owner-b', body: parallel })));
      assert.deepEqual(results.map(item => item.status).sort(), [200, 201]);
      assert.equal(results[0]!.json.id, results[1]!.json.id);
      const count = await engine.query<{ n: number }>('SELECT count(*)::integer AS n FROM dealer_website_assets WHERE dealer_id=$1 AND request_id=$2', [b.dealerId, parallel.requestId]);
      assert.equal(count.rows[0]?.n, 1);
    });
    await t.test('rejects extra fields, wrong file formats and invalid dimensions without storing anything', async () => {
      for (const body of [{ ...payload, requestId: randomUUID(), dealerId: b.dealerId }, { requestId: randomUUID(), image: 'data:image/svg+xml;base64,PHN2Zy8+' }, { image: payload.image }]) assert.equal((await request('/staff/website-assets', { method: 'POST', body })).status, 400);
      assert.equal((await engine.query<{ n: number }>('SELECT count(*)::integer AS n FROM dealer_website_assets WHERE dealer_id=$1', [a.dealerId])).rows[0]?.n, 1);
    });
    await t.test('enforces per-dealer count allowance under a transaction lock and allows existing replay at quota', async () => {
      await engine.query("INSERT INTO dealer_website_assets(id,dealer_id,request_id,request_hash,bytes,mime_type,byte_size,width,height,digest,uploaded_by) SELECT gen_random_uuid(),$1,gen_random_uuid(),repeat('a',64),decode('00','hex'),'image/png',1,1,1,repeat('b',64),'fictional-test-only' FROM generate_series(1,99)", [a.dealerId]);
      const result = await request('/staff/website-assets', { method: 'POST', body: { ...payload, requestId: randomUUID() } });
      assert.equal(result.status, 409); assert.equal(result.json.code, 'WEBSITE_IMAGE_QUOTA');
      assert.equal((await request('/staff/website-assets', { method: 'POST', body: payload })).status, 200);
      assert.equal((await request('/staff/website-assets', { method: 'POST', host: 'b.example.test', user: 'website-owner-b', body: { ...payload, requestId: randomUUID() } })).status, 201);
    });
    await t.test('enforces the byte allowance independently of the image count', async () => {
      await engine.query('DELETE FROM dealer_website_assets WHERE dealer_id=$1 AND uploaded_by=$2', [a.dealerId, 'fictional-test-only']);
      await engine.query("INSERT INTO dealer_website_assets(id,dealer_id,request_id,request_hash,bytes,mime_type,byte_size,width,height,digest,uploaded_by) SELECT gen_random_uuid(),$1,gen_random_uuid(),repeat('a',64),decode(repeat('00',2097152),'hex'),'image/png',2097152,1,1,repeat('b',64),'fictional-byte-quota-test' FROM generate_series(1,25)", [a.dealerId]);
      const count = await engine.query<{ n: number }>('SELECT count(*)::integer AS n FROM dealer_website_assets WHERE dealer_id=$1', [a.dealerId]);
      assert.equal(count.rows[0]?.n, 26);
      const result = await request('/staff/website-assets', { method: 'POST', body: { ...payload, requestId: randomUUID() } });
      assert.equal(result.status, 409); assert.equal(result.json.code, 'WEBSITE_IMAGE_QUOTA');
    });
    await t.test('schema rejects unsupported MIME, oversized bytes and unsafe dimensions', async () => {
      for (const [field, value] of [['mime_type', 'image/svg+xml'], ['width', 5000], ['height', 0], ['byte_size', 4]] as const) {
        await assert.rejects(engine.query(`UPDATE dealer_website_assets SET ${field}=$1 WHERE id=$2`, [value, uploaded.id]));
      }
    });
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); await engine.close(); }
});
