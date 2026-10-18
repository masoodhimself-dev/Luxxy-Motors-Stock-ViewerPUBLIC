import { defaultFeatureRule, dealerFeatureDefinitions, resolveDealerFeatures, type DealerFeatureKey, type FeatureRule } from '@workspace/vehicle-meta';
import { currentDealerId, multiTenantEnabled } from './tenant-context';

type Query = { query: (sql: string, params?: unknown[]) => Promise<{ rows: Record<string, any>[] }> };
const rowRule = (row: Record<string, any>): FeatureRule => ({ mode: row.mode, disabledAt: row.disabled_at ? new Date(row.disabled_at).toISOString() : null, revision: row.revision, reason: row.reason, updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : null, updatedBy: row.updated_by });
export async function readFeatureRules(dealerId: string | null, client?: Query) {
  client ??= (await import('@workspace/db')).pool;
  const defaults = await client.query('SELECT * FROM platform_feature_defaults');
  const overrides = dealerId ? await client.query('SELECT * FROM dealer_feature_overrides WHERE dealer_id=$1', [dealerId]) : { rows: [] };
  return {
    defaults: Object.fromEntries(defaults.rows.map(row => [row.feature_key, rowRule(row)])),
    overrides: Object.fromEntries(overrides.rows.map(row => [row.feature_key, rowRule(row)])),
  };
}
export async function effectiveDealerFeatures(dealerId?: string, now = new Date()) {
  // Platform policies are configured only in the multi-tenant installation.
  // Standalone deployments preserve their existing release policy and settings.
  if (!multiTenantEnabled() && !dealerId) return resolveDealerFeatures({}, {}, now);
  const rules = await readFeatureRules(dealerId ?? currentDealerId());
  return resolveDealerFeatures(rules.defaults, rules.overrides, now);
}
export async function dealerFeatureEnabled(key: DealerFeatureKey, dealerId?: string, now = new Date()) {
  return (await effectiveDealerFeatures(dealerId, now)).find(feature => feature.key === key)?.enabled === true;
}
export class FeaturePolicyError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}
export async function saveFeatureRule(input: { dealerId: string | null; key: DealerFeatureKey; mode: FeatureRule['mode']; disabledAt: string | null; reason: string; expectedRevision: number; actor: string }) {
  const definition = dealerFeatureDefinitions.find(feature => feature.key === input.key)!;
  if ('releaseEnabled' in definition && !definition.releaseEnabled) throw new FeaturePolicyError('This feature is unavailable in the current release.', 409);
  if (input.dealerId === null && input.mode === 'inherit') throw new FeaturePolicyError('Platform defaults must be enabled or disabled.', 400);
  if (input.mode === 'disabled' && input.disabledAt) throw new FeaturePolicyError('A disabled feature does not need a future switch-off date.', 400);
  if (input.disabledAt && Date.parse(input.disabledAt) <= Date.now()) throw new FeaturePolicyError('Choose a future switch-off date.', 400);
  const { pool } = await import('@workspace/db');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    if (input.dealerId) {
      const dealer = await client.query('SELECT id FROM dealerships WHERE id=$1', [input.dealerId]);
      if (!dealer.rows.length) throw new FeaturePolicyError('Dealer not found.', 404);
      await client.query("INSERT INTO dealer_feature_overrides (dealer_id,feature_key,mode,reason,updated_by) VALUES ($1,$2,'inherit','Initial inherited policy',$3) ON CONFLICT DO NOTHING", [input.dealerId, input.key, input.actor]);
    } else {
      await client.query('INSERT INTO platform_feature_defaults (feature_key,mode,reason,updated_by) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING', [input.key, definition.defaultEnabled ? 'enabled' : 'disabled', 'Initial release default', input.actor]);
    }
    const scoped = input.dealerId !== null;
    const current = await client.query(scoped ? 'SELECT * FROM dealer_feature_overrides WHERE dealer_id=$1 AND feature_key=$2 FOR UPDATE' : 'SELECT * FROM platform_feature_defaults WHERE feature_key=$1 FOR UPDATE', scoped ? [input.dealerId, input.key] : [input.key]);
    const previous = current.rows[0] ? rowRule(current.rows[0]) : defaultFeatureRule('inherit');
    if (previous.revision !== input.expectedRevision) throw new FeaturePolicyError('These controls changed in another session. Reload before saving.', 409);
    const values = [input.mode, input.disabledAt, input.reason, input.actor, input.expectedRevision + 1, ...(scoped ? [input.dealerId, input.key] : [input.key])];
    const updated = await client.query(scoped
      ? 'UPDATE dealer_feature_overrides SET mode=$1,disabled_at=$2,reason=$3,updated_by=$4,revision=$5,updated_at=now() WHERE dealer_id=$6 AND feature_key=$7 RETURNING *'
      : 'UPDATE platform_feature_defaults SET mode=$1,disabled_at=$2,reason=$3,updated_by=$4,revision=$5,updated_at=now() WHERE feature_key=$6 RETURNING *', values);
    const after = rowRule(updated.rows[0]);
    await client.query('INSERT INTO feature_policy_audit (dealer_id,feature_key,before_rule,after_rule,reason,actor) VALUES ($1,$2,$3::jsonb,$4::jsonb,$5,$6)', [input.dealerId, input.key, JSON.stringify(previous), JSON.stringify(after), input.reason, input.actor]);
    await client.query('COMMIT');
    return after;
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}
