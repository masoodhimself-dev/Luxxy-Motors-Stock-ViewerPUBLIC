import { canDeleteEmptySaleDraft, hasUnrefundedStockConflictPayment, saleHandoverStatus } from '@workspace/vehicle-meta';
import { currentTenant, multiTenantEnabled } from './tenant-context';
import { dealerIntegrationsStore } from './dealer-integrations-store';
import { createHash, randomUUID } from 'node:crypto';
import { loadSaleInvoicePhotos } from './sale-invoice-photos';
import { archiveSaleDocument } from './sale-document-pdf';
import { embedInvoiceLogoAsset } from './invoice-logo-assets';
import { attachInvoiceVerification, invoiceVerificationView } from './invoice-verification';
import { siteOrigin } from './enquiry-links';
import { revokeChangedDeliveryEvidence } from './delivery-evidence';
import { readSaleReviewContext } from './sale-review-context';
import { assertSaleFinancialIntegrity } from './sale-financial-integrity';
import { saleListStage } from './sale-list-stage';
import { saleQueueFilters, saleQueueStatus, saleQueueToday, saleRegistrationSearch } from '@workspace/vehicle-meta';
import { createSoldVehicleFollowUps } from './sold-vehicle-follow-ups';
import { lookupDvlaVehicle } from './dvla-vehicle-check';
import { readCachedMot } from './mot-storage';
import { prepareSaleInvoiceVehicleReview, readSaleInvoiceVehicleStock, saleInvoiceStockIdentity } from './sale-invoice-vehicle-review';
import { requireSaleInvoiceVehicleReviewTarget, type StagedSaleInvoiceVehicleReview } from '@workspace/vehicle-meta';
import { changeSaleHandoffTask, isSaleHandoffTaskKind, saleHandoffTaskPage, saleHandoffTaskPageSize, staffSaleHandoffTasks, type SaleHandoffTaskListOptions, type SaleHandoffTaskPage, type SaleHandoffTaskSummary } from '@workspace/vehicle-meta';
import { isStaffRole, roleHasPermission, saleHandoffTaskPermission, staffRoles } from './staff-permissions';
import { changeSaleWorkspace, createSaleWorkspace, saleWorkspaceTotals, publicSaleWorkspace, currentInvoiceBranding, saleWorkspaceBranding, saleWorkspaceFingerprint, saleWorkspaceNumber, SaleWorkspaceError, type SaleWorkspaceBranding, type SaleWorkspaceCommand, type SaleWorkspaceContext, type SaleWorkspaceDraft, type SaleWorkspaceMutation, type SaleWorkspaceRecord, type SaleWorkspaceVehicleSnapshot, type SaleWorkspacePayment } from '@workspace/vehicle-meta';

export type SaleWorkspaceAssets = { reviewUrl?: string; branding: SaleWorkspaceBranding; vehicle?: SaleWorkspaceVehicleSnapshot; paperwork?: { saleTerms: string; reservationTerms: string } };
export type SaleWorkspaceReadClient = { query: (text: string, parameters?: any[]) => Promise<{ rows: Record<string, any>[] }> };
export type SaleWorkspaceTransactionClient = SaleWorkspaceReadClient & { release: () => void };
export type SaleWorkspaceDatabase = SaleWorkspaceReadClient & { connect: () => Promise<SaleWorkspaceTransactionClient> };
export const staffSaleWorkspace = (record: SaleWorkspaceRecord): SaleWorkspaceRecord => ({
  ...publicSaleWorkspace(record),
  emptyDraftDeletable: canDeleteEmptySaleDraft(record, true),
  ...(Object.keys(record.providerPayments ?? {}).length ? { hasProviderPayments: true as const } : {}),
  ...(record.handoffTasks ? { handoffTasks: staffSaleHandoffTasks(record) } : {}),
});
const checkoutInProgress = 'This car is held while a customer completes online payment. Wait for the payment to be confirmed or the hold to expire.';
const currentStockId = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;

export class SaleVehicleConflictError extends SaleWorkspaceError {
  constructor() { super('This vehicle is reserved or sold to another customer.', 409); }
}

async function lockSaleVehicle(dealerId: string, vehicleId: string, client: SaleWorkspaceReadClient) {
  await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`sale-vehicle:${vehicleId}`]);
  return (await client.query('SELECT inventory_status, source_status, audit_metadata FROM vehicles WHERE dealer_id = $1 AND id = $2::uuid FOR UPDATE', [dealerId, vehicleId])).rows[0];
}

/** Caller chooses whether an old paid draft can claim stock without an explicit owner. */
export async function hasSaleWorkspaceStockClaim(
  client: SaleWorkspaceReadClient,
  dealerId: string,
  vehicleId: string,
  { excludeSaleId = null, includeLegacyLedger = false }: { excludeSaleId?: string | null; includeLegacyLedger?: boolean } = {},
) {
  const competing = await client.query(`SELECT id FROM sale_workspace
    WHERE dealer_id = $1 AND ($2::uuid IS NULL OR id <> $2::uuid) AND state#>>'{draft,vehicleId}' = $3 AND (
      state#>>'{lifecycle,status}' IN ('reserved','sold') OR (
        $4::boolean AND coalesce(state#>>'{lifecycle,status}','') NOT IN ('released','returned')
        AND coalesce(state#>>'{returnReplacement,direction}','') <> 'returned'
        AND coalesce(state->'standaloneReturn','null'::jsonb) = 'null'::jsonb
        AND (SELECT coalesce(sum(CASE WHEN jsonb_typeof(p->'signedAmountPence')='number' THEN (p->>'signedAmountPence')::numeric ELSE 0 END),0)
             FROM jsonb_array_elements(CASE WHEN jsonb_typeof(state->'payments')='array' THEN state->'payments' ELSE '[]'::jsonb END) p
             WHERE p->>'status'='confirmed' AND p->>'stockConflictReconciliation' IS DISTINCT FROM 'true'
               AND NOT EXISTS (
                 SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(state->'payments')='array' THEN state->'payments' ELSE '[]'::jsonb END) original
                 WHERE original->>'id' = p->>'reversesPaymentId' AND original->>'stockConflictReconciliation' = 'true'
               )
        ) > 0
      )
    ) LIMIT 1`, [dealerId, excludeSaleId, vehicleId, includeLegacyLedger]);
  return competing.rows.length > 0;
}

async function saleVehicleOwnership(dealerId: string, record: SaleWorkspaceRecord, vehicle: Record<string, any>, client: SaleWorkspaceReadClient) {
  const { vehicleId, sourceReservationId, sourceEnquiryId } = record.draft;
  const owner = vehicle.audit_metadata?.saleWorkspaceId;
  const competing = await hasSaleWorkspaceStockClaim(client, dealerId, vehicleId, {
    excludeSaleId: record.id,
    includeLegacyLedger: vehicle.inventory_status === 'available' && !owner,
  });
  const leads = await client.query("SELECT id FROM leads WHERE dealer_id = $1 AND vehicle_id = $2::uuid AND stage IN ('reserved','sale_agreed','collected') AND ($3::uuid IS NULL OR id <> $3::uuid) AND ($4::uuid IS NULL OR enquiry_id IS DISTINCT FROM $4::uuid)", [dealerId, vehicleId, sourceReservationId || null, sourceEnquiryId || null]);
  const linkedLead = sourceReservationId ? (await client.query("SELECT stage FROM leads WHERE dealer_id = $1 AND id = $2::uuid AND vehicle_id = $3::uuid", [dealerId, sourceReservationId, vehicleId])).rows[0] : sourceEnquiryId ? (await client.query("SELECT stage FROM leads WHERE dealer_id = $1 AND enquiry_id = $2::uuid AND vehicle_id = $3::uuid", [dealerId, sourceEnquiryId, vehicleId])).rows[0] : undefined;
  const ownReservation = owner === record.id || Boolean(linkedLead && ['reserved', 'sale_agreed'].includes(linkedLead.stage));
  const ownSold = owner === record.id || !owner && Boolean(record.completedAt || record.lifecycle?.status === 'sold');
  const conflict = Boolean(competing || leads.rows.length || owner && owner !== record.id
    || vehicle.inventory_status === 'reserved' && !ownReservation
    || vehicle.inventory_status === 'sold' && !ownSold);
  return { conflict, ownReservation, ownSold };
}

export async function requireSaleVehiclePaymentAccess(dealerId: string, record: SaleWorkspaceRecord, client: SaleWorkspaceReadClient, reconciliation = false) {
  const vehicleId = record.draft.vehicleId;
  const vehicle = currentStockId.test(vehicleId) ? await lockSaleVehicle(dealerId, vehicleId, client) : undefined;
  if (vehicle?.audit_metadata?.onlineStripeReservationId) throw new SaleWorkspaceError(checkoutInProgress, 409);
  const conflict = vehicle ? (await saleVehicleOwnership(dealerId, record, vehicle, client)).conflict : false;
  if (reconciliation) {
    if (!conflict) throw new SaleWorkspaceError('The stock conflict has changed. Reload this sale before recording the payment.', 409);
  } else {
    if (conflict) throw new SaleVehicleConflictError();
    if (hasUnrefundedStockConflictPayment(record)) throw new SaleWorkspaceError('Refund or correct the payment recorded against conflicting stock before continuing this sale.', 409);
  }
}

/** A current payment request can be viewed or sent only while the stock still belongs to this sale. */
export async function saleVehiclePaymentBlocked(dealerId: string, record: SaleWorkspaceRecord, client: SaleWorkspaceReadClient): Promise<boolean> {
  return hasUnrefundedStockConflictPayment(record) || Boolean(await readSaleVehicleActionBlock(dealerId, record, client));
}

async function readSaleVehicleActionBlock(dealerId: string, record: SaleWorkspaceRecord, client: SaleWorkspaceReadClient): Promise<SaleWorkspaceRecord['stockActionBlock']> {
  const vehicleId = record.draft.vehicleId;
  if (!currentStockId.test(vehicleId)) return undefined;
  const vehicle = (await client.query('SELECT inventory_status, source_status, audit_metadata FROM vehicles WHERE dealer_id = $1 AND id = $2::uuid', [dealerId, vehicleId])).rows[0];
  if (vehicle?.audit_metadata?.onlineStripeReservationId) return 'online-checkout';
  if (vehicle && (await saleVehicleOwnership(dealerId, record, vehicle, client)).conflict) return 'another-sale';
  return undefined;
}

/** Use the already-held transaction client; never acquire another pool connection while holding the dealer lock. */
export async function readSaleWorkspaceAssets(draft: SaleWorkspaceDraft, dealerId: string, client: SaleWorkspaceReadClient): Promise<SaleWorkspaceAssets> {
  const settings = await client.query('SELECT config FROM dealer_settings WHERE dealer_id = $1', [dealerId]);
  const validVehicleId = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(draft?.vehicleId ?? '');
  const vehicle = validVehicleId
    ? (await client.query("SELECT id, coalesce(website_title_override, title, '') AS title, coalesce(nullif(btrim(trim), ''), variant) AS trim, year, fuel, transmission, mileage, colour, owners, write_off_category, website_description, raw_source_data, plate, vrm, registration, engine_size, body_type, doors, seats, emission_class, coalesce(nullif(website_hero_image_override, ''), source_hero_image) AS invoice_image FROM vehicles WHERE dealer_id = $1 AND id = $2::uuid", [dealerId, draft.vehicleId])).rows[0]
    : undefined;
  const paperwork = await dealerIntegrationsStore.readSalesPaperwork(client);
  const branding = saleWorkspaceBranding(settings.rows[0]?.config);
  if (currentTenant()?.demo) {
    const demo = (await client.query('SELECT converted_at FROM dealer_demos WHERE dealer_id = $1', [dealerId])).rows[0];
    if (!demo || demo.converted_at) throw new SaleWorkspaceError('This demonstration changed while the sale was being prepared. Reload before continuing.', 409);
    branding.identity.name += ' · SAMPLE / DEMO';
  }
  return { reviewUrl: String(settings.rows[0]?.config?.contact?.googleReviewUrl || ''), paperwork, branding: currentInvoiceBranding(branding, paperwork.invoiceSettings), ...(vehicle ? { vehicle: { id: vehicle.id, title: vehicle.title, trim: vehicle.trim, registration: vehicle.plate || vehicle.vrm || vehicle.registration, engineSize: vehicle.engine_size, bodyType: vehicle.body_type, doors: vehicle.doors, seats: vehicle.seats, emissionClass: vehicle.emission_class, imageUrl: vehicle.invoice_image, year: vehicle.year, fuel: vehicle.fuel, transmission: vehicle.transmission, mileage: vehicle.mileage, colour: vehicle.colour, owners: vehicle.owners, writeOffCategory: vehicle.write_off_category, description: vehicle.website_description || vehicle.raw_source_data?.sourceExtras?.description || null, serviceHistory: typeof vehicle.raw_source_data?.sourceExtras?.serviceHistory === 'string' ? vehicle.raw_source_data.sourceExtras.serviceHistory : vehicle.raw_source_data?.sourceExtras?.historyExtras?.serviceHistory?.description || null } } : {}) };
}

export class PostgresSaleWorkspaceStore {
  constructor(private dealerId: string, private assets: (draft: SaleWorkspaceDraft, client: SaleWorkspaceReadClient) => Promise<SaleWorkspaceAssets>, private database: SaleWorkspaceDatabase, private invoicePhotos = loadSaleInvoicePhotos) {}
  private async prepareInvoicePhotos(saleId: string, revision: number, requestId: string) {
    const result = await this.database.query(`SELECT v.id, v.website_hero_image_override, v.source_hero_image,
      ARRAY(SELECT i.source_url FROM vehicle_images i WHERE i.vehicle_id=v.id AND i.is_active
        ORDER BY i.is_hero DESC,i.sort_order,i.id LIMIT 8) AS gallery
      FROM sale_workspace sw JOIN vehicles v ON v.dealer_id=sw.dealer_id
        AND v.id=CASE WHEN sw.state#>>'{draft,vehicleId}' ~* $5 THEN (sw.state#>>'{draft,vehicleId}')::uuid END
      WHERE sw.dealer_id=$1 AND sw.id=$2::uuid AND sw.revision=$3 AND NOT coalesce(sw.state->'requests' ? $4,false)`,
    [this.dealerId,saleId,revision,requestId,currentStockId.source]);
    const stock = result.rows[0];
    if (!stock) return undefined;
    const urls = [stock.website_hero_image_override,stock.source_hero_image,...(Array.isArray(stock.gallery) ? stock.gallery : [])];
    return { vehicleId:String(stock.id),dataUrls:await this.invoicePhotos(urls) };
  }
  async list(options:{q?:string;offset?:number;enquiryId?:string;reservationId?:string;queue?:unknown;owner?:unknown;actorId?:string}={}) {
    const {queue, owner} = saleQueueFilters(options.queue, options.owner);
    const now = new Date();
    const today = saleQueueToday(now);
    const nowIso = now.toISOString();
    const q=(options.q??'').trim();
    const offset=options.offset??0;
    if(q.length>120||!Number.isSafeInteger(offset)||offset<0||offset>10000)throw new SaleWorkspaceError('Check the sales search or page.',400);
    const validId=(id:string|undefined)=>!id||/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id);
    if(!validId(options.enquiryId)||!validId(options.reservationId))throw new SaleWorkspaceError('Choose a valid linked customer enquiry.',400);
    // SQL narrows the search and selects bounded sets of possible attention items.
    // The shared sale rules determine attention before the visible page is counted.
    const query = `SELECT state - 'documentArchives' - 'requests' - 'providerPayments' - 'documents' - 'events' - 'emailDeliveries' - 'payments' - 'corrections' - 'team' - 'handoffTasks' - 'invoiceVehicleReview' AS state,
      id AS list_id, updated_at::text AS list_updated_at,
      state#>>'{team,ownerId}' AS list_owner_id,
      state#>>'{team,ownerName}' AS list_owner_name,
      coalesce(state#>>'{team,note}','')<>'' AS list_has_team_note,
      CASE WHEN jsonb_typeof(state->'corrections')='array' THEN jsonb_array_length(state->'corrections')>0 ELSE false END AS list_has_correction_notes,
      coalesce(jsonb_typeof(state->'payments')='array',false) AS list_ledger_known,
      EXISTS(SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(state->'documents')='array' THEN state->'documents' ELSE '[]'::jsonb END) AS doc WHERE doc->>'type'='invoice') AS list_has_invoice,
      coalesce((SELECT jsonb_agg(jsonb_build_object('id',p->'id','status',p->'status','kind',p->'kind','signedAmountPence',p->'signedAmountPence','amountPence',p->'amountPence','receiptId',p->'receiptId','paymentRequestId',p->'paymentRequestId','reversesPaymentId',p->'reversesPaymentId','stockConflictReconciliation',p->'stockConflictReconciliation') ORDER BY payment.ordinality) FROM jsonb_array_elements(CASE WHEN jsonb_typeof(state->'payments')='array' THEN state->'payments' ELSE '[]'::jsonb END) WITH ORDINALITY AS payment(p,ordinality)),'[]'::jsonb) AS list_payment_entries,
      coalesce((SELECT jsonb_agg(jsonb_build_object('id',d->'id','type',d->'type','invoiceKind',d->'invoiceKind')) FROM jsonb_array_elements(CASE WHEN jsonb_typeof(state->'documents')='array' THEN state->'documents' ELSE '[]'::jsonb END) d WHERE d->>'type' IN ('invoice','receipt')),'[]'::jsonb) AS list_document_facts,
      coalesce((SELECT jsonb_agg(jsonb_build_object('documentId',e->'documentId','status',e->'status')) FROM jsonb_array_elements(CASE WHEN jsonb_typeof(state->'emailDeliveries')='array' THEN state->'emailDeliveries' ELSE '[]'::jsonb END) e WHERE e->>'status'='sent'),'[]'::jsonb) AS list_sent_documents,
      coalesce((SELECT jsonb_agg(jsonb_build_object('documentId',e->'documentId','type',e->'type')) FROM jsonb_array_elements(CASE WHEN jsonb_typeof(state->'events')='array' THEN state->'events' ELSE '[]'::jsonb END) e WHERE e->>'type'='deposit-confirmation-shared'),'[]'::jsonb) AS list_shared_deposits,
      CASE WHEN jsonb_typeof(state->'payments')='array' AND (state->'documents' IS NULL OR jsonb_typeof(state->'documents')='array') THEN CASE WHEN jsonb_array_length(coalesce(state->'documents','[]'::jsonb))=0 AND jsonb_array_length(state->'payments')=0 THEN jsonb_build_object('requests',state->'requests','documentArchives',state->'documentArchives','providerPayments',state->'providerPayments','events',state->'events','documents',state->'documents','payments',state->'payments','emailDeliveries',state->'emailDeliveries') END END AS deletion_evidence
      FROM sale_workspace
      CROSS JOIN LATERAL (SELECT
        (coalesce(state#>>'{lifecycle,status}','') IN ('released','returned')
          OR coalesce(state#>>'{returnReplacement,direction}','')='returned'
          OR coalesce(state->'standaloneReturn','null'::jsonb)<>'null'::jsonb
          OR coalesce(state#>>'{draft,fulfilment,completedAt}','')<>'') AS closed
      ) AS queue_state
      WHERE dealer_id=$1
      AND ($7<>'open' OR NOT queue_state.closed) AND ($7<>'closed' OR queue_state.closed)
      AND ($7<>'attention' OR
        EXISTS(SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(state->'payments')='array' THEN state->'payments' ELSE '[]'::jsonb END) p WHERE p->>'status'='pending' OR (p->>'status'='confirmed' AND p->>'stockConflictReconciliation'='true')) OR
        (NOT queue_state.closed AND (
          EXISTS(SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(state->'paymentRequests')='array' THEN state->'paymentRequests' ELSE '[]'::jsonb END) r WHERE r->>'status'='active' AND nullif(r->>'dueDate','')<=$10)
          OR state#>>'{draft,fulfilment,stage}'='unsuccessful'
          OR nullif(state#>>'{draft,fulfilment,scheduledDate}','')<=$10
          OR (coalesce(state->>'completedAt','')='' AND coalesce(state#>>'{lifecycle,status}','')<>'sold' AND
            EXISTS(SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(state->'documents')='array' THEN state->'documents' ELSE '[]'::jsonb END) doc WHERE doc->>'type' IN ('invoice','receipt')))
        )))
      AND ($8='all' OR ($8='mine' AND $9<>'' AND state#>>'{team,ownerId}'=$9) OR ($8='unassigned' AND coalesce(state#>>'{team,ownerId}','')=''))
      AND ($2='' OR id::text=$2 OR state#>>'{draft,sourceEnquiryId}'=$2 OR state#>>'{draft,sourceReservationId}'=$2
        OR strpos(lower(concat_ws(' ',reference,state#>>'{draft,customer}',state#>>'{draft,email}',state#>>'{draft,vehicle}',state#>>'{draft,registration}')),lower($2))>0
        OR ($11<>'' AND strpos(regexp_replace(upper(coalesce(state#>>'{draft,registration}','')),'[^A-Z0-9]','','g'),$11)>0)
        OR EXISTS(SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(state->'documents')='array' THEN state->'documents' ELSE '[]'::jsonb END) AS doc WHERE strpos(lower(coalesce(doc->>'number','')),lower($2))>0)
        OR ($3<>'' AND strpos(regexp_replace(coalesce(state#>>'{draft,phone}',''),'[^0-9]','','g'),$3)>0))
      AND ($4='' OR state#>>'{draft,sourceEnquiryId}'=$4) AND ($5='' OR state#>>'{draft,sourceReservationId}'=$5)
      AND ($12::timestamptz IS NULL OR (updated_at,id)<($12::timestamptz,$13::uuid))
      ORDER BY updated_at DESC,id DESC LIMIT 51 OFFSET $6`;
    const selected: Array<{ row: Record<string, any>; saleFacts: SaleWorkspaceRecord; attention: string; refundDue?: number }> = [];
    let skip = queue === 'attention' ? offset : 0;
    let cursor: { updatedAt: string; id: string } | undefined;
    while (selected.length < 51) {
      const result = await this.database.query(query, [
        this.dealerId, q, /^[+0-9 ().-]+$/.test(q) ? q.replace(/\D/g, '') : '',
        options.enquiryId ?? '', options.reservationId ?? '', queue === 'attention' ? 0 : offset,
        queue, owner, options.actorId ?? '', today, saleRegistrationSearch(q), cursor?.updatedAt ?? null, cursor?.id ?? null,
      ]);
      for (const row of result.rows) {
        const record = row.state as SaleWorkspaceRecord;
        const saleFacts: SaleWorkspaceRecord = {
          ...record,
          payments: row.list_payment_entries ?? record.payments ?? [],
          documents: row.list_document_facts ?? record.documents ?? [],
          events: row.list_shared_deposits ?? record.events ?? [],
          emailDeliveries: row.list_sent_documents ?? record.emailDeliveries ?? [],
        };
        const { attention, refundDue } = saleQueueStatus(saleFacts, today, nowIso);
        if (queue === 'attention' && !attention) continue;
        if (skip > 0) { skip--; continue; }
        selected.push({ row, saleFacts, attention, refundDue });
        if (selected.length === 51) break;
      }
      if (queue !== 'attention' || result.rows.length < 51) break;
      const last = result.rows.at(-1);
      if (!last?.list_updated_at || !last.list_id) break;
      cursor = { updatedAt: last.list_updated_at, id: last.list_id };
    }
    const sales=selected.slice(0,50).map(({row,saleFacts,attention,refundDue})=>{
      const record=row.state as SaleWorkspaceRecord,draft=record.draft;
      const identity={id:draft.id,customer:draft.customer,email:draft.email,phone:draft.phone,vehicleId:draft.vehicleId,vehicle:draft.vehicle,registration:draft.registration,sourceEnquiryId:draft.sourceEnquiryId,sourceReservationId:draft.sourceReservationId};
      const totals=saleWorkspaceTotals(draft,saleFacts.payments);
      const fulfilment = draft.fulfilment;
      const handover = fulfilment ? {
        method: fulfilment.method,
        status: saleHandoverStatus({ ...fulfilment, address: fulfilment.address ?? '' }),
        ...(fulfilment.scheduledDate ? { scheduledDate: fulfilment.scheduledDate } : {}),
        ...(fulfilment.timeWindow ? { timeWindow: fulfilment.timeWindow } : {}),
      } : null;
      const listHasRefunds=(row.list_payment_entries ?? []).some((payment: SaleWorkspacePayment)=>payment.status==='confirmed' && payment.signedAmountPence<0);
      const listHasInvoice = row.list_has_invoice === true;
      const listStage = saleListStage(saleFacts,listHasInvoice,nowIso);
      return {listSummary:true as const,listOwnerId:row.list_owner_id ?? null,listOwnerName:row.list_owner_name ?? '',listHasTeamNote:row.list_has_team_note === true,listAttention:attention,...(refundDue ? {listRefundDue:refundDue} : {}),listStage,listHasInvoice,listTotalDue:totals.totalDue,listPaid:totals.confirmedPaid,listPending:totals.pending,listLedgerKnown:row.list_ledger_known === true,listBalance:totals.balance,listHandover:handover,listHasCorrectionNotes:row.list_has_correction_notes === true,listHasRefunds,id:record.id,reference:record.reference,revision:record.revision,createdAt:record.createdAt,updatedAt:record.updatedAt,...(record.completedAt?{completedAt:record.completedAt}:{}),...(record.lifecycle?{lifecycle:record.lifecycle}:{}),...(record.standaloneReturn?{standaloneReturn:{id:record.standaloneReturn.id,creditPence:record.standaloneReturn.creditPence,refundDuePence:record.standaloneReturn.refundDuePence,at:record.standaloneReturn.at}}:{}),...(record.returnReplacement?{returnReplacement:{direction:record.returnReplacement.direction,otherSaleId:record.returnReplacement.otherSaleId,otherReference:record.returnReplacement.otherReference,creditPence:record.returnReplacement.creditPence,at:record.returnReplacement.at}}:{}),draft:identity,documents:[],payments:[],events:[],emptyDraftDeletable:canDeleteEmptySaleDraft({...record,...row.deletion_evidence},true)};
    });
    return {sales,hasMore:selected.length>50};
  }
  async get(id: string, options: { includeStockActionBlock?: boolean } = {}): Promise<SaleWorkspaceRecord> {
    const result = await this.database.query('SELECT state FROM sale_workspace WHERE dealer_id = $1 AND id = $2::uuid', [this.dealerId, id]);
    if (!result.rows[0]) throw new SaleWorkspaceError('Sale not found.', 404);
    const sale = result.rows[0].state as SaleWorkspaceRecord;
    const reviewContext = (sale.finalReview?.status === 'passed' || sale.finalReview?.status === 'overridden') ? await readSaleReviewContext(this.database,this.dealerId,sale) : undefined;
    const summary = staffSaleWorkspace({...sale,...(reviewContext?{finalReviewContextStale:sale.finalReview?.contextHash!==reviewContext.hash}:{})});
    if (options.includeStockActionBlock && sale.lifecycle?.status !== 'released' && sale.lifecycle?.status !== 'returned' && !sale.standaloneReturn && sale.returnReplacement?.direction !== 'returned') {
      const stockActionBlock = await readSaleVehicleActionBlock(this.dealerId, sale, this.database);
      if (stockActionBlock) summary.stockActionBlock = stockActionBlock;
    }
    return summary;
  }
  async checkInvoiceVehicle(id: string, expectedRevision: unknown, actorId: string, dvla = lookupDvlaVehicle) {
    const { rows } = await this.database.query('SELECT state FROM sale_workspace WHERE dealer_id=$1 AND id=$2::uuid',[this.dealerId,id]);
    const sale = rows[0]?.state as SaleWorkspaceRecord | undefined;
    if (!sale) throw new SaleWorkspaceError('Sale not found.',404);
    requireSaleInvoiceVehicleReviewTarget(sale,expectedRevision);
    const stock = await readSaleInvoiceVehicleStock(this.database,this.dealerId,sale.draft.vehicleId);
    // Only the short conditional write below needs a row lock. Provider latency never holds a sale transaction open.
    const review = await prepareSaleInvoiceVehicleReview(sale,stock,{ dvla,mot:registration=>readCachedMot(registration,this.database),now:()=>new Date() });
    const staged: StagedSaleInvoiceVehicleReview = { review,revision:sale.revision,actorId,stockIdentity:saleInvoiceStockIdentity(stock) };
    const saved = await this.database.query(`UPDATE sale_workspace SET state=jsonb_set(state,'{invoiceVehicleReview}',$4::jsonb)
      WHERE dealer_id=$1 AND id=$2::uuid AND revision=$3 RETURNING id`,[this.dealerId,id,sale.revision,JSON.stringify(staged)]);
    if (!saved.rows.length) throw new SaleWorkspaceError('This sale changed. Reload it before checking the vehicle.',409);
    return { review };
  }
  async listHandoffTasks(actorId: string, options: SaleHandoffTaskListOptions = { offset: 0, view: 'mine' }): Promise<SaleHandoffTaskPage> {
    const paymentRoles = staffRoles.filter(role => roleHasPermission(role, saleHandoffTaskPermission('check-payment')));
    const collectionRoles = staffRoles.filter(role => roleHasPermission(role, saleHandoffTaskPermission('arrange-collection')));
    const result = await this.database.query(`SELECT sw.id AS "saleId", sw.reference, coalesce(sw.state#>>'{draft,customer}','') AS customer,
      coalesce(sw.state#>>'{draft,vehicle}','') AS vehicle, t.task, assignee_status.issue AS "assignmentIssue"
      FROM sale_workspace sw
      CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(sw.state->'handoffTasks')='array' THEN sw.state->'handoffTasks' ELSE '[]'::jsonb END) AS t(task)
      LEFT JOIN portal_users assignee ON assignee.dealer_id = sw.dealer_id AND assignee.auth_user_id = t.task->>'assigneeId' AND assignee.disabled_at IS NULL
      CROSS JOIN LATERAL (SELECT CASE
        WHEN assignee.id IS NULL THEN 'inactive'
        WHEN NOT coalesce(assignee.role::text = ANY(CASE WHEN t.task->>'kind' = 'check-payment' THEN $4::text[] ELSE $5::text[] END),false) THEN 'role-changed'
      END AS issue) assignee_status
      WHERE sw.dealer_id = $1
        AND sw.state->'handoffTasks' @> CASE WHEN $3::boolean THEN '[{"status":"open"}]'::jsonb
          ELSE jsonb_build_array(jsonb_build_object('assigneeId',$2::text,'status','open')) END
        AND t.task->>'status' = 'open'
        AND (t.task->>'kind' = 'check-payment' OR t.task->>'kind' = 'arrange-collection'
          AND coalesce(sw.state#>>'{lifecycle,status}','') NOT IN ('released','returned')
          AND coalesce(sw.state->'standaloneReturn','null'::jsonb) = 'null'::jsonb
          AND coalesce(sw.state#>>'{returnReplacement,direction}','') <> 'returned'
          AND coalesce(sw.state#>>'{draft,fulfilment,completedAt}','') = '')
        AND (CASE WHEN $3::boolean THEN assignee_status.issue IS NOT NULL
          ELSE t.task->>'assigneeId' = $2 AND assignee_status.issue IS NULL END)
        AND ($8::text IS NULL OR ((t.task->>'createdAt') COLLATE "C", sw.id, (t.task->>'id') COLLATE "C") > ($8::text COLLATE "C", $9::uuid, $10::text COLLATE "C"))
      ORDER BY (t.task->>'createdAt') COLLATE "C", sw.id, (t.task->>'id') COLLATE "C"
      LIMIT $6 OFFSET $7`, [this.dealerId, actorId, options.view === 'needs-reassignment', paymentRoles, collectionRoles, saleHandoffTaskPageSize + 1,
        options.offset, options.cursor?.createdAt ?? null, options.cursor?.saleId ?? null, options.cursor?.taskId ?? null]);
    return saleHandoffTaskPage((result.rows as SaleHandoffTaskSummary[]).map(({ assignmentIssue, ...task }) => assignmentIssue ? { ...task, assignmentIssue } : task));
  }
  async listHandoffAssignees(id: string, kind: unknown) {
    if (!isSaleHandoffTaskKind(kind)) throw new SaleWorkspaceError('Choose a handoff task.');
    const found = await this.database.query('SELECT id FROM sale_workspace WHERE dealer_id=$1 AND id=$2::uuid', [this.dealerId, id]);
    if (!found.rows.length) throw new SaleWorkspaceError('Sale not found.', 404);
    const result = await this.database.query('SELECT auth_user_id, name, email, role FROM portal_users WHERE dealer_id=$1 AND disabled_at IS NULL ORDER BY coalesce(name,email,auth_user_id), auth_user_id', [this.dealerId]);
    const permission = saleHandoffTaskPermission(kind);
    return { members: result.rows.filter(member => isStaffRole(member.role) && roleHasPermission(member.role, permission))
      .map(member => ({ id: String(member.auth_user_id), name: String(member.name || member.email || 'Staff member') })) };
  }
  async mutateHandoffTask(id: string, input: Parameters<typeof changeSaleHandoffTask>[1], actor: { id: string; name: string; canManage: boolean; canRecordPayments: boolean }) {
    const client = await this.database.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`sale-workspace:${this.dealerId}`]);
      const result = await client.query('SELECT state FROM sale_workspace WHERE dealer_id = $1 AND id = $2::uuid FOR UPDATE', [this.dealerId, id]);
      if (!result.rows[0]) throw new SaleWorkspaceError('Sale not found.', 404);
      const isMachine = actor.id === 'machine' && !multiTenantEnabled();
      const actorRole = isMachine ? 'owner' : (await client.query(
        'SELECT role FROM portal_users WHERE dealer_id=$1 AND auth_user_id=$2 AND disabled_at IS NULL FOR SHARE',
        [this.dealerId, actor.id],
      )).rows[0]?.role;
      if (!isStaffRole(actorRole)) throw new SaleWorkspaceError('Your staff membership is no longer active.', 403);
      const mutation = await changeSaleHandoffTask(result.rows[0].state, input, {
        actorId: actor.id, actor: actor.name, now: new Date().toISOString(), nextId: randomUUID,
        canManage: actor.canManage && roleHasPermission(actorRole, 'sales.manage'),
        canRecordPayments: actor.canRecordPayments && roleHasPermission(actorRole, 'payments.record'),
        resolveAssignee: async (assigneeId, kind) => {
          const row = (await client.query('SELECT name, email, role FROM portal_users WHERE dealer_id=$1 AND auth_user_id=$2 AND disabled_at IS NULL FOR SHARE', [this.dealerId, assigneeId])).rows[0];
          if (!row || !isStaffRole(row.role) || !roleHasPermission(row.role, saleHandoffTaskPermission(kind))) throw new SaleWorkspaceError('Choose an active staff member who can handle this task.');
          return row.name || row.email || 'Staff member';
        },
      });
      if (!mutation.replayed) {
        const { sale } = mutation;
        await client.query('UPDATE sale_workspace SET revision = $3, state = $4::jsonb, updated_at = $5 WHERE dealer_id = $1 AND id = $2::uuid', [this.dealerId, id, sale.revision, JSON.stringify(sale), sale.updatedAt]);
      }
      await client.query('COMMIT');
      return { ...mutation, sale: staffSaleWorkspace(mutation.sale) };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally { client.release(); }
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
        OR EXISTS(SELECT 1 FROM sold_vehicle_follow_ups WHERE dealer_id=$1 AND sale_id=$2::uuid)
        OR EXISTS(SELECT 1 FROM sale_terms_documents WHERE dealer_id=$1 AND sale_id=$2::uuid)
        OR EXISTS(SELECT 1 FROM sale_delivery_evidence WHERE dealer_id=$1 AND sale_id=$2::uuid) AS protected`, [this.dealerId, id]);
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
    if (!result.replayed) {
      await revokeChangedDeliveryEvidence(client,{dealerId:this.dealerId,saleId:id,before:current,after:result.sale,actor});
      await client.query('UPDATE sale_workspace SET revision = $3, state = $4::jsonb, updated_at = $5 WHERE dealer_id = $1 AND id = $2::uuid', [this.dealerId, id, result.sale.revision, JSON.stringify(result.sale), result.sale.updatedAt]);
    }
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
      const result = await client.query("SELECT l.vehicle_id, e.payload->>'kind' AS kind, e.payload#>>'{reservation,status}' AS reservation_status FROM leads l JOIN lead_events e ON e.lead_id = l.id WHERE l.dealer_id = $1 AND l.id = $2::uuid AND e.payload->>'kind' IN ('online_reservation','online_stripe_reservation')", [this.dealerId, draft.sourceReservationId]);
      const reservation = result.rows[0];
      if (!reservation || reservation.vehicle_id !== draft.vehicleId) throw new SaleWorkspaceError('The reservation belongs to another vehicle or could not be found.', 409);
      if (reservation.kind === 'online_stripe_reservation' && reservation.reservation_status === 'awaiting_payment') throw new SaleWorkspaceError(checkoutInProgress, 409);
      const duplicate = await client.query("SELECT state FROM sale_workspace WHERE dealer_id = $1 AND state#>>'{draft,sourceReservationId}' = $2", [this.dealerId, draft.sourceReservationId]);
      if (duplicate.rows.some(row => row.state.id !== currentId)) throw new SaleWorkspaceError('A sale already exists for this reservation. Open its saved sale file.', 409);
    }
  }
  private async stock(record: SaleWorkspaceRecord, status: 'reserved' | 'sold' | 'released', client: SaleWorkspaceReadClient, actor: string, previous?: SaleWorkspaceRecord) {
    const vehicleId = record.draft.vehicleId;
    if (!currentStockId.test(vehicleId)) throw new SaleWorkspaceError('Choose a current stock vehicle before changing availability.');
    const vehicle = await lockSaleVehicle(this.dealerId, vehicleId, client);
    if (!vehicle) throw new SaleWorkspaceError('Vehicle not found.', 404);
    if (vehicle.audit_metadata?.onlineStripeReservationId) throw new SaleWorkspaceError(checkoutInProgress, 409);
    const owner = vehicle.audit_metadata?.saleWorkspaceId;
    if (status === 'released') {
      if (record.draft.sourceReservationId) {
        const stripe = (await client.query("SELECT e.payload->'reservation' AS reservation FROM lead_events e JOIN leads l ON l.id=e.lead_id WHERE l.dealer_id=$1 AND l.id=$2::uuid AND e.payload->>'kind'='online_stripe_reservation' FOR UPDATE OF e", [this.dealerId, record.draft.sourceReservationId])).rows[0]?.reservation;
        if (!stripe) throw new SaleWorkspaceError('Cancel the linked customer reservation before releasing this sale reservation.', 409);
        if (stripe.paymentStatus !== 'refunded' || stripe.amountRefundedPence !== stripe.amountReceivedPence || stripe.amountReceivedPence <= 0 || record.payments.filter(p => p.status === 'confirmed').reduce((sum, p) => sum + p.signedAmountPence, 0) !== 0) throw new SaleWorkspaceError('The linked Stripe deposit and any further payments must be refunded before releasing this vehicle.', 409);
      }
      if (vehicle.inventory_status !== 'reserved' || owner !== record.id) throw new SaleWorkspaceError('This vehicle is no longer reserved by this sale.', 409);
    } else {
      const ownership = await saleVehicleOwnership(this.dealerId, previous ?? record, vehicle, client);
      if (ownership.conflict) throw new SaleVehicleConflictError();
      if (vehicle.inventory_status !== 'available' && !(vehicle.inventory_status === 'reserved' && ownership.ownReservation) && !(status === 'sold' && vehicle.inventory_status === 'sold' && ownership.ownSold)) throw new SaleWorkspaceError('This vehicle is not available for this sale.', 409);
      if (status === 'reserved' && vehicle.source_status === 'missing') throw new SaleWorkspaceError('This vehicle is missing from the current stock feed. Review it before reserving.', 409);
    }
    const metadata = { ...(vehicle.audit_metadata ?? {}), saleWorkspaceId: status === 'released' ? null : record.id, saleWorkspaceStatus: status, saleWorkspaceActor: actor, saleWorkspaceChangedAt: record.updatedAt };
    await client.query('UPDATE vehicles SET inventory_status = $3::inventory_status, audit_metadata = $4::jsonb, updated_at = $5 WHERE dealer_id = $1 AND id = $2::uuid', [this.dealerId, vehicleId, status === 'released' ? 'available' : status, JSON.stringify(metadata), record.updatedAt]);
    if (record.draft.sourceReservationId || record.draft.sourceEnquiryId) await client.query(`UPDATE leads SET stage = $3::lead_stage, updated_at = $4 WHERE dealer_id = $1 AND ${record.draft.sourceReservationId ? 'id' : 'enquiry_id'} = $2::uuid`, [this.dealerId, record.draft.sourceReservationId || record.draft.sourceEnquiryId, status === 'sold' ? 'collected' : status === 'released' ? 'qualifying' : 'reserved', record.updatedAt]);
    if (status === 'sold' && vehicle.inventory_status !== 'sold') await createSoldVehicleFollowUps(client, this.dealerId, record, actor);
  }
  async mutate(input: { id?: string; requestId: string; expectedRevision?: number; draft?: unknown; command?: SaleWorkspaceCommand; actor: string; actorId?: string; requireInvoiceVehicleReview?: boolean }): Promise<SaleWorkspaceMutation> {
    if (input.command?.action === 'provider-refund-correction') throw new SaleWorkspaceError('Provider refund corrections require a verified payment event.', 403);
    const command = input.command;
    const issuesInvoice = command?.action === 'issue-invoice' || command?.action === 'complete-sale' || command?.action === 'document' && command.type === 'invoice';
    // Stock media is optional and can take several seconds to download. Only
    // bind prepared bytes after the existing locked sale revision check.
    const preparedPhotos = issuesInvoice && input.id && currentStockId.test(input.id) && typeof input.expectedRevision === 'number' &&
      Number.isSafeInteger(input.expectedRevision) && typeof input.requestId === 'string' &&
      (!input.requireInvoiceVehicleReview || command.vehicleReview !== undefined)
      ? await this.prepareInvoicePhotos(input.id,input.expectedRevision,input.requestId) : undefined;
    const client = await this.database.connect();
    try {
      await client.query('BEGIN');
      // Serialise numbering and create retry checks for this dealer; row locks protect each file too.
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`sale-workspace:${this.dealerId}`]);
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
          await client.query('COMMIT');
          return { sale: staffSaleWorkspace(sale), replayed: true };
        }
      }
      let resolvedCommand = input.command;
      if (resolvedCommand?.action === 'team' && current) {
        const { ownerId } = resolvedCommand;
        let ownerName = '';
        if (ownerId !== null && (typeof ownerId !== 'string' || !ownerId.trim() || ownerId.length > 150)) throw new SaleWorkspaceError('Choose a staff member from this dealership.');
        if (ownerId && !Object.hasOwn(current.requests ?? {}, input.requestId)) {
          if (ownerId === current.team?.ownerId) ownerName = current.team.ownerName;
          else if (ownerId === input.actorId) ownerName = input.actor;
          else {
            const member = (await client.query('SELECT name, email FROM portal_users WHERE dealer_id=$1 AND auth_user_id=$2 AND disabled_at IS NULL FOR SHARE', [this.dealerId, ownerId])).rows[0];
            if (!member) throw new SaleWorkspaceError('Choose a staff member from this dealership.');
            ownerName = member.name || member.email || 'Staff member';
          }
        }
        resolvedCommand = { ...resolvedCommand, ownerName };
      }
      await client.query('INSERT INTO sale_workspace_counters (dealer_id, numbers) VALUES ($1, $2::jsonb) ON CONFLICT DO NOTHING', [this.dealerId, '{}']);
      const counter = await client.query('SELECT numbers FROM sale_workspace_counters WHERE dealer_id = $1 FOR UPDATE', [this.dealerId]);
      const numbers = counter.rows[0].numbers as Record<string, number>;
      const now = new Date().toISOString();
      const draft = input.command?.action === 'update' ? input.command.draft : current?.draft ?? input.draft as SaleWorkspaceDraft;
      const assets = await this.assets(draft, client);
      if (issuesInvoice && assets.vehicle?.id && assets.vehicle.id === draft.vehicleId) {
        assets.vehicle = { ...assets.vehicle, invoicePhotoDataUrls:preparedPhotos?.vehicleId === assets.vehicle.id ? preparedPhotos.dataUrls : [] };
      }
      const context: SaleWorkspaceContext = { now, actor: input.actor, actorId: input.actorId, requireInvoiceVehicleReview:input.requireInvoiceVehicleReview, nextId: randomUUID, nextNumber: type => saleWorkspaceNumber(numbers, type, now, assets.branding.invoiceSettings), ...assets };
      const mutation = current
        ? changeSaleWorkspace(current, resolvedCommand!, { expectedRevision: input.expectedRevision!, requestId: input.requestId }, context)
        : createSaleWorkspace({ draft: input.draft, requestId: input.requestId }, context, saleWorkspaceNumber(numbers, 'sale', now, assets.branding.invoiceSettings));
      if (!mutation.replayed) {
        const command = input.command;
        if (command && (['issue-invoice', 'finish-invoice-sale', 'complete-sale', 'handover'].includes(command.action) || command.action === 'document' && command.type === 'invoice' || command.action === 'lifecycle' && command.status === 'sold')) assertSaleFinancialIntegrity(mutation.sale);
        if (!current || input.command?.action === 'update') await this.source(mutation.sale.draft, client, current?.id);

        const recordsPayment = command?.action === 'payment' || command?.action === 'invoice-payment' || command?.action === 'confirm';
        const reservesCar = command?.action === 'take-deposit'
          || command?.action === 'invoice-payment' && command.payment.kind === 'deposit'
          || command?.action === 'confirm' && command.reserveVehicle
          || recordsPayment && mutation.sale.lifecycle?.status === 'reserved' && current?.lifecycle?.status !== 'reserved';
        if (reservesCar) await this.stock(mutation.sale, 'reserved', client, input.actor);
        else if (current && (recordsPayment || command?.action === 'issue-invoice' || command?.action === 'document' && command.type === 'invoice')) {
          await requireSaleVehiclePaymentAccess(this.dealerId, current, client, command?.action === 'invoice-payment' && command.stockConflictReconciliation !== undefined);
        }
        if (input.command?.action === 'finish-invoice-sale') await this.stock(mutation.sale, 'sold', client, input.actor, current);
        if (input.command?.action === 'lifecycle') await this.stock(mutation.sale, input.command.status, client, input.actor, current);
        if (input.command?.action === 'complete-sale') await this.stock(mutation.sale, 'sold', client, input.actor, current);
        if (input.command?.action === 'handover') {
          await requireSaleVehiclePaymentAccess(this.dealerId, current!, client);
          if (mutation.sale.lifecycle?.status !== 'sold') mutation.sale.lifecycle = { status: 'sold', vehicleId: mutation.sale.draft.vehicleId, changedAt: mutation.sale.completedAt ?? now };
        }
        if (current && mutation.document?.snapshot.vehicle?.invoiceReview) {
          const stock = await readSaleInvoiceVehicleStock(client,this.dealerId,current.draft.vehicleId);
          if (current.invoiceVehicleReview?.stockIdentity !== saleInvoiceStockIdentity(stock)) {
            throw new SaleWorkspaceError('The stock vehicle details changed. Check the vehicle again before issuing this invoice.',409);
          }
        }
        for (const document of mutation.sale.documents.filter(d => !current?.documents.some(old => old.id === d.id))) {
          document.snapshot.branding = await embedInvoiceLogoAsset(document.snapshot.branding, this.dealerId, client, siteOrigin());
          if (document.type === 'invoice') attachInvoiceVerification(document, mutation.sale.id, siteOrigin());
          (mutation.sale.documentArchives ??= {})[document.id] = archiveSaleDocument(document);
        }
        if (current) await revokeChangedDeliveryEvidence(client,{dealerId:this.dealerId,saleId:current.id,before:current,after:mutation.sale,actor:input.actor});
        await client.query('INSERT INTO sale_workspace (id, dealer_id, reference, revision, state, created_at, updated_at) VALUES ($1::uuid, $2, $3, $4, $5::jsonb, $6, $7) ON CONFLICT (id) DO UPDATE SET revision = EXCLUDED.revision, state = EXCLUDED.state, updated_at = EXCLUDED.updated_at', [mutation.sale.id, this.dealerId, mutation.sale.reference, mutation.sale.revision, JSON.stringify(mutation.sale), mutation.sale.createdAt, mutation.sale.updatedAt]);
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
  await revokeChangedDeliveryEvidence(client,{dealerId:input.dealerId,saleId:current.id,before:current,after:mutation.sale,actor:context.actor});
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
    await revokeChangedDeliveryEvidence(client,{dealerId:input.dealerId,saleId:current.id,before:current,after:current,actor:'Stripe verified refund'});
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
  await revokeChangedDeliveryEvidence(client,{dealerId:input.dealerId,saleId:current.id,before:current,after:mutation.sale,actor:context.actor});
  await client.query('UPDATE sale_workspace SET revision = $3, state = $4::jsonb, updated_at = $5 WHERE dealer_id = $1 AND id = $2::uuid', [input.dealerId, current.id, mutation.sale.revision, JSON.stringify(mutation.sale), now]);
  await client.query('UPDATE sale_workspace_counters SET numbers = $2::jsonb WHERE dealer_id = $1', [input.dealerId, JSON.stringify(numbers)]);
  return publicSaleWorkspace(mutation.sale);
}
