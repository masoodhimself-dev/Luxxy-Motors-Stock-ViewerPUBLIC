import { Router } from "express";
import { z } from "zod/v4";
import { requireStaff, requirePermission } from "../middlewares/staff-auth";
import { currentTenant } from "../lib/tenant-context";
import { siteOrigin } from "../lib/enquiry-links";
import { aiDraftConfig, generateAiDraft, AiDraftError } from "../lib/ai-drafts";
import type { AiDraftProvider } from "../lib/ai-draft-provider";

const generateSchema = z
  .object({
    requestId: z.string().uuid(),
    expectedRevision: z.number().int().nonnegative(),
    expectedVersion: z.number().int().nonnegative(),
  })
  .strict();
export function createStaffAiDraftsRouter(
  options: { provider?: AiDraftProvider } = {},
) {
  const router = Router();
  router.use(
    ["/staff/ai-drafts", "/staff/enquiries/:id/ai-draft"],
    requireStaff,
    requirePermission("sales.manage"),
    (req, res, next) => {
      res.set("Cache-Control", "no-store, private");
      try {
        const raw = req.get("origin"),
          canonical = new URL(siteOrigin()),
          origin = new URL(raw || canonical.origin);
        const valid =
          (!raw || origin.origin === raw) &&
          !origin.username &&
          !origin.password &&
          (origin.origin === canonical.origin ||
            (currentTenant()?.kind === "website" &&
              origin.host === req.get("host") &&
              origin.protocol === canonical.protocol));
        if (!valid || (req.method !== "GET" && !raw)) {
          res
            .status(403)
            .json({ error: "Open AI drafts from your dealership website." });
          return;
        }
        next();
      } catch {
        res
          .status(403)
          .json({ error: "Open AI drafts from your dealership website." });
      }
    },
  );
  router.get("/staff/ai-drafts/config", async (_req, res) => {
    try {
      res.json(await aiDraftConfig());
    } catch {
      res
        .status(503)
        .json({
          error:
            "AI draft settings are temporarily unavailable. Manual replies still work.",
        });
    }
  });
  router.post("/staff/enquiries/:id/ai-draft", async (req, res) => {
    const parsed = generateSchema.safeParse(req.body),
      id = String(req.params.id);
    if (!parsed.success || !z.string().uuid().safeParse(id).success) {
      res
        .status(400)
        .json({
          error:
            "Reopen this email and check its current draft before using AI.",
        });
      return;
    }
    try {
      res.json(
        await generateAiDraft(
          id,
          req.staff!.authUserId,
          parsed.data,
          options.provider,
        ),
      );
    } catch (error) {
      if (error instanceof AiDraftError) {
        res.status(error.status).json({ error: error.message });
        return;
      }
      // No error object, prompt, provider body or key may enter the request log.
      res
        .status(503)
        .json({
          error:
            "AI drafts are temporarily unavailable. Your original draft is unchanged.",
        });
    }
  });
  return router;
}
export default createStaffAiDraftsRouter();
