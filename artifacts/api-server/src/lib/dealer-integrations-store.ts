import { currentDealerId, currentTenant, multiTenantEnabled } from "./tenant-context";
import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from 'node:crypto';
import { chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { z } from 'zod/v4';
import { defaultSaleTerms, type SalesPaperwork, type StockConnection, defaultEmailAppearance, defaultEmailTemplates, EmailTemplateError, validateEmailAppearance, validateEmailTemplate, type EmailAppearance, type EmailTemplate } from '@workspace/vehicle-meta';

export class IntegrationSettingsError extends Error { constructor(message: string, readonly status = 400) { super(message); this.name = 'IntegrationSettingsError'; } }
export type ResendSettings = { enabled: boolean; apiKey: string; from: string; replyTo: string };
export type StripeSettings = { enabled: boolean; mode: 'test' | 'live'; publishableKey: string; secretKey: string; webhookSecret: string };
export type PrivateDealerSettings = { version: 1; revision: number; updatedAt: string | null; resend: ResendSettings; stripe: StripeSettings; templates: Record<string, Pick<EmailTemplate, 'subject' | 'body'>>; appearance: EmailAppearance; resendConfigured?: boolean; salesPaperwork?: SalesPaperwork; stockConnection?: StockConnection };
const empty = (): PrivateDealerSettings => ({ version: 1, revision: 0, updatedAt: null, resend: { enabled: false, apiKey: '', from: '', replyTo: '' }, stripe: { enabled: false, mode: 'test', publishableKey: '', secretKey: '', webhookSecret: '' }, templates: {}, appearance: { ...defaultEmailAppearance } });
export function effectiveResendSettings(settings: PrivateDealerSettings): ResendSettings { return multiTenantEnabled() || settings.resendConfigured || settings.resend.apiKey || settings.resend.from || settings.resend.replyTo || settings.resend.enabled ? settings.resend : { enabled: process.env.RESEND_ENABLED === 'true', apiKey: process.env.RESEND_API_KEY?.trim() ?? '', from: process.env.RESEND_FROM_EMAIL?.trim() ?? '', replyTo: process.env.RESEND_REPLY_TO_EMAIL?.trim() ?? '' }; }
const clean = z.string().trim().max(512).refine(value => !/[\r\n\u0000-\u001f\u007f]/.test(value), 'Use a single line without control characters.');
const updateSchema = z.object({
  expectedRevision: z.number().int().nonnegative(),
  resend: z.object({ enabled: z.boolean(), apiKey: clean.optional(), clearApiKey: z.boolean().optional(), from: clean, replyTo: clean }).strict().optional(),
  stripe: z.object({ enabled: z.boolean(), mode: z.enum(['test', 'live']), publishableKey: clean.optional(), secretKey: clean.optional(), webhookSecret: clean.optional(), clearPublishableKey: z.boolean().optional(), clearSecretKey: z.boolean().optional(), clearWebhookSecret: z.boolean().optional() }).strict().optional(),
}).strict();
const emailAddress = /^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/;
function senderValid(value: string) { const match = /^(?:[^<>\r\n]+\s*)?<([^<>]+)>$/.exec(value); return emailAddress.test(match ? match[1]!.trim() : value); }
export function integrationReadiness(settings: Pick<PrivateDealerSettings, 'resend' | 'stripe'>) {
  const emailIssues: string[] = [];
  if (!/^re_[A-Za-z0-9_\-]{8,}$/.test(settings.resend.apiKey)) emailIssues.push('Add a valid Resend API key.');
  if (!senderValid(settings.resend.from)) emailIssues.push('Enter a valid verified sender address.');
  if (settings.resend.replyTo && !emailAddress.test(settings.resend.replyTo)) emailIssues.push('Enter a valid reply-to email address.');
  const stripeIssues: string[] = [];
  if (process.env.NODE_ENV === 'production' && settings.stripe.mode === 'test') stripeIssues.push('Test payments are disabled on production. Configure live keys to accept real reservation deposits.');
  if (!new RegExp(`^pk_${settings.stripe.mode}_[A-Za-z0-9]{8,}$`).test(settings.stripe.publishableKey)) stripeIssues.push(`Add a Stripe ${settings.stripe.mode} publishable key.`);
  if (!new RegExp(`^sk_${settings.stripe.mode}_[A-Za-z0-9]{8,}$`).test(settings.stripe.secretKey)) stripeIssues.push(`Add a Stripe ${settings.stripe.mode} secret key.`);
  if (!/^whsec_[A-Za-z0-9]{8,}$/.test(settings.stripe.webhookSecret)) stripeIssues.push('Add the webhook signing secret for this mode.');
  return { resend: { ready: emailIssues.length === 0, issues: emailIssues }, stripe: { ready: stripeIssues.length === 0, issues: stripeIssues }, checkedLocally: true as const, message: 'Configuration checked locally. No provider connection, email or charge was made. Verify sender domains and webhook delivery in the provider dashboard before enabling.' };
}
export function maskedIntegrationSettings(settings: PrivateDealerSettings) {
  const resend = effectiveResendSettings(settings);
  return { revision: settings.revision, updatedAt: settings.updatedAt, resend: { enabled: resend.enabled, apiKeyConfigured: Boolean(resend.apiKey), from: resend.from, replyTo: resend.replyTo }, stripe: { enabled: settings.stripe.enabled, mode: settings.stripe.mode, publishableKeyConfigured: Boolean(settings.stripe.publishableKey), secretKeyConfigured: Boolean(settings.stripe.secretKey), webhookSecretConfigured: Boolean(settings.stripe.webhookSecret) }, readiness: integrationReadiness({ ...settings, resend }) };
}
export type MaskedIntegrationSettings = ReturnType<typeof maskedIntegrationSettings>;
export function applyIntegrationUpdate(current: PrivateDealerSettings, raw: unknown): PrivateDealerSettings {
  const parsed = updateSchema.safeParse(raw);
  if (!parsed.success) throw new IntegrationSettingsError('Check your integration settings. Only the supported fields and single-line values are accepted.');
  const input = parsed.data;
  if (input.expectedRevision !== current.revision) throw new IntegrationSettingsError('These settings changed in another session. Reload before saving.', 409);
  if (!input.resend && !input.stripe) throw new IntegrationSettingsError('Choose integration settings to update.');
  const next = structuredClone(current);
  if (input.resend) {
    const { apiKey, clearApiKey, ...fields } = input.resend;
    const prior = effectiveResendSettings(next);
    next.resend = { ...prior, ...fields, apiKey: clearApiKey ? '' : apiKey || prior.apiKey }; next.resendConfigured = true;
  }
  if (input.stripe) {
    const fields = input.stripe;
    // Switching mode always clears old mode credentials; blank inputs never copy live keys into test mode.
    if (fields.mode !== current.stripe.mode) next.stripe = { enabled: false, mode: fields.mode, publishableKey: '', secretKey: '', webhookSecret: '' };
    next.stripe.enabled = fields.enabled; next.stripe.mode = fields.mode;
    for (const [key, clearKey] of [['publishableKey', 'clearPublishableKey'], ['secretKey', 'clearSecretKey'], ['webhookSecret', 'clearWebhookSecret']] as const) next.stripe[key] = fields[clearKey] ? '' : fields[key] || next.stripe[key];
  }
  const readiness = integrationReadiness(next);
  if (next.resend.enabled && !readiness.resend.ready) throw new IntegrationSettingsError(readiness.resend.issues.join(' '));
  if (next.stripe.enabled && !readiness.stripe.ready) throw new IntegrationSettingsError(readiness.stripe.issues.join(' '));
  return { ...next, revision: current.revision + 1, updatedAt: new Date().toISOString() };
}

/** Never stored in public dealer config. Production files are authenticated AES-256-GCM ciphertext. */
export class DealerIntegrationsStore {
  private queue: Promise<unknown> = Promise.resolve();
  readonly filename: string;
  constructor(private options: { filename?: string; dealerId?: string; encryptionKey?: string; production?: boolean; databaseBacked?: boolean } = {}) {
    const dealer = options.dealerId ?? currentDealerId();
    this.filename = options.filename ?? resolve(process.env.INTEGRATIONS_PRIVATE_DIR ?? '.private/dealer-integrations', `${createHash('sha256').update(dealer).digest('hex').slice(0, 24)}.json`);
    if (process.env.FRONTEND_DIST_DIR && this.filename.startsWith(resolve(process.env.FRONTEND_DIST_DIR) + '/')) throw new IntegrationSettingsError('Private integration storage must be outside the public website directory.', 503);
  }
  private serial<T>(work: () => Promise<T>): Promise<T> { const pending = this.queue.then(work, work); this.queue = pending.catch(() => {}); return pending; }
  private key(): Buffer | undefined {
    const raw = this.options.encryptionKey ?? process.env.INTEGRATIONS_ENCRYPTION_KEY;
    if (!raw) { if (this.options.production ?? process.env.NODE_ENV === 'production') throw new IntegrationSettingsError('Set INTEGRATIONS_ENCRYPTION_KEY before saving private integration settings on production.', 503); return undefined; }
    const key = /^[a-fA-F0-9]{64}$/.test(raw) ? Buffer.from(raw, 'hex') : Buffer.from(raw, 'base64');
    if (key.length !== 32) throw new IntegrationSettingsError('INTEGRATIONS_ENCRYPTION_KEY must contain 32 random bytes encoded as base64 or hex.', 503);
    return key;
  }
  private async load(transaction?: unknown): Promise<PrivateDealerSettings> {
    let source: string;
    try {
      if (this.options.databaseBacked) {
        const { db, dealerPrivateSettingsTable } = await import('@workspace/db'); const { eq } = await import('drizzle-orm');
        const [row] = await ((transaction ?? db) as typeof db).select().from(dealerPrivateSettingsTable).where(eq(dealerPrivateSettingsTable.dealerId, this.options.dealerId!));
        if (!row) return empty(); source = JSON.stringify(row.encryptedPayload);
      } else source = await readFile(this.filename, 'utf8');
    } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return empty(); throw new IntegrationSettingsError('Private integration settings could not be read.', 503); }
    try {
      const stored = JSON.parse(source) as { encrypted?: boolean; iv: string; tag: string; data: string };
      if (stored.encrypted) {
        const key = this.key(); if (!key) throw new Error('Missing encryption key');
        const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(stored.iv, 'base64')); decipher.setAuthTag(Buffer.from(stored.tag, 'base64'));
        source = Buffer.concat([decipher.update(Buffer.from(stored.data, 'base64')), decipher.final()]).toString('utf8');
      } else if (this.options.production ?? process.env.NODE_ENV === 'production') throw new Error('Unencrypted production data');
      const state = JSON.parse(source) as PrivateDealerSettings;
      if (state.version !== 1 || !Number.isSafeInteger(state.revision) || !state.resend || !state.stripe || !state.templates) throw new Error('Invalid data');
      return { ...state, appearance: state.appearance ?? { ...defaultEmailAppearance } };
    } catch { throw new IntegrationSettingsError('Private integration settings could not be decrypted. Check the server encryption configuration.', 503); }
  }
  private async save(state: PrivateDealerSettings, transaction?: unknown) {
    const key = this.key(); let source = JSON.stringify(state);
    if (key) { const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key, iv); const encrypted = Buffer.concat([cipher.update(source, 'utf8'), cipher.final()]); source = JSON.stringify({ encrypted: true, iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), data: encrypted.toString('base64') }); }
    if (this.options.databaseBacked) {
      const { db, dealerPrivateSettingsTable } = await import('@workspace/db'); const { eq } = await import('drizzle-orm');
      const rows = await ((transaction ?? db) as typeof db).insert(dealerPrivateSettingsTable).values({ dealerId: this.options.dealerId!, revision: state.revision, encryptedPayload: JSON.parse(source) }).onConflictDoUpdate({ target: dealerPrivateSettingsTable.dealerId, set: { revision: state.revision, encryptedPayload: JSON.parse(source), updatedAt: new Date() }, setWhere: eq(dealerPrivateSettingsTable.revision, state.revision - 1) }).returning();
      if (!rows.length) throw new IntegrationSettingsError('These settings changed. Reload before saving.', 409); return;
    }
    await mkdir(dirname(this.filename), { recursive: true, mode: 0o700 }); await chmod(dirname(this.filename), 0o700);
    const temp = `${this.filename}.${randomUUID()}.tmp`; await writeFile(temp, source, { mode: 0o600 }); await rename(temp, this.filename); await chmod(this.filename, 0o600);
  }
  async readStockConnection(transaction?: unknown): Promise<{ revision: number; connection: StockConnection }> {
    const state = await this.readPrivate(transaction);
    const scoped = currentTenant();
    if (state.stockConnection) {
      if (scoped && (state.stockConnection.platform !== scoped.platform || state.stockConnection.retailerId !== scoped.retailerId)) throw new IntegrationSettingsError('Stock settings do not match the registered dealership.', 503);
      return { revision: state.revision, connection: state.stockConnection };
    }
    const tenant = currentTenant();
    if (tenant) return { revision: state.revision, connection: { platform: tenant.platform, retailerId: tenant.retailerId, sourceUrl: tenant.sourceUrl, enabled: true } };
    if (multiTenantEnabled()) throw new IntegrationSettingsError('Verified dealership context required.', 503);
    const platform = process.env.STOCK_PLATFORM ?? 'autotrader';
    if (platform !== 'autotrader' && platform !== 'cazoo') throw new IntegrationSettingsError('STOCK_PLATFORM must be autotrader or cazoo.', 503);
    return { revision: state.revision, connection: { platform, retailerId: process.env.STOCK_RETAILER_ID ?? '', sourceUrl: process.env.STOCK_SOURCE_URL ?? '', enabled: true } };
  }
  async updateStockConnection(raw: unknown, transaction?: unknown) {
    const parsed = z.object({ expectedRevision: z.number().int().nonnegative(), connection: z.object({ platform: z.enum(['autotrader', 'cazoo']), retailerId: clean.min(1).max(128), sourceUrl: clean.url(), enabled: z.boolean() }).strict() }).strict().safeParse(raw);
    if (!parsed.success) throw new IntegrationSettingsError('Choose a stock platform, retailer reference and valid HTTPS source URL.');
    const tenant = currentTenant();
    if (tenant && (tenant.platform !== parsed.data.connection.platform || tenant.retailerId !== parsed.data.connection.retailerId)) throw new IntegrationSettingsError('Change source identity through the dealership registry after reviewing existing stock.', 409);
    const url = new URL(parsed.data.connection.sourceUrl);
    const hosts = parsed.data.connection.platform === 'cazoo' ? ['cazoo.co.uk', 'www.cazoo.co.uk'] : ['autotrader.co.uk', 'www.autotrader.co.uk'];
    if (url.protocol !== 'https:' || !hosts.includes(url.hostname) || url.username || url.password || (url.port && url.port !== '443')) throw new IntegrationSettingsError('Use an HTTPS dealership URL on the selected marketplace.');
    return this.serial(async () => { const state = await this.load(transaction); if (state.revision !== parsed.data.expectedRevision) throw new IntegrationSettingsError('These settings changed. Reload before saving.', 409); state.stockConnection = parsed.data.connection; state.revision++; state.updatedAt = new Date().toISOString(); await this.save(state, transaction); return { revision: state.revision, connection: state.stockConnection }; });
  }
  async readSalesPaperwork() { const state = await this.readPrivate(); return { revision: state.revision, saleTerms: state.salesPaperwork?.saleTerms ?? defaultSaleTerms, reservationTerms: state.salesPaperwork?.reservationTerms ?? '', invoiceDetails: state.salesPaperwork?.invoiceDetails ?? {} }; }
  async updateSalesPaperwork(raw: unknown) {
    const parsed = z.object({ expectedRevision: z.number().int().nonnegative(), saleTerms: z.string().trim().max(20000), reservationTerms: z.string().trim().max(20000), invoiceDetails: z.object({ name: clean.min(1).optional(), companyName: clean.optional(), companyNumber: clean.optional(), vatNumber: clean.optional(), street: clean.optional(), city: clean.optional(), region: clean.optional(), postcode: clean.optional(), phone: clean.optional(), email: clean.refine(value => !value || emailAddress.test(value), 'Enter a valid email address.').optional() }).strict().optional() }).strict().safeParse(raw);
    if (!parsed.success) throw new IntegrationSettingsError('Use valid terms of up to 20,000 characters each.');
    return this.serial(async () => { const state = await this.load(); if (state.revision !== parsed.data.expectedRevision) throw new IntegrationSettingsError('These settings changed. Reload before saving.', 409); state.salesPaperwork = { saleTerms: parsed.data.saleTerms, reservationTerms: parsed.data.reservationTerms, invoiceDetails: parsed.data.invoiceDetails ?? state.salesPaperwork?.invoiceDetails ?? {} }; state.revision++; state.updatedAt = new Date().toISOString(); await this.save(state); return { revision: state.revision, ...state.salesPaperwork }; });
  }
  async readPrivate(transaction?: unknown) { return this.serial(() => this.load(transaction)); }
  async readMasked() { return maskedIntegrationSettings(await this.readPrivate()); }
  async update(raw: unknown) { return this.serial(async () => { const next = applyIntegrationUpdate(await this.load(), raw); await this.save(next); return maskedIntegrationSettings(next); }); }
  async listTemplates() { const state = await this.readPrivate(); return { revision: state.revision, templates: defaultEmailTemplates.map(template => ({ ...template, ...state.templates[template.id] })), appearance: state.appearance }; }
  async updateAppearance(raw: unknown) {
    const input = raw as { expectedRevision?: unknown; appearance?: unknown } | null;
    if (!input || typeof input.expectedRevision !== 'number' || Object.keys(input).some(key => !['expectedRevision', 'appearance'].includes(key))) throw new EmailTemplateError('Enter valid email branding settings.');
    const appearance = validateEmailAppearance(input.appearance);
    return this.serial(async () => { const state = await this.load(); if (state.revision !== input.expectedRevision) throw new EmailTemplateError('These settings changed in another session. Reload before saving.', 409); state.appearance = appearance; state.revision++; state.updatedAt = new Date().toISOString(); await this.save(state); return { revision: state.revision, templates: defaultEmailTemplates.map(template => ({ ...template, ...state.templates[template.id] })), appearance: state.appearance }; });
  }
  async updateTemplate(raw: unknown) {
    const input = raw as { id?: unknown; expectedRevision?: unknown; subject?: unknown; body?: unknown; reset?: unknown } | null;
    if (!input || typeof input.id !== 'string' || !defaultEmailTemplates.some(template => template.id === input.id) || typeof input.expectedRevision !== 'number' || Object.keys(input).some(key => !['id', 'expectedRevision', 'subject', 'body', 'reset'].includes(key))) throw new EmailTemplateError('Choose a supported email template.');
    const copy = input.reset === true ? undefined : validateEmailTemplate(input);
    return this.serial(async () => { const state = await this.load(); if (state.revision !== input.expectedRevision) throw new EmailTemplateError('These settings changed in another session. Reload before saving.', 409); if (copy) state.templates[input.id as string] = copy; else delete state.templates[input.id as string]; state.revision++; state.updatedAt = new Date().toISOString(); await this.save(state); return { revision: state.revision, templates: defaultEmailTemplates.map(template => ({ ...template, ...state.templates[template.id] })), appearance: state.appearance }; });
  }
}
const stores = new Map<string, DealerIntegrationsStore>();
function scopedStore(): DealerIntegrationsStore {
  const id = currentDealerId(), shared = multiTenantEnabled(); const key = `${shared ? 'shared' : 'legacy'}:${id}`;
  let store = stores.get(key); if (!store) { store = new DealerIntegrationsStore({ dealerId: id, ...(shared ? { databaseBacked: true, production: true } : {}) }); stores.set(key, store); } return store;
}
export const dealerIntegrationsStore = new Proxy({} as DealerIntegrationsStore, { get(_target, prop) { const store = scopedStore(); const value = Reflect.get(store, prop); return typeof value === 'function' ? value.bind(store) : value; } });
