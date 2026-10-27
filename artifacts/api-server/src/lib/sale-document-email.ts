import { createHash } from "node:crypto";
import { db, pool } from "@workspace/db";
import {
  SaleWorkspaceError,
  type SaleWorkspaceRecord,
  type SaleWorkspaceDocument,
} from "@workspace/vehicle-meta";
import { currentDealerId, multiTenantEnabled } from "./tenant-context";
import {
  PostgresSaleWorkspaceStore,
  readSaleWorkspaceAssets,
} from "./sale-workspace-store";
import {
  dealerIntegrationsStore,
  effectiveResendSettings,
  type PrivateDealerSettings,
} from "./dealer-integrations-store";
import { renderDealerEmail, type EmailRequest } from "./email-provider";
import {
  enqueueEmailOutbox,
  attemptQueuedEmail,
  type EmailOutbox,
} from "./email-outbox";
import {
  saleCorrespondenceEnquiry,
  saleEmailIdentity,
} from "./sale-correspondence";
export { saleEmailIdentity } from "./sale-correspondence";
import { executorQuery } from "./query-executor";
import { archiveSaleDocument } from "./sale-document-pdf";
import { invoiceEmailAttachments } from "./invoice-email-attachments";

type Executor = Pick<typeof db, "execute">;
const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
const uuid = (value: string) =>
  /^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(value);
const service = (dealer = currentDealerId()) =>
  new PostgresSaleWorkspaceStore(
    dealer,
    (draft, client) => readSaleWorkspaceAssets(draft, dealer, client),
    pool,
  );
export type SaleDocumentEmailContext = {
  saleId: string;
  documentId: string;
  requestId: string;
  documentHash: string;
  archiveHash: string;
  recipient: string;
  actorId: string;
  actorName: string;
  attemptedAt: string;
};
function context(row: EmailOutbox): SaleDocumentEmailContext {
  const c = row.validation.saleDocument as SaleDocumentEmailContext | undefined;
  if (
    !c ||
    !uuid(c.saleId) ||
    !uuid(c.documentId) ||
    typeof c.requestId !== "string" ||
    !c.requestId ||
    !/^\w{64}$/.test(c.documentHash) ||
    !/^\w{64}$/.test(c.archiveHash) ||
    typeof c.recipient !== "string" ||
    typeof c.actorId !== "string" ||
    typeof c.actorName !== "string" ||
    !Number.isFinite(Date.parse(c.attemptedAt))
  )
    throw new Error("The approved invoice email context is invalid.");
  return c;
}
function issued(record: SaleWorkspaceRecord, documentId: string) {
  const document = record.documents.find((item) => item.id === documentId);
  const archive =
    document &&
    (record.documentArchives?.[documentId] ?? archiveSaleDocument(document));
  if (!document || !archive)
    throw new SaleWorkspaceError("The issued document is unavailable.", 404);
  if (
    hash(Buffer.from(archive.content, "base64").toString("base64")) !==
      hash(archive.content) ||
    createHash("sha256")
      .update(Buffer.from(archive.content, "base64"))
      .digest("hex") !== archive.sha256
  )
    throw new SaleWorkspaceError(
      "The saved invoice failed its integrity check.",
      409,
    );
  return { document, archive };
}
async function renderInvoice(
  record: SaleWorkspaceRecord,
  document: SaleWorkspaceDocument,
  content: string,
): Promise<EmailRequest & { bodyText?: string }> {
  const buyer = document.snapshot.draft,
    branding = document.snapshot.branding,
    to = buyer.email.trim();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to))
    throw new SaleWorkspaceError(
      "The issued document needs a valid customer email. Issue an updated document after correcting the email.",
    );
  const money = (pence: number) =>
      new Intl.NumberFormat("en-GB", {
        style: "currency",
        currency: "GBP",
      }).format(pence / 100),
    attachments = invoiceEmailAttachments(document, content);
  const rendered = await renderDealerEmail({
    templateId:
      document.type === "invoice"
        ? "invoice"
        : document.type === "statement"
          ? "balance_statement"
          : document.type === "receipt"
            ? "payment_receipt"
            : "document_email",
    variables: {
      customer_name: buyer.customer,
      customer_email: to,
      dealer_name: branding.identity.name,
      dealer_email: branding.contact.email,
      dealer_phone: branding.contact.phone,
      reference: record.reference,
      vehicle_title: buyer.vehicle,
      vehicle_registration: buyer.registration,
      document_title: document.title,
      document_type: document.title,
      document_number: document.number,
      issued_at: document.issuedAt,
      amount: money(
        document.paymentAmountPence ?? document.snapshot.totals.totalDue,
      ),
      amount_received: money(document.snapshot.totals.confirmedPaid),
      balance: money(document.balanceAtIssue),
    },
    facts: [
      { label: "Document", value: `${document.title} ${document.number}` },
      { label: "Vehicle", value: buyer.vehicle },
      ...(buyer.registration
        ? [{ label: "Registration", value: buyer.registration }]
        : []),
      {
        label: "Issued",
        value: new Date(document.issuedAt).toLocaleString("en-GB", {
          timeZone: "Europe/London",
        }),
      },
      {
        label: "Payments recorded at issue",
        value: money(document.snapshot.totals.confirmedPaid),
      },
      { label: "Balance at issue", value: money(document.balanceAtIssue) },
    ],
    attachments,
  });
  return { ...rendered, to, idempotencyKey: "", attachments };
}
/** Manual approval queues one frozen invoice envelope. Replays cannot create another message. */
export async function approveSaleDocumentEmail(
  input: {
    saleId: string;
    documentId: string;
    requestId: string;
    expectedRevision: number;
    actorId: string;
    actorName: string;
  },
  options: {
    config?: PrivateDealerSettings;
    render?: typeof renderInvoice;
    attempt?: typeof attemptQueuedEmail;
  } = {},
) {
  const dealer = currentDealerId(),
    store = service(dealer);
  if (
    !uuid(input.saleId) ||
    !uuid(input.documentId) ||
    !Number.isSafeInteger(input.expectedRevision) ||
    typeof input.requestId !== "string" ||
    !/^[a-zA-Z0-9_-]{8,100}$/.test(input.requestId)
  )
    throw new SaleWorkspaceError("Check the saved invoice email request.");
  const deliveryId = saleEmailIdentity(
      `sale-email:${dealer}:${input.saleId}:${input.requestId}`,
    ),
    journalRequest = saleEmailIdentity(
      `sale-email-request:${dealer}:${input.saleId}:${input.requestId}`,
    );
  // Config/template rendering is outside the held transaction; frozen document hashes are rechecked inside it.
  const initial = (
    await pool.query(
      "SELECT state FROM sale_workspace WHERE dealer_id=$1 AND id=$2::uuid",
      [dealer, input.saleId],
    )
  ).rows[0]?.state as SaleWorkspaceRecord | undefined;
  if (!initial) throw new SaleWorkspaceError("Sale not found.", 404);
  const known = initial.emailDeliveries?.find(
    (item) => item.id === input.requestId,
  );
  if (known && known.documentId !== input.documentId)
    throw new SaleWorkspaceError(
      "This request was used for another document.",
      409,
    );
  if (known) return { sale: await store.get(initial.id), replayed: true };
  const { document, archive } = issued(initial, input.documentId),
    config = options.config ?? (await dealerIntegrationsStore.readPrivate());
  const rendered = await (options.render ?? renderInvoice)(
    initial,
    document,
    archive.content,
  );
  const sendKey = `sale-document-${document.id}-${input.requestId}`;
  const result = await db.transaction(async (tx) => {
    const query = executorQuery(tx);
    await query("SELECT pg_advisory_xact_lock(hashtext($1))", [
      `sale-workspace:${dealer}`,
    ]);
    const current = (
      await query(
        "SELECT state FROM sale_workspace WHERE dealer_id=$1 AND id=$2::uuid FOR UPDATE",
        [dealer, input.saleId],
      )
    ).rows[0]?.state as SaleWorkspaceRecord | undefined;
    if (!current) throw new SaleWorkspaceError("Sale not found.", 404);
    const previous = (
      await query(
        "SELECT id,document_ids,request_hash FROM enquiry_emails WHERE dealer_id=$1 AND id=$2::uuid",
        [dealer, deliveryId],
      )
    ).rows[0];
    if (previous) {
      if (
        !previous.document_ids?.includes(`${input.saleId}:${input.documentId}`)
      )
        throw new SaleWorkspaceError(
          "This request was used for another document.",
          409,
        );
      return { replayed: true, outboxId: undefined };
    }
    if (
      current.emailDeliveries?.some(
        (item) =>
          item.documentId === input.documentId &&
          ["sending", "unknown"].includes(item.status),
      )
    )
      throw new SaleWorkspaceError(
        "An approved copy of this document is still sending or its acceptance is unconfirmed. Check its email history before preparing another copy.",
        409,
      );
    if (current.revision !== input.expectedRevision)
      throw new SaleWorkspaceError(
        "This sale changed. Reload the sale before emailing its invoice.",
        409,
      );
    const frozen = issued(current, input.documentId);
    if (
      hash(JSON.stringify(frozen.document)) !==
        hash(JSON.stringify(document)) ||
      frozen.archive.sha256 !== archive.sha256
    )
      throw new SaleWorkspaceError(
        "The saved invoice changed. Reload before emailing.",
        409,
      );
    const enquiryId = await saleCorrespondenceEnquiry(
        current,
        document.snapshot.draft,
        tx,
      ),
      attemptedAt = new Date().toISOString();
    const ctx: SaleDocumentEmailContext = {
      saleId: current.id,
      documentId: document.id,
      requestId: input.requestId,
      documentHash: hash(JSON.stringify(document)),
      archiveHash: archive.sha256,
      recipient: document.snapshot.draft.email.trim(),
      actorId: input.actorId,
      actorName: input.actorName,
      attemptedAt,
    };
    const approvedRequest = {
      to: ctx.recipient,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
      idempotencyKey: sendKey,
    };
    await query(
      `INSERT INTO enquiry_emails(id,dealer_id,enquiry_id,request_id,request_hash,status,recipient,subject,message,rendered_text,attachment_manifest,photo_ids,document_ids,created_by) VALUES($1::uuid,$2,$3::uuid,$4::uuid,$5,'sending',$6,$7,$8,$9,$10::jsonb,'[]'::jsonb,$11::jsonb,$12)`,
      [
        deliveryId,
        dealer,
        enquiryId,
        journalRequest,
        hash(JSON.stringify(ctx)),
        ctx.recipient,
        rendered.subject,
        rendered.bodyText || rendered.text || "",
        rendered.text || "",
        JSON.stringify([
          {
            id: document.id,
            filename: document.number + ".pdf",
            byteSize: Buffer.byteLength(archive.content, "base64"),
          },
        ]),
        JSON.stringify([`${current.id}:${document.id}`]),
        input.actorId,
      ],
    );
    const outbox = await enqueueEmailOutbox(
      {
        enquiryId,
        deliveryId,
        kind: "staff",
        config: effectiveResendSettings(config),
        request: {
          ...approvedRequest,
          attachments: invoiceEmailAttachments(document, archive.content),
        },
        validation: {
          saleDocument: ctx,
          approvedRequest,
          ...(!multiTenantEnabled() && input.actorId === "machine"
            ? { machineTokenHash: hash(process.env.PORTAL_API_TOKEN || "") }
            : {}),
        },
      },
      tx,
    );
    await store.finishEmailOnClient(
      current.id,
      "email-start-" + saleEmailIdentity(input.requestId),
      {
        action: "email-status",
        delivery: {
          id: input.requestId,
          documentId: document.id,
          to: ctx.recipient,
          status: "sending",
          attemptedAt,
        },
      },
      input.actorName,
      { query },
    );
    return { replayed: false, outboxId: outbox.id };
  });
  if (result.outboxId)
    await (options.attempt ?? attemptQueuedEmail)(result.outboxId);
  return { sale: await store.get(input.saleId), replayed: result.replayed };
}
/** Frozen copy is reused; mutable website/template copy cannot rewrite an approved send. */
export async function rebuildSaleDocumentOutbox(
  row: EmailOutbox,
  executor: Executor = db,
): Promise<EmailRequest> {
  if (row.dealer_id !== currentDealerId() || row.kind !== "staff")
    throw new Error(
      "The approved invoice email belongs to another dealership.",
    );
  const c = context(row),
    query = executorQuery(executor);
  const actor = (
    await query(
      "SELECT m.created_by,u.role,u.disabled_at FROM enquiry_emails m LEFT JOIN portal_users u ON u.dealer_id=m.dealer_id AND u.auth_user_id=m.created_by WHERE m.id=$1::uuid AND m.dealer_id=$2 AND m.enquiry_id=$3::uuid",
      [row.delivery_id, row.dealer_id, row.enquiry_id],
    )
  ).rows[0];
  const machine =
    !multiTenantEnabled() &&
    actor?.created_by === "machine" &&
    Boolean(process.env.PORTAL_API_TOKEN) &&
    row.validation.machineTokenHash === hash(process.env.PORTAL_API_TOKEN!);
  if (
    !machine &&
    (!actor ||
      actor.disabled_at ||
      !["owner", "salesperson", "accounts"].includes(String(actor.role)) ||
      actor.created_by !== c.actorId)
  )
    throw new Error("The invoice email approval is no longer authorised.");
  const record = (
    await query(
      "SELECT state FROM sale_workspace WHERE dealer_id=$1 AND id=$2::uuid",
      [row.dealer_id, c.saleId],
    )
  ).rows[0]?.state as SaleWorkspaceRecord | undefined;
  if (!record) throw new Error("The invoice sale is unavailable.");
  const { document, archive } = issued(record, c.documentId);
  if (
    hash(JSON.stringify(document)) !== c.documentHash ||
    archive.sha256 !== c.archiveHash ||
    document.snapshot.draft.email.trim() !== c.recipient
  )
    throw new Error("The approved invoice or recipient changed.");
  if (
    (await saleCorrespondenceEnquiry(
      record,
      document.snapshot.draft,
      executor,
      false,
    )) !== row.enquiry_id
  )
    throw new Error("The invoice customer thread changed.");
  const request = row.validation.approvedRequest as EmailRequest | undefined;
  if (
    !request ||
    request.to !== c.recipient ||
    request.idempotencyKey !== row.send_key ||
    typeof request.html !== "string" ||
    typeof request.subject !== "string"
  )
    throw new Error("The approved invoice wording is unavailable.");
  return {
    ...request,
    attachments: invoiceEmailAttachments(document, archive.content),
  };
}
export async function syncSaleDocumentEmail(
  row: EmailOutbox,
  executor: Executor = db,
) {
  const c = context(row),
    query = executorQuery(executor);
  const status =
    row.status === "queued" || row.status === "sending"
      ? "sending"
      : row.status === "cancelled"
        ? "unknown"
        : row.status;
  const error =
    status === "sent" || row.status === "sending"
      ? undefined
      : row.status === "queued"
        ? "Approved invoice email queued for a bounded retry."
        : status === "unknown"
          ? "Invoice email acceptance is unconfirmed. Check delivery before preparing another copy."
          : "Invoice email was not accepted. Review the recipient and sender before sending a fresh email.";
  await service(row.dealer_id).finishEmailOnClient(
    c.saleId,
    "email-result-" +
      saleEmailIdentity(
        JSON.stringify([
          row.id,
          row.status,
          row.attempts,
          row.provider_id,
          row.error_code,
        ]),
      ),
    {
      action: "email-status",
      delivery: {
        id: c.requestId,
        documentId: c.documentId,
        to: c.recipient,
        status,
        attemptedAt: c.attemptedAt,
        ...(status === "sent"
          ? { sentAt: new Date(row.finished_at || c.attemptedAt).toISOString() }
          : {}),
        ...(row.provider_id ? { providerId: row.provider_id } : {}),
        ...(error ? { error } : {}),
      },
    },
    c.actorName,
    { query },
  );
}
