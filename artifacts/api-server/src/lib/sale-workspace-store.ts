import { createHash, randomUUID } from 'node:crypto';
import { archiveSaleDocument } from './sale-document-pdf';
import { customerSaleView, customerSaleDocument } from '@workspace/vehicle-meta';
import { changeSaleWorkspace, createSaleWorkspace, publicSaleWorkspace, saleWorkspaceBranding, saleWorkspaceFingerprint, saleWorkspaceNumber, SaleWorkspaceError, type SaleWorkspaceBranding, type SaleWorkspaceCommand, type SaleWorkspaceContext, type SaleWorkspaceDraft, type SaleWorkspaceMutation, type SaleWorkspaceRecord, type SaleWorkspaceVehicleSnapshot } from '@workspace/vehicle-meta';

export type SaleWorkspaceAssets = { branding: SaleWorkspaceBranding; vehicle?: SaleWorkspaceVehicleSnapshot };
export type SaleWorkspaceReadClient = { query: (text: string, parameters?: any[]) => Promise<{ rows: Record<string, any>[] }> };
export type SaleWorkspaceTransactionClient = SaleWorkspaceReadClient & { release: () => void };
export type SaleWorkspaceDatabase = SaleWorkspaceReadClient & { connect: () => Promise<SaleWorkspaceTransactionClient> };

/** Use the already-held transaction client; never acquire another pool connection while holding the dealer lock. */
export async function readSaleWorkspaceAssets(draft: SaleWorkspaceDraft, dealerId: string, client: SaleWorkspaceReadClient): Promise<SaleWorkspaceAssets> {
  const settings = await client.query('SELECT config FROM dealer_settings WHERE dealer_id = $1', [dealerId]);
  const validVehicleId = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(draft?.vehicleId ?? '');
  const vehicle = validVehicleId
    ? (await client.query("SELECT id, coalesce(website_title_override, title, '') AS title, year, fuel, transmission, mileage FROM vehicles WHERE dealer_id = $1 AND id = $2::uuid", [dealerId, draft.vehicleId])).rows[0]
    : undefined;
  return { branding: saleWorkspaceBranding(settings.rows[0]?.config), ...(vehicle ? { vehicle: { id: vehicle.id, title: vehicle.title, year: vehicle.year, fuel: vehicle.fuel, transmission: vehicle.transmission, mileage: vehicle.mileage } } : {}) };
}

export class PostgresSaleWorkspaceStore {
  constructor(private dealerId: string, private assets: (draft: SaleWorkspaceDraft, client: SaleWorkspaceReadClient) => Promise<SaleWorkspaceAssets>, private database: SaleWorkspaceDatabase) {}
  async list(): Promise<SaleWorkspaceRecord[]> {
    const result = await this.database.query('SELECT state FROM sale_workspace WHERE dealer_id = $1 ORDER BY updated_at DESC', [this.dealerId]);
    return result.rows.map(row => publicSaleWorkspace(row.state));
  }
  async get(id: string): Promise<SaleWorkspaceRecord> {
    const result = await this.database.query('SELECT state FROM sale_workspace WHERE dealer_id = $1 AND id = $2::uuid', [this.dealerId, id]);
    if (!result.rows[0]) throw new SaleWorkspaceError('Sale not found.', 404);
    return publicSaleWorkspace(result.rows[0].state);
  }
  /** Provider acceptance is merged under a row lock; concurrent payments cannot strand it as sending. */
  async finishEmail(id: string, requestId: string, command: Extract<SaleWorkspaceCommand, { action: 'email-status' | 'link-email-status' }>, actor: string) {
    const client = await this.database.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`sale-workspace:${this.dealerId}`]);
      const current = (await client.query('SELECT state FROM sale_workspace WHERE dealer_id = $1 AND id = $2::uuid FOR UPDATE', [this.dealerId, id])).rows[0]?.state as SaleWorkspaceRecord | undefined;
      if (!current) throw new SaleWorkspaceError('Sale not found.', 404);
      const context: SaleWorkspaceContext = { now: new Date().toISOString(), actor, nextId: randomUUID, nextNumber: () => { throw new Error('Email finalization cannot issue documents'); }, ...await this.assets(current.draft, client) };
      const result = changeSaleWorkspace(current, command, { requestId, expectedRevision: current.revision }, context);
      if (!result.replayed) await client.query('UPDATE sale_workspace SET revision = $3, state = $4::jsonb, updated_at = $5 WHERE dealer_id = $1 AND id = $2::uuid', [this.dealerId, id, result.sale.revision, JSON.stringify(result.sale), result.sale.updatedAt]);
      await client.query('COMMIT'); return { ...result, sale: publicSaleWorkspace(result.sale) };
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
  }
  async customer(token: string) {
    if (!/^[a-f0-9]{64}$/.test(token)) throw new SaleWorkspaceError('This customer link is unavailable or has expired.', 404);
    const hash = createHash('sha256').update(token).digest('hex');
    const result = await this.database.query("SELECT state FROM sale_workspace WHERE dealer_id = $1 AND state#>>'{customerAccess,tokenHash}' = $2", [this.dealerId, hash]);
    const record = result.rows[0]?.state as SaleWorkspaceRecord | undefined;
    if (!record?.customerAccess || record.customerAccess.revokedAt || Date.parse(record.customerAccess.expiresAt) <= Date.now()) throw new SaleWorkspaceError('This customer link is unavailable or has expired.', 404);
    const assets = await this.assets(record.draft, this.database);
    if (record.draft.sourceEnquiryId) {
      const appointment = await this.database.query('SELECT appointment_at, appointment_status, appointment_cancelled_at FROM enquiries WHERE dealer_id = $1 AND id = $2::uuid', [this.dealerId, record.draft.sourceEnquiryId]);
      const e = appointment.rows[0];
      if (e?.appointment_at && !e.appointment_cancelled_at) record.draft.appointment = { at: new Date(e.appointment_at).toISOString(), status: e.appointment_status ?? 'confirmed' }; else delete record.draft.appointment;
    }
    return { record, view: customerSaleView(record, assets.branding) };
  }
  async customerDocument(token: string, documentId: string) {
    const { record } = await this.customer(token);
    const document = record.documents.find(d => d.id === documentId);
    if (!document || document.snapshot.draft.customer !== record.draft.customer || document.snapshot.draft.email !== record.draft.email) throw new SaleWorkspaceError('Document not found.', 404);
    return customerSaleDocument(document);
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
      if (duplicate.rows.some(row => row.state.id !== currentId)) throw new SaleWorkspaceError('A sale already exists for this enquiry. Open its saved sale file.', 409);
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
  }
  async mutate(input: { id?: string; requestId: string; expectedRevision?: number; draft?: unknown; command?: SaleWorkspaceCommand; actor: string }): Promise<SaleWorkspaceMutation> {
    if (input.command?.action === 'provider-refund-correction') throw new SaleWorkspaceError('Provider refund corrections require a verified payment event.', 403);
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
      } else {
        const replay = await client.query("SELECT state FROM sale_workspace WHERE dealer_id = $1 AND state->'requests' ? $2 FOR UPDATE", [this.dealerId, input.requestId]);
        if (replay.rows[0]) {
          const sale = replay.rows[0].state as SaleWorkspaceRecord;
          if (sale.requests?.[input.requestId]?.fingerprint !== saleWorkspaceFingerprint({ action: 'create', draft: input.draft })) throw new SaleWorkspaceError('This request reference has already been used for different details.', 409);
          await client.query('COMMIT');
          return { sale: publicSaleWorkspace(sale), replayed: true };
        }
      }
      await client.query('INSERT INTO sale_workspace_counters (dealer_id, numbers) VALUES ($1, $2::jsonb) ON CONFLICT DO NOTHING', [this.dealerId, '{}']);
      const counter = await client.query('SELECT numbers FROM sale_workspace_counters WHERE dealer_id = $1 FOR UPDATE', [this.dealerId]);
      const numbers = counter.rows[0].numbers as Record<string, number>;
      const now = new Date().toISOString();
      const draft = input.command?.action === 'update' ? input.command.draft : current?.draft ?? input.draft as SaleWorkspaceDraft;
      const assets = await this.assets(draft, client);
      const context: SaleWorkspaceContext = { now, actor: input.actor, nextId: randomUUID, nextNumber: type => saleWorkspaceNumber(numbers, type, now), ...assets };
      const mutation = current
        ? changeSaleWorkspace(current, input.command!, { expectedRevision: input.expectedRevision!, requestId: input.requestId }, context)
        : createSaleWorkspace({ draft: input.draft, requestId: input.requestId }, context, saleWorkspaceNumber(numbers, 'sale', now));
      if (!mutation.replayed) {
        if (!current || input.command?.action === 'update') await this.source(mutation.sale.draft, client, current?.id);
        if (input.command?.action === 'customer-link') {
          const collision = await client.query("SELECT id FROM sale_workspace WHERE dealer_id = $1 AND id <> $2::uuid AND state#>>'{customerAccess,tokenHash}' = $3", [this.dealerId, mutation.sale.id, input.command.tokenHash]);
          if (collision.rows.length) throw new SaleWorkspaceError('Create a new unique customer link.', 409);
        }
        if (input.command?.action === 'lifecycle') await this.stock(mutation.sale, input.command.status, client, input.actor);
        if (input.command?.action === 'handover') {
          await this.stock(mutation.sale, 'sold', client, input.actor);
          mutation.sale.lifecycle = { status: 'sold', vehicleId: mutation.sale.draft.vehicleId, changedAt: now };
        }
        if (mutation.document) (mutation.sale.documentArchives ??= {})[mutation.document.id] = archiveSaleDocument(mutation.document);
        await client.query('INSERT INTO sale_workspace (id, dealer_id, reference, revision, state, created_at, updated_at) VALUES ($1::uuid, $2, $3, $4, $5::jsonb, $6, $7) ON CONFLICT (id) DO UPDATE SET revision = EXCLUDED.revision, state = EXCLUDED.state, updated_at = EXCLUDED.updated_at', [mutation.sale.id, this.dealerId, mutation.sale.reference, mutation.sale.revision, JSON.stringify(mutation.sale), mutation.sale.createdAt, mutation.sale.updatedAt]);
        await client.query('UPDATE sale_workspace_counters SET numbers = $2::jsonb WHERE dealer_id = $1', [this.dealerId, JSON.stringify(numbers)]);
      }
      await client.query('COMMIT');
      return { ...mutation, sale: publicSaleWorkspace(mutation.sale) };
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
  const context: SaleWorkspaceContext = { now, actor: 'Stripe verified payment', nextId: randomUUID, nextNumber: type => saleWorkspaceNumber(numbers, type, now), ...await readSaleWorkspaceAssets(draft, input.dealerId, client) };
  current ??= createSaleWorkspace({ draft, requestId: 'stripe-create-' + input.paymentIntentId }, context, saleWorkspaceNumber(numbers, 'sale', now)).sale;
  const mutation = changeSaleWorkspace(current, { action: 'payment', payment: { amount: (input.amountPence / 100).toFixed(2), method: 'Stripe', date: new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(now)), reference: input.paymentIntentId, kind: 'deposit', status: 'confirmed' } }, { requestId: 'stripe-payment-' + input.paymentIntentId, expectedRevision: current.revision }, context);
  mutation.sale.lifecycle = { status: 'reserved', vehicleId: input.vehicleId, changedAt: now };
  (mutation.sale.providerPayments ??= {})[input.paymentIntentId] = { paymentId: mutation.sale.payments.at(-1)!.id, eventId: input.eventId };
  if (mutation.document) (mutation.sale.documentArchives ??= {})[mutation.document.id] = archiveSaleDocument(mutation.document);
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
  const context: SaleWorkspaceContext = { now, actor: 'Stripe verified refund', nextId: randomUUID, nextNumber: type => saleWorkspaceNumber(numbers, type, now), ...await readSaleWorkspaceAssets(current.draft, input.dealerId, client) };
  const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(now));
  const command: SaleWorkspaceCommand = difference > 0
    ? { action: 'reverse', paymentId: original.id, amount: (difference / 100).toFixed(2), kind: 'refund', reason: 'Stripe confirmed refund', date }
    : { action: 'provider-refund-correction', paymentId: original.id, amount: (-difference / 100).toFixed(2), reason: 'Stripe refund status changed: this previously recorded refund is no longer confirmed as returned. The original deposit remains received; no new payment was charged.', date };
  const mutation = changeSaleWorkspace(current, command, { expectedRevision: current.revision, requestId: 'stripe-refund-' + createHash('sha256').update(input.eventId).digest('hex') }, context);
  (mutation.sale.providerPayments![input.paymentIntentId].refundEvents ??= {})[input.eventId] = { amountRefundedPence: input.amountRefundedPence };
  if (mutation.document) (mutation.sale.documentArchives ??= {})[mutation.document.id] = archiveSaleDocument(mutation.document);
  await client.query('UPDATE sale_workspace SET revision = $3, state = $4::jsonb, updated_at = $5 WHERE dealer_id = $1 AND id = $2::uuid', [input.dealerId, current.id, mutation.sale.revision, JSON.stringify(mutation.sale), now]);
  await client.query('UPDATE sale_workspace_counters SET numbers = $2::jsonb WHERE dealer_id = $1', [input.dealerId, JSON.stringify(numbers)]);
  return publicSaleWorkspace(mutation.sale);
}
