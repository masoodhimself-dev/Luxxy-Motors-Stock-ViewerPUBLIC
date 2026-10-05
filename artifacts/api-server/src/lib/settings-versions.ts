export type SettingsVersion = { revision: number; config: Record<string, unknown>; publishedAt: string; publishedBy: string; action: 'initial' | 'publish' | 'restore'; restoredFrom?: number };
export class SettingsVersionError extends Error {
  constructor(message: string, public status = 409, public revision?: number) { super(message); }
}
export function expectedSettingsRevision(value: string | string[] | undefined): number {
  const input = Array.isArray(value) ? value[0] : value;
  if (input === undefined) throw new SettingsVersionError('Refresh settings before publishing. A settings revision is required.', 428);
  if (!/^(?:\d+|"\d+")$/.test(input)) throw new SettingsVersionError('The settings revision is invalid.', 400);
  const clean = input.replace(/^"|"$/g, '');
  if (!/^\d+$/.test(clean) || !Number.isSafeInteger(Number(clean))) throw new SettingsVersionError('The settings revision is invalid.', 400);
  return Number(clean);
}
export function nextSettingsVersion(current: SettingsVersion, config: Record<string, unknown>, expected: number, actor: string, now: string, restoredFrom?: number): SettingsVersion {
  if (expected !== current.revision) throw new SettingsVersionError('Settings have changed since you opened them. Refresh to review the latest version before publishing.', 409, current.revision);
  return { revision: current.revision + 1, config: structuredClone(config), publishedAt: now, publishedBy: actor, action: restoredFrom === undefined ? 'publish' : 'restore', ...(restoredFrom === undefined ? {} : { restoredFrom }) };
}
export type SettingsQueryClient = { query: (sql: string, values?: any[]) => Promise<{ rows: Record<string, any>[] }> };
export type SettingsDatabase = SettingsQueryClient & { connect: () => Promise<SettingsQueryClient & { release: () => void }> };
function version(row: Record<string, any>): SettingsVersion {
  return { revision: row.revision, config: row.config, publishedAt: new Date(row.published_at).toISOString(), publishedBy: row.published_by, action: row.action, ...(row.restored_from == null ? {} : { restoredFrom: row.restored_from }) };
}
/** History and the published configuration commit in the same transaction. */
export class PostgresSettingsVersionStore {
  constructor(private dealerId: string, private database: SettingsDatabase) {}
  async history(): Promise<SettingsVersion[]> {
    const rows = await this.database.query('SELECT * FROM dealer_settings_versions WHERE dealer_id = $1 ORDER BY revision DESC LIMIT 100', [this.dealerId]);
    return rows.rows.map(version);
  }
  async publish(input: { config?: Record<string, unknown>; expectedRevision: number; actor: string; restoredFrom?: number; validate: (config: Record<string, unknown>, current: Record<string, unknown>, client: SettingsQueryClient) => Promise<Record<string, unknown>> }): Promise<SettingsVersion> {
    const client = await this.database.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`dealer-settings:${this.dealerId}`]);
      const existing = await client.query('SELECT config, revision, updated_at FROM dealer_settings WHERE dealer_id = $1 FOR UPDATE', [this.dealerId]);
      const row = existing.rows[0];
      if (!row) throw new SettingsVersionError('Open settings before publishing.', 428);
      const current: SettingsVersion = { revision: row.revision, config: row.config, publishedAt: new Date(row.updated_at).toISOString(), publishedBy: 'Existing settings', action: 'initial' };
      if (input.expectedRevision !== current.revision) throw new SettingsVersionError('Settings have changed since you opened them. Refresh to review the latest version before publishing.', 409, current.revision);
      let config = input.config;
      if (input.restoredFrom !== undefined) {
        const restore = await client.query('SELECT config FROM dealer_settings_versions WHERE dealer_id = $1 AND revision = $2', [this.dealerId, input.restoredFrom]);
        if (!restore.rows[0]) throw new SettingsVersionError('Settings version not found.', 404);
        config = restore.rows[0].config;
      }
      if (!config) throw new SettingsVersionError('Check your settings.', 400);
      const cleaned = await input.validate(config, current.config, client);
      const next = nextSettingsVersion(current, cleaned, input.expectedRevision, input.actor, new Date().toISOString(), input.restoredFrom);
      await client.query("INSERT INTO dealer_settings_versions(dealer_id,revision,config,published_at,published_by,action) VALUES($1,$2,$3::jsonb,$4,$5,'initial') ON CONFLICT DO NOTHING", [this.dealerId, current.revision, JSON.stringify(current.config), current.publishedAt, current.publishedBy]);
      await client.query('INSERT INTO dealer_settings_versions(dealer_id,revision,config,published_at,published_by,action,restored_from) VALUES($1,$2,$3::jsonb,$4,$5,$6,$7)', [this.dealerId, next.revision, JSON.stringify(next.config), next.publishedAt, next.publishedBy, next.action, next.restoredFrom ?? null]);
      await client.query('UPDATE dealer_settings SET config = $2::jsonb, revision = $3, updated_at = $4 WHERE dealer_id = $1', [this.dealerId, JSON.stringify(next.config), next.revision, next.publishedAt]);
      await client.query('COMMIT'); return next;
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
  }
}
