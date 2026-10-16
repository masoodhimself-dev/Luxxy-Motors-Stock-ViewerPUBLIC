/** Fixed-host, create-only provider clients. Never return or log provider bodies. */
export type DomainAutomationConfig = {
  cloudflareToken: string;
  renderToken: string;
  serviceId: string;
  target: string;
  allowedZones: string[];
  accountId?: string;
};

export class DomainProviderError extends Error {
  constructor(message: string, public readonly permanent: boolean, public readonly httpStatus?: number) {
    super(message);
    this.name = 'DomainProviderError';
  }
}

const hostnamePattern = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const normal = (name: string) => name.toLowerCase().replace(/\.$/, '');
const validHostname = (name: string) => typeof name === 'string' && name === normal(name) && hostnamePattern.test(name);

function validateConfig(config: DomainAutomationConfig): boolean {
  return Boolean(config.cloudflareToken && config.renderToken && /^srv-[a-z0-9]+$/.test(config.serviceId)
    && validHostname(config.target) && config.target.endsWith('.onrender.com')
    && (config.allowedZones.length || config.accountId) && config.allowedZones.every(validHostname)
    && (!config.accountId || /^[a-f0-9]{32}$/.test(config.accountId)));
}

/** The public readiness description never includes credentials or their lengths. */
export function automationConfig(): { ready: boolean; reason: string; config?: DomainAutomationConfig } {
  if (process.env.DOMAIN_AUTOMATION_ENABLED !== 'true') return { ready: false, reason: 'Automatic domain setup is disabled.' };
  const config: DomainAutomationConfig = {
    cloudflareToken: process.env.CLOUDFLARE_DNS_API_TOKEN?.trim() ?? '',
    renderToken: process.env.RENDER_DOMAINS_API_KEY?.trim() ?? '',
    serviceId: process.env.DOMAIN_AUTOMATION_RENDER_SERVICE_ID?.trim() ?? '',
    target: process.env.DOMAIN_AUTOMATION_RENDER_TARGET?.trim() ?? '',
    allowedZones: [...new Set((process.env.DOMAIN_AUTOMATION_ZONES ?? '').split(',').map(s => s.trim()).filter(Boolean))],
    ...(process.env.DOMAIN_AUTOMATION_CLOUDFLARE_ACCOUNT_ID?.trim() ? { accountId: process.env.DOMAIN_AUTOMATION_CLOUDFLARE_ACCOUNT_ID.trim() } : {}),
  };
  if (!validateConfig(config)) return { ready: false, reason: 'The operator must configure scoped Cloudflare and Render access and approved zones or a Cloudflare account.' };
  return { ready: true, reason: 'Cloudflare and Render domain setup is configured.', config };
}

type JsonObject = Record<string, unknown>;
type DnsRecord = { type: string; name: string; content: string };
type Plan = { zoneId: string; hostnames: string[]; missing: Array<{ type: 'TXT' | 'CNAME'; name: string; content: string }> };
const object = (value: unknown): JsonObject | null => value && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : null;
const MAX_BODY_BYTES = 1024 * 1024;
const MAX_PAGES = 100;

/**
 * API contracts: Cloudflare /client/v4/zones and /dns_records; Render /v1/services/
 * {id}/custom-domains/{name}, POST collection, POST {name}/verify (202 only starts it).
 * No provider URL is obtained from a response, user field, or environment variable.
 */
export function createDomainProviders(config: DomainAutomationConfig, transport: typeof fetch = fetch) {
  if (!validateConfig(config)) throw new DomainProviderError('Domain provider configuration is incomplete.', true);
  // Copy to avoid a caller changing the scope or destination during an awaited request.
  config = { ...config, allowedZones: [...config.allowedZones] };

  function allowedZone(hostname: string): string | undefined {
    if (!validHostname(hostname)) throw new DomainProviderError('Enter a valid domain hostname without a scheme, path, port or wildcard.', true);
    const zone = config.allowedZones.filter(z => hostname === z || hostname.endsWith(`.${z}`)).sort((a, b) => b.length - a.length)[0];
    if (!zone && config.allowedZones.length) throw new DomainProviderError('This domain is outside the operator-approved Cloudflare zones.', true);
    return zone;
  }

  async function readJson(response: Response, provider: string): Promise<unknown> {
    if (Number(response.headers.get('content-length') ?? 0) > MAX_BODY_BYTES) {
      await response.body?.cancel().catch(() => undefined);
      throw new DomainProviderError(`${provider} returned an oversized response.`, false);
    }
    if (!response.body) return null;
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = []; let length = 0;
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        length += value.byteLength;
        if (length > MAX_BODY_BYTES) {
          await reader.cancel().catch(() => undefined);
          throw new DomainProviderError(`${provider} returned an oversized response.`, false);
        }
        chunks.push(value);
      }
      if (!length) return null;
      const bytes = new Uint8Array(length); let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
      return JSON.parse(new TextDecoder().decode(bytes));
    } catch (error) {
      if (error instanceof DomainProviderError) throw error;
      throw new DomainProviderError(`${provider} returned an unreadable response.`, false);
    } finally { reader.releaseLock(); }
  }

  async function call(provider: 'Cloudflare' | 'Render', path: string, method = 'GET', body?: unknown, accepted: number[] = []) {
    const base = provider === 'Cloudflare' ? 'https://api.cloudflare.com/client/v4' : 'https://api.render.com/v1';
    const url = new URL(base + path);
    const token = provider === 'Cloudflare' ? config.cloudflareToken : config.renderToken;
    let response: Response;
    try {
      response = await transport(url, {
        method, redirect: 'error', signal: AbortSignal.timeout(10_000),
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    } catch {
      throw new DomainProviderError(`${provider} could not be reached. Setup can be retried safely.`, false);
    }
    if (!response.ok && !accepted.includes(response.status)) {
      await response.body?.cancel().catch(() => undefined);
      const permanent = response.status !== 429 && response.status < 500;
      const reason = response.status === 401 || response.status === 403 ? 'access was refused; check the scoped API token'
        : response.status === 402 ? 'requires billing approval'
          : response.status === 429 ? 'rate limit was reached; retry later'
            : response.status >= 500 ? 'is temporarily unavailable; retry later'
              : response.status >= 300 && response.status < 400 ? 'redirect was refused'
                : 'refused the setup request; review its domain settings';
      throw new DomainProviderError(`${provider} ${reason}.`, permanent, response.status);
    }
    // Error bodies can contain credentials or account information. Never consume them.
    if (!response.ok) { await response.body?.cancel().catch(() => undefined); return { status: response.status, data: null }; }
    if (response.status === 202 || response.status === 204) {
      await response.body?.cancel().catch(() => undefined);
      return { status: response.status, data: null };
    }
    return { status: response.status, data: await readJson(response, provider) };
  }

  async function cloudflareList(path: string): Promise<unknown[]> {
    const records: unknown[] = [];
    const perPage = path.startsWith('/zones?') ? 50 : 100;
    for (let page = 1; page <= MAX_PAGES; page++) {
      const { data } = await call('Cloudflare', `${path}${path.includes('?') ? '&' : '?'}per_page=${perPage}&page=${page}`);
      const envelope = object(data);
      if (envelope?.success !== true || !Array.isArray(envelope.result)) throw new DomainProviderError('Cloudflare returned an invalid response.', false);
      records.push(...envelope.result);
      const info = object(envelope.result_info);
      const totalPages = info?.total_pages;
      if (typeof totalPages === 'number') {
        if (!Number.isInteger(totalPages) || totalPages < 0 || totalPages > MAX_PAGES) throw new DomainProviderError('Cloudflare results require operator review before continuing.', true);
        if (page >= totalPages) return records;
      } else if (typeof info?.total_count === 'number') {
        if (records.length >= info.total_count) return records;
      } else if (envelope.result.length < perPage) return records;
      if (!envelope.result.length) throw new DomainProviderError('Cloudflare returned inconsistent pagination.', false);
    }
    throw new DomainProviderError('Cloudflare results require operator review before continuing.', true);
  }

  async function exactDns(zoneId: string, name: string): Promise<DnsRecord[]> {
    const values = await cloudflareList(`/zones/${encodeURIComponent(zoneId)}/dns_records?name=${encodeURIComponent(name)}`);
    const records: DnsRecord[] = [];
    for (const value of values) {
      const record = object(value);
      if (!record || typeof record.name !== 'string' || typeof record.type !== 'string' || typeof record.content !== 'string') throw new DomainProviderError('Cloudflare returned an invalid DNS record.', false);
      // Independently match the name even if provider filtering changes.
      if (normal(record.name) === name) records.push({ name, type: record.type.toUpperCase(), content: record.content });
    }
    return records;
  }

  async function resolveZone(hostname: string): Promise<{ name: string; id: string }> {
    const explicitZone = allowedZone(hostname);
    const labels = hostname.split('.');
    const candidates = explicitZone ? [explicitZone] : labels.slice(0, -1).map((_label, index) => labels.slice(index).join('.'));
    for (const name of candidates) {
      const accountFilter = config.accountId ? `&account.id=${encodeURIComponent(config.accountId)}` : '';
      const zones = await cloudflareList(`/zones?name=${encodeURIComponent(name)}&status=active${accountFilter}`);
      const exact = zones.map(object).filter(zone => zone?.name === name);
      if (exact.length > 1) throw new DomainProviderError('Cloudflare returned ambiguous zone ownership. Ask the operator to review it.', true);
      if (!exact.length) continue;
      const zone = exact[0]!;
      if (zone.status !== 'active' || zone.type !== 'full' || typeof zone.id !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(zone.id)
        || (config.accountId && object(zone.account)?.id !== config.accountId)) {
        throw new DomainProviderError('The domain must be an active Cloudflare DNS zone in the approved scope.', true);
      }
      return { name, id: zone.id };
    }
    throw new DomainProviderError('The domain is not an active DNS zone accessible in the approved Cloudflare scope.', true);
  }

  let serviceChecked = false;
  async function checkService(): Promise<void> {
    if (serviceChecked) return;
    const { data } = await call('Render', `/services/${encodeURIComponent(config.serviceId)}`);
    const service = object(data); const details = object(service?.serviceDetails);
    let matches = false;
    try {
      const url = new URL(String(details?.url));
      matches = service?.id === config.serviceId && service.type === 'web_service'
        && url.origin === `https://${config.target}` && url.pathname === '/' && !url.search && !url.hash;
    } catch { /* Missing or malformed provider data fails closed. */ }
    if (!matches) throw new DomainProviderError('The configured Render service and website destination do not match. Ask the operator to review configuration.', true);
    serviceChecked = true;
  }

  async function plan(hostname: string, verificationToken: string): Promise<Plan> {
    allowedZone(hostname);
    if (!/^dealer-verification=[a-zA-Z0-9_-]{16,256}$/.test(verificationToken)) throw new DomainProviderError('The platform domain verification token is invalid.', true);
    await checkService();
    const zone = await resolveZone(hostname);
    const zoneName = zone.name;
    const zoneId = zone.id;
    const hostnames = hostname === zoneName || hostname === `www.${zoneName}` ? [hostname, hostname === zoneName ? `www.${zoneName}` : zoneName] : [hostname];
    const missing: Plan['missing'] = [];
    // All hosts, including the automatically paired apex/www, are inspected before writes.
    for (const name of hostnames) {
      const records = await exactDns(zoneId, name);
      if (records.some(r => r.type === 'A' || r.type === 'AAAA' || r.type === 'NS' || (r.type === 'CNAME' && normal(r.content) !== config.target))) {
        throw new DomainProviderError('Existing DNS records conflict with the website destination. Review them manually; nothing will be replaced.', true);
      }
      if (!records.some(r => r.type === 'CNAME' && normal(r.content) === config.target)) missing.push({ type: 'CNAME', name, content: config.target });
    }
    for (const owner of hostnames) {
      const name = `_dealer-verification.${owner}`;
      const records = await exactDns(zoneId, name);
      if (records.some(r => r.type === 'CNAME' || r.type === 'NS')) throw new DomainProviderError('An existing DNS record conflicts with platform ownership verification.', true);
      if (owner === hostname && !records.some(r => r.type === 'TXT' && r.content.replace(/^"(.*)"$/, '$1') === verificationToken)) missing.push({ type: 'TXT', name, content: verificationToken });
    }
    return { zoneId, hostnames, missing };
  }

  async function preflight(hostname: string, verificationToken: string) {
    const result = await plan(hostname, verificationToken);
    return { zoneId: result.zoneId, hostnames: result.hostnames };
  }

  async function ensureDns(hostname: string, verificationToken: string) {
    const result = await plan(hostname, verificationToken);
    for (const record of result.missing) {
      try {
        const { data } = await call('Cloudflare', `/zones/${encodeURIComponent(result.zoneId)}/dns_records`, 'POST', { ...record, ttl: 1, ...(record.type === 'CNAME' ? { proxied: false } : {}) });
        const envelope = object(data);
        if (envelope?.success !== true) throw new DomainProviderError('Cloudflare could not confirm the new DNS record.', false);
      } catch (error) {
        if (!(error instanceof DomainProviderError) || (error.permanent && error.httpStatus !== 409)) throw error;
        // A timeout may follow a successful create. Inspect before a later attempt can create.
        const now = await plan(hostname, verificationToken);
        if (now.missing.some(r => r.name === record.name && r.type === record.type && r.content === record.content)) throw error;
      }
    }
    return { zoneId: result.zoneId, hostnames: result.hostnames };
  }

  const renderPath = (hostname: string) => `/services/${encodeURIComponent(config.serviceId)}/custom-domains/${encodeURIComponent(hostname)}`;
  function renderDomain(data: unknown, hostname: string, canonical: boolean): JsonObject {
    const value = object(data);
    if (!value || value.name !== hostname || !['verified', 'unverified'].includes(String(value.verificationStatus)) || typeof value.redirectForName !== 'string') throw new DomainProviderError('Render returned an invalid domain response.', false);
    if (canonical && value.redirectForName && normal(value.redirectForName) !== hostname) throw new DomainProviderError('This Render domain already redirects elsewhere. Review it manually before continuing.', true);
    return value;
  }
  async function getRender(hostname: string, canonical = true): Promise<JsonObject | null> {
    const { status, data } = await call('Render', renderPath(hostname), 'GET', undefined, [404]);
    return status === 404 ? null : renderDomain(data, hostname, canonical);
  }

  async function ensureRender(hostname: string): Promise<void> {
    allowedZone(hostname);
    if (!config.allowedZones.length) await resolveZone(hostname);
    await checkService();
    let domain = await getRender(hostname);
    if (!domain) {
      try {
        await call('Render', `/services/${encodeURIComponent(config.serviceId)}/custom-domains`, 'POST', { name: hostname });
      } catch (error) {
        if (!(error instanceof DomainProviderError) || (error.permanent && error.httpStatus !== 409)) throw error;
        domain = await getRender(hostname);
        if (!domain) throw error;
      }
      domain ??= await getRender(hostname);
      if (!domain) throw new DomainProviderError('Render has not confirmed the domain yet. Retry setup to check it again.', false);
    }
    if (domain.verificationStatus !== 'verified') await call('Render', `${renderPath(hostname)}/verify`, 'POST');
  }

  async function renderVerified(hostname: string): Promise<boolean> {
    allowedZone(hostname);
    if (!config.allowedZones.length) await resolveZone(hostname);
    await checkService();
    const domain = await getRender(hostname, false);
    if (domain?.verificationStatus === 'verified') return true;
    if (domain) await call('Render', `${renderPath(hostname)}/verify`, 'POST');
    return false;
  }

  return { preflight, ensureDns, ensureRender, renderVerified };
}
