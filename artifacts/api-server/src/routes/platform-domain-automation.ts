import { Router } from 'express';
import { getAuth } from '@clerk/express';
import { pool } from '@workspace/db';
import { z } from 'zod/v4';
import { automationConfig } from '../lib/domain-providers';
import { domainSetupHostname, newDomainVerificationToken, publicDomainJob } from '../lib/domain-setup';

// Inherits platform host, Clerk administrator and origin checks from platform-dealers.
const router = Router();
router.get('/dealers/:id/domain-automation', async (req, res) => {
  const dealer = (await pool.query('SELECT id FROM dealerships WHERE id=$1', [req.params.id])).rows[0];
  if (!dealer) { res.status(404).json({ error: 'Dealer not found.' }); return; }
  const state = automationConfig();
  const jobs = await pool.query('SELECT * FROM domain_setup_jobs WHERE dealer_id=$1 ORDER BY created_at DESC LIMIT 30', [req.params.id]);
  res.json({ configured: state.ready, reason: state.reason, jobs: jobs.rows.map(publicDomainJob) });
});
router.post('/dealers/:id/domain-automation', async (req, res) => {
  const parsed = z.object({ hostname: z.string().trim().max(253) }).strict().safeParse(req.body);
  const hostname = parsed.success ? domainSetupHostname(parsed.data.hostname) : null;
  if (!hostname) { res.status(400).json({ error: 'Enter a real dealership hostname, without a URL, port or wildcard.' }); return; }
  const state = automationConfig();
  if (!state.ready || !state.config) { res.status(409).json({ error: state.reason }); return; }
  if (state.config.allowedZones.length && !state.config.allowedZones.some(zone => hostname === zone || hostname.endsWith(`.${zone}`))) { res.status(409).json({ error: 'This domain is not in the operator’s approved Cloudflare zones. Use manual setup or configure access first.' }); return; }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`domain-setup:${hostname}`]);
    const dealer = (await client.query('SELECT id FROM dealerships WHERE id=$1', [req.params.id])).rows[0];
    if (!dealer) { await client.query('ROLLBACK'); res.status(404).json({ error: 'Dealer not found.' }); return; }
    await client.query('INSERT INTO dealer_domains(hostname,dealer_id,verification_token) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING', [hostname, dealer.id, newDomainVerificationToken()]);
    const domain = (await client.query('SELECT dealer_id FROM dealer_domains WHERE hostname=$1 FOR UPDATE', [hostname])).rows[0];
    if (domain?.dealer_id !== dealer.id) { await client.query('ROLLBACK'); res.status(409).json({ error: 'That domain belongs to another dealership.' }); return; }
    const prior = (await client.query('SELECT * FROM domain_setup_jobs WHERE hostname=$1', [hostname])).rows[0];
    if (prior) { await client.query('COMMIT'); res.status(202).json({ job: publicDomainJob(prior) }); return; }
    const active = (await client.query("SELECT id FROM domain_setup_jobs WHERE dealer_id=$1 AND status IN ('queued','running','waiting')", [dealer.id])).rows;
    if (active.length >= 5) { await client.query('ROLLBACK'); res.status(409).json({ error: 'Finish the existing domain connections before adding another.' }); return; }
    const history = [{ status: 'queued', stage: 'preflight', at: new Date().toISOString(), actor: getAuth(req).userId }];
    const job = (await client.query('INSERT INTO domain_setup_jobs(dealer_id,hostname,render_service_id,render_target,created_by,updated_by,history) VALUES ($1,$2,$3,$4,$5,$5,$6::jsonb) RETURNING *', [dealer.id, hostname, state.config.serviceId, state.config.target, getAuth(req).userId, JSON.stringify(history)])).rows[0];
    await client.query('COMMIT');
    res.status(202).json({ job: publicDomainJob(job) });
  } catch { await client.query('ROLLBACK'); res.status(503).json({ error: 'Unable to queue domain setup. Retry the same hostname.' }); }
  finally { client.release(); }
});
router.post('/dealers/:id/domain-automation/:jobId/retry', async (req, res) => {
  if (!z.uuid().safeParse(req.params.jobId).success || !z.object({}).strict().safeParse(req.body).success) { res.status(400).json({ error: 'Choose a saved domain connection to retry.' }); return; }
  const state = automationConfig();
  if (!state.ready || !state.config) { res.status(409).json({ error: state.reason }); return; }
  const event = [{ status: 'queued', stage: 'preflight', at: new Date().toISOString(), actor: getAuth(req).userId, message: 'Operator requested a retry after reviewing the blocked connection.' }];
  const job = (await pool.query("UPDATE domain_setup_jobs SET status='queued',error=NULL,attempts=0,updated_by=$3,history=history || $6::jsonb,next_attempt_at=now(),deadline_at=now()+interval '30 minutes',updated_at=now() WHERE id=$1 AND dealer_id=$2 AND status='blocked' AND render_service_id=$4 AND render_target=$5 RETURNING *", [req.params.jobId, req.params.id, getAuth(req).userId, state.config.serviceId, state.config.target, JSON.stringify(event)])).rows[0];
  if (!job) { res.status(409).json({ error: 'Only a blocked connection for this dealership and configured Render service can be retried.' }); return; }
  res.status(202).json({ job: publicDomainJob(job) });
});
export default router;
