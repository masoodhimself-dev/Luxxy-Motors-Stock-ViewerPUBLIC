// Local network sandbox only. The production entry never imports this file.
import { previewIntegrationsStore } from './dealer-integrations';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { changeSaleWorkspace, createSaleWorkspace, publicSaleWorkspace, saleWorkspaceBranding, saleWorkspaceFingerprint, saleWorkspaceNumber, SaleWorkspaceError, type SalesPaperwork, type SaleWorkspaceBranding, type SaleWorkspaceVehicleSnapshot, type SaleWorkspaceCommand, type SaleWorkspaceContext, type SaleWorkspaceDraft, type SaleWorkspaceMutation, type SaleWorkspaceRecord } from '@workspace/vehicle-meta';
import { archiveSaleDocument } from '../../api-server/src/lib/sale-document-pdf';
import { customerSaleView, customerSaleDocument } from '@workspace/vehicle-meta';
import { readPreviewSettings, readPreviewBookingState } from './reservations';
import { previewStock } from './stock';

export type PreviewSalesState = { schemaVersion: 1; sales: SaleWorkspaceRecord[]; numbers: Record<string, number> };
const defaultFilename = fileURLToPath(new URL('../../../.local/sales-workspace-preview.json', import.meta.url));
export class PreviewSaleWorkspaceStore {
  private queue: Promise<unknown> = Promise.resolve();
  constructor(private filename = defaultFilename, private assets: (draft: SaleWorkspaceDraft) => Promise<{ branding: SaleWorkspaceBranding; vehicle?: SaleWorkspaceVehicleSnapshot; paperwork?: SalesPaperwork }> = async (draft: SaleWorkspaceDraft) => {
    const settings = await readPreviewSettings();
    const vehicle = previewStock.cars.find(car => car.id === draft?.vehicleId);
    return { paperwork: await previewIntegrationsStore.readSalesPaperwork(), branding: saleWorkspaceBranding(settings), ...(vehicle ? { vehicle: { id: vehicle.id, title: vehicle.title ?? '', year: vehicle.year, fuel: vehicle.fuel, transmission: vehicle.transmission, mileage: vehicle.mileage, colour: vehicle.colour, owners: vehicle.owners, writeOffCategory: vehicle.writeOffCategory, description: typeof vehicle.sourceExtras?.description === 'string' ? vehicle.sourceExtras.description : null, serviceHistory: typeof vehicle.sourceExtras?.serviceHistory === 'string' ? vehicle.sourceExtras.serviceHistory : null } } : {}) };
  }) {}
  private serial<T>(work: () => Promise<T>): Promise<T> {
    const next = this.queue.then(work, work); this.queue = next.catch(() => {}); return next;
  }
  private async load(): Promise<PreviewSalesState> {
    try {
      const state = JSON.parse(await readFile(this.filename, 'utf8')) as PreviewSalesState;
      if (state.schemaVersion !== 1 || !Array.isArray(state.sales) || !state.numbers) throw new Error('Invalid local sales store');
      return state;
    } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { schemaVersion: 1, sales: [], numbers: {} }; throw error; }
  }
  private async save(state: PreviewSalesState) {
    await mkdir(dirname(this.filename), { recursive: true });
    const temporary = `${this.filename}.${randomUUID()}.tmp`;
    await writeFile(temporary, JSON.stringify(state, null, 2), { mode: 0o600 });
    await rename(temporary, this.filename);
  }
  async list() { return this.serial(async () => (await this.load()).sales.map(publicSaleWorkspace).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))); }
  async get(id: string) {
    return this.serial(async () => { const sale = (await this.load()).sales.find(item => item.id === id); if (!sale) throw new SaleWorkspaceError('Sale not found.', 404); return publicSaleWorkspace(sale); });
  }
  async releaseReservation(reservationId: string) {
    return this.serial(async () => {
      const state = await this.load(); const connected = state.sales.filter(s => s.draft.sourceReservationId === reservationId);
      if (connected.some(s => s.lifecycle?.status === 'sold')) throw new SaleWorkspaceError('This reservation belongs to a sold vehicle. Review its sale file.', 409);
      let changed = false;
      for (const s of connected) if (s.lifecycle?.status === 'reserved') {
        const now = new Date().toISOString(); s.lifecycle = { ...s.lifecycle, status: 'released', changedAt: now }; s.revision++; s.updatedAt = now;
        s.events.push({ id: randomUUID(), type: 'reservation-cancelled', description: 'Linked online reservation cancelled; car released', actor: 'Showroom staff', occurredAt: now }); changed = true;
      }
      if (changed) await this.save(state);
    });
  }
  async inventory() { return this.serial(async () => Object.fromEntries((await this.load()).sales.filter(s => s.lifecycle && ['reserved', 'sold'].includes(s.lifecycle.status)).map(s => [s.draft.vehicleId, s.lifecycle!.status])) as Record<string, 'reserved' | 'sold'>); }
  async customer(token: string) {
    return this.serial(async () => {
      if (!/^[a-f0-9]{64}$/.test(token)) throw new SaleWorkspaceError('This customer link is unavailable or has expired.', 404);
      const hash = createHash('sha256').update(token).digest('hex');
      const record = (await this.load()).sales.find(s => s.customerAccess?.tokenHash === hash);
      if (!record?.customerAccess || record.customerAccess.revokedAt || Date.parse(record.customerAccess.expiresAt) <= Date.now()) throw new SaleWorkspaceError('This customer link is unavailable or has expired.', 404);
      const { branding } = await this.assets(record.draft);
      if (record.draft.sourceEnquiryId) {
        const enquiry = (await readPreviewBookingState()).enquiries?.find(e => e.id === record.draft.sourceEnquiryId);
        if (enquiry?.appointmentAt && !enquiry.appointmentCancelledAt) record.draft.appointment = { at: enquiry.appointmentAt, status: enquiry.appointmentStatus ?? 'confirmed' }; else delete record.draft.appointment;
      }
      return { record, view: customerSaleView(record, branding) };
    });
  }
  async pdf(id: string, documentId: string) { return this.serial(async () => {
    const record = (await this.load()).sales.find(s => s.id === id);
    const document = record?.documents.find(d => d.id === documentId);
    if (!document) throw new SaleWorkspaceError('Document not found.', 404);
    return { document, archive: record?.documentArchives?.[documentId] ?? archiveSaleDocument(document) };
  }); }
  async mutate(input: { id?: string; requestId: string; expectedRevision?: number; draft?: unknown; command?: SaleWorkspaceCommand; actor?: string }): Promise<SaleWorkspaceMutation> {
    if (input.command?.action === 'provider-refund-correction') throw new SaleWorkspaceError('Provider refund corrections require a verified payment event.', 403);
    return this.serial(async () => {
      const state = await this.load();
      const current = input.id ? state.sales.find(sale => sale.id === input.id) : undefined;
      if (input.id && !current) throw new SaleWorkspaceError('Sale not found.', 404);
      if (!input.id) {
        const existing = state.sales.find(sale => sale.requests?.[input.requestId]);
        if (existing) {
          if (existing.requests?.[input.requestId]?.fingerprint !== saleWorkspaceFingerprint({ action: 'create', draft: input.draft })) throw new SaleWorkspaceError('This request reference has already been used for different details.', 409);
          return { sale: publicSaleWorkspace(existing), replayed: true, preview: true };
        }
      }
      const now = new Date().toISOString();
      const draft = input.command?.action === 'update' ? input.command.draft : current?.draft ?? input.draft as SaleWorkspaceDraft;
      const context: SaleWorkspaceContext = { now, actor: input.actor ?? 'Showroom staff', nextId: randomUUID, nextNumber: type => saleWorkspaceNumber(state.numbers, type, now), ...await this.assets(draft) };
      const mutation = current
        ? changeSaleWorkspace(current, input.command!, { expectedRevision: input.expectedRevision!, requestId: input.requestId }, context)
        : createSaleWorkspace({ draft: input.draft, requestId: input.requestId }, context, saleWorkspaceNumber(state.numbers, 'sale', now));
      if (!mutation.replayed) {
        if (input.command?.action === 'customer-link' && state.sales.some(s => s.id !== mutation.sale.id && s.customerAccess?.tokenHash === (input.command as { tokenHash: string }).tokenHash)) throw new SaleWorkspaceError('Create a new unique customer link.', 409);
        if (input.command?.action === 'lifecycle' || input.command?.action === 'handover' || input.command?.action === 'take-deposit' || input.command?.action === 'complete-sale' || input.command?.action === 'confirm' && input.command.reserveVehicle) {
          const status = input.command.action === 'take-deposit' || input.command.action === 'confirm' ? 'reserved' : input.command.action === 'handover' || input.command.action === 'complete-sale' ? 'sold' : input.command.status;
          const car = previewStock.cars.find(c => c.id === mutation.sale.draft.vehicleId);
          if (!car) throw new SaleWorkspaceError('Choose a current stock vehicle before changing availability.');
          const competing = state.sales.some(s => s.id !== mutation.sale.id && s.draft.vehicleId === car.id && ['reserved','sold'].includes(s.lifecycle?.status ?? ''));
          const booking = await readPreviewBookingState();
          const competingReservation = booking.reservations.some(r => r.vehicleId === car.id && r.status === 'reserved' && r.id !== mutation.sale.draft.sourceReservationId);
          if (status === 'released' && mutation.sale.draft.sourceReservationId && booking.reservations.some(r => r.id === mutation.sale.draft.sourceReservationId && r.status === 'reserved')) throw new SaleWorkspaceError('Cancel the linked customer reservation before releasing this sale reservation.', 409);
          if (status !== 'released' && (competing || competingReservation)) throw new SaleWorkspaceError('This vehicle is reserved or sold to another customer.', 409);
          if (status === 'reserved' && car.sourceStatus === 'missing') throw new SaleWorkspaceError('This car is missing from the current feed. Review it before reserving.', 409);
          mutation.sale.lifecycle = { status, vehicleId: car.id, changedAt: now };
        }
        if ((!current || input.command?.action === 'update') && (mutation.sale.draft.sourceEnquiryId || mutation.sale.draft.sourceReservationId)) {
          const booking = await readPreviewBookingState();
          const source = mutation.sale.draft.sourceEnquiryId ? booking.enquiries?.find(e => e.id === mutation.sale.draft.sourceEnquiryId) : booking.reservations.find(r => r.id === mutation.sale.draft.sourceReservationId);
          if (!source || source.vehicleId && source.vehicleId !== mutation.sale.draft.vehicleId) throw new SaleWorkspaceError('The source record belongs to another vehicle or could not be found.', 409);
          if ('appointmentAt' in source && source.appointmentAt && !source.appointmentCancelledAt) mutation.sale.draft.appointment = { at: source.appointmentAt, status: source.appointmentStatus ?? 'confirmed' };
          if (mutation.sale.draft.sourceEnquiryId && state.sales.some(s => s.id !== mutation.sale.id && s.draft.sourceEnquiryId === mutation.sale.draft.sourceEnquiryId)) throw new SaleWorkspaceError('A sale already exists for this enquiry.', 409);
          if (mutation.sale.draft.sourceReservationId && state.sales.some(s => s.id !== mutation.sale.id && s.draft.sourceReservationId === mutation.sale.draft.sourceReservationId)) throw new SaleWorkspaceError('A sale already exists for this reservation.', 409);
        }
        for (const document of mutation.sale.documents.filter(d => !current?.documents.some(old => old.id === d.id))) (mutation.sale.documentArchives ??= {})[document.id] = archiveSaleDocument(document);
        if (current) state.sales[state.sales.findIndex(sale => sale.id === current.id)] = mutation.sale; else state.sales.push(mutation.sale);
        await this.save(state);
      }
      return { ...mutation, sale: publicSaleWorkspace(mutation.sale), preview: true };
    });
  }
}

export const previewStore = new PreviewSaleWorkspaceStore();
export const readPreviewSaleInventory = () => previewStore.inventory();
export const releasePreviewSourceReservation = (id: string) => previewStore.releaseReservation(id);
async function body(req: IncomingMessage) {
  let data = '';
  for await (const chunk of req) { data += chunk; if (Buffer.byteLength(data) > 256_000) throw new SaleWorkspaceError('Sale request is too large.', 413); }
  try { return JSON.parse(data); } catch { throw new SaleWorkspaceError('Invalid sale request.', 400); }
}
function send(res: ServerResponse, status: number, value: unknown) { res.statusCode = status; res.setHeader('Content-Type', 'application/json'); res.setHeader('Cache-Control', 'no-store'); res.end(JSON.stringify(value)); }
function local(req: IncomingMessage) {
  const remote = (req.socket.remoteAddress ?? '').replace(/^::ffff:/, '');
  const host = new URL(`http://${req.headers.host}`).hostname;
  const loopback = ['127.0.0.1', '::1'].includes(remote) && ['127.0.0.1', 'localhost', '[::1]'].includes(host);
  const lanHost = process.env.LUXXY_PREVIEW_LAN_HOST;
  const privateIpv4 = /^(10\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[01])\.)/;
  const lan = Boolean(lanHost && privateIpv4.test(lanHost) && host === lanHost && (privateIpv4.test(remote) || remote === '127.0.0.1'));
  return (loopback || lan) && (!req.headers.origin || req.headers.origin === `http://${req.headers.host}`);
}
export async function salesPreview(req: IncomingMessage, res: ServerResponse, url: URL, store: PreviewSaleWorkspaceStore = previewStore): Promise<boolean> {
  if (!/^\/api\/(?:sale-workspace|customer-sale)(?:\/|$)/.test(url.pathname)) return false;
  if (!local(req)) { send(res, 403, { error: 'The sales service is available only on the authorised network.' }); return true; }
  try {
    const customerRoute = /^\/api\/customer-sale\/([^/]+)(?:\/documents\/([^/]+)(?:\/(pdf))?)?$/.exec(url.pathname);
    if (customerRoute && req.method === 'GET') {
      res.setHeader('Referrer-Policy', 'no-referrer'); res.setHeader('X-Robots-Tag', 'noindex, nofollow');
      const { record, view } = await store.customer(customerRoute[1]);
      if (!customerRoute[2]) send(res, 200, { sale: view });
      else {
        const { document, archive } = await store.pdf(record.id, customerRoute[2]);
        if (document.snapshot.draft.customer !== record.draft.customer || document.snapshot.draft.email !== record.draft.email) throw new SaleWorkspaceError('Document not found.', 404);
        if (customerRoute[3]) { res.setHeader('Content-Type', 'application/pdf'); res.setHeader('Cache-Control', 'no-store'); res.setHeader('Content-Disposition', `attachment; filename="${document.number}.pdf"`); res.end(Buffer.from(archive.content, 'base64')); }
        else send(res, 200, { document: customerSaleDocument(document) });
      }
      return true;
    }
    const extra = /^\/api\/sale-workspace\/([^/]+)\/(lifecycle|customer-links|documents)(?:\/([^/]+))?(?:\/(pdf|email))?$/.exec(url.pathname);
    if (extra && (extra[2] !== 'documents' || extra[3])) {
      const [, saleId, section, item, action] = extra;
      if (section === 'documents' && action === 'pdf' && req.method === 'GET') {
        const { document, archive } = await store.pdf(saleId, item);
        res.setHeader('Content-Type', 'application/pdf'); res.setHeader('Cache-Control', 'no-store'); res.setHeader('Content-Disposition', `attachment; filename="${document.number}.pdf"`); res.end(Buffer.from(archive.content, 'base64')); return true;
      }
      if (req.method !== 'POST') throw new SaleWorkspaceError('Sale action not found.', 405);
      const input = await body(req); let command: SaleWorkspaceCommand;
      let token: string | undefined;
      if (section === 'lifecycle') command = { action: 'lifecycle', status: input.status };
      else if (section === 'customer-links' && item === 'revoke') command = { action: 'customer-revoke' };
      else if (section === 'customer-links' && item === 'email') {
        const { record } = await store.customer(input.token);
        if (record.id !== saleId) throw new SaleWorkspaceError('Customer link not found.', 404);
        if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(record.draft.email)) throw new SaleWorkspaceError('Add a valid customer email first.');
        command = { action: 'link-email-status', delivery: { id: input.requestId, to: record.draft.email, status: 'prepared', attemptedAt: new Date().toISOString(), error: 'Email is prepared. Add and enable Resend in API settings to send.' } };
      }
      else if (section === 'customer-links') {
        token = input.token;
        if (!token || !/^[a-f0-9]{64}$/.test(token)) throw new SaleWorkspaceError('Check the secure customer link.');
        command = { action: 'customer-link', tokenHash: createHash('sha256').update(token).digest('hex'), expiresAt: input.expiresAt ?? new Date(Date.now() + Number(input.days ?? 30) * 86400000).toISOString() };
      } else {
        const record = await store.get(saleId); const document = record.documents.find(d => d.id === item);
        if (!document) throw new SaleWorkspaceError('Document not found.', 404);
        const to = document.snapshot.draft.email;
        if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) throw new SaleWorkspaceError('The issued document needs a valid customer email.');
        command = { action: 'email-status', delivery: { id: input.requestId, documentId: document.id, to, status: 'prepared', attemptedAt: new Date().toISOString(), error: 'Email is prepared. Add and enable Resend in API settings to send.' } };
      }
      const mutation = await store.mutate({ id: saleId, command, expectedRevision: input.expectedRevision, requestId: input.requestId });
      send(res, 200, { ...mutation, ...(token ? { customerUrl: `/my-purchase/${token}`, expiresAt: mutation.sale.customerAccess?.expiresAt } : {}) }); return true;
    }
    if (req.method === 'GET' && url.pathname === '/api/sale-workspace/paperwork') { const p = await previewIntegrationsStore.readSalesPaperwork(); send(res, 200, { saleTerms: p.saleTerms, reservationTerms: p.reservationTerms, invoiceDetails: p.invoiceDetails }); return true; }
    const route = /^\/api\/sale-workspace(?:\/([^/]+))?(?:\/(payments|documents|handover|take-deposit|complete-sale))?(?:\/([^/]+)\/(confirm|reverse))?$/.exec(url.pathname);
    if (!route) throw new SaleWorkspaceError('Sale action not found.', 404);
    const [, id, section, paymentId, action] = route;
    if (req.method === 'GET' && !section) { send(res, 200, id ? { sale: await store.get(id), preview: true } : { sales: await store.list(), preview: true }); return true; }
    const input = await body(req);
    if (req.method === 'POST' && !id) { const mutation = await store.mutate({ requestId: input.requestId, draft: input.draft }); send(res, mutation.replayed ? 200 : 201, mutation); return true; }
    let command: SaleWorkspaceCommand | undefined;
    if (req.method === 'PUT' && id && !section) command = { action: 'update', draft: input.draft };
    if (req.method === 'POST' && id) {
      if (section === 'payments' && !paymentId) command = { action: 'payment', payment: input.payment };
      if (section === 'payments' && paymentId && action === 'confirm') command = { action: 'confirm', paymentId, date: input.date, reserveVehicle: input.reserveVehicle === true };
      if (section === 'payments' && paymentId && action === 'reverse') command = { action: 'reverse', paymentId, amount: input.amount, kind: input.kind, reason: input.reason, date: input.date };
      if (section === 'documents') command = { action: 'document', type: input.type };
      if (section === 'take-deposit') command = { action: 'take-deposit', payment: input.payment };
      if (section === 'complete-sale') command = { action: 'complete-sale', acknowledge: input.acknowledge };
      if (section === 'handover') command = { action: 'handover', recipient: input.recipient, completedAt: input.completedAt, acknowledgeOutstanding: input.acknowledgeOutstanding };
    }
    if (!id || !command) throw new SaleWorkspaceError('Sale action not found.', 405);
    send(res, 200, await store.mutate({ id, command, requestId: input.requestId, expectedRevision: input.expectedRevision }));
  } catch (error) { send(res, error instanceof SaleWorkspaceError ? error.status : 500, { error: error instanceof SaleWorkspaceError ? error.message : 'The sale could not be saved. Please try again.' }); }
  return true;
}
