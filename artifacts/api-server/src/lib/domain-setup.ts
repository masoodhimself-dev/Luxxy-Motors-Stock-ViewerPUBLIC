import { randomBytes } from 'node:crypto';
import { isIP } from 'node:net';
import { pool } from '@workspace/db';
import { normaliseTenantHost } from './tenant-context';
import { isDemoHost } from './demo-conversion';

export function domainSetupHostname(value: string): string | null {
  const host = normaliseTenantHost(value);
  if (!host || /[:/*]/.test(value) || isIP(host) || !host.includes('.') || host.length > 253 || host.split('.').some(p => p.length > 63 || !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(p))) return null;
  const reserved = [normaliseTenantHost(process.env.PLATFORM_ADMIN_HOST ?? ''), normaliseTenantHost(process.env.STOCK_IMPORT_API_HOST ?? '')];
  return reserved.includes(host) || isDemoHost(host) || /\.(?:local|internal|localhost)$/.test(host) || host.endsWith('.onrender.com') || host === 'onrender.com' ? null : host;
}

export const newDomainVerificationToken = () => `dealer-verification=${randomBytes(24).toString('hex')}`;
export const publicDomainJob = (row: any) => ({
  id: row.id, hostname: row.hostname, status: row.status, stage: row.stage,
  attempts: row.attempts, error: row.error, history: row.history,
  createdAt: row.created_at, updatedAt: row.updated_at, nextAttemptAt: row.next_attempt_at,
});

/** Claim Render's apex/www companions together before any external writes. */
export async function reserveDomainHostnames(dealerId: string, hostnames: string[]) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const hostname of [...new Set(hostnames)].sort()) {
      if (!domainSetupHostname(hostname)) throw new Error('Reserved or invalid companion hostname.');
      await client.query('INSERT INTO dealer_domains(hostname,dealer_id,verification_token) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING', [hostname, dealerId, newDomainVerificationToken()]);
      const row = (await client.query('SELECT dealer_id FROM dealer_domains WHERE hostname=$1 FOR UPDATE', [hostname])).rows[0];
      if (row?.dealer_id !== dealerId) throw new Error('A website hostname belongs to another dealership.');
    }
    await client.query('COMMIT');
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}
