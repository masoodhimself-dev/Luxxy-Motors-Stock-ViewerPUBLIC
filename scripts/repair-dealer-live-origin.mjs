/** Reviewed operator repair, never an HTTP endpoint or application startup task.
 * Default is a read-only review. This operation never deletes tenant activity. */
import { createDecipheriv, createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export class LiveOriginRepairError extends Error {
  constructor(code) { super(code); this.code = code; }
}
const fail = code => { throw new LiveOriginRepairError(code); };
const requireDatabase = createRequire(new URL('../lib/db/package.json', import.meta.url));
const stable = value => value instanceof Date ? value.toISOString() : Array.isArray(value) ? value.map(stable) :
  value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])])) : value;
const hash = value => createHash('sha256').update(JSON.stringify(stable(value))).digest('hex');
const without = (value, keys) => Object.fromEntries(Object.entries(value).filter(([key]) => !keys.includes(key)));
const identifier = value => /^[a-z_]+$/.test(value) ? `"${value}"` : fail('unsupported_schema');
const host = value => {
  if (typeof value !== 'string' || !/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/i.test(value)) fail('invalid_domain_configuration');
  return value.toLowerCase();
};
function policy(environment) {
  return {
    demo: host(environment.DEMO_BASE_DOMAIN),
    demoEmail: host(environment.DEMO_EMAIL_DOMAIN),
    reserved: [host(environment.PLATFORM_ADMIN_HOST), host(environment.STOCK_IMPORT_API_HOST)],
    sharedKeys: [environment.DEMO_RESEND_API_KEY, environment.DEMO_RESEND_STATUS_API_KEY].filter(Boolean),
  };
}
const isDemoHost = (hostname, p) => hostname === p.demo || hostname.endsWith(`.${p.demo}`);
function origin(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.port || url.pathname !== '/' || url.search || url.hash) fail('invalid_live_origin');
    host(url.hostname);
    if (url.origin !== value) fail('use_exact_https_origin');
    return url;
  } catch (error) {
    if (error instanceof LiveOriginRepairError) throw error;
    fail('invalid_live_origin');
  }
}
function privateSettings(payload, environment) {
  try {
    const raw = environment.INTEGRATIONS_ENCRYPTION_KEY;
    if (!raw || !payload?.encrypted) throw Error();
    const key = /^[a-fA-F0-9]{64}$/.test(raw) ? Buffer.from(raw, 'hex') : Buffer.from(raw, 'base64');
    if (key.length !== 32) throw Error();
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(payload.iv, 'base64'));
    decipher.setAuthTag(Buffer.from(payload.tag, 'base64'));
    const value = JSON.parse(Buffer.concat([decipher.update(Buffer.from(payload.data, 'base64')), decipher.final()]).toString('utf8'));
    if (value.version !== 1 || !Number.isSafeInteger(value.revision) || !value.resend || !value.stripe || !value.templates) throw Error();
    return value;
  } catch { fail('private_settings_unavailable'); }
}
function liveEmailReadiness(state, website, target, p) {
  const from = state.resend.from;
  const match = typeof from === 'string' && /^(?:[^<>\r\n]+\s*)?<([^<>]+)>$/.exec(from);
  const email = (match ? match[1] : from)?.trim();
  const validEmail = value => typeof value === 'string' && /^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(value);
  if (!state.resend.enabled || !/^re_[A-Za-z0-9_-]{8,}$/.test(state.resend.apiKey) || !validEmail(email) ||
    (state.resend.replyTo && !validEmail(state.resend.replyTo))) fail('live_email_not_ready');
  const domain = email.slice(email.lastIndexOf('@') + 1).toLowerCase();
  const base = target.hostname.replace(/^www\./, '');
  if (p.sharedKeys.includes(state.resend.apiKey) || domain === p.demoEmail || isDemoHost(domain, p) ||
    (domain !== base && !domain.endsWith(`.${base}`))) fail('separate_live_sender_required');
  if (state.resend.replyTo) {
    const replyDomain = state.resend.replyTo.slice(state.resend.replyTo.lastIndexOf('@') + 1).toLowerCase();
    if (replyDomain === p.demoEmail || isDemoHost(replyDomain, p)) fail('live_reply_address_required');
  }
  if (state.stripe.enabled !== false || website?.onlineReservation?.enabled === true) fail('payments_must_remain_off');
  return { configured: true, sender: `***@${domain}`, providerVerified: 'not_checked_by_this_script' };
}

/** Rebase only existing tenant-owned artwork at this exact prior origin. */
export function rebaseManagedArtwork(config, previousOrigin, liveOrigin) {
  const next = structuredClone(config), changed = [];
  for (const [group, key] of [['identity', 'logoAsset'], ['presentation', 'footerLogoUrl'], ['presentation', 'heroImageUrl']]) {
    const value = next?.[group]?.[key];
    if (typeof value !== 'string') continue;
    try {
      const url = new URL(value);
      if (url.origin !== previousOrigin || url.username || url.password ||
        !(url.pathname === '/api/demo-logo' || /^\/api\/website-assets\/[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(url.pathname))) continue;
      next[group][key] = liveOrigin + url.pathname + url.search + url.hash;
      changed.push(`${group}.${key}`);
    } catch { /* Relative and third-party artwork is already independent of the old origin. */ }
  }
  return { config: next, changed };
}

// Hash complete tenant rows inside PostgreSQL: customer, invoice, message and key
// contents never leave the server. Child tables inherit the dealer through their parent.
const childScopes = [
  ['lead_events', 'JOIN public.leads parent ON parent.id=t.lead_id'],
  ['vehicle_images', 'JOIN public.vehicles parent ON parent.id=t.vehicle_id'],
  ...['sale_payments', 'invoices', 'sale_revisions', 'sale_fulfilments', 'sale_events', 'sale_adjustments', 'sale_part_exchanges', 'sale_warranties', 'deal_vault_artifacts']
    .map(table => [table, 'JOIN public.sales parent ON parent.id=t.sale_id']),
  ...['sale_documents', 'signatures', 'acknowledgements']
    .map(table => [table, 'JOIN public.sale_revisions revision ON revision.id=t.revision_id JOIN public.sales parent ON parent.id=revision.sale_id']),
];
async function protectedActivity(client, dealerId) {
  const columns = (await client.query("SELECT table_name,column_name FROM information_schema.columns WHERE table_schema='public' ORDER BY table_name,column_name")).rows;
  const tables = new Set(columns.map(row => row.table_name));
  const excluded = ['dealer_domains', 'dealer_settings', 'dealer_settings_versions', 'dealer_demos'];
  const scopes = columns.filter(row => row.column_name === 'dealer_id' && !excluded.includes(row.table_name))
    .map(row => [row.table_name, '', 't.dealer_id']);
  for (const [table, join] of childScopes) if (tables.has(table) && !scopes.some(([name]) => name === table)) scopes.push([table, join, 'parent.dealer_id']);
  for (const row of columns.filter(row => row.column_name === 'vehicle_id'))
    if (!scopes.some(([name]) => name === row.table_name)) scopes.push([row.table_name, 'JOIN public.vehicles parent ON parent.id=t.vehicle_id', 'parent.dealer_id']);
  const activity = {};
  for (const [table, join, dealerColumn] of scopes.sort(([a], [b]) => a.localeCompare(b))) {
    const row = (await client.query(`SELECT count(*)::text AS count,md5(coalesce(string_agg(row_hash,',' ORDER BY row_hash),'')) AS hash FROM (SELECT md5(to_jsonb(t)::text) AS row_hash FROM public.${identifier(table)} t ${join} WHERE ${dealerColumn}=$1) fingerprinted`, [dealerId])).rows[0];
    activity[table] = { count: Number(row.count), hash: row.hash };
  }
  return { tables: activity, fingerprint: hash(activity) };
}
async function blockers(client, dealerId) {
  const checks = [
    ['email_outbox', 'status', ['queued', 'sending']],
    ['enquiry_emails', 'status', ['sending']],
    ['enquiry_email_drafts', 'status', ['sending']],
    ['demo_completion_jobs', 'status', ['queued', 'running']],
    ['domain_setup_jobs', 'status', ['queued', 'running', 'waiting']],
    ['cazoo_feed_checks', 'status', ['processing']],
    ['stock_import_runs', 'status', ['pending', 'processing', 'running']],
    ['staff_push_deliveries', 'status', ['pending', 'sending']],
    ['vehicle_watch_deliveries', 'status', ['processing']],
  ];
  const available = new Set((await client.query("SELECT table_name FROM information_schema.tables WHERE table_schema='public'")).rows.map(row => row.table_name));
  const result = [];
  for (const [table, column, statuses] of checks) if (available.has(table)) {
    const row = (await client.query(`SELECT count(*)::text AS count FROM public.${identifier(table)} WHERE dealer_id=$1 AND ${identifier(column)}::text=ANY($2::text[])`, [dealerId, statuses])).rows[0];
    if (Number(row.count)) result.push({ table, count: Number(row.count) });
  }
  return result;
}
async function snapshot(client, dealerId, lock) {
  const dealer = (await client.query(`SELECT * FROM dealerships WHERE id=$1${lock ? ' FOR UPDATE' : ''}`, [dealerId])).rows[0];
  if (!dealer) fail('dealer_not_found');
  const demo = (await client.query(`SELECT * FROM dealer_demos WHERE dealer_id=$1${lock ? ' FOR UPDATE' : ''}`, [dealerId])).rows[0];
  const domains = (await client.query(`SELECT * FROM dealer_domains WHERE dealer_id=$1 ORDER BY hostname${lock ? ' FOR UPDATE' : ''}`, [dealerId])).rows;
  const settings = (await client.query(`SELECT * FROM dealer_settings WHERE dealer_id=$1${lock ? ' FOR UPDATE' : ''}`, [dealerId])).rows[0];
  const privateRow = (await client.query(`SELECT * FROM dealer_private_settings WHERE dealer_id=$1${lock ? ' FOR SHARE' : ''}`, [dealerId])).rows[0];
  const domainJobs = (await client.query('SELECT * FROM domain_setup_jobs WHERE dealer_id=$1 ORDER BY id', [dealerId])).rows;
  const settingsVersions = (await client.query('SELECT revision,md5(to_jsonb(t)::text) AS hash FROM dealer_settings_versions t WHERE dealer_id=$1 ORDER BY revision', [dealerId])).rows;
  if (!demo || !settings || !privateRow) fail('incomplete_dealer_configuration');
  return { dealer, demo, domains, settings, privateRow, domainJobs, settingsVersions };
}

/** Executes only on the supplied connection. Never imports workers/providers. */
export async function repairDealerLiveOrigin(client, input, environment = process.env) {
  const { dealerId, liveOrigin, apply = false, confirm, expectedFingerprint, actor, rollback = false } = input;
  if (!/^[a-z0-9][a-z0-9-]{1,62}$/.test(dealerId ?? '')) fail('invalid_dealer_id');
  const p = policy(environment), target = origin(liveOrigin);
  if (isDemoHost(target.hostname, p) || p.reserved.includes(target.hostname) || /(?:^|\.)onrender\.com$/.test(target.hostname)) fail('ineligible_live_origin');
  if (apply && (confirm !== dealerId || !/^[a-f0-9]{64}$/.test(expectedFingerprint ?? '') ||
    typeof actor !== 'string' || !/^[A-Za-z0-9_@. -]{3,150}$/.test(actor))) fail('exact_apply_confirmation_required');
  if (rollback && !apply) fail('rollback_requires_apply');
  let begun = false;
  try {
    await client.query(apply ? 'BEGIN ISOLATION LEVEL SERIALIZABLE' : 'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY'); begun = true;
    await client.query("SET LOCAL lock_timeout='5s'");
    await client.query("SET LOCAL statement_timeout='60s'");
    if (apply) {
      // Keep the same demo-row-before-advisory-lock order as conversion/reset.
      await client.query('SELECT dealer_id FROM dealer_demos WHERE dealer_id=$1 FOR UPDATE', [dealerId]);
      for (const key of [`stock-import:${dealerId}`, `sale-workspace:${dealerId}`, `dealer-settings:${dealerId}`, `live-origin-repair:${dealerId}`])
        await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [key]);
    }
    const state = await snapshot(client, dealerId, apply);
    if (state.dealer.status !== 'active') fail('dealer_must_be_active');
    if (state.demo.converted_at) {
      if (apply && state.dealer.canonical_origin === liveOrigin && state.demo.conversion_receipt?.kind === 'non_destructive_live_origin_repair_v1' &&
        state.demo.conversion_receipt?.sourceFingerprint === expectedFingerprint && state.demo.conversion_receipt?.origin === liveOrigin) {
        await client.query('ROLLBACK'); begun = false;
        return { status: 'replayed', dealerId, origin: liveOrigin, writesPerformed: 0, messagesSent: 0 };
      }
      fail('already_converted_use_regular_domain_review');
    }
    const oldOrigin = origin(state.dealer.canonical_origin);
    if (!isDemoHost(oldOrigin.hostname, p)) fail('source_is_not_a_demo_origin');
    if (!state.domains.some(row => row.hostname === target.hostname && row.verified === true)) fail('live_origin_not_verified_for_dealer');
    const redirects = state.domainJobs.filter(row => row.status === 'completed').flatMap(row => Array.isArray(row.hostnames) ? row.hostnames.filter(name => name !== row.hostname) : []);
    if (redirects.includes(target.hostname)) fail('live_origin_is_redirect_only');
    const privateState = privateSettings(state.privateRow.encrypted_payload, environment);
    const email = liveEmailReadiness(privateState, state.settings.config, target, p);
    const pending = await blockers(client, dealerId);
    if (pending.length) fail('pending_email_or_job_requires_review');
    const activity = await protectedActivity(client, dealerId);
    const fingerprint = hash({ dealerId, liveOrigin, state, activity });
    if (apply && expectedFingerprint !== fingerprint) fail('stale_review_fingerprint');
    const artwork = rebaseManagedArtwork(state.settings.config, oldOrigin.origin, liveOrigin);
    const report = {
      status: apply ? rollback ? 'verified_rollback' : 'applied' : 'prepared_read_only',
      dealerId, previousOrigin: oldOrigin.origin, origin: liveOrigin, fingerprint,
      email, managedArtworkFields: artwork.changed, protectedActivity: activity,
      noDeletes: true, messagesSent: 0, providerRequests: 0,
      automationConfiguration: 'unchanged; live activation makes the dealer eligible for existing configured jobs',
      warnings: ['Owner invitation is separate and is not changed.', 'Existing issued documents and sent emails retain their original bytes.', 'Review pending automatic notifications before live activation.'],
      writesPerformed: 0,
    };
    if (!apply) { await client.query('ROLLBACK'); begun = false; return report; }
    if (artwork.changed.length) {
      const settings = (await client.query('UPDATE dealer_settings SET config=$2::jsonb,revision=revision+1,updated_at=now() WHERE dealer_id=$1 AND revision=$3 RETURNING revision', [dealerId, JSON.stringify(artwork.config), state.settings.revision])).rows[0];
      if (!settings) fail('settings_changed_during_repair');
      await client.query("INSERT INTO dealer_settings_versions(dealer_id,revision,config,published_at,published_by,action) VALUES($1,$2,$3::jsonb,now(),$4,'publish')", [dealerId, settings.revision, JSON.stringify(artwork.config), actor]);
    }
    await client.query('UPDATE dealerships SET canonical_origin=$2 WHERE id=$1', [dealerId, liveOrigin]);
    const retired = state.domains.filter(row => row.verified && isDemoHost(row.hostname, p)).map(row => row.hostname);
    if (retired.length) await client.query('UPDATE dealer_domains SET verified=false WHERE dealer_id=$1 AND hostname=ANY($2::text[])', [dealerId, retired]);
    const receipt = {
      kind: 'non_destructive_live_origin_repair_v1', origin: liveOrigin, previousOrigin: oldOrigin.origin,
      sourceFingerprint: fingerprint, protectedActivityFingerprint: activity.fingerprint, actor,
      removed: { sales: 0, enquiries: 0, leads: 0, vehicles: 0 },
      retainedBaseline: state.demo.baseline != null,
      ...(state.demo.conversion_receipt ? { previousReceipt: state.demo.conversion_receipt } : {}),
    };
    await client.query('UPDATE dealer_demos SET converted_at=now(),converted_by=$2,conversion_receipt=$3::jsonb,revision=revision+1,updated_by=$2 WHERE dealer_id=$1 AND converted_at IS NULL', [dealerId, actor, JSON.stringify(receipt)]);
    const after = await protectedActivity(client, dealerId);
    if (after.fingerprint !== activity.fingerprint) fail('protected_activity_changed_repair_rolled_back');
    const final = await snapshot(client, dealerId, false);
    const expectedDomains = state.domains.map(row => retired.includes(row.hostname) ? { ...row, verified: false } : row);
    if (hash(final.dealer) !== hash({ ...state.dealer, canonical_origin: liveOrigin }) || !final.demo.converted_at ||
      hash(without(final.demo, ['converted_at', 'converted_by', 'conversion_receipt', 'revision', 'updated_by'])) !==
        hash(without(state.demo, ['converted_at', 'converted_by', 'conversion_receipt', 'revision', 'updated_by'])) ||
      final.demo.converted_by !== actor || final.demo.updated_by !== actor || final.demo.revision !== state.demo.revision + 1 ||
      hash(final.demo.conversion_receipt) !== hash(receipt) || hash(final.domains) !== hash(expectedDomains) ||
      hash(final.settings.config) !== hash(artwork.config) || final.settings.revision !== state.settings.revision + (artwork.changed.length ? 1 : 0) ||
      hash(without(final.settings, ['config', 'revision', 'updated_at'])) !== hash(without(state.settings, ['config', 'revision', 'updated_at'])) ||
      hash(final.settingsVersions.filter(row => row.revision !== (artwork.changed.length ? final.settings.revision : -1))) !== hash(state.settingsVersions) ||
      hash(final.demo.baseline) !== hash(state.demo.baseline) ||
      hash(final.privateRow) !== hash(state.privateRow) ||
      !final.domains.some(row => row.hostname === target.hostname && row.verified)) fail('repair_postcondition_failed');
    if (rollback) await client.query('ROLLBACK');
    else {
      try { await client.query('COMMIT'); }
      catch { fail('commit_unconfirmed_check_receipt_before_retry'); }
    }
    begun = false;
    return { ...report, writesPerformed: rollback ? 0 : 2 + retired.length + (artwork.changed.length ? 2 : 0),
      protectedActivityAfter: after.fingerprint, baselinePreserved: true, retiredDemoDomains: retired, rolledBack: rollback };
  } finally { if (begun) await client.query('ROLLBACK').catch(() => {}); }
}

export function parseRepairArguments(args) {
  if (args.length === 1 && args[0] === '--help') return { help: true };
  const values = {}, flags = new Set();
  for (let i = 0; i < args.length; i++) {
    const key = args[i];
    if (['--apply', '--rollback'].includes(key)) { if (flags.has(key)) fail('invalid_arguments'); flags.add(key); }
    else if (['--dealer', '--origin', '--confirm', '--fingerprint', '--actor'].includes(key) && args[i + 1] && !args[i + 1].startsWith('--') && !(key in values)) values[key] = args[++i];
    else fail('invalid_arguments');
  }
  if (!values['--dealer'] || !values['--origin']) fail('invalid_arguments');
  return { dealerId: values['--dealer'], liveOrigin: values['--origin'], apply: flags.has('--apply'), rollback: flags.has('--rollback'),
    confirm: values['--confirm'], expectedFingerprint: values['--fingerprint'], actor: values['--actor'] };
}
export async function main(args = process.argv.slice(2), environment = process.env) {
  const input = parseRepairArguments(args);
  if (input.help) {
    console.log('Read-only review: node scripts/repair-dealer-live-origin.mjs --dealer DEALER_ID --origin https://dealer.example\nReviewed apply: add --apply --confirm DEALER_ID --fingerprint REVIEW_SHA256 --actor OPERATOR\nAdd --rollback to verify the writes in a transaction and roll them back. No messages or external provider calls are made.');
    return;
  }
  if (!environment.DATABASE_URL) fail('missing_database_configuration');
  const { Client } = requireDatabase('pg');
  const client = new Client({ connectionString: environment.DATABASE_URL, connectionTimeoutMillis: 10_000,
    idle_in_transaction_session_timeout: 60_000, application_name: 'luxxy_reviewed_live_origin_repair' });
  try { await client.connect(); console.log(JSON.stringify(await repairDealerLiveOrigin(client, input, environment), null, 2)); }
  finally { await client.end().catch(() => {}); }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) void main().catch(error => {
  console.error(JSON.stringify({ status: 'failed', code: error instanceof LiveOriginRepairError ? error.code : 'repair_unavailable',
    message: 'Repair did not confirm completion. Check its receipt before retrying. No provider request was made.' }));
  process.exitCode = 1;
});
