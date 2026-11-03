import { Router, type Request, type Response } from "express";
import { pool } from "@workspace/db";
import {
  SaleWorkspaceError,
  publicSaleWorkspace,
  saleWorkspaceTotals,
  type SaleWorkspaceRecord,
} from "@workspace/vehicle-meta";
import {
  salePaymentRequestAvailable,
  salePaymentRequestRemaining,
  salePaymentAgreement,
} from "../../../../lib/vehicle-meta/src/sale-operations";
import {
  requireStaff,
  requirePermission,
  staffLabel,
} from "../middlewares/staff-auth";
import { currentDealerId } from "../lib/tenant-context";
import {
  saleOperation,
  runSaleFinalReview,
  runSaleReplacementReview,
  overrideSaleReview,
  saleTokenHash,
} from "../lib/sale-operations-store";
import { archiveSaleDocument } from "../lib/sale-document-pdf";
import { siteOrigin } from "../lib/enquiry-links";
const router = Router(),
  uuid = (id: string) =>
    /^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(id);
function failure(req: Request, res: Response, error: unknown) {
  if (error instanceof SaleWorkspaceError) {
    res.status(error.status).json({ error: error.message });
    return;
  }
  req.log.error({ err: error }, "Deal operation failed");
  res
    .status(500)
    .json({
      error: "The deal could not be updated. Your saved records are unchanged.",
    });
}
router.use("/sale-operations", requireStaff, (_req, res, next) => {
  res.set("Cache-Control", "no-store");
  next();
});
for (const [action, permission] of [
  ["request-payment", "payments.record"],
  ["renew-request-link", "payments.record"],
  ["cancel-request", "payments.record"],
  ["delivery-charge", "sales.manage"],
  ["return-replace", "sales.manage"],
  ["refund-credit", "payments.refund"],
] as const) {
  router.post(
    `/sale-operations/:id/${action}`,
    requirePermission(permission),
    ...(action === "return-replace"
      ? [requirePermission("payments.refund")]
      : []),
    async (req, res) => {
      try {
        if (!uuid(req.params.id))
          throw new SaleWorkspaceError("Deal not found.", 404);
        if (Buffer.byteLength(JSON.stringify(req.body ?? {})) > 24000)
          throw new SaleWorkspaceError("The action is too large.", 413);
        res.json(
          await saleOperation(
            req.params.id,
            { ...req.body, action },
            staffLabel(req),
          ),
        );
      } catch (error) {
        failure(req, res, error);
      }
    },
  );
}
for (const proposed of [false, true]) router.post(`/sale-operations/:id/${proposed ? 'override-replacement-review' : 'override-final-review'}`, requirePermission(proposed ? 'sales.manage' : 'payments.record'), ...(proposed ? [requirePermission('payments.refund')] : []), async (req, res) => {
  try { if (!uuid(req.params.id)) throw new SaleWorkspaceError('Deal not found.', 404); if (Buffer.byteLength(JSON.stringify(req.body ?? {})) > 24000) throw new SaleWorkspaceError('The action is too large.', 413); res.json(await overrideSaleReview(req.params.id, req.body ?? {}, staffLabel(req), proposed)); } catch (error) { failure(req, res, error); }
});
router.post('/sale-operations/:id/replacement-review', requirePermission('sales.manage'), requirePermission('payments.refund'), async (req, res) => {
  try {
    if (!uuid(req.params.id)) throw new SaleWorkspaceError('Deal not found.', 404);
    if (Buffer.byteLength(JSON.stringify(req.body ?? {})) > 24000) throw new SaleWorkspaceError('The action is too large.', 413);
    res.json(await runSaleReplacementReview(req.params.id, req.body ?? {}, staffLabel(req)));
  } catch (error) { failure(req, res, error); }
});
router.post(
  "/sale-operations/:id/final-review",
  requirePermission("payments.record"),
  async (req, res) => {
    try {
      if (!uuid(req.params.id))
        throw new SaleWorkspaceError("Deal not found.", 404);
      res.json(
        await runSaleFinalReview(
          req.params.id,
          req.body?.expectedRevision,
          staffLabel(req),
        ),
      );
    } catch (error) {
      failure(req, res, error);
    }
  },
);

router.use("/payment-requests", (_req, res, next) => {
  res.set({
    "Cache-Control": "no-store, private",
    "Referrer-Policy": "no-referrer",
    "X-Robots-Tag": "noindex, nofollow",
  });
  next();
});
const paymentBuckets = new Map<string, { count: number; until: number }>();
router.use("/payment-requests", (req, res, next) => {
  const origin = req.get("origin");
  if (origin && origin !== new URL(siteOrigin()).origin) {
    res
      .status(403)
      .json({ error: "Open the payment request on the dealership website." });
    return;
  }
  if (req.body && Buffer.byteLength(JSON.stringify(req.body)) > 2000) {
    res.status(413).json({ error: "The request is too large." });
    return;
  }
  const now = Date.now(),
    key = `${currentDealerId()}:${req.ip}:${req.method === "GET" ? "read" : "write"}`;
  if (paymentBuckets.size > 5000)
    for (const [k, v] of paymentBuckets)
      if (v.until < now) paymentBuckets.delete(k);
  let bucket = paymentBuckets.get(key);
  if (!bucket || bucket.until < now) {
    if (paymentBuckets.size > 10000) {
      res.status(429).json({ error: "Try again shortly." });
      return;
    }
    bucket = { count: 0, until: now + 60000 };
    paymentBuckets.set(key, bucket);
  }
  if (++bucket.count > (req.method === "GET" ? 90 : 15)) {
    res
      .set("Retry-After", "60")
      .status(429)
      .json({ error: "Please wait a minute before trying again." });
    return;
  }
  next();
});
async function requested(
  token: string,
  client: Pick<typeof pool, "query"> = pool,
  lock = false,
) {
  if (!/^[a-f0-9]{64}$/.test(token))
    throw new SaleWorkspaceError("This payment request is unavailable.", 404);
  const hash = saleTokenHash(token);
  const result = await client.query(
    `SELECT state FROM sale_workspace WHERE dealer_id=$1 AND EXISTS(SELECT 1 FROM jsonb_array_elements(coalesce(state->'paymentRequests','[]'::jsonb)) r WHERE r->>'tokenHash'=$2) LIMIT 1${lock ? " FOR UPDATE" : ""}`,
    [currentDealerId(), hash],
  );
  const sale = result.rows[0]?.state as SaleWorkspaceRecord | undefined,
    request = sale?.paymentRequests?.find((r) => r.tokenHash === hash);
  if (
    !sale ||
    !request ||
    !salePaymentRequestAvailable(sale, request, new Date().toISOString())
  )
    throw new SaleWorkspaceError(
      "This payment request has expired or changed. Please contact the dealership.",
      410,
    );
  const document = sale.documents.find((d) => d.id === request.documentId);
  if (!document)
    throw new SaleWorkspaceError("The payment request is unavailable.", 404);
  return { sale, request, document };
}
const matchingInvoice = (sale: SaleWorkspaceRecord) =>
  [...sale.documents]
    .reverse()
    .find(
      (d) =>
        d.type === "invoice" &&
        salePaymentAgreement({ ...sale, draft: d.snapshot.draft }) ===
          salePaymentAgreement(sale),
    );
router.get("/payment-requests/:token", async (req, res) => {
  try {
    const { sale, request, document } = await requested(req.params.token),
      totals = saleWorkspaceTotals(sale.draft, sale.payments),
      branding = document.snapshot.branding;
    res.json({
      reference: request.reference,
      saleReference: sale.reference,
      kind: request.kind,
      amountPence: request.amountPence,
      amountDuePence: salePaymentRequestRemaining(sale, request),
      balancePence: totals.balance,
      dueDate: request.dueDate,
      note: request.note,
      customer: sale.draft.customer,
      vehicle: sale.draft.vehicle,
      registration: sale.draft.registration,
      dealer: {
        name: branding.identity.name,
        phone: branding.contact.phone,
        email: branding.contact.email,
      },
      paymentInstructions: branding.invoiceSettings?.paymentInstructions || "",
      paymentReportedAt: request.paymentReportedAt,
      invoiceRequestedAt: request.invoiceRequestedAt,
      invoiceAvailable: !!matchingInvoice(sale),
    });
  } catch (error) {
    failure(req, res, error);
  }
});
for (const kind of ["pdf", "invoice"] as const)
  router.get(`/payment-requests/:token/${kind}`, async (req, res) => {
    try {
      const { sale, document } = await requested(req.params.token),
        selected = kind === "invoice" ? matchingInvoice(sale) : document;
      if (!selected)
        throw new SaleWorkspaceError(
          "The invoice has not been issued yet.",
          404,
        );
      const archive =
        sale.documentArchives?.[selected.id] ?? archiveSaleDocument(selected);
      res.set({
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${selected.number.replace(/[^A-Za-z0-9_-]/g, "")}.pdf"`,
      });
      res.end(Buffer.from(archive.content, "base64"));
    } catch (error) {
      failure(req, res, error);
    }
  });
router.post("/payment-requests/:token/:action", async (req, res) => {
  const client = await pool.connect();
  try {
    if (
      !["report-payment", "request-invoice"].includes(req.params.action) ||
      req.body?.confirm !== true
    )
      throw new SaleWorkspaceError("Confirm the request.", 400);
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
      `sale-workspace:${currentDealerId()}`,
    ]);
    const { sale, request } = await requested(req.params.token, client, true),
      now = new Date().toISOString();
    const field =
      req.params.action === "report-payment"
        ? "paymentReportedAt"
        : "invoiceRequestedAt";
    if (!request[field]) {
      request[field] = now;
      sale.revision++;
      sale.updatedAt = now;
      sale.events.push({
        id: crypto.randomUUID(),
        type: field,
        description:
          field === "paymentReportedAt"
            ? "Customer reported a payment; staff must verify receipt."
            : "Customer requested an invoice.",
        actor: "Customer via private request link",
        occurredAt: now,
      });
      await client.query(
        "UPDATE sale_workspace SET state=$3::jsonb,revision=$4,updated_at=$5 WHERE dealer_id=$1 AND id=$2::uuid",
        [currentDealerId(), sale.id, JSON.stringify(sale), sale.revision, now],
      );
    }
    await client.query("COMMIT");
    res.json({
      recorded: true,
      message:
        field === "paymentReportedAt"
          ? "The dealership has your update. Your payment still needs to be checked."
          : "Your invoice request has been saved for the dealership.",
    });
  } catch (error) {
    await client.query("ROLLBACK");
    failure(req, res, error);
  } finally {
    client.release();
  }
});
export default router;
