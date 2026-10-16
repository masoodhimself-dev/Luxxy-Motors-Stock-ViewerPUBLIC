import { resolveTxt } from 'node:dns/promises';
import { pool } from '@workspace/db';
import type { Logger } from 'pino';
import { automationConfig, createDomainProviders, DomainProviderError } from './domain-providers';
import { domainSetupHostname, reserveDomainHostnames } from './domain-setup';
import { domainHttpsReady } from './domain-https-check';
import { isPlatformAdmin } from './platform-admin';
import { multiTenantEnabled } from './tenant-context';

type Providers = ReturnType<typeof createDomainProviders>;
type Dependencies = {
  providers?: Providers;
  resolveOwnership?: typeof resolveTxt;
  probeHttps?: typeof domainHttpsReady;
};

/** Restart-safe database work; advisory leases release automatically if the process dies. */
export async function processDomainSetupJobs(deps: Dependencies = {}) {
  const config = automationConfig();
  if (!config.ready || !config.config) return;
  const providers = deps.providers ?? createDomainProviders(config.config);
  const due = await pool.query("SELECT id FROM domain_setup_jobs WHERE status IN ('queued','running','waiting') AND next_attempt_at<=now() ORDER BY next_attempt_at LIMIT 3");
  for (const { id } of due.rows) {
    const client = await pool.connect();
    let locked = false, zoneLock: string | null = null;
    let job: any;
    let stage = 'preflight';
    const record = async (status: string, nextStage: string, message: string | null = null) => {
      stage = nextStage;
      const event = { status, stage, at: new Date().toISOString(), actor: job.updated_by, ...(message ? { message } : {}) };
      job.history = [...(job.history ?? []), event].slice(-80);
      await client.query("UPDATE domain_setup_jobs SET status=$2,stage=$3,error=$4,history=$5::jsonb,updated_at=now(),next_attempt_at=now()+interval '1 minute' WHERE id=$1", [id, status, stage, message, JSON.stringify(job.history)]);
    };
    try {
      locked = Boolean((await client.query('SELECT pg_try_advisory_lock(hashtext($1)) AS locked', [`domain-setup-job:${id}`])).rows[0]?.locked);
      if (!locked) continue;
      job = (await client.query("SELECT * FROM domain_setup_jobs WHERE id=$1 AND status IN ('queued','running','waiting') AND next_attempt_at<=now()", [id])).rows[0];
      if (!job) continue;
      stage = job.stage;
      if (job.render_service_id !== config.config.serviceId || job.render_target !== config.config.target) { await record('blocked', stage, 'The configured Render destination changed. Operator review required.'); continue; }
      if (!isPlatformAdmin(job.updated_by) || !domainSetupHostname(job.hostname)) { await record('blocked', stage, 'This domain connection is no longer authorised.'); continue; }
      if (job.attempts >= 30 || new Date(job.deadline_at).getTime() <= Date.now()) { await record('blocked', stage, 'Verification has not completed within 30 minutes. Check the provider status, then retry.'); continue; }
      const primary = (await client.query('SELECT * FROM dealer_domains WHERE hostname=$1 AND dealer_id=$2', [job.hostname, job.dealer_id])).rows[0];
      if (!primary) { await record('blocked', stage, 'Domain ownership changed. No setup performed.'); continue; }
      await client.query('UPDATE domain_setup_jobs SET attempts=attempts+1 WHERE id=$1', [id]);
      await record('running', 'preflight');
      const plan = await providers.preflight(job.hostname, primary.verification_token);
      const dealer = (await client.query('SELECT canonical_origin FROM dealerships WHERE id=$1', [job.dealer_id])).rows[0];
      const canonical = dealer ? new URL(dealer.canonical_origin).hostname : '';
      if (plan.hostnames.includes(canonical) && canonical !== job.hostname) throw new DomainProviderError(`Connect ${canonical} as the primary address so the website and Render redirect agree.`, true);
      const zoneKey = `domain-setup-zone:${plan.zoneId}`;
      if (!(await client.query('SELECT pg_try_advisory_lock(hashtext($1)) AS locked', [zoneKey])).rows[0]?.locked) { await record('waiting', 'preflight', 'Another connection for this DNS zone is finishing.'); continue; }
      zoneLock = zoneKey;
      try { await reserveDomainHostnames(job.dealer_id, plan.hostnames); }
      catch { throw new DomainProviderError('A hostname in this connection is reserved or belongs to another dealership.', true); }
      await client.query('UPDATE domain_setup_jobs SET hostnames=$2::jsonb WHERE id=$1', [id, JSON.stringify(plan.hostnames)]);
      // Check every companion's TXT and CNAME records before any provider write.
      const domains = (await client.query('SELECT hostname,verification_token FROM dealer_domains WHERE dealer_id=$1 AND hostname=ANY($2::text[])', [job.dealer_id, plan.hostnames])).rows;
      if (domains.length !== plan.hostnames.length) throw new DomainProviderError('Domain registration changed. Operator review required.', true);
      for (const d of domains) await providers.preflight(d.hostname, d.verification_token);
      await record('running', 'render');
      await providers.ensureRender(job.hostname);
      await record('running', 'dns');
      for (const d of domains) await providers.ensureDns(d.hostname, d.verification_token);
      await record('running', 'ownership');
      for (const d of domains) {
        let found = false;
        try { found = (await (deps.resolveOwnership ?? resolveTxt)(`_dealer-verification.${d.hostname}`)).some(parts => parts.join('') === d.verification_token); } catch { /* DNS may still be propagating. */ }
        if (!found) { await record('waiting', 'ownership', 'DNS records are saved. Waiting for public ownership verification.'); break; }
      }
      if (stage === 'ownership' && job.history.at(-1)?.status === 'waiting') continue;
      await record('running', 'https');
      let ready = true;
      for (const d of domains) if (!await providers.renderVerified(d.hostname)) ready = false;
      if (!ready) { await record('waiting', 'https', 'Waiting for Render domain verification and its certificate.'); continue; }
      // Test the canonical host and each paired redirect's TLS certificate, without secrets.
      for (const d of domains) if (!await (deps.probeHttps ?? domainHttpsReady)(d.hostname, d.hostname === job.hostname ? [] : [job.hostname])) ready = false;
      if (!ready) { await record('waiting', 'https', 'DNS is verified. Waiting for valid HTTPS to reach the application.'); continue; }
      await client.query('BEGIN');
      const stillOwned = (await client.query('SELECT hostname FROM dealer_domains WHERE dealer_id=$1 AND hostname=ANY($2::text[]) FOR UPDATE', [job.dealer_id, plan.hostnames])).rows;
      if (stillOwned.length !== plan.hostnames.length) throw new Error('Domain registration changed.');
      await client.query('UPDATE dealer_domains SET verified=true WHERE dealer_id=$1 AND hostname=ANY($2::text[])', [job.dealer_id, plan.hostnames]);
      await record('completed', 'complete');
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      if (job && locked) await record(error instanceof DomainProviderError && error.permanent ? 'blocked' : 'waiting', stage, error instanceof DomainProviderError ? error.message : 'A temporary domain setup problem occurred. Saved progress will be checked again.').catch(() => {});
    } finally {
      if (zoneLock) await client.query('SELECT pg_advisory_unlock(hashtext($1))', [zoneLock]).catch(() => {});
      if (locked) await client.query('SELECT pg_advisory_unlock(hashtext($1))', [`domain-setup-job:${id}`]).catch(() => {});
      client.release();
    }
  }
}

export function startDomainSetupWorker(log: Logger) {
  let running = false, stopped = false;
  const tick = async () => {
    if (stopped || running || !multiTenantEnabled() || !automationConfig().ready) return;
    running = true;
    try { await processDomainSetupJobs(); } catch { log.warn('Domain setup queue unavailable; saved work will retry.'); }
    finally { running = false; }
  };
  const timer = setInterval(() => void tick(), 15_000);
  timer.unref(); void tick();
  return () => { stopped = true; clearInterval(timer); };
}
