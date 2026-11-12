import { invoiceEmailAttachments } from "../../api-server/src/lib/invoice-email-attachments";
import { loadSaleInvoicePhotos } from "../../api-server/src/lib/sale-invoice-photos";
// Local network sandbox only. The production entry never imports this file.
import { previewIntegrationsStore } from "./dealer-integrations";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { IncomingMessage, ServerResponse } from "node:http";
import {
  changeSaleWorkspace,
  createSaleWorkspace,
  changeSaleHandoffTask,
  isSaleHandoffTaskKind,
  publicSaleWorkspace,
  currentInvoiceBranding,
  saleWorkspaceBranding,
  saleWorkspaceFingerprint,
  saleWorkspaceTotals,
  requireSaleInvoiceVehicleReviewTarget,
  saleHandoverStatus,
  saleCollectionTaskResolution,
  compareSaleHandoffTaskKeys,
  saleHandoffTaskKey,
  saleHandoffTaskListOptions,
  saleHandoffTaskPage,
  saleHandoffTaskPageSize,
  saleHandoffTaskSummary,
  releaseSaleForCancelledReservation,
  staffSaleHandoffTasks,
  saleQueueFilters,
  saleQueueStatus,
  saleQueueToday,
  saleRegistrationSearch,
  saleWorkspaceNumber,
  SaleWorkspaceError,
  dailySalePaymentsOptions,
  previewDailySalePayments,
  type SaleHandoffTaskListOptions,
  type SaleHandoffTaskSummary,
  type SaleInvoiceVehicleReview,
  type SaleWorkspaceBranding,
  type SaleWorkspaceVehicleSnapshot,
  type SaleWorkspaceCommand,
  type SaleWorkspaceContext,
  type SaleWorkspaceDraft,
  type SaleWorkspaceMutation,
  type SaleWorkspaceRecord,
} from "@workspace/vehicle-meta";
import { archiveSaleDocument } from "../../api-server/src/lib/sale-document-pdf";
import {
  attachInvoiceVerification,
  invoiceVerificationView,
} from "../../api-server/src/lib/invoice-verification";
import { previewAssignment, previewReservationMatchesVehicle, readPreviewSettings, readPreviewBookingState } from "./reservations";
import { previewStock } from "./stock";
import { saleListStage } from "../../api-server/src/lib/sale-list-stage";
import { roleHasPermission, saleHandoffTaskPermission, type StaffRole } from "../../api-server/src/lib/staff-permissions";

const previewSalesActorId = "preview-alex";
class PreviewSaleVehicleConflictError extends SaleWorkspaceError {
  constructor() { super("This vehicle is reserved or sold to another customer.", 409); }
}
const previewStaffSale = (sale: SaleWorkspaceRecord): SaleWorkspaceRecord => ({
  ...publicSaleWorkspace(sale),
  ...(Object.keys(sale.providerPayments ?? {}).length ? { hasProviderPayments: true as const } : {}),
  ...(sale.handoffTasks ? { handoffTasks: staffSaleHandoffTasks(sale) } : {}),
});
const previewStockActionsClosed = (sale: SaleWorkspaceRecord) =>
  sale.lifecycle?.status === 'released' || sale.lifecycle?.status === 'returned' || sale.standaloneReturn || sale.returnReplacement?.direction === 'returned';
function previewLegacyStockClaim(sale: SaleWorkspaceRecord) {
  if (previewStockActionsClosed(sale)) return false;
  const refundOnly = new Set(sale.payments.filter(payment => payment.stockConflictReconciliation).map(payment => payment.id));
  return sale.payments.reduce((net, payment) => payment.status === 'confirmed' && !refundOnly.has(payment.id) && !refundOnly.has(payment.reversesPaymentId ?? '') ? net + payment.signedAmountPence : net, 0) > 0;
}

export type PreviewSalesState = {
  schemaVersion: 1;
  sales: SaleWorkspaceRecord[];
  numbers: Record<string, number>;
};
const defaultFilename = fileURLToPath(
  new URL("../../../.local/sales-workspace-preview.json", import.meta.url),
);
export class PreviewSaleWorkspaceStore {
  private queue: Promise<unknown> = Promise.resolve();
  constructor(
    private filename = defaultFilename,
    private assets: (
      draft: SaleWorkspaceDraft,
    ) => Promise<{
      branding: SaleWorkspaceBranding;
      vehicle?: SaleWorkspaceVehicleSnapshot;
      paperwork?: { saleTerms: string; reservationTerms: string };
    }> = async (draft: SaleWorkspaceDraft) => {
      const settings = await readPreviewSettings();
      const vehicle = previewStock.cars.find(
        (car) => car.id === draft?.vehicleId,
      );
      const paperwork = await previewIntegrationsStore.readSalesPaperwork();
      return {
        paperwork,
        branding: currentInvoiceBranding(
          saleWorkspaceBranding(settings),
          paperwork.invoiceSettings,
        ),
        ...(vehicle
          ? {
              vehicle: {
                id: vehicle.id,
                title: vehicle.title ?? "",
                trim: vehicle.trim?.trim() || vehicle.variant,
                registration:
                  vehicle.plate || vehicle.vrm || vehicle.registration,
                engineSize: vehicle.engineSize,
                bodyType: vehicle.bodyType,
                doors: vehicle.doors,
                seats: vehicle.seats,
                emissionClass: vehicle.emissionClass,
                imageUrl: vehicle.heroImage || vehicle.images?.[0]?.url,
                year: vehicle.year,
                fuel: vehicle.fuel,
                transmission: vehicle.transmission,
                mileage: vehicle.mileage,
                colour: vehicle.colour,
                owners: vehicle.owners,
                writeOffCategory: vehicle.writeOffCategory,
                description:
                  typeof vehicle.sourceExtras?.description === "string"
                    ? vehicle.sourceExtras.description
                    : null,
                serviceHistory:
                  typeof vehicle.sourceExtras?.serviceHistory === "string"
                    ? vehicle.sourceExtras.serviceHistory
                    : null,
              },
            }
          : {}),
      };
    },
  ) {}
  private serial<T>(work: () => Promise<T>): Promise<T> {
    const next = this.queue.then(work, work);
    this.queue = next.catch(() => {});
    return next;
  }
  private async load(): Promise<PreviewSalesState> {
    try {
      const state = JSON.parse(
        await readFile(this.filename, "utf8"),
      ) as PreviewSalesState;
      if (
        state.schemaVersion !== 1 ||
        !Array.isArray(state.sales) ||
        !state.numbers
      )
        throw new Error("Invalid local sales store");
      return state;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT")
        return { schemaVersion: 1, sales: [], numbers: {} };
      throw error;
    }
  }
  private async save(state: PreviewSalesState) {
    await mkdir(dirname(this.filename), { recursive: true });
    const temporary = `${this.filename}.${randomUUID()}.tmp`;
    await writeFile(temporary, JSON.stringify(state, null, 2), { mode: 0o600 });
    await rename(temporary, this.filename);
  }
  async list() {
    return this.serial(async () =>
      (await this.load()).sales
        .map(publicSaleWorkspace)
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    );
  }
  async get(id: string, options: { includeStockActionBlock?: boolean } = {}) {
    return this.serial(async () => {
      const { sales } = await this.load();
      const sale = sales.find((item) => item.id === id);
      if (!sale) throw new SaleWorkspaceError("Sale not found.", 404);
      const view = previewStaffSale(sale);
      if (!options.includeStockActionBlock || previewStockActionsClosed(sale)) return view;
      const vehicleId = sale.draft.vehicleId;
      const car = previewStock.cars.find(item => item.id === vehicleId);
      if (!car) return view;
      const reservations = (await readPreviewBookingState()).reservations.filter(reservation => reservation.status === 'reserved' && previewReservationMatchesVehicle(reservation, vehicleId));
      const linkedReservation = reservations.some(reservation => reservation.id === sale.draft.sourceReservationId);
      const ownReservation = linkedReservation || sale.lifecycle?.status === 'reserved';
      const ownSold = Boolean(sale.completedAt || sale.lifecycle?.status === 'sold');
      const includeLegacyLedger = !ownReservation && !ownSold && (!car.inventoryStatus || car.inventoryStatus === 'available');
      if (reservations.some(reservation => reservation.id !== sale.draft.sourceReservationId)
        || car.inventoryStatus === 'reserved' && !ownReservation || car.inventoryStatus === 'sold' && !ownSold
        || sales.some(item => item.id !== id && item.draft.vehicleId === vehicleId &&
          (item.lifecycle?.status === 'reserved' || item.lifecycle?.status === 'sold' || includeLegacyLedger && previewLegacyStockClaim(item)))) {
        view.stockActionBlock = 'another-sale';
      }
      return view;
    });
  }
  async reviewInvoiceVehicle(id: string, expectedRevision: unknown) {
    return this.serial(async () => {
      const state = await this.load();
      const sale = state.sales.find(item => item.id === id);
      if (!sale) throw new SaleWorkspaceError("Sale not found.", 404);
      requireSaleInvoiceVehicleReviewTarget(sale, expectedRevision);
      const stock = previewStock.cars.find(car => car.id === sale.draft.vehicleId);
      const review: SaleInvoiceVehicleReview = {
        id: randomUUID(), registration: sale.draft.registration, checkedAt: new Date().toISOString(), status: 'unavailable',
        ...(typeof stock?.mileage === 'number' && stock.mileage >= 0 ? { stockMileage: stock.mileage } : {}),
        warnings: ['Official vehicle checks are unavailable in this local preview.'],
      };
      sale.invoiceVehicleReview = { review, revision: sale.revision, actorId: previewSalesActorId, stockIdentity: '' };
      await this.save(state);
      return { review, preview: true };
    });
  }
  async listHandoffTasks(actorId: string, options: SaleHandoffTaskListOptions, members: Array<{ id: string; role: StaffRole }>) {
    return this.serial(async () => {
      const roles = new Map(members.map(member => [member.id, member.role]));
      const rows = (await this.load()).sales.flatMap(sale => {
        const resolution = saleCollectionTaskResolution(sale);
        return (sale.handoffTasks ?? []).flatMap((task): SaleHandoffTaskSummary[] => {
          if (task.status !== 'open' || !isSaleHandoffTaskKind(task.kind) || task.kind === 'arrange-collection' && resolution) return [];
          const summary = saleHandoffTaskSummary(sale, task);
          if (options.cursor && compareSaleHandoffTaskKeys(saleHandoffTaskKey(summary), options.cursor) <= 0) return [];
          const role = roles.get(task.assigneeId);
          const assignmentIssue = !role ? 'inactive' : roleHasPermission(role, saleHandoffTaskPermission(task.kind)) ? undefined : 'role-changed';
          if (options.view === 'needs-reassignment') return assignmentIssue ? [{ ...summary, assignmentIssue }] : [];
          return task.assigneeId === actorId && !assignmentIssue ? [summary] : [];
        });
      }).sort((a, b) => compareSaleHandoffTaskKeys(saleHandoffTaskKey(a), saleHandoffTaskKey(b)));
      return saleHandoffTaskPage(rows.slice(options.offset, options.offset + saleHandoffTaskPageSize + 1));
    });
  }
  async mutateHandoffTask(id: string, input: Parameters<typeof changeSaleHandoffTask>[1], actor: { id: string; name: string; role: StaffRole }, members: Array<{ id: string; name: string; role: StaffRole }>) {
    return this.serial(async () => {
      const state = await this.load();
      const index = state.sales.findIndex(sale => sale.id === id);
      if (index < 0) throw new SaleWorkspaceError('Sale not found.', 404);
      const mutation = await changeSaleHandoffTask(state.sales[index]!, input, {
        actorId: actor.id, actor: actor.name, canManage: roleHasPermission(actor.role, 'sales.manage'),
        canRecordPayments: roleHasPermission(actor.role, 'payments.record'), now: new Date().toISOString(), nextId: randomUUID,
        resolveAssignee: async (assigneeId, kind) => {
          const member = members.find(item => item.id === assigneeId && roleHasPermission(item.role, saleHandoffTaskPermission(kind)));
          if (!member) throw new SaleWorkspaceError('Choose an active staff member who can handle this task.');
          return member.name;
        },
      });
      if (!mutation.replayed) {
        state.sales[index] = mutation.sale;
        await this.save(state);
      }
      return { ...mutation, sale: previewStaffSale(mutation.sale), preview: true };
    });
  }
  async verifyInvoice(saleId: string, documentId: string, token: string) {
    return this.serial(async () =>
      invoiceVerificationView(
        (await this.load()).sales.find((s) => s.id === saleId),
        documentId,
        token,
      ),
    );
  }
  async releaseReservation(reservationId: string) {
    return this.serial(async () => {
      const state = await this.load();
      const connected = state.sales.filter(
        (s) => s.draft.sourceReservationId === reservationId,
      );
      if (connected.some((s) => s.lifecycle?.status === "sold" || s.completedAt))
        throw new SaleWorkspaceError(
          "This reservation belongs to a sold vehicle. Review its sale file.",
          409,
        );
      let changed = false;
      const now = new Date().toISOString();
      for (const sale of connected) {
        if (releaseSaleForCancelledReservation(sale, { now, actor: 'Showroom staff', nextId: randomUUID })) changed = true;
      }
      if (changed) await this.save(state);
    });
  }
  async inventory() {
    return this.serial(
      async () =>
        Object.fromEntries(
          (await this.load()).sales
            .filter(
              (s) =>
                s.lifecycle &&
                ["reserved", "sold"].includes(s.lifecycle.status),
            )
            .map((s) => [s.draft.vehicleId, s.lifecycle!.status]),
        ) as Record<string, "reserved" | "sold">,
    );
  }
  async pdf(id: string, documentId: string) {
    return this.serial(async () => {
      const record = (await this.load()).sales.find((s) => s.id === id);
      const document = record?.documents.find((d) => d.id === documentId);
      if (!document) throw new SaleWorkspaceError("Document not found.", 404);
      return {
        document,
        archive:
          record?.documentArchives?.[documentId] ??
          archiveSaleDocument(document),
      };
    });
  }
  async mutate(input: {
    id?: string;
    requestId: string;
    expectedRevision?: number;
    draft?: unknown;
    command?: SaleWorkspaceCommand;
    actor?: string;
    requireInvoiceVehicleReview?: boolean;
  }): Promise<SaleWorkspaceMutation> {
    if (input.command?.action === "provider-refund-correction")
      throw new SaleWorkspaceError(
        "Provider refund corrections require a verified payment event.",
        403,
      );
    return this.serial(async () => {
      const state = await this.load();
      const current = input.id
        ? state.sales.find((sale) => sale.id === input.id)
        : undefined;
      if (input.id && !current)
        throw new SaleWorkspaceError("Sale not found.", 404);
      if (!input.id) {
        const existing = state.sales.find(
          (sale) => sale.requests?.[input.requestId],
        );
        if (existing) {
          if (
            existing.requests?.[input.requestId]?.fingerprint !==
            saleWorkspaceFingerprint({ action: "create", draft: input.draft })
          )
            throw new SaleWorkspaceError(
              "This request reference has already been used for different details.",
              409,
            );
          return {
            sale: previewStaffSale(existing),
            replayed: true,
            preview: true,
          };
        }
      }
      const now = new Date().toISOString();
      const draft =
        input.command?.action === "update"
          ? input.command.draft
          : (current?.draft ?? (input.draft as SaleWorkspaceDraft));
      const assets = await this.assets(draft);
      const command = input.command;
      const issuesInvoice = command?.action === 'issue-invoice' || command?.action === 'complete-sale' || command?.action === 'document' && command.type === 'invoice';
      if (issuesInvoice && assets.vehicle?.id && assets.vehicle.id === draft?.vehicleId &&
        assets.vehicle.invoicePhotoDataUrls === undefined && current?.revision === input.expectedRevision &&
        !Object.hasOwn(current?.requests ?? {},input.requestId) && (!input.requireInvoiceVehicleReview || command.vehicleReview !== undefined)) {
        const car = previewStock.cars.find(item=>item.id===draft.vehicleId);
        const gallery = assets.vehicle.imageUrl ? await loadSaleInvoicePhotos([assets.vehicle.imageUrl,...(car?.images ?? []).map(image=>image.url)],'') : [];
        assets.vehicle = { ...assets.vehicle,invoicePhotoDataUrls:gallery };
      }
      const context: SaleWorkspaceContext = {
        now,
        actor: input.actor ?? previewAssignment(previewSalesActorId).assignedToName ?? "Showroom staff",
        actorId: previewSalesActorId,
        requireInvoiceVehicleReview: input.requireInvoiceVehicleReview,
        nextId: randomUUID,
        nextNumber: (type) =>
          saleWorkspaceNumber(
            state.numbers,
            type,
            now,
            assets.branding.invoiceSettings,
          ),
        ...assets,
      };
      const mutation = current
        ? changeSaleWorkspace(
            current,
            input.command!,
            {
              expectedRevision: input.expectedRevision!,
              requestId: input.requestId,
            },
            context,
          )
        : createSaleWorkspace(
            { draft: input.draft, requestId: input.requestId },
            context,
            saleWorkspaceNumber(
              state.numbers,
              "sale",
              now,
              assets.branding.invoiceSettings,
            ),
          );
      if (!mutation.replayed) {
        const command = input.command;
        const recordsPayment = command?.action === 'payment' || command?.action === 'invoice-payment' || command?.action === 'confirm';
        const reservesCar = command?.action === 'take-deposit'
          || command?.action === 'invoice-payment' && command.payment.kind === 'deposit'
          || command?.action === 'confirm' && command.reserveVehicle
          || recordsPayment && mutation.sale.lifecycle?.status === 'reserved' && current?.lifecycle?.status !== 'reserved';
        const status = reservesCar ? 'reserved' : command?.action === 'lifecycle' ? command.status
          : command?.action === 'finish-invoice-sale' || command?.action === 'complete-sale' || command?.action === 'handover' ? 'sold' : undefined;
        if (status || recordsPayment || command?.action === 'issue-invoice' || command?.action === 'document' && command.type === 'invoice') {
          const vehicleId = mutation.sale.draft.vehicleId;
          const car = previewStock.cars.find(
            (c) => c.id === vehicleId,
          );
          if (status && !car)
            throw new SaleWorkspaceError(
              "Choose a current stock vehicle before changing availability.",
            );
          const competing = state.sales.some(
            (s) =>
              s.id !== mutation.sale.id &&
              s.draft.vehicleId === vehicleId &&
              ["reserved", "sold"].includes(s.lifecycle?.status ?? ""),
          );
          const booking = await readPreviewBookingState();
          const competingReservation = booking.reservations.some(
            (r) =>
              r.vehicleId === vehicleId &&
              r.status === "reserved" &&
              r.id !== mutation.sale.draft.sourceReservationId,
          );
          if (
            status === "released" &&
            mutation.sale.draft.sourceReservationId &&
            booking.reservations.some(
              (r) =>
                r.id === mutation.sale.draft.sourceReservationId &&
                r.status === "reserved",
            )
          )
            throw new SaleWorkspaceError(
              "Cancel the linked customer reservation before releasing this sale reservation.",
              409,
            );
          const reconciles = command?.action === 'invoice-payment' && command.stockConflictReconciliation !== undefined;
          if (reconciles && !competing && !competingReservation) throw new SaleWorkspaceError('The stock conflict has changed. Reload this sale before recording the payment.', 409);
          if (!reconciles && status !== "released" && (competing || competingReservation)) throw new PreviewSaleVehicleConflictError();
          if (status === "reserved" && car?.sourceStatus === "missing")
            throw new SaleWorkspaceError(
              "This car is missing from the current feed. Review it before reserving.",
              409,
            );
          if (status && mutation.sale.lifecycle?.status !== status) mutation.sale.lifecycle = {
            status,
            vehicleId,
            changedAt: status === 'sold' ? mutation.sale.completedAt ?? now : now,
          };
        }
        if (
          (!current || input.command?.action === "update") &&
          (mutation.sale.draft.sourceEnquiryId ||
            mutation.sale.draft.sourceReservationId)
        ) {
          const booking = await readPreviewBookingState();
          const source = mutation.sale.draft.sourceEnquiryId
            ? booking.enquiries?.find(
                (e) => e.id === mutation.sale.draft.sourceEnquiryId,
              )
            : booking.reservations.find(
                (r) => r.id === mutation.sale.draft.sourceReservationId,
              );
          if (
            !source ||
            (source.vehicleId &&
              source.vehicleId !== mutation.sale.draft.vehicleId)
          )
            throw new SaleWorkspaceError(
              "The source record belongs to another vehicle or could not be found.",
              409,
            );
          if (
            "appointmentAt" in source &&
            source.appointmentAt &&
            !source.appointmentCancelledAt
          )
            mutation.sale.draft.appointment = {
              at: source.appointmentAt,
              status: source.appointmentStatus ?? "confirmed",
            };
          if (
            mutation.sale.draft.sourceEnquiryId &&
            state.sales.some(
              (s) =>
                s.id !== mutation.sale.id &&
                s.draft.sourceEnquiryId === mutation.sale.draft.sourceEnquiryId,
            )
          )
            throw new SaleWorkspaceError(
              "A sale already exists for this enquiry.",
              409,
            );
          if (
            mutation.sale.draft.sourceReservationId &&
            state.sales.some(
              (s) =>
                s.id !== mutation.sale.id &&
                s.draft.sourceReservationId ===
                  mutation.sale.draft.sourceReservationId,
            )
          )
            throw new SaleWorkspaceError(
              "A sale already exists for this reservation.",
              409,
            );
        }
        for (const document of mutation.sale.documents.filter(
          (d) => !current?.documents.some((old) => old.id === d.id),
        )) {
          if (document.type === "invoice")
            attachInvoiceVerification(
              document,
              mutation.sale.id,
              "http://127.0.0.1:4175",
            );
          (mutation.sale.documentArchives ??= {})[document.id] =
            archiveSaleDocument(document);
        }
        if (current)
          state.sales[state.sales.findIndex((sale) => sale.id === current.id)] =
            mutation.sale;
        else state.sales.push(mutation.sale);
        await this.save(state);
      }
      return {
        ...mutation,
        sale: previewStaffSale(mutation.sale),
        preview: true,
      };
    });
  }
}

export const previewStore = new PreviewSaleWorkspaceStore();
export const readPreviewSaleInventory = () => previewStore.inventory();
export const releasePreviewSourceReservation = (id: string) =>
  previewStore.releaseReservation(id);
async function body(req: IncomingMessage) {
  let data = "";
  for await (const chunk of req) {
    data += chunk;
    if (Buffer.byteLength(data) > 256_000)
      throw new SaleWorkspaceError("Sale request is too large.", 413);
  }
  try {
    return JSON.parse(data);
  } catch {
    throw new SaleWorkspaceError("Invalid sale request.", 400);
  }
}
function send(res: ServerResponse, status: number, value: unknown) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(value));
}
function local(req: IncomingMessage) {
  const remote = (req.socket.remoteAddress ?? "").replace(/^::ffff:/, "");
  const host = new URL(`http://${req.headers.host}`).hostname;
  const loopback =
    ["127.0.0.1", "::1"].includes(remote) &&
    ["127.0.0.1", "localhost", "[::1]"].includes(host);
  const lanHost = process.env.LUXXY_PREVIEW_LAN_HOST;
  const privateIpv4 = /^(10\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[01])\.)/;
  const lan = Boolean(
    lanHost &&
    privateIpv4.test(lanHost) &&
    host === lanHost &&
    (privateIpv4.test(remote) || remote === "127.0.0.1"),
  );
  return (
    (loopback || lan) &&
    (!req.headers.origin || req.headers.origin === `http://${req.headers.host}`)
  );
}
export async function salesPreview(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  store: PreviewSaleWorkspaceStore = previewStore,
): Promise<boolean> {
  const replacementRoute = req.method === 'GET' && /^\/api\/sale-operations\/([^/]+)\/replacement-availability$/.exec(url.pathname);
  if (
    !replacementRoute && !/^\/api\/(?:sale-workspace|invoice-verification)(?:\/|$)/.test(
      url.pathname,
    )
  )
    return false;
  if (!local(req)) {
    send(res, 403, {
      error: "The sales service is available only on the authorised network.",
    });
    return true;
  }
  try {
    const handoffRoute = /^\/api\/sale-workspace(?:\/([^/]+))?\/handoff-tasks$/.exec(url.pathname);
    if (handoffRoute) {
      const { readPreviewTaskRoster } = await import('./operations');
      const members = await readPreviewTaskRoster();
      const actorId = typeof req.headers['x-preview-staff-id'] === 'string' ? req.headers['x-preview-staff-id'] : previewSalesActorId;
      const actor = members.find(member => member.id === actorId);
      if (!actor) throw new SaleWorkspaceError('Sign in to use the dealer portal.', 401);
      const id = handoffRoute[1];
      if (req.method === 'GET' && !id) {
        const options = saleHandoffTaskListOptions({ offset: url.searchParams.get('offset'), view: url.searchParams.get('view'), cursor: url.searchParams.get('cursor') });
        if (options.view === 'needs-reassignment' && !roleHasPermission(actor.role, 'sales.manage')) throw new SaleWorkspaceError('Your role cannot review staff assignments.', 403);
        send(res, 200, await store.listHandoffTasks(actor.id, options, members));
      }
      else if (req.method === 'GET' && id) {
        if (!roleHasPermission(actor.role, 'sales.manage')) throw new SaleWorkspaceError('Your staff role does not allow this action.', 403);
        const kind = url.searchParams.get('kind');
        if (!isSaleHandoffTaskKind(kind)) throw new SaleWorkspaceError('Choose a handoff task.');
        await store.get(id);
        send(res, 200, { members: members.filter(member => roleHasPermission(member.role, saleHandoffTaskPermission(kind))).map(({id,name}) => ({id,name})) });
      } else if (req.method === 'POST' && id) {
        const input = await body(req);
        if (!input || typeof input !== 'object' || Array.isArray(input)) throw new SaleWorkspaceError('Check the handoff task details.');
        send(res, 200, await store.mutateHandoffTask(id, input, actor, members));
      } else throw new SaleWorkspaceError('Sale action not found.', 404);
      return true;
    }
    if (replacementRoute) {
      const sale = await store.get(replacementRoute[1]);
      const vehicleId = url.searchParams.get('vehicleId');
      if (!vehicleId || vehicleId === sale.draft.vehicleId || !sale.completedAt || sale.lifecycle?.status !== 'sold') throw new SaleWorkspaceError('Choose an available replacement car.', 409);
      const car = previewStock.cars.find(item => item.id === vehicleId);
      const inventory = await store.inventory();
      if (!car || car.sourceStatus === 'missing' || car.archivedAt || Number(car.missingCount ?? 0) !== 0 || (inventory[vehicleId] ?? car.inventoryStatus ?? 'available') !== 'available') throw new SaleWorkspaceError('This replacement vehicle is not available.', 409);
      if ((await readPreviewBookingState()).reservations.some(reservation => previewReservationMatchesVehicle(reservation, vehicleId) && reservation.status === 'reserved')) throw new PreviewSaleVehicleConflictError();
      const competing = (await store.list()).some(item => item.draft.vehicleId === vehicleId && previewLegacyStockClaim(item));
      if (competing) throw new PreviewSaleVehicleConflictError();
      send(res, 200, { vehicleId });
      return true;
    }
    const proofRoute =
      /^\/api\/invoice-verification\/([^/]+)\/([^/]+)\/([^/]+)$/.exec(
        url.pathname,
      );
    if (proofRoute && req.method === "GET") {
      res.setHeader("Referrer-Policy", "no-referrer");
      res.setHeader("X-Robots-Tag", "noindex, nofollow");
      send(
        res,
        200,
        await store.verifyInvoice(proofRoute[1], proofRoute[2], proofRoute[3]),
      );
      return true;
    }
    const extra =
      /^\/api\/sale-workspace\/([^/]+)\/(lifecycle|documents)(?:\/([^/]+))?(?:\/(pdf|email))?$/.exec(
        url.pathname,
      );
    if (extra && (extra[2] !== "documents" || extra[3])) {
      const [, saleId, section, item, action] = extra;
      if (section === "documents" && action === "pdf" && req.method === "GET") {
        const { document, archive } = await store.pdf(saleId, item);
        res.setHeader("Content-Type", "application/pdf");
        res.setHeader("Cache-Control", "no-store");
        res.setHeader(
          "Content-Disposition",
          `attachment; filename="${document.number}.pdf"`,
        );
        res.end(Buffer.from(archive.content, "base64"));
        return true;
      }
      if (req.method !== "POST")
        throw new SaleWorkspaceError("Sale action not found.", 405);
      const input = await body(req);
      let command: SaleWorkspaceCommand;
      if (section === "lifecycle")
        command = { action: "lifecycle", status: input.status };
      else {
        const record = await store.get(saleId);
        const document = record.documents.find((d) => d.id === item);
        if (!document) throw new SaleWorkspaceError("Document not found.", 404);
        const to = document.snapshot.draft.email;
        if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to))
          throw new SaleWorkspaceError(
            "The issued document needs a valid customer email.",
          );
        const { archive } = await store.pdf(saleId, document.id);
        invoiceEmailAttachments(document, archive.content);
        command = {
          action: "email-status",
          delivery: {
            id: input.requestId,
            documentId: document.id,
            to,
            status: "prepared",
            attemptedAt: new Date().toISOString(),
            error:
              "Email is prepared. Add and enable Resend in API settings to send.",
          },
        };
      }
      const mutation = await store.mutate({
        id: saleId,
        command,
        expectedRevision: input.expectedRevision,
        requestId: input.requestId,
      });
      send(res, 200, mutation);
      return true;
    }
    if (
      req.method === "GET" &&
      url.pathname === "/api/sale-workspace/paperwork"
    ) {
      const p = await previewIntegrationsStore.readSalesPaperwork();
      send(res, 200, {
        saleTerms: p.saleTerms,
        reservationTerms: p.reservationTerms,
        invoiceSettings: p.invoiceSettings,
        paymentDefaults: p.paymentDefaults,
      });
      return true;
    }
    if (req.method === "GET" && url.pathname === "/api/sale-workspace/daily-payments") {
      const options = dailySalePaymentsOptions(
        url.searchParams.get('date') ?? undefined,
        url.searchParams.get('confirmedOffset') ?? undefined,
        url.searchParams.get('pendingOffset') ?? undefined,
      );
      send(res, 200, previewDailySalePayments(await store.list(), options));
      return true;
    }
    const route =
      /^\/api\/sale-workspace(?:\/([^/]+))?(?:\/(payments|documents|handover|fulfilment|take-deposit|complete-sale|invoice-payments|invoice-vehicle-review|issue-invoice|finish-invoice-sale|checklists|team))?(?:\/([^/]+)\/(confirm|reverse))?$/.exec(
        url.pathname,
      );
    if (!route) throw new SaleWorkspaceError("Sale action not found.", 404);
    const [, id, section, paymentId, action] = route;
    if (req.method === "GET" && !section) {
      if (id) { send(res,200,{sale:await store.get(id,{includeStockActionBlock:true}),preview:true});return true; }
      const q=(url.searchParams.get('q')??'').trim(),offset=Number(url.searchParams.get('offset')??0),enquiryId=url.searchParams.get('enquiryId'),reservationId=url.searchParams.get('reservationId');
      if(q.length>120||!Number.isSafeInteger(offset)||offset<0||offset>10000)throw new SaleWorkspaceError('Check the sales search or page.',400);
      const digits=/^[+0-9 ().-]+$/.test(q)?q.replace(/\D/g,''):'';
      const { queue, owner } = saleQueueFilters(url.searchParams.get('queue') ?? 'all', url.searchParams.get('owner') ?? 'all');
      const now = new Date(), today = saleQueueToday(now), registration = saleRegistrationSearch(q);
      const rows = (await store.list()).map(sale => ({ sale, status: saleQueueStatus(sale, today, now.toISOString()) })).filter(({ sale, status }) =>
        (queue === 'all' || (queue === 'attention' && status.attention) || (queue === 'open' && !status.closed) || (queue === 'closed' && status.closed)) &&
        (owner === 'all' || (owner === 'mine' && sale.team?.ownerId === previewSalesActorId) || (owner === 'unassigned' && !sale.team?.ownerId)) &&
        (!enquiryId || sale.draft.sourceEnquiryId === enquiryId) && (!reservationId || sale.draft.sourceReservationId === reservationId) &&
        (!q || sale.id === q || sale.draft.sourceEnquiryId === q || sale.draft.sourceReservationId === q ||
          `${sale.reference} ${sale.draft.customer} ${sale.draft.email} ${sale.draft.vehicle} ${sale.draft.registration}`.toLowerCase().includes(q.toLowerCase()) ||
          (registration && sale.draft.registration?.replace(/[^a-z0-9]/gi, '').toUpperCase().includes(registration)) ||
          sale.documents.some(document => document.number.toLowerCase().includes(q.toLowerCase())) ||
          (digits && sale.draft.phone.replace(/\D/g, '').includes(digits))))
        .sort((a, b) => b.sale.updatedAt.localeCompare(a.sale.updatedAt) || b.sale.id.localeCompare(a.sale.id));
      const sales = rows.slice(offset, offset + 50).map(({ sale, status }) => {
        const { draft } = sale, totals = saleWorkspaceTotals(draft, sale.payments);
        const hasInvoice = sale.documents.some(document => document.type === 'invoice');
        return {
          listSummary: true, listTotalDue: totals.totalDue, listPaid: totals.confirmedPaid, listPending: totals.pending,
          listBalance: totals.balance, listLedgerKnown: true, listStage: saleListStage(sale, hasInvoice),
          listHasInvoice: hasInvoice, listHasCorrectionNotes: Boolean(sale.corrections?.length),
          listHasRefunds: sale.payments.some(payment => payment.status === 'confirmed' && payment.signedAmountPence < 0),
          listHandover: draft.fulfilment ? { method: draft.fulfilment.method, status: saleHandoverStatus(draft.fulfilment) } : null,
          listOwnerId: sale.team?.ownerId ?? null, listOwnerName: sale.team?.ownerName ?? '', listHasTeamNote: Boolean(sale.team?.note), listAttention: status.attention,
          ...(status.refundDue ? { listRefundDue: status.refundDue } : {}),
          id: sale.id, reference: sale.reference, revision: sale.revision, createdAt: sale.createdAt, updatedAt: sale.updatedAt,
          completedAt: sale.completedAt, lifecycle: sale.lifecycle, emptyDraftDeletable: sale.emptyDraftDeletable,
          draft: { id: draft.id, customer: draft.customer, email: draft.email, phone: draft.phone, vehicleId: draft.vehicleId, vehicle: draft.vehicle,
            registration: draft.registration, sourceEnquiryId: draft.sourceEnquiryId, sourceReservationId: draft.sourceReservationId },
          documents: [], payments: [], events: [],
        };
      });
      send(res,200,{sales,hasMore:offset+50<rows.length,preview:true});
      return true;
    }
    const input = await body(req);
    if (req.method === "POST" && id && section === "invoice-vehicle-review") {
      send(res, 200, await store.reviewInvoiceVehicle(id, input.expectedRevision));
      return true;
    }
    if (req.method === "POST" && !id) {
      const mutation = await store.mutate({
        requestId: input.requestId,
        draft: input.draft,
      });
      send(res, mutation.replayed ? 200 : 201, mutation);
      return true;
    }
    let command: SaleWorkspaceCommand | undefined;
    if (req.method === "PUT" && id && !section)
      command = { action: "update", draft: input.draft };
    if (req.method === "POST" && id) {
      if (section === "team") {
        const sale = await store.get(id);
        const ownerName = input.ownerId === sale.team?.ownerId ? sale.team?.ownerName : previewAssignment(input.ownerId).assignedToName ?? '';
        command = { action: "team", ownerId: input.ownerId, note: input.note, ownerName };
      }
      if (section === "fulfilment")
        command = { action: "fulfilment", fulfilment: input.fulfilment };
      if (section === "checklists")
        command = {
          action: "checklists",
          completion: input.completion,
          partExchanges: input.partExchanges,
        };
      if (section === "payments" && !paymentId)
        command = { action: "payment", payment: input.payment };
      if (section === "payments" && paymentId && action === "confirm")
        command = {
          action: "confirm",
          paymentId,
          date: input.date,
          reserveVehicle: input.reserveVehicle === true,
        };
      if (section === "payments" && paymentId && action === "reverse")
        command = {
          action: "reverse",
          paymentId,
          amount: input.amount,
          kind: input.kind,
          reason: input.reason,
          date: input.date,
          invoiceOnly: input.invoiceOnly === true,
        };
      if (section === "documents")
        command = { action: "document", type: input.type, ...(input.vehicleReview !== undefined ? { vehicleReview: input.vehicleReview } : {}) };
      if (section === "invoice-payments")
        command = { action: "invoice-payment", payment: input.payment, ...(input.stockConflictReconciliation !== undefined ? { stockConflictReconciliation: input.stockConflictReconciliation } : {}) };
      if (section === "issue-invoice")
        command = {
          action: "issue-invoice",
          kind: input.kind,
          acknowledge: input.acknowledge,
          ...(input.vehicleReview !== undefined ? { vehicleReview: input.vehicleReview } : {}),
        };
      if (section === "finish-invoice-sale")
        command = {
          action: "finish-invoice-sale",
          acknowledge: input.acknowledge,
          acknowledgeOutstanding: input.acknowledgeOutstanding === true,
          ...(input.reviewedInvoiceId !== undefined ? { reviewedInvoiceId: input.reviewedInvoiceId } : {}),
        };
      if (section === "take-deposit")
        command = { action: "take-deposit", payment: input.payment };
      if (section === "complete-sale")
        command = { action: "complete-sale", acknowledge: input.acknowledge, ...(input.vehicleReview !== undefined ? { vehicleReview: input.vehicleReview } : {}) };
      if (section === "handover")
        command = {
          action: "handover",
          recipient: input.recipient,
          completedAt: input.completedAt,
          acknowledgeOutstanding: input.acknowledgeOutstanding,
        };
    }
    if (!id || !command)
      throw new SaleWorkspaceError("Sale action not found.", 405);
    send(
      res,
      200,
      await store.mutate({
        id,
        command,
        requestId: input.requestId,
        expectedRevision: input.expectedRevision,
        requireInvoiceVehicleReview: true,
      }),
    );
  } catch (error) {
    send(res, error instanceof SaleWorkspaceError ? error.status : 500, {
      ...(error instanceof PreviewSaleVehicleConflictError ? { code: 'sale-vehicle-conflict' } : {}),
      error:
        error instanceof SaleWorkspaceError
          ? error.message
          : "The sale could not be saved. Please try again.",
    });
  }
  return true;
}
