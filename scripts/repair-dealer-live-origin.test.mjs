import assert from 'node:assert/strict';
import test from 'node:test';
import { createCipheriv, createHash, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { readdir, readFile } from 'node:fs/promises';
import { repairDealerLiveOrigin, rebaseManagedArtwork, parseRepairArguments } from './repair-dealer-live-origin.mjs';

const requireApi = createRequire(new URL('../artifacts/api-server/package.json', import.meta.url));
const { PGlite } = requireApi('@electric-sql/pglite');
const directory = new URL('../lib/db/drizzle/', import.meta.url);
const migrations = await Promise.all((await readdir(directory)).filter(file => /^\d+.*\.sql$/.test(file)).sort().map(file => readFile(new URL(file, directory), 'utf8')));
const dealerId = 'demo-multi-choice-fixture', oldOrigin = 'https://multi.demo.example.test', liveOrigin = 'https://multi.example.test';
const secret = 're_fixture_private_secret_never_in_report';
const env = {
  DEMO_BASE_DOMAIN: 'demo.example.test', DEMO_EMAIL_DOMAIN: 'demo-mail.example.test',
  PLATFORM_ADMIN_HOST: 'admin.example.test', STOCK_IMPORT_API_HOST: 'imports.example.test',
  DEMO_RESEND_API_KEY: 're_fixture_shared_demo_key', INTEGRATIONS_ENCRYPTION_KEY: Buffer.alloc(32, 42).toString('base64'),
};
function encrypted(settings) {
  const iv = Buffer.alloc(12, 19), cipher = createCipheriv('aes-256-gcm', Buffer.from(env.INTEGRATIONS_ENCRYPTION_KEY, 'base64'), iv);
  const data = Buffer.concat([cipher.update(JSON.stringify(settings)), cipher.final()]);
  return { encrypted: true, iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), data: data.toString('base64') };
}
const privateState = {
  version: 1, revision: 0, resend: { enabled: true, apiKey: secret, from: 'Multi Choice <enquiries@multi.example.test>', replyTo: 'enquiries@multi.example.test' },
  stripe: { enabled: false }, templates: {}, stockConnection: { source: 'cazoo', refreshSchedule: 'unchanged' },
};
async function fixture(work) {
  const db = new PGlite();
  try {
    for (const sql of migrations) await db.exec(sql);
    const car = randomUUID(), enquiry = randomUUID(), sale = randomUUID();
    for (const id of [dealerId, 'other-dealer']) {
      await db.query("INSERT INTO dealerships(id,name,status,canonical_origin,stock_platform,retailer_id,source_url) VALUES($1,'Fixture Motors','active',$2,'cazoo','fixture','https://www.cazoo.co.uk/fixture')", [id, id === dealerId ? oldOrigin : 'https://other.example.test']);
      await db.query('INSERT INTO dealer_settings(dealer_id,revision,config) VALUES($1,7,$2::jsonb)', [id, JSON.stringify({
        identity: { name: 'Multi Choice Motors', logoAsset: `${oldOrigin}/api/demo-logo` },
        presentation: { footerLogoUrl: `${oldOrigin}/api/demo-logo?variant=footer`, heroImageUrl: 'https://cdn.example.test/hero.jpg' },
        contact: { email: 'enquiries@multi.example.test' }, onlineReservation: { enabled: false },
      })]);
      await db.query('INSERT INTO dealer_private_settings(dealer_id,encrypted_payload) VALUES($1,$2::jsonb)', [id, JSON.stringify(encrypted(privateState))]);
    }
    for (const [hostname, id, verified] of [['multi.demo.example.test', dealerId, true], ['multi.example.test', dealerId, true], ['unverified.example.test', dealerId, false], ['other.example.test', 'other-dealer', true]])
      await db.query("INSERT INTO dealer_domains(hostname,dealer_id,verified,verification_token) VALUES($1,$2,$3,'fixture-token')", [hostname, id, verified]);
    await db.query("INSERT INTO dealer_demos(dealer_id,recipient,expires_at,updated_by,baseline,logo_data) VALUES($1,'operator@example.test',now()+interval '1 day','fixture',$2::jsonb,'data:image/png;base64,Zml4dHVyZQ==')", [dealerId, JSON.stringify({ preserved: 'baseline', arbitrarySample: [1, 2, 3] })]);
    await db.query("INSERT INTO vehicles(id,dealer_id,source,advert_id,title,source_price) VALUES($1,$2,'cazoo','fixture-1','Actual current stock',4990)", [car, dealerId]);
    await db.query("INSERT INTO vehicle_images(vehicle_id,source_url) VALUES($1,'https://cdn.example.test/actual-stock.jpg')", [car]);
    await db.query("INSERT INTO enquiries(id,dealer_id,type,status,customer_name,email,message) VALUES($1,$2,'general','new','Real customer fixture','buyer@example.test','Keep this enquiry and all its history')", [enquiry, dealerId]);
    await db.query('INSERT INTO sale_workspace(id,dealer_id,reference,revision,state) VALUES($1,$2,\'INV-REAL-FIXTURE\',9,$3::jsonb)', [sale, dealerId, JSON.stringify({
      draft: { customer: 'Real customer fixture', email: 'buyer@example.test', vehicleId: car },
      documents: [{ id: 'issued-invoice', snapshot: { branding: { identity: { name: 'Historic dealership' } }, total: 499000 } }],
      documentArchives: { 'issued-invoice': { content: 'EXACT_ISSUED_PDF_BYTES', sha256: 'PRESERVE' } },
      payments: [{ id: 'real-payment', amountPence: 499000, method: 'bank_transfer', status: 'confirmed' }],
    })]);
    await work(db, { car, enquiry, sale });
  } finally { await db.close(); }
}
const input = { dealerId, liveOrigin };
const apply = report => ({ ...input, apply: true, confirm: dealerId, actor: 'user_operator', expectedFingerprint: report.fingerprint });
const code = expected => error => error.code === expected;
async function allRows(db) {
  const tables = (await db.query("SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE' ORDER BY table_name")).rows;
  const result = {};
  for (const { table_name } of tables) result[table_name] = (await db.query(`SELECT to_jsonb(t) AS row FROM public."${table_name}" t ORDER BY to_jsonb(t)::text`)).rows;
  return result;
}

test('dry-run hashes protected data and exposes no private settings or customer content; it writes nothing', async () => fixture(async db => {
  const before = await allRows(db), report = await repairDealerLiveOrigin(db, input, env);
  assert.equal(report.status, 'prepared_read_only'); assert.equal(report.writesPerformed, 0);
  assert.equal(report.email.sender, '***@multi.example.test');
  assert.equal(report.protectedActivity.tables.sale_workspace.count, 1);
  assert.equal(report.protectedActivity.tables.vehicle_images.count, 1);
  assert.equal(report.protectedActivity.tables.enquiries.count, 1);
  assert.doesNotMatch(JSON.stringify(report), /EXACT_ISSUED_PDF_BYTES|Real customer fixture|buyer@example|re_fixture|baseline.*arbitrarySample/);
  assert.deepEqual(await allRows(db), before);
  assert.equal((await repairDealerLiveOrigin(db, input, env)).fingerprint, report.fingerprint);
}));

test('confirmed apply changes only tenant origin/demo status/managed artwork and retains every protected row and other tenant', async () => fixture(async db => {
  const before = await allRows(db), report = await repairDealerLiveOrigin(db, input, env);
  const result = await repairDealerLiveOrigin(db, apply(report), env), after = await allRows(db);
  assert.equal(result.status, 'applied'); assert.equal(result.protectedActivityAfter, report.protectedActivity.fingerprint);
  for (const table of Object.keys(before)) if (!['dealerships', 'dealer_demos', 'dealer_domains', 'dealer_settings', 'dealer_settings_versions'].includes(table)) assert.deepEqual(after[table], before[table], table);
  for (const table of ['dealerships', 'dealer_private_settings', 'dealer_settings']) {
    const key = table === 'dealerships' ? 'id' : 'dealer_id';
    assert.deepEqual(after[table].filter(item => item.row[key] === 'other-dealer'), before[table].filter(item => item.row[key] === 'other-dealer'));
  }
  const demo = (await db.query('SELECT * FROM dealer_demos WHERE dealer_id=$1', [dealerId])).rows[0];
  assert.ok(demo.converted_at); assert.equal(demo.converted_by, 'user_operator');
  assert.deepEqual(demo.baseline, before.dealer_demos[0].row.baseline);
  assert.equal(demo.conversion_receipt.removed.sales, 0);
  const settings = (await db.query('SELECT * FROM dealer_settings WHERE dealer_id=$1', [dealerId])).rows[0];
  assert.equal(settings.revision, 8); assert.equal(settings.config.identity.logoAsset, `${liveOrigin}/api/demo-logo`);
  assert.equal(settings.config.presentation.footerLogoUrl, `${liveOrigin}/api/demo-logo?variant=footer`);
  assert.equal(settings.config.presentation.heroImageUrl, 'https://cdn.example.test/hero.jpg');
  assert.equal((await db.query("SELECT verified FROM dealer_domains WHERE hostname='multi.demo.example.test'")).rows[0].verified, false);
  assert.equal((await db.query("SELECT verified FROM dealer_domains WHERE hostname='multi.example.test'")).rows[0].verified, true);
  assert.deepEqual(await repairDealerLiveOrigin(db, apply(report), env), { status: 'replayed', dealerId, origin: liveOrigin, writesPerformed: 0, messagesSent: 0 });
  assert.deepEqual(await allRows(db), after);
}));

test('wrong confirmation and stale activity fingerprint cannot apply; a fresh review is required', async () => fixture(async (db, ids) => {
  const report = await repairDealerLiveOrigin(db, input, env);
  await assert.rejects(repairDealerLiveOrigin(db, { ...apply(report), confirm: 'other-dealer' }, env), code('exact_apply_confirmation_required'));
  await db.query("UPDATE enquiries SET message='Customer added more details' WHERE id=$1", [ids.enquiry]);
  const changed = await allRows(db);
  await assert.rejects(repairDealerLiveOrigin(db, apply(report), env), code('stale_review_fingerprint'));
  assert.deepEqual(await allRows(db), changed);
}));

test('live domain must be verified for this dealer and cannot be a demo, platform or redirect-only host', async () => fixture(async db => {
  for (const [target, expected] of [
    ['https://other.example.test', 'live_origin_not_verified_for_dealer'], ['https://unverified.example.test', 'live_origin_not_verified_for_dealer'],
    ['https://multi.demo.example.test', 'ineligible_live_origin'], ['https://admin.example.test', 'ineligible_live_origin'],
    ['https://imports.example.test', 'ineligible_live_origin'], ['https://multi.example.test/path', 'invalid_live_origin'],
  ]) await assert.rejects(repairDealerLiveOrigin(db, { ...input, liveOrigin: target }, env), code(expected));
  await db.query("INSERT INTO domain_setup_jobs(dealer_id,hostname,hostnames,render_service_id,render_target,created_by,updated_by,status) VALUES($1,'multi.demo.example.test',$2::jsonb,'fixture','fixture','fixture','fixture','completed')", [dealerId, JSON.stringify(['multi.demo.example.test', 'multi.example.test'])]);
  await assert.rejects(repairDealerLiveOrigin(db, input, env), code('live_origin_is_redirect_only'));
}));

test('pending outbox and processing import jobs block promotion without changing their records', async () => fixture(async (db, ids) => {
  await db.query("INSERT INTO email_outbox(dealer_id,enquiry_id,kind,send_key,payload_hash,validation_hash,validation,account_hash,status,retry_deadline) VALUES($1,$2,'customer','fixture-send','hash','hash','{}','hash','queued',now()+interval '1 day')", [dealerId, ids.enquiry]);
  const pending = await allRows(db);
  await assert.rejects(repairDealerLiveOrigin(db, input, env), code('pending_email_or_job_requires_review'));
  assert.deepEqual(await allRows(db), pending);
  await db.query("UPDATE email_outbox SET status='sent'");
  await db.query("INSERT INTO cazoo_feed_checks(dealer_id,slot_key,status,received_at) VALUES($1,'fixture','processing',now())", [dealerId]);
  await assert.rejects(repairDealerLiveOrigin(db, input, env), code('pending_email_or_job_requires_review'));
}));

test('separate live encrypted sender and disabled payments are required; no credential enters reports', async () => fixture(async db => {
  for (const [patch, expected] of [
    [{ resend: { ...privateState.resend, apiKey: env.DEMO_RESEND_API_KEY } }, 'separate_live_sender_required'],
    [{ resend: { ...privateState.resend, from: 'Demo <dealer@demo-mail.example.test>' } }, 'separate_live_sender_required'],
    [{ resend: { ...privateState.resend, from: 'Other Dealer <sales@other.example.test>' } }, 'separate_live_sender_required'],
    [{ resend: { ...privateState.resend, replyTo: 'dealer@demo-mail.example.test' } }, 'live_reply_address_required'],
    [{ stripe: { enabled: true } }, 'payments_must_remain_off'],
  ]) {
    await db.query('UPDATE dealer_private_settings SET encrypted_payload=$1::jsonb WHERE dealer_id=$2', [JSON.stringify(encrypted({ ...privateState, ...patch })), dealerId]);
    await assert.rejects(repairDealerLiveOrigin(db, input, env), code(expected));
  }
  await db.query('UPDATE dealer_private_settings SET encrypted_payload=$1::jsonb WHERE dealer_id=$2', [JSON.stringify(encrypted(privateState)), dealerId]);
  await assert.rejects(repairDealerLiveOrigin(db, input, { ...env, INTEGRATIONS_ENCRYPTION_KEY: Buffer.alloc(32, 1).toString('base64') }), code('private_settings_unavailable'));
}));

test('explicit rollback rehearses the real writes and preserves all data byte for byte', async () => fixture(async db => {
  const before = await allRows(db), report = await repairDealerLiveOrigin(db, input, env);
  const result = await repairDealerLiveOrigin(db, { ...apply(report), rollback: true }, env);
  assert.equal(result.status, 'verified_rollback'); assert.equal(result.rolledBack, true); assert.equal(result.writesPerformed, 0);
  assert.deepEqual(await allRows(db), before);
}));

test('an unexpected invoice side effect is detected by the protected fingerprint and the entire transaction rolls back', async () => fixture(async db => {
  await db.exec(`CREATE FUNCTION fixture_unexpected_change() RETURNS trigger AS $$ BEGIN
    UPDATE sale_workspace SET state=state || '{"unexpected":true}'::jsonb WHERE dealer_id=NEW.id; RETURN NEW;
    END; $$ LANGUAGE plpgsql;
    CREATE TRIGGER fixture_origin_side_effect AFTER UPDATE OF canonical_origin ON dealerships FOR EACH ROW EXECUTE FUNCTION fixture_unexpected_change();`);
  const before = await allRows(db), report = await repairDealerLiveOrigin(db, input, env);
  await assert.rejects(repairDealerLiveOrigin(db, apply(report), env), code('protected_activity_changed_repair_rolled_back'));
  assert.deepEqual(await allRows(db), before);
}));

test('managed artwork rebasing and CLI parsing stay narrow and default to no writes', () => {
  const config = { identity: { logoAsset: `${oldOrigin}/api/demo-logo` }, presentation: { footerLogoUrl: '/api/demo-logo', heroImageUrl: 'https://third-party.example.test/api/demo-logo' } };
  const before = structuredClone(config), changed = rebaseManagedArtwork(config, oldOrigin, liveOrigin);
  assert.deepEqual(changed.changed, ['identity.logoAsset']); assert.deepEqual(config, before);
  assert.deepEqual(parseRepairArguments(['--dealer', dealerId, '--origin', liveOrigin]), { dealerId, liveOrigin, apply: false, rollback: false, confirm: undefined, expectedFingerprint: undefined, actor: undefined });
  assert.throws(() => parseRepairArguments(['--apply', '--apply']), code('invalid_arguments'));
  assert.equal(createHash('sha256').update('fixture').digest('hex').length, 64);
});
