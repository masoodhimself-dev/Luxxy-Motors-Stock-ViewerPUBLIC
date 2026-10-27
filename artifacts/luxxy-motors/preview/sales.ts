import { invoiceEmailAttachments } from "../../api-server/src/lib/invoice-email-attachments";
import { loadBrochurePhotos } from "../../api-server/src/lib/vehicle-brochure-images";
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
  publicSaleWorkspace,
  currentInvoiceBranding,
  saleWorkspaceBranding,
  saleWorkspaceFingerprint,
  saleWorkspaceTotals,
  saleWorkspaceNumber,
  SaleWorkspaceError,
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
import { readPreviewSettings, readPreviewBookingState } from "./reservations";
import { previewStock } from "./stock";

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
                registration:
                  vehicle.plate || vehicle.vrm || vehicle.registration,
                engineSize: vehicle.engineSize,
                bodyType: vehicle.bodyType,
                doors: vehicle.doors,
                seats: vehicle.seats,
                emissionClass: vehicle.emissionClass,
                imageUrl: vehicle.heroImage,
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
  async get(id: string) {
    return this.serial(async () => {
      const sale = (await this.load()).sales.find((item) => item.id === id);
      if (!sale) throw new SaleWorkspaceError("Sale not found.", 404);
      return publicSaleWorkspace(sale);
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
      if (connected.some((s) => s.lifecycle?.status === "sold"))
        throw new SaleWorkspaceError(
          "This reservation belongs to a sold vehicle. Review its sale file.",
          409,
        );
      let changed = false;
      for (const s of connected)
        if (s.lifecycle?.status === "reserved") {
          const now = new Date().toISOString();
          s.lifecycle = { ...s.lifecycle, status: "released", changedAt: now };
          s.revision++;
          s.updatedAt = now;
          s.events.push({
            id: randomUUID(),
            type: "reservation-cancelled",
            description: "Linked online reservation cancelled; car released",
            actor: "Showroom staff",
            occurredAt: now,
          });
          changed = true;
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
            sale: publicSaleWorkspace(existing),
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
      if (
        input.command?.action === "issue-invoice" &&
        assets.vehicle?.imageUrl
      ) {
        const photo = (
          await loadBrochurePhotos(
            [
              {
                url: assets.vehicle.imageUrl.replace(/w\d+-h\d+/, "w480-h360"),
                caption: "",
              },
            ],
            "",
            4000,
          )
        )[0];
        if (photo?.bytes && photo.format)
          assets.vehicle.photoDataUrl = `data:image/${photo.format === "JPEG" ? "jpeg" : "png"};base64,${Buffer.from(photo.bytes).toString("base64")}`;
      }
      const context: SaleWorkspaceContext = {
        now,
        actor: input.actor ?? "Showroom staff",
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
        if (
          (input.command?.action === "invoice-payment" &&
            input.command.payment.kind === "deposit") ||
          input.command?.action === "finish-invoice-sale" ||
          input.command?.action === "lifecycle" ||
          input.command?.action === "handover" ||
          input.command?.action === "take-deposit" ||
          input.command?.action === "complete-sale" ||
          (input.command?.action === "confirm" && input.command.reserveVehicle)
        ) {
          const status =
            input.command.action === "invoice-payment" ||
            input.command.action === "take-deposit" ||
            input.command.action === "confirm"
              ? "reserved"
              : input.command.action === "finish-invoice-sale" ||
                  input.command.action === "handover" ||
                  input.command.action === "complete-sale"
                ? "sold"
                : input.command.status;
          const car = previewStock.cars.find(
            (c) => c.id === mutation.sale.draft.vehicleId,
          );
          if (!car)
            throw new SaleWorkspaceError(
              "Choose a current stock vehicle before changing availability.",
            );
          const competing = state.sales.some(
            (s) =>
              s.id !== mutation.sale.id &&
              s.draft.vehicleId === car.id &&
              ["reserved", "sold"].includes(s.lifecycle?.status ?? ""),
          );
          const booking = await readPreviewBookingState();
          const competingReservation = booking.reservations.some(
            (r) =>
              r.vehicleId === car.id &&
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
          if (status !== "released" && (competing || competingReservation))
            throw new SaleWorkspaceError(
              "This vehicle is reserved or sold to another customer.",
              409,
            );
          if (status === "reserved" && car.sourceStatus === "missing")
            throw new SaleWorkspaceError(
              "This car is missing from the current feed. Review it before reserving.",
              409,
            );
          mutation.sale.lifecycle = {
            status,
            vehicleId: car.id,
            changedAt: now,
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
        sale: publicSaleWorkspace(mutation.sale),
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
  if (
    !/^\/api\/(?:sale-workspace|invoice-verification)(?:\/|$)/.test(
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
      });
      return true;
    }
    const route =
      /^\/api\/sale-workspace(?:\/([^/]+))?(?:\/(payments|documents|handover|fulfilment|take-deposit|complete-sale|invoice-payments|issue-invoice|finish-invoice-sale|checklists))?(?:\/([^/]+)\/(confirm|reverse))?$/.exec(
        url.pathname,
      );
    if (!route) throw new SaleWorkspaceError("Sale action not found.", 404);
    const [, id, section, paymentId, action] = route;
    if (req.method === "GET" && !section) {
      if (id) { send(res,200,{sale:await store.get(id),preview:true});return true; }
      const q=(url.searchParams.get('q')??'').trim(),offset=Number(url.searchParams.get('offset')??0),enquiryId=url.searchParams.get('enquiryId'),reservationId=url.searchParams.get('reservationId');
      if(q.length>120||!Number.isSafeInteger(offset)||offset<0||offset>10000)throw new SaleWorkspaceError('Check the sales search or page.',400);
      const digits=/^[+0-9 ().-]+$/.test(q)?q.replace(/\D/g,''):'';
      const rows=(await store.list()).filter(sale=>(!enquiryId||sale.draft.sourceEnquiryId===enquiryId)&&(!reservationId||sale.draft.sourceReservationId===reservationId)&&(!q||sale.id===q||sale.draft.sourceEnquiryId===q||sale.draft.sourceReservationId===q||`${sale.reference} ${sale.draft.customer} ${sale.draft.email} ${sale.draft.vehicle} ${sale.draft.registration}`.toLowerCase().includes(q.toLowerCase())||(digits&&sale.draft.phone.replace(/\D/g,'').includes(digits)))).sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt)||b.id.localeCompare(a.id));
      const sales=rows.slice(offset,offset+50).map(sale=>({listSummary:true,listTotalDue:saleWorkspaceTotals(sale.draft,[]).totalDue,id:sale.id,reference:sale.reference,revision:sale.revision,createdAt:sale.createdAt,updatedAt:sale.updatedAt,completedAt:sale.completedAt,lifecycle:sale.lifecycle,emptyDraftDeletable:sale.emptyDraftDeletable,draft:{id:sale.draft.id,customer:sale.draft.customer,email:sale.draft.email,phone:sale.draft.phone,vehicleId:sale.draft.vehicleId,vehicle:sale.draft.vehicle,registration:sale.draft.registration,sourceEnquiryId:sale.draft.sourceEnquiryId,sourceReservationId:sale.draft.sourceReservationId},documents:[],payments:[],events:[]}));
      send(res,200,{sales,hasMore:offset+50<rows.length,preview:true});
      return true;
    }
    const input = await body(req);
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
        command = { action: "document", type: input.type };
      if (section === "invoice-payments")
        command = { action: "invoice-payment", payment: input.payment };
      if (section === "issue-invoice")
        command = {
          action: "issue-invoice",
          kind: input.kind,
          acknowledge: input.acknowledge,
        };
      if (section === "finish-invoice-sale")
        command = {
          action: "finish-invoice-sale",
          acknowledge: input.acknowledge,
          acknowledgeOutstanding: input.acknowledgeOutstanding === true,
        };
      if (section === "take-deposit")
        command = { action: "take-deposit", payment: input.payment };
      if (section === "complete-sale")
        command = { action: "complete-sale", acknowledge: input.acknowledge };
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
      }),
    );
  } catch (error) {
    send(res, error instanceof SaleWorkspaceError ? error.status : 500, {
      error:
        error instanceof SaleWorkspaceError
          ? error.message
          : "The sale could not be saved. Please try again.",
    });
  }
  return true;
}
