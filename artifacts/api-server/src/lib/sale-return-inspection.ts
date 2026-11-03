import { createHash, randomUUID } from 'node:crypto';
import { SaleWorkspaceError, publicSaleWorkspace, type SaleWorkspaceRecord } from '@workspace/vehicle-meta';
import type { SaleWorkspaceDatabase } from './sale-workspace-store';

const uuid = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(value);
export type SaleReturnInspectionInput = { expectedRevision: unknown; requestId: unknown; confirm: unknown; note: unknown };

/** Explicit staff attestation. Does not inspect a vehicle automatically or send anything. */
export async function completeSaleReturnInspection(database: SaleWorkspaceDatabase, dealerId: string, saleId: string, input: SaleReturnInspectionInput, actor: string) {
  if (!uuid(saleId)) throw new SaleWorkspaceError('Sale not found.', 404);
  if (!uuid(input.requestId) || !Number.isSafeInteger(input.expectedRevision) || Number(input.expectedRevision) < 0) throw new SaleWorkspaceError('Reload the returned sale before continuing.');
  if (input.confirm !== true) throw new SaleWorkspaceError('Confirm that the returned vehicle has been inspected and is ready to advertise.');
  if (typeof input.note !== 'string' || !input.note.trim() || input.note.length > 1200) throw new SaleWorkspaceError('Add an inspection note of up to 1,200 characters.');
  const note = input.note.trim();
  const fingerprint = createHash('sha256').update(JSON.stringify({ saleId, expectedRevision: input.expectedRevision, confirm: true, note })).digest('hex');
  const key = `return-inspection:${input.requestId}`;
  const client = await database.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`sale-workspace:${dealerId}`]);
    const sale = (await client.query('SELECT state FROM sale_workspace WHERE dealer_id=$1 AND id=$2::uuid FOR UPDATE', [dealerId, saleId])).rows[0]?.state as SaleWorkspaceRecord | undefined;
    if (!sale) throw new SaleWorkspaceError('Sale not found.', 404);
    const prior = sale.requests?.[key];
    if (prior) {
      if (prior.fingerprint !== fingerprint || !sale.returnInspection) throw new SaleWorkspaceError('This request reference was already used for different inspection details.', 409);
      await client.query('COMMIT');
      return { sale: publicSaleWorkspace(sale), replayed: true };
    }
    if (sale.revision !== input.expectedRevision) throw new SaleWorkspaceError('This returned sale changed. Reload it before continuing.', 409);
    if (sale.lifecycle?.status !== 'returned' || sale.returnReplacement?.direction !== 'returned' || sale.returnInspection) throw new SaleWorkspaceError('This sale has no returned vehicle awaiting inspection.', 409);
    const vehicleId = sale.draft.vehicleId;
    if (!uuid(vehicleId)) throw new SaleWorkspaceError('The returned vehicle could not be identified.', 409);
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`sale-vehicle:${vehicleId}`]);
    const car = (await client.query('SELECT inventory_status,source_status,missing_count,archived_at,retirement_started_at,audit_metadata FROM vehicles WHERE dealer_id=$1 AND id=$2::uuid FOR UPDATE', [dealerId, vehicleId])).rows[0];
    if (!car || car.inventory_status !== 'hidden' || car.audit_metadata?.returnInspectionPending !== true || car.audit_metadata?.returnedFromSaleId !== sale.id || car.audit_metadata?.saleWorkspaceId) throw new SaleWorkspaceError('The returned vehicle availability or ownership changed. Review its vehicle file before continuing.', 409);
    if (car.source_status !== 'live' || Number(car.missing_count ?? 0) !== 0) throw new SaleWorkspaceError('This vehicle is no longer present in the current stock feed. Restore its current listing with the stock provider before making it available.', 409);
    const retentionArchive = car.audit_metadata?.retentionArchive;
    const archiveTime = car.archived_at ? new Date(car.archived_at).getTime() : NaN;
    const recordedArchiveTime = typeof retentionArchive?.archivedAt === 'string' ? Date.parse(retentionArchive.archivedAt) : NaN;
    // Only our exact previous-sale retention archive can be restored here. A
    // later manual archive cannot borrow an older retention marker to reopen.
    const restoreSoldListing = Boolean(car.archived_at && retentionArchive?.reason === 'sold' && retentionArchive?.originalInventoryStatus === 'sold' && Number.isFinite(archiveTime) && archiveTime === recordedArchiveTime);
    if (car.archived_at && !restoreSoldListing) throw new SaleWorkspaceError('This listing was archived outside the previous sale retention process. Review and restore it with the stock provider before making it available.', 409);
    const competing = (await client.query("SELECT id FROM sale_workspace WHERE dealer_id=$1 AND id<>$2::uuid AND state#>>'{draft,vehicleId}'=$3 AND state#>>'{lifecycle,status}' IN ('reserved','sold')", [dealerId, saleId, vehicleId])).rows;
    const competingLeads = (await client.query("SELECT id FROM leads WHERE dealer_id=$1 AND vehicle_id=$2::uuid AND stage IN ('reserved','sale_agreed','collected') AND ($3::uuid IS NULL OR id<>$3::uuid) AND ($4::uuid IS NULL OR enquiry_id IS DISTINCT FROM $4::uuid)", [dealerId, vehicleId, sale.draft.sourceReservationId || null, sale.draft.sourceEnquiryId || null])).rows;
    if (competing.length || competingLeads.length) throw new SaleWorkspaceError('Another sale or customer reservation is linked to this vehicle. Resolve it before making the vehicle available.', 409);
    const now = new Date().toISOString();
    sale.returnInspection = { at: now, actor, note };
    sale.revision++;
    sale.updatedAt = now;
    sale.events.push({ id: randomUUID(), type: 'return-inspection', description: 'Returned vehicle inspection recorded; vehicle made available.', occurredAt: now, actor });
    (sale.requests ??= {})[key] = { fingerprint };
    await client.query("UPDATE vehicles SET inventory_status='available',audit_metadata=$3::jsonb,updated_at=$4,archived_at=CASE WHEN $5::boolean THEN NULL ELSE archived_at END,retirement_started_at=CASE WHEN $5::boolean THEN NULL ELSE retirement_started_at END WHERE dealer_id=$1 AND id=$2::uuid", [dealerId, vehicleId, JSON.stringify({ ...car.audit_metadata, returnInspectionPending: false, returnInspectedAt: now, returnInspectedBy: actor, ...(restoreSoldListing ? { returnListingRestored: { at: now, actor } } : {}) }), now, restoreSoldListing]);
    // Only the original deal's exact linked lead is released. Buyer history and
    // unrelated enquiries, contacts and cancelled appointments remain intact.
    if (sale.draft.sourceReservationId || sale.draft.sourceEnquiryId) {
      const closed = (await client.query("UPDATE leads SET stage='lost',outcome='lost',outcome_reason='Vehicle returned and replaced under the linked sale.',closed_at=$5,next_action=NULL,next_action_due_at=NULL,updated_at=$5 WHERE dealer_id=$1 AND vehicle_id=$2::uuid AND stage IN ('reserved','sale_agreed','collected') AND (($3::uuid IS NOT NULL AND id=$3::uuid) OR ($4::uuid IS NOT NULL AND enquiry_id=$4::uuid)) RETURNING id", [dealerId, vehicleId, sale.draft.sourceReservationId || null, sale.draft.sourceEnquiryId || null, now])).rows;
      for (const lead of closed) await client.query("INSERT INTO lead_events(id,lead_id,type,actor_type,actor,body,payload,occurred_at) VALUES($1::uuid,$2::uuid,'outcome_recorded','staff',$3,'Original vehicle returned and replaced; original lead closed.',$4::jsonb,$5)", [randomUUID(), lead.id, actor, JSON.stringify({ kind: 'return_inspection', saleId, outcome: 'lost' }), now]);
    }
    await client.query("UPDATE sold_vehicle_follow_ups SET status='not_needed',outcome='not_needed',note=concat_ws(E'\\n',nullif(note,''),'Vehicle returned and replaced; original sold follow-up no longer applies.'),revision=revision+1,updated_by=$4,updated_at=$5 WHERE dealer_id=$1 AND sale_id=$2::uuid AND vehicle_id=$3::uuid AND status='pending'", [dealerId, saleId, vehicleId, actor, now]);
    await client.query('UPDATE sale_workspace SET revision=$3,state=$4::jsonb,updated_at=$5 WHERE dealer_id=$1 AND id=$2::uuid', [dealerId, saleId, sale.revision, JSON.stringify(sale), now]);
    await client.query('COMMIT');
    return { sale: publicSaleWorkspace(sale), replayed: false };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally { client.release(); }
}
