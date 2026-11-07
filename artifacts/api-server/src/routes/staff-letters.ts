import { createHash } from "node:crypto";
import { pool } from "@workspace/db";
import { saleWorkspaceBranding } from "@workspace/vehicle-meta";
import { renderStaffLetter, renderStaffLetterPreview, StaffLetterError } from "@workspace/vehicle-meta/staff-letter-pdf";
import { Router, type Request, type Response } from "express";
import { z } from "zod/v4";
import { requireDealerFeature } from "../middlewares/dealer-features";
import { requirePermission, requireStaff } from "../middlewares/staff-auth";
import {
  dealerIntegrationsStore,
  effectiveResendSettings,
  integrationReadiness,
} from "../lib/dealer-integrations-store";
import { activeDemo } from "../lib/demo-policy";
import { EmailPreparationBusy, withEmailPreparation } from "../lib/email-preparation";
import {
  EmailProviderError,
  prepareEmailWithSettings,
  sendPreparedEmail,
} from "../lib/email-provider";
import { siteOrigin } from "../lib/enquiry-links";
import { embedInvoiceLogoAsset } from "../lib/invoice-logo-assets";
import { currentDealerId, currentTenant } from "../lib/tenant-context";

const hash = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
const fileName = "dealership-letter.pdf";
const line = (length: number) => z.string().trim().min(1).max(length)
  .refine(value => !/[\u0000-\u001f\u007f]/.test(value));
const paragraphs = (length: number, min: number) => z.string().trim().min(min).max(length)
  .refine(value => !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value))
  .transform(value => value.replace(/\r\n?/g, "\n"));
const letterSchema = z.strictObject({
  recipientName: line(120),
  postalAddress: paragraphs(500, 0),
  subject: line(160),
  body: paragraphs(8000, 1),
  date: z.iso.date(),
});
const sendSchema = letterSchema.extend({
  email: z.string().trim().toLowerCase().max(254).email(),
  requestId: z.uuid().toLowerCase(),
  previewHash: z.string().regex(/^[a-f0-9]{64}$/),
});
type StaffLetter = z.infer<typeof letterSchema>;

async function readLetterBranding(dealerId: string) {
  const { rows } = await pool.query("SELECT config FROM dealer_settings WHERE dealer_id=$1", [dealerId]);
  // Invoices can have payment instructions and a custom footer. Letters use
  // the public identity, address, contact details and company registration.
  const { invoiceSettings: _invoiceSettings, ...branding } = saleWorkspaceBranding(rows[0]?.config);
  return embedInvoiceLogoAsset(branding, dealerId, pool, siteOrigin());
}

const defaultDependencies = {
  branding: readLetterBranding,
  settings: async () => effectiveResendSettings(await dealerIntegrationsStore.readPrivate()),
  transport: fetch,
};

function preparationFailure(req: Request, res: Response, error: unknown, send = false) {
  const retry = send ? { code: "LETTER_SEND_RETRY" } : {};
  if (error instanceof StaffLetterError) {
    res.status(400).json({ error: error.message });
  } else if (error instanceof EmailPreparationBusy) {
    res.set("Retry-After", "15").status(503).json({ error: "The letter service is busy. Try again in a moment.", ...retry });
  } else {
    req.log.error("Staff letter preparation failed");
    res.status(503).json({ error: "The letter could not be prepared. Try again in a moment.", ...retry });
  }
}

function deliveryFailure(req: Request, res: Response, error: unknown) {
  if (error instanceof EmailProviderError) {
    if (error.retryAfterSeconds) res.set("Retry-After", String(error.retryAfterSeconds));
    if (error.providerCode === "feature_disabled") {
      res.status(403).json({ error: "Email sending is switched off for this dealership.", code: "FEATURE_DISABLED" });
      return;
    }
    if (error.providerCode === "invalid_idempotent_request") {
      res.status(409).json({ error: "This send request was already used for a different email. Check before sending again.", code: "LETTER_REQUEST_USED" });
      return;
    }
    if (!error.attempted || error.httpStatus === 429) {
      res.status(503).json({ error: "Email sending is busy or temporarily unavailable. Try again with this same letter.", code: "LETTER_SEND_RETRY" });
      return;
    }
    if ([400, 401, 403, 404, 422].includes(error.httpStatus)) {
      res.status(502).json({ error: "The email provider rejected the letter. Check the recipient address and the dealership’s email settings.", code: "LETTER_SEND_REJECTED" });
      return;
    }
  }
  req.log.warn("Staff letter provider acceptance could not be confirmed");
  res.status(502).json({
    error: "We couldn’t confirm whether the email provider accepted this letter. Retry this same letter before starting a new one.",
    code: "LETTER_SEND_UNCONFIRMED",
  });
}

export function createStaffLettersRouter(overrides: Partial<typeof defaultDependencies> = {}) {
  const deps = { ...defaultDependencies, ...overrides };
  const router = Router();

  router.use("/staff/letters", (_req, res, next) => {
    res.set({ "Cache-Control": "no-store, private", "X-Content-Type-Options": "nosniff" });
    next();
  }, requireStaff, requirePermission("sales.manage"));

  async function letterDocument(dealerId: string, input: StaffLetter) {
    const branding = await deps.branding(dealerId);
    if (!branding.identity.name && !branding.legal.companyName) {
      throw new StaffLetterError("Add the dealership name in Settings before creating a letter.");
    }
    const fileId = hash(JSON.stringify({ input, branding })).slice(0, 32);
    return { branding, fileId };
  }

  router.post("/staff/letters/preview", async (req, res) => {
    const input = letterSchema.safeParse(req.body);
    if (!input.success) {
      res.status(400).json({ error: "Check the recipient, date, subject and letter text." });
      return;
    }
    try {
      const preview = await withEmailPreparation(async () => {
        const { branding, fileId } = await letterDocument(currentDealerId(), input.data);
        return renderStaffLetterPreview(input.data, branding, fileId);
      });
      const pdf = Buffer.from(preview.pdf);
      res.json({ pdfBase64: pdf.toString("base64"), previewSvg: preview.previewSvg, previewHash: hash(pdf) });
    } catch (error) {
      preparationFailure(req, res, error);
    }
  });

  router.post("/staff/letters/send", requireDealerFeature("customerEmails"), async (req, res) => {
    const input = sendSchema.safeParse(req.body);
    if (!input.success) {
      res.status(400).json({ error: "Enter a valid email address and review the letter before sending." });
      return;
    }
    const { email, requestId, previewHash, ...letter } = input.data;
    try {
      const prepared = await withEmailPreparation(async () => {
        if (currentTenant()?.demo || await activeDemo()) {
          res.status(403).json({ error: "Letters can be printed in a demo. Email is available on live dealerships with sending enabled.", code: "LETTER_DEMO_DISABLED" });
          return;
        }
        const dealerId = currentDealerId();
        const settings = await deps.settings();
        if (!settings.enabled || !integrationReadiness({ resend: settings }).resend.ready) {
          res.status(503).json({ error: "Email sending is unavailable. Ask the dealership owner to check Settings → API integrations.", code: "LETTER_EMAIL_UNAVAILABLE" });
          return;
        }
        const { branding, fileId } = await letterDocument(dealerId, letter);
        const pdf = Buffer.from(renderStaffLetter(letter, branding, fileId));
        if (hash(pdf) !== previewHash) {
          res.status(409).json({ error: "The letter changed after your preview. Review it again before sending.", code: "LETTER_PREVIEW_CHANGED" });
          return;
        }
        const idempotencyKey = `staff-letter/${hash(JSON.stringify([dealerId, requestId]))}`;
        const text = "Please find your letter attached.";
        const envelope = await prepareEmailWithSettings(settings, {
          to: email,
          subject: letter.subject,
          text,
          html: "<p>Please find your letter attached.</p>",
          idempotencyKey,
          attachments: [{ filename: fileName, content: pdf.toString("base64") }],
        });
        return { ...envelope, idempotencyKey };
      });
      if (!prepared) return;
      try {
        const providerId = await sendPreparedEmail(prepared.config, JSON.stringify(prepared.body), prepared.idempotencyKey, deps.transport);
        res.json({ providerId });
      } catch (error) {
        deliveryFailure(req, res, error);
      }
    } catch (error) {
      preparationFailure(req, res, error, true);
    }
  });

  return router;
}

export default createStaffLettersRouter();
