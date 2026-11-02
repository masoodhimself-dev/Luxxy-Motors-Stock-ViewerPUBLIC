import { Router, raw } from "express";
import { Webhook } from "svix";
import { acceptCazooLeadEvent, cazooLeadsEnabled } from "../lib/cazoo-leads";
export function createCazooLeadWebhook() {
  const router = Router();
  router.post(
    "/",
    raw({ type: "application/json", limit: "64kb" }),
    async (req, res) => {
      res.set({
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      });
      const secret = process.env.CAZOO_LEADS_WEBHOOK_SECRET;
      if (!cazooLeadsEnabled() || !secret) {
        res.sendStatus(503);
        return;
      }
      let event: unknown;
      try {
        if (!Buffer.isBuffer(req.body)) throw new Error("Raw payload required");
        new Webhook(secret).verify(req.body.toString("utf8"), {
          "svix-id": req.get("svix-id") || "",
          "svix-timestamp": req.get("svix-timestamp") || "",
          "svix-signature": req.get("svix-signature") || "",
        });
        event = JSON.parse(req.body.toString("utf8"));
      } catch {
        res.sendStatus(401);
        return;
      }
      try {
        await acceptCazooLeadEvent(event);
        res.sendStatus(200);
      } catch {
        res.sendStatus(503);
      }
    },
  );
  return router;
}
