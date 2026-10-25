import assert from 'node:assert/strict';
import test from 'node:test';
import { publicSettingsLinkError } from './lib/settings-content';
import { PostgresSettingsVersionStore, SettingsVersionError, type SettingsDatabase } from './lib/settings-versions';

test('publication rejects executable public links and embedded credentials without requiring optional fields', () => {
  assert.equal(publicSettingsLinkError({}), null);
  for (const [group, field] of [['identity', 'logoAsset'], ['address', 'mapsUrl'], ['legal', 'termsUrl'], ['legal', 'privacyUrl'], ['legal', 'cookieUrl'], ['social', 'instagram'], ['social', 'facebook'], ['social', 'twitter']]) {
    for (const value of ['javascript:alert(1)', 'data:text/html,<svg/onload=alert(1)>', 'https://user:password@example.test/', '//example.test/', 'https://example.test/with space', 'https://example.test/\\path']) {
      assert.match(publicSettingsLinkError({ [group]: { [field!]: value } }) ?? '', /valid HTTP or HTTPS/);
    }
    for (const value of ['', 'https://example.test/path?query=1#section', 'http://example.test/path']) {
      assert.equal(publicSettingsLinkError({ [group]: { [field!]: value } }), null);
    }
  }
});

test('safe installed logos and internal legal routes remain publishable; SVG data cannot bypass the editor', () => {
  for (const logoAsset of ['/api/website-assets/11111111-1111-4111-8111-111111111111', '/api/demo-logo', '/images/dealer.svg', 'data:image/png;base64,AAAA']) assert.equal(publicSettingsLinkError({ identity: { logoAsset } }), null);
  assert.equal(publicSettingsLinkError({ legal: { termsUrl: '/terms', privacyUrl: '/privacy?from=footer', cookieUrl: '' } }), null);
  for (const logoAsset of ['data:image/svg+xml;base64,PHN2Zy8+', '/\\evil.example.test', '/path\nother']) assert.ok(publicSettingsLinkError({ identity: { logoAsset } }));
});

test('presentation links keep their HTTPS-only contract and reject disguised credential links', () => {
  assert.equal(publicSettingsLinkError({ presentation: { footerLogoUrl: '', reviewsUrl: 'https://example.test/reviews' } }), null);
  for (const value of ['http://example.test', 'https://user:password@example.test', 'javascript:alert(1)', 'https://example.test/ space']) assert.match(publicSettingsLinkError({ presentation: { reviewsUrl: value } }) ?? '', /valid HTTPS/);
});

function versionFixture() {
  let current = { revision: 7, config: { identity: { name: 'Fictional dealer' } } as Record<string, unknown>, updated_at: '2026-10-25T10:00:00Z' };
  const history = new Map<number, Record<string, unknown>>();
  const calls: Array<{ sql: string; parameters: any[] }> = [];
  const query = async (sql: string, parameters: any[] = []) => {
    calls.push({ sql, parameters });
    if (sql.startsWith('SELECT config, revision')) return { rows: [structuredClone(current)] };
    if (sql.startsWith('SELECT config FROM dealer_settings_versions')) return { rows: history.has(parameters[1]) ? [{ config: structuredClone(history.get(parameters[1])) }] : [] };
    if (sql.startsWith('INSERT INTO dealer_settings_versions')) history.set(parameters[1], JSON.parse(parameters[2]));
    if (sql.startsWith('UPDATE dealer_settings SET')) current = { revision: parameters[2], config: JSON.parse(parameters[1]), updated_at: parameters[3] };
    return { rows: [] };
  };
  const database: SettingsDatabase = { query, connect: async () => ({ query, release() {} }) };
  return { store: new PostgresSettingsVersionStore('fictional-only', database), calls, current: () => structuredClone(current), history };
}
const validate = async (config: Record<string, unknown>) => {
  const error = publicSettingsLinkError(config);
  if (error) throw new SettingsVersionError(error, 400);
  return config;
};

test('two consecutive publications use the returned revision and preserve both history versions', async () => {
  const f = versionFixture();
  const first = await f.store.publish({ config: { identity: { name: 'First edit' } }, expectedRevision: 7, actor: 'Fictional owner', validate });
  const second = await f.store.publish({ config: { identity: { name: 'Second edit' } }, expectedRevision: first.revision, actor: 'Fictional owner', validate });
  assert.equal(first.revision, 8); assert.equal(second.revision, 9); assert.equal(f.current().revision, 9);
  assert.deepEqual(f.history.get(8), first.config); assert.deepEqual(f.history.get(9), second.config);
  assert.deepEqual(f.calls.filter(call => call.sql.startsWith('UPDATE dealer_settings')).map(call => call.parameters[2]), [8, 9]);
});

test('a genuinely stale editor receives the current revision without overwriting newer settings', async () => {
  const f = versionFixture();
  await f.store.publish({ config: { identity: { name: 'Newer saved edit' } }, expectedRevision: 7, actor: 'Other owner', validate });
  const writes = f.calls.filter(call => /^(INSERT|UPDATE)/.test(call.sql)).length;
  await assert.rejects(f.store.publish({ config: { identity: { name: 'Old unsaved edit' } }, expectedRevision: 7, actor: 'Fictional owner', validate }), { status: 409, revision: 8 });
  assert.equal(f.calls.filter(call => /^(INSERT|UPDATE)/.test(call.sql)).length, writes);
  assert.deepEqual(f.current().config, { identity: { name: 'Newer saved edit' } });
});

test('restoration returns a new revision which can be published again immediately', async () => {
  const f = versionFixture();
  const published = await f.store.publish({ config: { identity: { name: 'First edit' } }, expectedRevision: 7, actor: 'Fictional owner', validate });
  const restored = await f.store.publish({ restoredFrom: 7, expectedRevision: published.revision, actor: 'Fictional owner', validate });
  const saved = await f.store.publish({ config: { identity: { name: 'After restore' } }, expectedRevision: restored.revision, actor: 'Fictional owner', validate });
  assert.equal(restored.revision, 9); assert.equal(restored.restoredFrom, 7); assert.equal(saved.revision, 10);
  assert.deepEqual(f.history.get(7), { identity: { name: 'Fictional dealer' } });
});

test('unsafe publication is rejected before any version or published settings is written', async () => {
  const f = versionFixture();
  await assert.rejects(f.store.publish({ config: { social: { instagram: 'javascript:alert(1)' } }, expectedRevision: 7, actor: 'Fictional owner', validate }), { status: 400 });
  assert.equal(f.current().revision, 7); assert.equal(f.calls.some(call => /^(INSERT|UPDATE)/.test(call.sql)), false);
  assert.equal(f.calls.at(-1)?.sql, 'ROLLBACK');
});
