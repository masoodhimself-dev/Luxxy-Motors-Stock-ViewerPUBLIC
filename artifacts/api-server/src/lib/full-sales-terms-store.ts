import { createHash, randomUUID } from 'node:crypto';
import { applicableSalesTerms, currentInvoiceBranding, normaliseFullSalesTerms, saleWorkspaceBranding, salesTermsReviewPoints, type FullSalesTermsContent, type FullSalesTermsSettings, type FullSalesTermsVersion, type SaleWorkspaceRecord, type SalesTermsSnapshot } from '@workspace/vehicle-meta';
import { fullSalesTermsPdfBytes } from '@workspace/vehicle-meta/full-sales-terms-pdf';
import { embedInvoiceLogoAsset } from './invoice-logo-assets';
import { shoreDriveTermsDraft } from './shore-drive-terms-draft';

type Query = { query: (sql: string, values?: any[]) => Promise<{ rows: any[] }> };
type Client = Query & { release: () => void };
export type SalesTermsDatabase = Query & { connect: () => Promise<Client> };
export class SalesTermsError extends Error { constructor(message: string, public status = 400) { super(message); } }
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const uuid = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value);
const blank: FullSalesTermsContent = { title: 'Terms and conditions', sections: [] };
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));
export class FullSalesTermsStore {
  constructor(private database: SalesTermsDatabase, private dealerId: string, private canonicalOrigin: string) {}
  private async transaction<T>(work: (client: Client) => Promise<T>): Promise<T> {
    const client = await this.database.connect();
    try { await client.query('BEGIN'); await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`full-sales-terms:${this.dealerId}`]); const result = await work(client); await client.query('COMMIT'); return result; }
    catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
  }
  private async read(client: Query): Promise<FullSalesTermsSettings & { reviewPoints: string[] }> {
    const row = (await client.query('SELECT * FROM dealer_sales_terms WHERE dealer_id=$1', [this.dealerId])).rows[0];
    const published = row?.published_version_id ? (await client.query('SELECT * FROM dealer_sales_terms_versions WHERE dealer_id=$1 AND id=$2::uuid', [this.dealerId, row.published_version_id])).rows[0] : null;
    const version: FullSalesTermsVersion | null = published ? { ...published.content, id: published.id, version: published.version, status: 'published', createdAt: new Date(published.created_at).toISOString(), createdBy: published.created_by } : null;
    const draft = clone(row?.draft ?? (this.dealerId === 'shore-drive-limited' ? shoreDriveTermsDraft : blank));
    const config = (await client.query('SELECT config FROM dealer_settings WHERE dealer_id=$1', [this.dealerId])).rows[0]?.config;
    const included = Array.isArray(config?.presentation?.includedItems) ? config.presentation.includedItems : [];
    const warranty = [config?.warranty?.description, ...included].filter(v => typeof v === 'string').join(' ');
    return { revision: row?.revision ?? 0, draft, reviewPoints: salesTermsReviewPoints(draft, warranty), published: version, ...(row ? { updatedAt: new Date(row.updated_at).toISOString() } : this.dealerId === 'shore-drive-limited' ? { suppliedDraft: true } : {}) };
  }
  async settings() { return this.read(this.database); }
  async save(expectedRevision: unknown, content: unknown, actor: string) {
    let draft: FullSalesTermsContent; try { draft = normaliseFullSalesTerms(content); } catch (e) { throw new SalesTermsError((e as Error).message); }
    return this.transaction(async client => {
      const before = await this.read(client);
      if (expectedRevision !== before.revision) throw new SalesTermsError('These terms changed. Reload before saving.', 409);
      await client.query(`INSERT INTO dealer_sales_terms(dealer_id,revision,draft,updated_by) VALUES($1,1,$2,$3)
        ON CONFLICT(dealer_id) DO UPDATE SET revision=dealer_sales_terms.revision+1,draft=$2,updated_at=now(),updated_by=$3`, [this.dealerId, draft, actor]);
      return this.read(client);
    });
  }
  async publish(expectedRevision: unknown, actor: string) {
    return this.transaction(async client => {
      const before = await this.read(client);
      if (!before.revision || expectedRevision !== before.revision) throw new SalesTermsError('Save the current draft before using it for new sales.', 409);
      const content = normaliseFullSalesTerms(before.draft);
      if (before.published && hash(content) === hash(normaliseFullSalesTerms(before.published))) return before;
      const version = Number((await client.query('SELECT coalesce(max(version),0)+1 AS next FROM dealer_sales_terms_versions WHERE dealer_id=$1', [this.dealerId])).rows[0].next);
      const id = randomUUID();
      await client.query('INSERT INTO dealer_sales_terms_versions(id,dealer_id,version,content,created_by) VALUES($1,$2,$3,$4,$5)', [id, this.dealerId, version, content, actor]);
      await client.query('UPDATE dealer_sales_terms SET published_version_id=$2::uuid,revision=revision+1,updated_at=now(),updated_by=$3 WHERE dealer_id=$1', [this.dealerId, id, actor]);
      return this.read(client);
    });
  }
  async preview(content: unknown, category: unknown, actor: string) {
    let draft: FullSalesTermsContent; try { draft = normaliseFullSalesTerms(content); } catch (e) { throw new SalesTermsError((e as Error).message); }
    const config = (await this.database.query('SELECT config FROM dealer_settings WHERE dealer_id=$1', [this.dealerId])).rows[0]?.config;
    if (!config?.identity?.name || typeof config.identity.name !== 'string') throw new SalesTermsError('Add the dealership name in Settings before preparing terms.');
    const branding = await embedInvoiceLogoAsset(currentInvoiceBranding(saleWorkspaceBranding(config)), this.dealerId, this.database, this.canonicalOrigin);
    const snapshot: SalesTermsSnapshot = { rendererVersion: 'classic-ledger-terms-v1', dealerId: this.dealerId, saleId: '', saleRevision: 0, saleReference: 'Terms preview', termsVersionId: '00000000-0000-4000-8000-000000000000', termsVersion: 0, title: draft.title,
      sections: applicableSalesTerms(draft, category), issuedAt: new Date().toISOString(), issuedBy: actor, customer: '', customerAddress: '', vehicle: '', registration: '', category: typeof category === 'string' ? category : '', branding, draft: true };
    if (!snapshot.sections.length) throw new SalesTermsError('No terms apply to the selected vehicle category.');
    return snapshot;
  }
  async issue(saleId: string, input: { requestId: unknown; expectedSaleRevision: unknown; termsVersionId: unknown }, actor: string) {
    if (!uuid(saleId) || !uuid(input.requestId) || !uuid(input.termsVersionId)) throw new SalesTermsError('Reload the sale and terms before issuing.');
    const fingerprint = hash({ saleId, expectedSaleRevision: input.expectedSaleRevision, termsVersionId: input.termsVersionId });
    return this.transaction(async client => {
      const existing = (await client.query('SELECT id,request_hash,snapshot,created_at FROM sale_terms_documents WHERE dealer_id=$1 AND request_id=$2::uuid', [this.dealerId, input.requestId])).rows[0];
      if (existing) { if (existing.request_hash !== fingerprint) throw new SalesTermsError('This request was already used for different terms. Reload before continuing.', 409); return { ...existing, replayed: true }; }
      // Share the sale row lock with every other sales mutation before freezing the customer and vehicle.
      const record = (await client.query('SELECT state FROM sale_workspace WHERE dealer_id=$1 AND id=$2::uuid FOR UPDATE', [this.dealerId, saleId])).rows[0]?.state as SaleWorkspaceRecord | undefined;
      if (!record) throw new SalesTermsError('Sale not found.', 404);
      if (record.revision !== input.expectedSaleRevision) throw new SalesTermsError('The sale changed. Review it before issuing these terms.', 409);
      if (record.finalReview?.status !== 'passed' || record.finalReview.reviewedRevision !== record.revision) throw new SalesTermsError('Run the final checks for this saved sale before issuing its terms.', 409);
      const settings = await this.read(client), published = settings.published;
      if (!published || published.id !== input.termsVersionId) throw new SalesTermsError('The dealership terms changed. Review the current version.', 409);
      if (!record.draft.customer.trim() || !record.draft.vehicle.trim() || !record.draft.registration.trim()) throw new SalesTermsError('Add the customer, vehicle and registration before issuing the terms.');
      const vehicle = uuid(record.draft.vehicleId) ? (await client.query('SELECT write_off_category FROM vehicles WHERE dealer_id=$1 AND id=$2::uuid', [this.dealerId, record.draft.vehicleId])).rows[0] : undefined;
      const config = (await client.query('SELECT config FROM dealer_settings WHERE dealer_id=$1', [this.dealerId])).rows[0]?.config;
      if (!config?.identity?.name || typeof config.identity.name !== 'string') throw new SalesTermsError('Add the dealership name in Settings before preparing terms.');
      const branding = await embedInvoiceLogoAsset(currentInvoiceBranding(saleWorkspaceBranding(config)), this.dealerId, client, this.canonicalOrigin);
      const snapshot: SalesTermsSnapshot = { rendererVersion: 'classic-ledger-terms-v1', dealerId: this.dealerId, saleId, saleRevision: record.revision, saleReference: record.reference, termsVersionId: published.id, termsVersion: published.version,
        title: published.title, sections: applicableSalesTerms(published, vehicle?.write_off_category), issuedAt: new Date().toISOString(), issuedBy: actor,
        customer: record.draft.customer, customerAddress: record.draft.address, vehicle: record.draft.vehicle, registration: record.draft.registration, category: vehicle?.write_off_category ?? '', branding };
      if (!snapshot.sections.length) throw new SalesTermsError('No terms apply to this vehicle. Update the dealership terms before issuing.');
      const id = randomUUID(), dealerPdf = Buffer.from(fullSalesTermsPdfBytes(snapshot, 'dealer')).toString('base64'), bothPdf = Buffer.from(fullSalesTermsPdfBytes(snapshot, 'both')).toString('base64');
      await client.query('INSERT INTO sale_terms_documents(id,dealer_id,sale_id,request_id,request_hash,snapshot,dealer_pdf,both_pdf,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)', [id, this.dealerId, saleId, input.requestId, fingerprint, snapshot, dealerPdf, bothPdf, actor]);
      return { id, snapshot, created_at: snapshot.issuedAt, replayed: false };
    });
  }
  async list(saleId: string) {
    if (!uuid(saleId)) throw new SalesTermsError('Sale not found.', 404);
    if (!(await this.database.query('SELECT id FROM sale_workspace WHERE dealer_id=$1 AND id=$2::uuid', [this.dealerId, saleId])).rows[0]) throw new SalesTermsError('Sale not found.', 404);
    return (await this.database.query("SELECT id,snapshot - 'branding' - 'sections' AS snapshot,created_at FROM sale_terms_documents WHERE dealer_id=$1 AND sale_id=$2::uuid ORDER BY created_at DESC,id DESC", [this.dealerId, saleId])).rows;
  }
  async pdf(saleId: string, documentId: string, copies: unknown) {
    if (!uuid(saleId) || !uuid(documentId) || (copies !== 'dealer' && copies !== 'both')) throw new SalesTermsError('Terms document not found.', 404);
    const row = (await this.database.query('SELECT dealer_pdf,both_pdf,snapshot FROM sale_terms_documents WHERE dealer_id=$1 AND sale_id=$2::uuid AND id=$3::uuid', [this.dealerId, saleId, documentId])).rows[0];
    if (!row) throw new SalesTermsError('Terms document not found.', 404);
    return { bytes: Buffer.from(copies === 'both' ? row.both_pdf : row.dealer_pdf, 'base64'), snapshot: row.snapshot as SalesTermsSnapshot };
  }
}
