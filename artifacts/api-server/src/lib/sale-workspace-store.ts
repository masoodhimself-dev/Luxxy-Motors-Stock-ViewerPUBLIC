import { canDeleteEmptySaleDraft, saleHandoverStatus } from '@workspace/vehicle-meta';
import { currentTenant } from './tenant-context';
import { dealerIntegrationsStore } from './dealer-integrations-store';
import { createHash, randomUUID } from 'node:crypto';
import { loadBrochurePhotos } from './vehicle-brochure-images';
import { archiveSaleDocument } from './sale-document-pdf';
import { embedInvoiceLogoAsset } from './invoice-logo-assets';
import { attachInvoiceVerification, invoiceVerificationView } from './invoice-verification';
import { siteOrigin } from './enquiry-links';
import { createSoldVehicleFollowUps } from './sold-vehicle-follow-ups';
import { changeSaleWorkspace, createSaleWorkspace, saleWorkspaceTotals, publicSaleWorkspace, currentInvoiceBranding, saleWorkspaceBranding, saleWorkspaceFingerprint, saleWorkspaceNumber, SaleWorkspaceError, type SaleWorkspaceBranding, type SaleWorkspaceCommand, type SaleWorkspaceContext, type SaleWorkspaceDraft, type SaleWorkspaceMutation, type SaleWorkspaceRecord, type SaleWorkspaceVehicleSnapshot, type SaleWorkspacePayment } from '@workspace/vehicle-meta';

export type SaleWorkspaceAssets = { reviewUrl?: string; branding: SaleWorkspaceBranding; vehicle?: SaleWorkspaceVehicleSnapshot; paperwork?: { saleTerms: string; reservationTerms: string } };
export type SaleWorkspaceReadClient = { query: (text: string, parameters?: any[]) => Promise<{ rows: Record<string, any>[] }> };
export type SaleWorkspaceTransactionClient = SaleWorkspaceReadClient & { release: () => void };
export type SaleWorkspaceDatabase = SaleWorkspaceReadClient & { connect: () => Promise<SaleWorkspaceTransactionClient> };
const staffSaleWorkspace = (record: SaleWorkspaceRecord): SaleWorkspaceRecord => ({ ...publicSaleWorkspace(record), emptyDraftDeletable: canDeleteEmptySaleDraft(record, true) });

/** Use the already-held transaction client; never acquire another pool connection while holding the dealer lock. */
export async function readSaleWorkspaceAssets(draft: SaleWorkspaceDraft, dealerId: string, client: SaleWorkspaceReadClient): Promise<SaleWorkspaceAssets> {
  const settings = await client.query('SELECT config FROM dealer_settings WHERE dealer_id = $1', [dealerId]);
  const validVehicleId = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(draft?.vehicleId ?? '');
  const vehicle = validVehicleId
    ? (await client.query("SELECT id, coalesce(website_title_override, title, '') AS title, year, fuel, transmission, mileage, colour, owners, write_off_category, website_description, raw_source_data, plate, vrm, registration, engine_size, body_type, doors, seats, emission_class, coalesce(nullif(website_hero_image_override, ''), source_hero_image) AS invoice_image FROM vehicles WHERE dealer_id = $1 AND id = $2::uuid", [dealerId, draft.vehicleId])).rows[0]
    : undefined;
  const paperwork = await dealerIntegrationsStore.readSalesPaperwork(client);
  const branding = saleWorkspaceBranding(settings.rows[0]?.config);
  if (currentTenant()?.demo) {
    const demo = (await client.query('SELECT converted_at FROM dealer_demos WHERE dealer_id = $1', [dealerId])).rows[0];
    if (!demo || demo.converted_at) throw new SaleWorkspaceError('This demonstration changed while the sale was being prepared. Reload before continuing.', 409);
    branding.identity.name += ' · SAMPLE / DEMO';
  }
  return { reviewUrl: String(settings.rows[0]?.config?.contact?.googleReviewUrl || ''), paperwork, branding: currentInvoiceBranding(branding, paperwork.invoiceSettings), ...(vehicle ? { vehicle: { id: vehicle.id, title: vehicle.title, registration: vehicle.plate || vehicle.vrm || vehicle.registration, engineSize: vehicle.engine_size, bodyType: vehicle.body_type, doors: vehicle.doors, seats: vehicle.seats, emissionClass: vehicle.emission_class, imageUrl: vehicle.invoice_image, year: vehicle.year, fuel: vehicle.fuel, transmission: vehicle.transmission, mileage: vehicle.mileage, colour: vehicle.colour, owners: vehicle.owners, writeOffCategory: vehicle.write_off_category, description: vehicle.website_description || vehicle.raw_source_data?.sourceExtras?.description || null, serviceHistory: typeof vehicle.raw_source_data?.sourceExtras?.serviceHistory === 'string' ? vehicle.raw_source_data.sourceExtras.serviceHistory : vehicle.raw_source_data?.sourceExtras?.historyExtras?.serviceHistory?.description || null } } : {}) };
}

export class PostgresSaleWorkspaceStore {
  constructor(private dealerId: string, private assets: (draft: SaleWorkspaceDraft, client: SaleWorkspaceReadClient) => Promise<SaleWorkspaceAssets>, private database: SaleWorkspaceDatabase, private options?: { afterLock?: (client: SaleWorkspaceReadClient) => Promise<void>; afterCreate?: (client: SaleWorkspaceReadClient, sale: SaleWorkspaceRecord) => Promise<void>; onCreateReplay?: (client: SaleWorkspaceReadClient, sale: SaleWorkspaceRecord) => Promise<void>; omitInvoiceVerification?: boolean; omitLogoEmbedding?: boolean; logoOwnerDealerId?:string }) {}
  async list(options:{q?:string;offset?:number;enquiryId?:string;reservationId?:string}={}) {
    const q=(options.q??'').trim();
    const offset=options.offset??0;
    if(q.length>120||!Number.isSafeInteger(offset)||offset<0||offset>10000)throw new SaleWorkspaceError('Check the sales search or page.',400);
    const validId=(id:string|undefined)=>!id||/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id);
    if(!validId(options.enquiryId)||!validId(options.reservationId))throw new SaleWorkspaceError('Choose a valid linked customer enquiry.',400);
    // Bound database results before projection. Historical snapshots, archives,
    // retry data and event logs never travel in the list response.
    const result=await this.database.query(`SELECT state - 'documentArchives' - 'requests' - 'providerPayments' - 'documents' - 'events' - 'emailDeliveries' - 'payments' - 'corrections' AS state,
      CASE WHEN jsonb_typeof(state->'corrections')='array' THEN jsonb_array_length(state->'corrections')>0 ELSE false END AS list_has_correction_notes,
      coalesce(jsonb_typeof(state->'payments')='array',false) AS list_ledger_known,
      coalesce((SELECT jsonb_agg(jsonb_build_object('status',p->'status','signedAmountPence',p->'signedAmountPence','amountPence',p->'amountPence')) FROM jsonb_array_elements(CASE WHEN jsonb_typeof(state->'payments')='array' THEN state->'payments' ELSE '[]'::jsonb END) AS p),'[]'::jsonb) AS list_payment_entries,
      CASE WHEN jsonb_typeof(state->'payments')='array' AND (state->'documents' IS NULL OR jsonb_typeof(state->'documents')='array') THEN CASE WHEN jsonb_array_length(coalesce(state->'documents','[]'::jsonb))=0 AND jsonb_array_length(state->'payments')=0 THEN jsonb_build_object('requests',state->'requests','documentArchives',state->'documentArchives','providerPayments',state->'providerPayments','events',state->'events','documents',state->'documents','payments',state->'payments','emailDeliveries',state->'emailDeliveries') END END AS deletion_evidence
      FROM sale_workspace WHERE dealer_id=$1
      AND ($2='' OR id::text=$2 OR state#>>'{draft,sourceEnquiryId}'=$2 OR state#>>'{draft,sourceReservationId}'=$2
        OR strpos(lower(concat_ws(' ',reference,state#>>'{draft,customer}',state#>>'{draft,email}',state#>>'{draft,vehicle}',state#>>'{draft,registration}')),lower($2))>0
        OR ($3<>'' AND strpos(regexp_replace(coalesce(state#>>'{draft,phone}',''),'[^0-9]','','g'),$3)>0))
      AND ($4='' OR state#>>'{draft,sourceEnquiryId}'=$4) AND ($5='' OR state#>>'{draft,sourceReservationId}'=$5)
      ORDER BY updated_at DESC,id DESC LIMIT 51 OFFSET $6`,[this.dealerId,q,(/^[+0-9 ().-]+$/.test(q)?q.replace(/\D/g,''):''),options.enquiryId??'',options.reservationId??'',offset]);
    const sales=result.rows.slice(0,50).map(row=>{
      const record=row.state as SaleWorkspaceRecord,draft=record.draft;
      const identity={id:draft.id,customer:draft.customer,email:draft.email,phone:draft.phone,vehicleId:draft.vehicleId,vehicle:draft.vehicle,registration:draft.registration,sourceEnquiryId:draft.sourceEnquiryId,sourceReservationId:draft.sourceReservationId};
      const totals=saleWorkspaceTotals(draft,(row.list_payment_entries ?? []) as SaleWorkspacePayment[]);
      const handover=draft.fulfilment ? {method:draft.fulfilment.method,status:saleHandoverStatus({...draft.fulfilment,address:draft.fulfilment.address ?? ''})} : null;
      const listHasRefunds=(row.list_payment_entries ?? []).some((payment: SaleWorkspacePayment)=>payment.status==='confirmed' && payment.signedAmountPence<0);
      return {listSummary:true as const,listTotalDue:totals.totalDue,listPaid:totals.confirmedPaid,listPending:totals.pending,listLedgerKnown:row.list_ledger_known === true,listBalance:totals.balance,listHandover:handover,listHasCorrectionNotes:row.list_has_correction_notes === true,listHasRefunds,id:record.id,reference:record.reference,revision:record.revision,createdAt:record.createdAt,updatedAt:record.updatedAt,...(record.completedAt?{completedAt:record.completedAt}:{}),...(record.lifecycle?{lifecycle:record.lifecycle}:{}),draft:identity,documents:[],payments:[],events:[],emptyDraftDeletable:canDeleteEmptySaleDraft({...record,...row.deletion_evidence},true)};
    });
    return {sales,hasMore:result.rows.length>50};
  }
  async get(id: string): Promise<SaleWorkspaceRecord> {
    const result = await this.database.query('SELECT state FROM sale_workspace WHERE dealer_id = $1 AND id = $2::uuid', [this.dealerId, id]);
    if (!result.rows[0]) throw new SaleWorkspaceError('Sale not found.', 404);
    return staffSaleWorkspace(result.rows[0].state);
  }
  /** Remove only unused empty or clearly labelled test drafts; never cascade financial history. */
  async deleteEmptyDraft(id: string, expectedRevision: unknown) {
    if (!Number.isSafeInteger(expectedRevision) || Number(expectedRevision) < 1) throw new SaleWorkspaceError('Reload the saved draft before deleting it.', 409);
    const client = await this.database.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`sale-workspace:${this.dealerId}`]);
      const current = (await client.query('SELECT state, revision FROM sale_workspace WHERE dealer_id = $1 AND id = $2::uuid FOR UPDATE', [this.dealerId, id])).rows[0];
      if (!current) throw new SaleWorkspaceError('Sale draft not found.', 404);
      if (current.revision !== expectedRevision || current.state.revision !== expectedRevision) throw new SaleWorkspaceError('This sale changed on another device. Reload it before deleting.', 409);
      if (!canDeleteEmptySaleDraft(current.state, true)) throw new SaleWorkspaceError('Only unused empty drafts or clearly labelled test drafts can be deleted. Real customer details, invoices, payments and sale history are protected.', 409);
      // Check references that are outside the JSON ledger too. Never release stock or erase follow-ups.
      const linked = await client.query(`SELECT EXISTS(SELECT 1 FROM vehicles WHERE dealer_id=$1 AND audit_metadata->>'saleWorkspaceId'=$2)
        OR EXISTS(SELECT 1 FROM sold_vehicle_follow_ups WHERE dealer_id=$1 AND sale_id=$2::uuid) AS protected`, [this.dealerId, id]);
      if (linked.rows[0]?.protected) throw new SaleWorkspaceError('This draft has linked stock or follow-up activity and must be kept.', 409);
      const deleted = await client.query('DELETE FROM sale_workspace WHERE dealer_id=$1 AND id=$2::uuid AND revision=$3 RETURNING id', [this.dealerId, id, expectedRevision]);
      if (!deleted.rows.length) throw new SaleWorkspaceError('This sale changed on another device. Reload it before deleting.', 409);
      await client.query('COMMIT');
      return { deleted: true, id };
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
  }
  async verifyInvoice(saleId: string, documentId: string, token: string) {
    const result = await this.database.query('SELECT state FROM sale_workspace WHERE dealer_id = $1 AND id = $2::uuid', [this.dealerId, saleId]);
    return invoiceVerificationView(result.rows[0]?.state, documentId, token);
  }
  /** Merge inside an existing transaction; callers must not acquire another connection. */
  async finishEmailOnClient(id: string, requestId: string, command: Extract<SaleWorkspaceCommand, { action: 'email-status' }>, actor: string, client: SaleWorkspaceReadClient) {
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`sale-workspace:${this.dealerId}`]);
    const current = (await client.query('SELECT state FROM sale_workspace WHERE dealer_id = $1 AND id = $2::uuid FOR UPDATE', [this.dealerId, id])).rows[0]?.state as SaleWorkspaceRecord | undefined;
    if (!current) throw new SaleWorkspaceError('Sale not found.', 404);
    const document = current.documents.find(item => item.id === command.delivery.documentId);
    if (!document) throw new SaleWorkspaceError('Document not found.', 404);
    // Email finalization cannot issue or rebrand a document. Its immutable
    // snapshot provides all required context without another database checkout.
    const context: SaleWorkspaceContext = { now: new Date().toISOString(), actor, nextId: randomUUID, nextNumber: () => { throw new Error('Email finalization cannot issue documents'); }, branding: document.snapshot.branding };
    const result = changeSaleWorkspace(current, command, { requestId, expectedRevision: current.revision }, context);
    if (!result.replayed) await client.query('UPDATE sale_workspace SET revision = $3, state = $4::jsonb, updated_at = $5 WHERE dealer_id = $1 AND id = $2::uuid', [this.dealerId, id, result.sale.revision, JSON.stringify(result.sale), result.sale.updatedAt]);
    return { ...result, sale: staffSaleWorkspace(result.sale) };
  }
  /** Provider acceptance is merged under a row lock; concurrent payments survive. */
  async finishEmail(id: string, requestId: string, command: Extract<SaleWorkspaceCommand, { action: 'email-status' }>, actor: string) {
    const client = await this.database.connect();
    try {
      await client.query('BEGIN');
      const result = await this.finishEmailOnClient(id, requestId, command, actor, client);
      await client.query('COMMIT'); return result;
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
  }
  async pdf(id: string, documentId: string) {
    const result = await this.database.query('SELECT state FROM sale_workspace WHERE dealer_id = $1 AND id = $2::uuid', [this.dealerId, id]);
    const record = result.rows[0]?.state as SaleWorkspaceRecord | undefined;
    const document = record?.documents.find(d => d.id === documentId);
    if (!document) throw new SaleWorkspaceError('Document not found.', 404);
    return { document, archive: record?.documentArchives?.[documentId] ?? archiveSaleDocument(document) };
  }
  private async source(draft: SaleWorkspaceDraft, client: SaleWorkspaceReadClient, currentId?: string) {
    const valid = (value: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
    if (draft.sourceEnquiryId) {
      if (!valid(draft.sourceEnquiryId)) throw new SaleWorkspaceError('Source enquiry not found.', 404);
      const result = await client.query('SELECT vehicle_id, appointment_at, appointment_status, appointment_cancelled_at FROM enquiries WHERE dealer_id = $1 AND id = $2::uuid', [this.dealerId, draft.sourceEnquiryId]);
      const e = result.rows[0];
      if (!e || e.vehicle_id && e.vehicle_id !== draft.vehicleId) throw new SaleWorkspaceError('The enquiry belongs to another vehicle or could not be found.', 409);
      const duplicate = await client.query("SELECT state FROM sale_workspace WHERE dealer_id = $1 AND state#>>'{draft,sourceEnquiryId}' = $2", [this.dealerId, draft.sourceEnquiryId]);
      // Keep every historical sale, but let a customer return after a released
      // reservation once its ledger is clear. A provider can later change a
      // refund's status, so re-check the stored ledger under the dealer lock
      // instead of assuming that every released sale is settled.
      if (duplicate.rows.some(row => {
        const sale = row.state as SaleWorkspaceRecord;
        if (sale.id === currentId) return false;
        if (sale.lifecycle?.status !== 'released' || sale.completedAt || sale.draft.sourceReservationId || !Array.isArray(sale.payments)) return true;
        const totals = saleWorkspaceTotals(sale.draft, sale.payments);
        return totals.confirmedPaid !== 0 || totals.pending !== 0;
      })) throw new SaleWorkspaceError('A sale already exists for this enquiry or an earlier payment needs review. Open its saved sale file.', 409);
      if (e.appointment_at && !e.appointment_cancelled_at) draft.appointment = { at: new Date(e.appointment_at).toISOString(), status: e.appointment_status ?? 'confirmed' };
    }
    if (draft.sourceReservationId) {
      if (!valid(draft.sourceReservationId)) throw new SaleWorkspaceError('Source reservation not found.', 404);
      const result = await client.query("SELECT l.vehicle_id FROM leads l JOIN lead_events e ON e.lead_id = l.id WHERE l.dealer_id = $1 AND l.id = $2::uuid AND e.payload->>'kind' IN ('online_reservation','online_stripe_reservation')", [this.dealerId, draft.sourceReservationId]);
      if (!result.rows[0] || result.rows[0].vehicle_id !== draft.vehicleId) throw new SaleWorkspaceError('The reservation belongs to another vehicle or could not be found.', 409);
      const duplicate = await client.query("SELECT state FROM sale_workspace WHERE dealer_id = $1 AND state#>>'{draft,sourceReservationId}' = $2", [this.dealerId, draft.sourceReservationId]);
      if (duplicate.rows.some(row => row.state.id !== currentId)) throw new SaleWorkspaceError('A sale already exists for this reservation. Open its saved sale file.', 409);
    }
  }
  private async stock(record: SaleWorkspaceRecord, status: 'reserved' | 'sold' | 'released', client: SaleWorkspaceReadClient, actor: string) {
    const vehicleId = record.draft.vehicleId;
    if (!/^[0-9a-f-]{36}$/i.test(vehicleId)) throw new SaleWorkspaceError('Choose a current stock vehicle before changing availability.');
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`sale-vehicle:${vehicleId}`]);
    const vehicle = (await client.query('SELECT inventory_status, source_status, audit_metadata FROM vehicles WHERE dealer_id = $1 AND id = $2::uuid FOR UPDATE', [this.dealerId, vehicleId])).rows[0];
    if (!vehicle) throw new SaleWorkspaceError('Vehicle not found.', 404);
    const owner = vehicle.audit_metadata?.saleWorkspaceId;
    if (status === 'released') {
      if (record.draft.sourceReservationId) {
        const stripe = (await client.query("SELECT e.payload->'reservation' AS reservation FROM lead_events e JOIN leads l ON l.id=e.lead_id WHERE l.dealer_id=$1 AND l.id=$2::uuid AND e.payload->>'kind'='online_stripe_reservation' FOR UPDATE OF e", [this.dealerId, record.draft.sourceReservationId])).rows[0]?.reservation;
        if (!stripe) throw new SaleWorkspaceError('Cancel the linked customer reservation before releasing this sale reservation.', 409);
        if (stripe.paymentStatus !== 'refunded' || stripe.amountRefundedPence !== stripe.amountReceivedPence || stripe.amountReceivedPence <= 0 || record.payments.filter(p => p.status === 'confirmed').reduce((sum, p) => sum + p.signedAmountPence, 0) !== 0) throw new SaleWorkspaceError('The linked Stripe deposit and any further payments must be refunded before releasing this vehicle.', 409);
      }
      if (vehicle.inventory_status !== 'reserved' || owner !== record.id) throw new SaleWorkspaceError('This vehicle is no longer reserved by this sale.', 409);
    } else {
      const competing = await client.query("SELECT id FROM sale_workspace WHERE dealer_id = $1 AND id <> $2::uuid AND state#>>'{draft,vehicleId}' = $3 AND state#>>'{lifecycle,status}' IN ('reserved','sold')", [this.dealerId, record.id, vehicleId]);
      const leads = await client.query("SELECT id FROM leads WHERE dealer_id = $1 AND vehicle_id = $2::uuid AND stage IN ('reserved','sale_agreed','collected') AND ($3::uuid IS NULL OR id <> $3::uuid) AND ($4::uuid IS NULL OR enquiry_id IS DISTINCT FROM $4::uuid)", [this.dealerId, vehicleId, record.draft.sourceReservationId || null, record.draft.sourceEnquiryId || null]);
      if (competing.rows.length || leads.rows.length || owner && owner !== record.id) throw new SaleWorkspaceError('This vehicle is reserved or sold to another customer.', 409);
      const linkedLead = record.draft.sourceReservationId ? (await client.query("SELECT stage FROM leads WHERE dealer_id = $1 AND id = $2::uuid AND vehicle_id = $3::uuid", [this.dealerId, record.draft.sourceReservationId, vehicleId])).rows[0] : record.draft.sourceEnquiryId ? (await client.query("SELECT stage FROM leads WHERE dealer_id = $1 AND enquiry_id = $2::uuid AND vehicle_id = $3::uuid", [this.dealerId, record.draft.sourceEnquiryId, vehicleId])).rows[0] : undefined;
      const ownReservation = vehicle.inventory_status === 'reserved' && (owner === record.id || Boolean(linkedLead && ['reserved', 'sale_agreed'].includes(linkedLead.stage)));
      if (vehicle.inventory_status !== 'available' && !ownReservation && !(vehicle.inventory_status === 'sold' && owner === record.id)) throw new SaleWorkspaceError('This vehicle is not available for this sale.', 409);
      if (status === 'reserved' && vehicle.source_status === 'missing') throw new SaleWorkspaceError('This vehicle is missing from the current stock feed. Review it before reserving.', 409);
    }
    const metadata = { ...(vehicle.audit_metadata ?? {}), saleWorkspaceId: status === 'released' ? null : record.id, saleWorkspaceStatus: status, saleWorkspaceActor: actor, saleWorkspaceChangedAt: record.updatedAt };
    await client.query('UPDATE vehicles SET inventory_status = $3::inventory_status, audit_metadata = $4::jsonb, updated_at = $5 WHERE dealer_id = $1 AND id = $2::uuid', [this.dealerId, vehicleId, status === 'released' ? 'available' : status, JSON.stringify(metadata), record.updatedAt]);
    if (record.draft.sourceReservationId || record.draft.sourceEnquiryId) await client.query(`UPDATE leads SET stage = $3::lead_stage, updated_at = $4 WHERE dealer_id = $1 AND ${record.draft.sourceReservationId ? 'id' : 'enquiry_id'} = $2::uuid`, [this.dealerId, record.draft.sourceReservationId || record.draft.sourceEnquiryId, status === 'sold' ? 'collected' : status === 'released' ? 'qualifying' : 'reserved', record.updatedAt]);
    if (status === 'sold' && vehicle.inventory_status !== 'sold') await createSoldVehicleFollowUps(client, this.dealerId, record, actor);
  }
  async mutate(input: { id?: string; requestId: string; expectedRevision?: number; draft?: unknown; command?: SaleWorkspaceCommand; actor: string }): Promise<SaleWorkspaceMutation> {
    if (input.command?.action === 'provider-refund-correction') throw new SaleWorkspaceError('Provider refund corrections require a verified payment event.', 403);
    const client = await this.database.connect();
    try {
      await client.query('BEGIN');
      // Serialise numbering and create retry checks for this dealer; row locks protect each file too.
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`sale-workspace:${this.dealerId}`]);
      await this.options?.afterLock?.(client);
      let current: SaleWorkspaceRecord | undefined;
      if (input.id) {
        const result = await client.query('SELECT state FROM sale_workspace WHERE dealer_id = $1 AND id = $2::uuid FOR UPDATE', [this.dealerId, input.id]);
        current = result.rows[0]?.state;
        if (!current) throw new SaleWorkspaceError('Sale not found.', 404);
        if (input.command?.action === 'reverse' && Object.values(current.providerPayments ?? {}).some(provider => provider.paymentId === (input.command as Extract<SaleWorkspaceCommand, {action:'reverse'}>).paymentId)) throw new SaleWorkspaceError('Refund this payment with its provider. A verified provider update will record the refund here.', 409);
      } else {
        const replay = await client.query("SELECT state FROM sale_workspace WHERE dealer_id = $1 AND state->'requests' ? $2 FOR UPDATE", [this.dealerId, input.requestId]);
        if (replay.rows[0]) {
          const sale = replay.rows[0].state as SaleWorkspaceRecord;
          if (sale.requests?.[input.requestId]?.fingerprint !== saleWorkspaceFingerprint({ action: 'create', draft: input.draft })) throw new SaleWorkspaceError('This request reference has already been used for different details.', 409);
          await this.options?.onCreateReplay?.(client,sale);
          await client.query('COMMIT');
          return { sale: staffSaleWorkspace(sale), replayed: true };
        }
      }
      await client.query('INSERT INTO sale_workspace_counters (dealer_id, numbers) VALUES ($1, $2::jsonb) ON CONFLICT DO NOTHING', [this.dealerId, '{}']);
      const counter = await client.query('SELECT numbers FROM sale_workspace_counters WHERE dealer_id = $1 FOR UPDATE', [this.dealerId]);
      const numbers = counter.rows[0].numbers as Record<string, number>;
      const now = new Date().toISOString();
      const draft = input.command?.action === 'update' ? input.command.draft : current?.draft ?? input.draft as SaleWorkspaceDraft;
      const assets = await this.assets(draft, client);
      if (input.command?.action === 'issue-invoice' && assets.vehicle?.imageUrl) {
        const photo = (await loadBrochurePhotos([{ url: assets.vehicle.imageUrl.replace(/w\d+-h\d+/, 'w480-h360'), caption: '' }], process.env.VEHICLE_PDF_IMAGE_HOSTS ?? '', 4000))[0];
        if (photo?.bytes && photo.format) assets.vehicle.photoDataUrl = `data:image/${photo.format === 'JPEG' ? 'jpeg' : 'png'};base64,${Buffer.from(photo.bytes).toString('base64')}`;
      }
      const context: SaleWorkspaceContext = { now, actor: input.actor, nextId: randomUUID, nextNumber: type => saleWorkspaceNumber(numbers, type, now, assets.branding.invoiceSettings), ...assets };
      const mutation = current
        ? changeSaleWorkspace(current, input.command!, { expectedRevision: input.expectedRevision!, requestId: input.requestId }, context)
        : createSaleWorkspace({ draft: input.draft, requestId: input.requestId }, context, saleWorkspaceNumber(numbers, 'sale', now, assets.branding.invoiceSettings));
      if (!mutation.replayed) {
        if (!current || input.command?.action === 'update') await this.source(mutation.sale.draft, client, current?.id);

        if (input.command?.action === 'invoice-payment' && input.command.payment.kind === 'deposit') await this.stock(mutation.sale, 'reserved', client, input.actor);
        if (input.command?.action === 'finish-invoice-sale') await this.stock(mutation.sale, 'sold', client, input.actor);
        if (input.command?.action === 'lifecycle') await this.stock(mutation.sale, input.command.status, client, input.actor);
        if (input.command?.action === 'take-deposit' || input.command?.action === 'complete-sale' || input.command?.action === 'confirm' && input.command.reserveVehicle) await this.stock(mutation.sale, input.command.action === 'complete-sale' ? 'sold' : 'reserved', client, input.actor);
        if (input.command?.action === 'handover') {
          await this.stock(mutation.sale, 'sold', client, input.actor);
          mutation.sale.lifecycle = { status: 'sold', vehicleId: mutation.sale.draft.vehicleId, changedAt: now };
        }
        for (const document of mutation.sale.documents.filter(d => !current?.documents.some(old => old.id === d.id))) {
          if (!this.options?.omitLogoEmbedding) document.snapshot.branding = await embedInvoiceLogoAsset(document.snapshot.branding, this.options?.logoOwnerDealerId ?? this.dealerId, client, siteOrigin());
          if (document.type === 'invoice' && !this.options?.omitInvoiceVerification) attachInvoiceVerification(document, mutation.sale.id, siteOrigin());
          (mutation.sale.documentArchives ??= {})[document.id] = archiveSaleDocument(document);
        }
        await client.query('INSERT INTO sale_workspace (id, dealer_id, reference, revision, state, created_at, updated_at) VALUES ($1::uuid, $2, $3, $4, $5::jsonb, $6, $7) ON CONFLICT (id) DO UPDATE SET revision = EXCLUDED.revision, state = EXCLUDED.state, updated_at = EXCLUDED.updated_at', [mutation.sale.id, this.dealerId, mutation.sale.reference, mutation.sale.revision, JSON.stringify(mutation.sale), mutation.sale.createdAt, mutation.sale.updatedAt]);
        if (!current) await this.options?.afterCreate?.(client,mutation.sale);
        await client.query('UPDATE sale_workspace_counters SET numbers = $2::jsonb WHERE dealer_id = $1', [this.dealerId, JSON.stringify(numbers)]);
      }
      await client.query('COMMIT');
      return { ...mutation, sale: staffSaleWorkspace(mutation.sale) };
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
  }
}

export type StripeReservationDeposit = { dealerId: string; reservationId: string; vehicleId: string; customerName: string; email: string; phone: string; vehicleTitle: string; vehicleRegistration?: string; expectedPricePence: number; amountPence: number; currency: string; paymentIntentId: string; eventId: string };
/** Only call after provider signature, event and exact amount/currency validation. No Stripe calls here. */
export async function recordStripeReservationDeposit(input: StripeReservationDeposit, client: SaleWorkspaceReadClient): Promise<SaleWorkspaceRecord> {
  if (input.currency.toLowerCase() !== 'gbp' || !Number.isSafeInteger(input.amountPence) || input.amountPence <= 0 || input.amountPence > input.expectedPricePence || !/^pi_[A-Za-z0-9]+$/.test(input.paymentIntentId)) throw new SaleWorkspaceError('The confirmed deposit does not match the sale.');
  await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`sale-workspace:${input.dealerId}`]);
  const result = await client.query("SELECT state FROM sale_workspace WHERE dealer_id = $1 AND state#>>'{draft,sourceReservationId}' = $2 FOR UPDATE", [input.dealerId, input.reservationId]);
  let current = result.rows[0]?.state as SaleWorkspaceRecord | undefined;
  const intentOwner = (await client.query("SELECT state FROM sale_workspace WHERE dealer_id = $1 AND state->'providerPayments' ? $2 FOR UPDATE", [input.dealerId, input.paymentIntentId])).rows[0]?.state as SaleWorkspaceRecord | undefined;
  if (intentOwner && intentOwner.id !== current?.id) throw new SaleWorkspaceError('This payment intent was already used for another reservation.', 409);
  if (current?.providerPayments?.[input.paymentIntentId]) {
    const paid = current.payments.find(p => p.id === current!.providerPayments![input.paymentIntentId].paymentId);
    if (!paid || paid.amountPence !== input.amountPence || current.draft.vehicleId !== input.vehicleId) throw new SaleWorkspaceError('This confirmed payment has incompatible reservation details.', 409);
    return publicSaleWorkspace(current);
  }
  await client.query('INSERT INTO sale_workspace_counters (dealer_id, numbers) VALUES ($1, $2::jsonb) ON CONFLICT DO NOTHING', [input.dealerId, '{}']);
  const numbers = (await client.query('SELECT numbers FROM sale_workspace_counters WHERE dealer_id = $1 FOR UPDATE', [input.dealerId])).rows[0].numbers as Record<string, number>;
  const now = new Date().toISOString();
  const draft: SaleWorkspaceDraft = current?.draft ?? { id: '', customer: input.customerName, email: input.email, phone: input.phone, address: '', vehicleId: input.vehicleId, vehicle: input.vehicleTitle, registration: input.vehicleRegistration ?? '', price: (input.expectedPricePence / 100).toFixed(2), partExchange: false, pxRegistration: '', pxDescription: '', pxValue: '', deposit: '', paymentMethod: 'Stripe', notes: '', collection: '', preparation: false, documents: false, handover: false, sourceReservationId: input.reservationId, customerSource: 'Online reservation' };
  if (draft.vehicleId !== input.vehicleId) throw new SaleWorkspaceError('The confirmed reservation belongs to another vehicle.', 409);
  const assets = await readSaleWorkspaceAssets(draft, input.dealerId, client);
  const context: SaleWorkspaceContext = { now, actor: 'Stripe verified payment', nextId: randomUUID, nextNumber: type => saleWorkspaceNumber(numbers, type, now, assets.branding.invoiceSettings), ...assets };
  current ??= createSaleWorkspace({ draft, requestId: 'stripe-create-' + input.paymentIntentId }, context, saleWorkspaceNumber(numbers, 'sale', now, assets.branding.invoiceSettings)).sale;
  const mutation = changeSaleWorkspace(current, { action: 'payment', payment: { amount: (input.amountPence / 100).toFixed(2), method: 'Stripe', date: new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(now)), reference: input.paymentIntentId, kind: 'deposit', status: 'confirmed' } }, { requestId: 'stripe-payment-' + input.paymentIntentId, expectedRevision: current.revision }, context);
  mutation.sale.lifecycle = { status: 'reserved', vehicleId: input.vehicleId, changedAt: now };
  (mutation.sale.providerPayments ??= {})[input.paymentIntentId] = { paymentId: mutation.sale.payments.at(-1)!.id, eventId: input.eventId };
  if (mutation.document) {
    mutation.document.snapshot.branding = await embedInvoiceLogoAsset(mutation.document.snapshot.branding, input.dealerId, client, siteOrigin());
    (mutation.sale.documentArchives ??= {})[mutation.document.id] = archiveSaleDocument(mutation.document);
  }
  await client.query('INSERT INTO sale_workspace (id, dealer_id, reference, revision, state, created_at, updated_at) VALUES ($1::uuid, $2, $3, $4, $5::jsonb, $6, $7) ON CONFLICT (id) DO UPDATE SET revision = EXCLUDED.revision, state = EXCLUDED.state, updated_at = EXCLUDED.updated_at', [mutation.sale.id, input.dealerId, mutation.sale.reference, mutation.sale.revision, JSON.stringify(mutation.sale), mutation.sale.createdAt, mutation.sale.updatedAt]);
  await client.query('UPDATE sale_workspace_counters SET numbers = $2::jsonb WHERE dealer_id = $1', [input.dealerId, JSON.stringify(numbers)]);
  await client.query("UPDATE vehicles SET audit_metadata = audit_metadata || $3::jsonb WHERE dealer_id = $1 AND id = $2::uuid", [input.dealerId, input.vehicleId, JSON.stringify({ saleWorkspaceId: mutation.sale.id, saleWorkspaceStatus: 'reserved' })]);
  return publicSaleWorkspace(mutation.sale);
}

/** Reconcile signed provider events against the cumulative succeeded refund amount in the caller's transaction. */
export async function recordStripeReservationRefund(input: { dealerId: string; reservationId: string; paymentIntentId: string; eventId: string; amountRefundedPence: number }, client: SaleWorkspaceReadClient): Promise<SaleWorkspaceRecord> {
  await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`sale-workspace:${input.dealerId}`]);
  const current = (await client.query("SELECT state FROM sale_workspace WHERE dealer_id = $1 AND state#>>'{draft,sourceReservationId}' = $2 FOR UPDATE", [input.dealerId, input.reservationId])).rows[0]?.state as SaleWorkspaceRecord | undefined;
  const originalId = current?.providerPayments?.[input.paymentIntentId]?.paymentId;
  const original = current?.payments.find(p => p.id === originalId);
  if (!current || !original || original.status !== 'confirmed' || !/^evt_[A-Za-z0-9_]{1,124}$/.test(input.eventId) || !Number.isSafeInteger(input.amountRefundedPence) || input.amountRefundedPence < 0 || input.amountRefundedPence > original.amountPence) throw new SaleWorkspaceError('The Stripe refund does not match a confirmed reservation payment.', 409);
  const provider = current.providerPayments![input.paymentIntentId];
  const previous = provider.refundEvents?.[input.eventId];
  if (previous) {
    if (previous.amountRefundedPence !== input.amountRefundedPence) throw new SaleWorkspaceError('This Stripe refund event was already recorded with different details.', 409);
    return publicSaleWorkspace(current);
  }
  const refunded = -current.payments.filter(p => p.reversesPaymentId === original.id && p.status === 'confirmed').reduce((sum, p) => sum + p.signedAmountPence, 0);
  const difference = input.amountRefundedPence - refunded;
  if (difference === 0) {
    // Persist no-op event identities too, so a replay after a later correction cannot revive old totals.
    (provider.refundEvents ??= {})[input.eventId] = { amountRefundedPence: input.amountRefundedPence };
    await client.query('UPDATE sale_workspace SET revision = $3, state = $4::jsonb, updated_at = $5 WHERE dealer_id = $1 AND id = $2::uuid', [input.dealerId, current.id, current.revision, JSON.stringify(current), current.updatedAt]);
    return publicSaleWorkspace(current);
  }
  await client.query('INSERT INTO sale_workspace_counters (dealer_id, numbers) VALUES ($1, $2::jsonb) ON CONFLICT DO NOTHING', [input.dealerId, '{}']);
  const numbers = (await client.query('SELECT numbers FROM sale_workspace_counters WHERE dealer_id = $1 FOR UPDATE', [input.dealerId])).rows[0].numbers as Record<string, number>;
  const now = new Date().toISOString();
  const assets = await readSaleWorkspaceAssets(current.draft, input.dealerId, client);
  const context: SaleWorkspaceContext = { now, actor: 'Stripe verified refund', nextId: randomUUID, nextNumber: type => saleWorkspaceNumber(numbers, type, now, assets.branding.invoiceSettings), ...assets };
  const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(now));
  const command: SaleWorkspaceCommand = difference > 0
    ? { action: 'reverse', paymentId: original.id, amount: (difference / 100).toFixed(2), kind: 'refund', reason: 'Stripe confirmed refund', date }
    : { action: 'provider-refund-correction', paymentId: original.id, amount: (-difference / 100).toFixed(2), reason: 'Stripe refund status changed: this previously recorded refund is no longer confirmed as returned. The original deposit remains received; no new payment was charged.', date };
  const mutation = changeSaleWorkspace(current, command, { expectedRevision: current.revision, requestId: 'stripe-refund-' + createHash('sha256').update(input.eventId).digest('hex') }, context);
  (mutation.sale.providerPayments![input.paymentIntentId].refundEvents ??= {})[input.eventId] = { amountRefundedPence: input.amountRefundedPence };
  if (mutation.document) {
    mutation.document.snapshot.branding = await embedInvoiceLogoAsset(mutation.document.snapshot.branding, input.dealerId, client, siteOrigin());
    (mutation.sale.documentArchives ??= {})[mutation.document.id] = archiveSaleDocument(mutation.document);
  }
  await client.query('UPDATE sale_workspace SET revision = $3, state = $4::jsonb, updated_at = $5 WHERE dealer_id = $1 AND id = $2::uuid', [input.dealerId, current.id, mutation.sale.revision, JSON.stringify(mutation.sale), now]);
  await client.query('UPDATE sale_workspace_counters SET numbers = $2::jsonb WHERE dealer_id = $1', [input.dealerId, JSON.stringify(numbers)]);
  return publicSaleWorkspace(mutation.sale);
}
