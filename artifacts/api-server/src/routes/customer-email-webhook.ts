import { Router, raw } from "express";
import { Webhook } from "svix";
import { acceptReplyEvent } from "../lib/customer-email-replies";
export function createCustomerEmailWebhook() {
  const router = Router();
  router.post(
    "/",
    raw({ type: "application/json", limit: "64kb" }),
    async (req, res) => {
      res.set({
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      });
      const secret = process.env.RESEND_RECEIVING_WEBHOOK_SECRET;
      if (process.env.EMAIL_REPLIES_ENABLED !== "true" || !secret) {
        res.sendStatus(503);
        return;
      }
      let event: unknown;
      try {
        if (!Buffer.isBuffer(req.body))
          throw new Error("Raw payload required.");
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
        await acceptReplyEvent(event);
        res.sendStatus(200);
      } catch {
        res.sendStatus(503);
      }
    },
  );
  return router;
}
