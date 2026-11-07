import { createHash } from "node:crypto";
import { renderDirectEmail } from "@workspace/vehicle-meta";
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
import { dealerProfile } from "../lib/enquiry-notifications";
import { currentDealerId, currentTenant } from "../lib/tenant-context";

const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const draftSchema = z.strictObject({
  email: z.string().trim().toLowerCase().max(254).email(),
  subject: z.string().trim().min(1).max(200)
    .refine(value => !/[\u0000-\u001f\u007f]/.test(value)),
  body: z.string().trim().min(1).max(12000)
    .refine(value => !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value))
    .transform(value => value.replace(/\r\n?/g, "\n")),
});
const sendSchema = draftSchema.extend({
  requestId: z.uuid().toLowerCase(),
  previewHash: z.string().regex(/^[a-f0-9]{64}$/),
});
type Draft = z.infer<typeof draftSchema>;

const defaultDependencies = {
  profile: dealerProfile,
  configuration: async () => dealerIntegrationsStore.readPrivate(),
  transport: fetch,
};

function preparationFailure(req: Request, res: Response, error: unknown) {
  if (error instanceof EmailPreparationBusy) {
    res.set("Retry-After", "15").status(503).json({
      error: "The email service is busy. Try again in a moment.",
      code: "EMAIL_SEND_RETRY",
    });
    return;
  }
  req.log.error("Direct staff email preparation failed");
  res.status(503).json({
    error: "The email could not be prepared. Try again in a moment.",
    code: "EMAIL_SEND_RETRY",
  });
}

function deliveryFailure(req: Request, res: Response, error: unknown) {
  if (error instanceof EmailProviderError) {
    if (error.retryAfterSeconds) res.set("Retry-After", String(error.retryAfterSeconds));
    if (error.providerCode === "feature_disabled") {
      res.status(403).json({ error: "Email sending is switched off for this dealership.", code: "FEATURE_DISABLED" });
      return;
    }
    if (error.providerCode === "invalid_idempotent_request") {
      res.status(409).json({ error: "This send request was already used for a different email. Check before sending again.", code: "EMAIL_REQUEST_USED" });
      return;
    }
    if (!error.attempted || error.httpStatus === 429) {
      res.status(503).json({ error: "Email sending is busy or temporarily unavailable. Try again with this same email.", code: "EMAIL_SEND_RETRY" });
      return;
    }
    if ([400, 401, 403, 404, 422].includes(error.httpStatus)) {
      res.status(502).json({ error: "The email provider rejected the message. Check the recipient and the dealership’s email settings.", code: "EMAIL_SEND_REJECTED" });
      return;
    }
  }
  req.log.warn("Direct staff email provider acceptance could not be confirmed");
  res.status(502).json({
    error: "We couldn’t confirm whether the email provider accepted this message. Retry this same email before starting a new one.",
    code: "EMAIL_SEND_UNCONFIRMED",
  });
}

export function createStaffDirectEmailRouter(overrides: Partial<typeof defaultDependencies> = {}) {
  const deps = { ...defaultDependencies, ...overrides };
  const router = Router();
  const route = "/staff/email/compose";

  router.use(route, (_req, res, next) => {
    res.set({ "Cache-Control": "no-store, private", "X-Content-Type-Options": "nosniff" });
    next();
  }, requireStaff, requirePermission("sales.manage"));

  async function preview(draft: Draft, config: Awaited<ReturnType<typeof deps.configuration>>) {
    const profile = await deps.profile();
    const email = {
      email: draft.email,
      ...renderDirectEmail(draft, {
        name: profile.identity.name,
        email: profile.contact.email,
        phone: profile.contact.phone,
        address: profile.contact.address,
      }, config.appearance),
    };
    return { ...email, previewHash: hash(email) };
  }

  router.post(`${route}/preview`, async (req, res) => {
    const input = draftSchema.safeParse(req.body);
    if (!input.success) {
      res.status(400).json({ error: "Check the recipient, subject and message." });
      return;
    }
    try {
      const result = await withEmailPreparation(async () => preview(input.data, await deps.configuration()));
      res.json(result);
    } catch (error) {
      preparationFailure(req, res, error);
    }
  });

  router.post(`${route}/send`, requireDealerFeature("customerEmails"), async (req, res) => {
    const input = sendSchema.safeParse(req.body);
    if (!input.success) {
      res.status(400).json({ error: "Review the email before sending." });
      return;
    }
    const { requestId, previewHash, ...draft } = input.data;
    try {
      const prepared = await withEmailPreparation(async () => {
        if (currentTenant()?.demo || await activeDemo()) {
          res.status(403).json({ error: "You can preview email in a demo. Sending is available on live dealerships with email enabled.", code: "EMAIL_UNAVAILABLE" });
          return;
        }
        const dealerId = currentDealerId();
        const config = await deps.configuration();
        const settings = effectiveResendSettings(config);
        if (!settings.enabled || !integrationReadiness({ resend: settings }).resend.ready) {
          res.status(503).json({ error: "Email sending is unavailable. Ask the dealership owner to check Settings → API integrations.", code: "EMAIL_UNAVAILABLE" });
          return;
        }
        const result = await preview(draft, config);
        if (result.previewHash !== previewHash) {
          res.status(409).json({ error: "The email changed after your preview. Review it again before sending.", code: "EMAIL_PREVIEW_CHANGED" });
          return;
        }
        const idempotencyKey = `staff-email/${hash([dealerId, requestId])}`;
        const envelope = await prepareEmailWithSettings(settings, {
          to: result.email,
          subject: result.subject,
          html: result.html,
          text: result.text,
          idempotencyKey,
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
      preparationFailure(req, res, error);
    }
  });

  return router;
}

export default createStaffDirectEmailRouter();
