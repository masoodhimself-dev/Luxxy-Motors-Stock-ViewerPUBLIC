import { currentDealerId } from "../lib/tenant-context";
import { Router, type IRouter, type RequestHandler } from "express";
import { pool } from "@workspace/db";
import {
  requirePermission,
  requireStaff,
  staffLabel,
} from "../middlewares/staff-auth";
import { ChatError, DealerChatService } from "../lib/dealer-chat";
import { PostgresChatStore } from "../lib/dealer-chat-store";
import { findVisibleStockVehicle } from "./stock";
import { getOrCreateSettings } from "./dealer-settings";

const dealerId = () => currentDealerId();
export function productionChatService() {
  return new DealerChatService(new PostgresChatStore(pool), {
    dealerId,
    dealer: getOrCreateSettings,
    vehicle: findVisibleStockVehicle,
    staff: async () =>
      (
        await pool.query(
          "SELECT auth_user_id AS id,coalesce(nullif(name,''),email,'Staff member') AS name FROM portal_users WHERE dealer_id=$1 AND disabled_at IS NULL",
          [dealerId()],
        )
      ).rows,
  });
}
type RouterOptions = {
  service?: DealerChatService;
  staffAuth?: RequestHandler;
  settingsAuth?: RequestHandler;
  rateLimit?: boolean;
};
export function createDealerChatRouter(options: RouterOptions = {}): IRouter {
  const router = Router(),
    service = options.service ?? productionChatService();
  const buckets = new Map<string, { count: number; reset: number }>();
  router.use(["/chat", "/staff/chat"], (_req, res, next) => {
    res.set("Cache-Control", "no-store");
    next();
  });
  router.use("/staff/chat", options.staffAuth ?? requireStaff);
  router.use("/staff/chat/settings", (req, res, next) => {
    if (req.method === "GET") {
      next();
      return;
    }
    (options.settingsAuth ?? requirePermission("settings.publish"))(
      req,
      res,
      next,
    );
  });
  router.use("/chat", (req, res, next) => {
    if (options.rateLimit === false) {
      next();
      return;
    }
    const now = Date.now();
    if (buckets.size > 10_000)
      for (const [key, bucket] of buckets)
        if (bucket.reset < now) buckets.delete(key);
    const start = req.method === "POST" && req.path === "/conversations",
      window = start ? 3600_000 : 60_000,
      maximum = start ? 30 : req.method === "GET" ? 180 : 45;
    const key = `${req.ip}:${start ? "start" : req.method === "GET" ? "read" : "write"}:`;
    const bucket = buckets.get(key);
    if (!bucket || bucket.reset < now)
      buckets.set(key, { count: 1, reset: now + window });
    else if (++bucket.count > maximum) {
      res
        .set("Retry-After", String(Math.ceil((bucket.reset - now) / 1000)))
        .status(429)
        .json({
          error: "Please wait a moment before sending more chat requests.",
        });
      return;
    }
    next();
  });
  const handle =
    (run: (req: any) => Promise<unknown>, status = 200): RequestHandler =>
    async (req, res) => {
      try {
        const input = req.body;
        if (
          req.method !== "GET" &&
          input !== undefined &&
          (!input || typeof input !== "object" || Array.isArray(input))
        )
          throw new ChatError("Please check the chat request.");
        res.status(status).json(await run(req));
      } catch (error) {
        if (error instanceof ChatError)
          res.status(error.status).json({ error: error.message });
        else
          res
            .status(500)
            .json({
              error: "Chat could not be loaded or saved. Please try again.",
            });
      }
    };
  const token = (req: any) => req.get("X-Chat-Token") ?? "";
  router.get(
    "/chat/config",
    handle(() => service.config()),
  );
  router.post(
    "/chat/conversations",
    handle((req) => service.start(req.body ?? {}, token(req)), 201),
  );
  router.get(
    "/chat/conversations/:id",
    handle((req) => service.get(req.params.id, token(req))),
  );
  router.post(
    "/chat/conversations/:id/messages",
    handle((req) => service.message(req.params.id, req.body ?? {}, token(req))),
  );
  router.post(
    "/chat/conversations/:id/contact",
    handle((req) => service.contact(req.params.id, req.body ?? {}, token(req))),
  );
  router.post(
    "/chat/conversations/:id/handover",
    handle((req) => service.handover(req.params.id, token(req))),
  );
  router.get(
    "/staff/chat/conversations",
    handle(() => service.inbox()),
  );
  router.get(
    "/staff/chat/conversations/:id",
    handle((req) => service.get(req.params.id, undefined, true)),
  );
  router.post(
    "/staff/chat/conversations/:id/messages",
    handle((req) =>
      service.message(req.params.id, req.body ?? {}, undefined, {
        id: req.staff.authUserId,
        name: staffLabel(req),
      }),
    ),
  );
  router.patch(
    "/staff/chat/conversations/:id",
    handle((req) => service.update(req.params.id, req.body ?? {})),
  );
  router.post(
    "/staff/chat/conversations/:id/read",
    handle((req) => service.read(req.params.id)),
  );
  router.post(
    "/staff/chat/presence",
    handle((req) =>
      service.presence(req.staff.authUserId, req.body?.available),
    ),
  );
  router.get(
    "/staff/chat/settings",
    handle(() => service.settings()),
  );
  router.patch(
    "/staff/chat/settings",
    handle((req) => service.settings(req.body ?? {})),
  );
  const unsupported: RequestHandler = (_req, res) => {
    res.status(405).json({ error: "This chat action is unavailable." });
  };
  for (const [path, methods] of [
    ["/chat/config", "GET"],
    ["/chat/conversations", "POST"],
    ["/chat/conversations/:id", "GET"],
    ["/chat/conversations/:id/messages", "POST"],
    ["/chat/conversations/:id/contact", "POST"],
    ["/chat/conversations/:id/handover", "POST"],
    ["/staff/chat/conversations", "GET"],
    ["/staff/chat/conversations/:id", "GET, PATCH"],
    ["/staff/chat/conversations/:id/messages", "POST"],
    ["/staff/chat/conversations/:id/read", "POST"],
    ["/staff/chat/presence", "POST"],
    ["/staff/chat/settings", "GET, PATCH"],
  ])
    router.all(
      path,
      (_req, res, next) => {
        res.set("Allow", methods);
        next();
      },
      unsupported,
    );
  return router;
}
export default createDealerChatRouter();
