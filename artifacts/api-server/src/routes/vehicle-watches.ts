import { Router, type Request, type Response } from "express";
import { z } from "zod/v4";
import {
  requireStaff,
  requirePermission,
  staffLabel,
} from "../middlewares/staff-auth";
import { staffWriteOriginAllowed } from "../middlewares/staff-write-origin";
import {
  allowWatchRequest,
  normalWatchEmail,
  readVehicleWatchSettings,
  saveVehicleWatchSettings,
  requestVehicleWatch,
  requestWatchManageLink,
  readVehicleWatches,
  verifyVehicleWatch,
  stopVehicleWatch,
  readVehicleWatchCounts,
  readVehicleWatchTasks,
  previewVehicleWatchTask,
  sendVehicleWatchTask,
  VehicleWatchError,
} from "../lib/vehicle-watches";
const router = Router();
const generic = {
  accepted: true,
  message: "If this address can receive updates, check your email to confirm.",
};
const email = z.string().trim().max(254).email().transform(normalWatchEmail);
const signup = z
  .object({
    vehicleId: z.uuid(),
    email,
    website: z.string().max(500).optional(),
  })
  .strict();
const manage = z
  .object({ email, website: z.string().max(500).optional() })
  .strict();
const preview = z
  .object({
    subject: z
      .string()
      .trim()
      .min(1)
      .max(200)
      .refine((v) => !/[\r\n\x00-\x1f\x7f]/.test(v)),
    message: z.string().trim().min(1).max(12000),
    expectedRevision: z.number().int().nonnegative(),
    watchIds: z
      .array(z.uuid())
      .min(1)
      .max(20)
      .refine((v) => new Set(v).size === v.length),
  })
  .strict();
function failure(req: Request, res: Response, error: unknown) {
  if (error instanceof VehicleWatchError) {
    res.status(error.status).json({ error: error.message });
    return;
  }
  req.log?.warn("A vehicle watch request could not be completed.");
  res
    .status(503)
    .json({
      error:
        "Car updates are temporarily unavailable. Please try again shortly.",
    });
}
router.use(
  [
    "/vehicle-watches",
    "/staff/vehicle-watch-tasks",
    "/staff/vehicle-watch-counts",
    "/staff/vehicle-watch-settings",
  ],
  (req, res, next) => {
    res.set({
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
      "X-Robots-Tag": "noindex, nofollow",
    });
    if (
      !staffWriteOriginAllowed({ method: req.method, get: (n) => req.get(n) })
    ) {
      res
        .status(403)
        .json({ error: "Open this action on the dealership website." });
      return;
    }
    next();
  },
);
router.get("/vehicle-watches/availability", async (req, res) => {
  try {
    const s = await readVehicleWatchSettings();
    res.json({ enabled: s.enabled && s.emailReady, emailReady: s.emailReady });
  } catch (error) {
    failure(req, res, error);
  }
});
router.post("/vehicle-watches", async (req, res) => {
  const p = signup.safeParse(req.body);
  if (!p.success) {
    res
      .status(400)
      .json({ error: "Enter a valid email address and choose a car." });
    return;
  }
  try {
    if (
      !p.data.website &&
      (await allowWatchRequest(p.data.email, req.ip || "unknown"))
    )
      await requestVehicleWatch(p.data.vehicleId, p.data.email);
    res.status(202).json(generic);
  } catch (error) {
    req.log?.warn("A requested vehicle watch confirmation awaits retry.");
    res.status(202).json(generic);
  }
});
router.post("/vehicle-watches/manage-link", async (req, res) => {
  const p = manage.safeParse(req.body);
  if (!p.success) {
    res.status(400).json({ error: "Enter a valid email address." });
    return;
  }
  try {
    if (
      !p.data.website &&
      (await allowWatchRequest(p.data.email, req.ip || "unknown"))
    )
      await requestWatchManageLink(p.data.email);
    res.status(202).json(generic);
  } catch {
    res.status(202).json(generic);
  }
});
router.post("/vehicle-watches/verify", async (req, res) => {
  const p = z
    .object({ token: z.string().max(100) })
    .strict()
    .safeParse(req.body);
  if (!p.success) {
    res
      .status(410)
      .json({ error: "This private link is invalid or has expired." });
    return;
  }
  try {
    res.json(await verifyVehicleWatch(p.data.token));
  } catch (error) {
    failure(req, res, error);
  }
});
router.get("/vehicle-watches/manage", async (req, res) => {
  try {
    res.json(await readVehicleWatches(req.get("x-vehicle-watch-token") || ""));
  } catch (error) {
    failure(req, res, error);
  }
});
router.post("/vehicle-watches/:id/stop", async (req, res) => {
  if (!z.uuid().safeParse(req.params.id).success) {
    res.status(404).json({ error: "Watch not found." });
    return;
  }
  try {
    res.json(
      await stopVehicleWatch(
        req.get("x-vehicle-watch-token") || "",
        String(req.params.id),
      ),
    );
  } catch (error) {
    failure(req, res, error);
  }
});
router.get("/staff/vehicle-watch-settings", requireStaff, async (req, res) => {
  try {
    res.json(await readVehicleWatchSettings());
  } catch (error) {
    failure(req, res, error);
  }
});
router.put(
  "/staff/vehicle-watch-settings",
  requireStaff,
  requirePermission("settings.publish"),
  async (req, res) => {
    const p = z
      .object({
        enabled: z.boolean(),
        revision: z.number().int().nonnegative(),
      })
      .strict()
      .safeParse(req.body);
    if (!p.success) {
      res
        .status(400)
        .json({ error: "Choose whether car updates are enabled." });
      return;
    }
    try {
      res.json(await saveVehicleWatchSettings(p.data.enabled, p.data.revision));
    } catch (error) {
      failure(req, res, error);
    }
  },
);
router.get("/staff/vehicle-watch-counts", requireStaff, async (req, res) => {
  try {
    res.json(await readVehicleWatchCounts());
  } catch (error) {
    failure(req, res, error);
  }
});
router.get("/staff/vehicle-watch-tasks", requireStaff, async (req, res) => {
  try {
    res.json(await readVehicleWatchTasks());
  } catch (error) {
    failure(req, res, error);
  }
});
router.post(
  "/staff/vehicle-watch-tasks/:id/preview",
  requireStaff,
  requirePermission("sales.manage"),
  async (req, res) => {
    const p = preview.safeParse(req.body);
    if (!p.success || !z.uuid().safeParse(req.params.id).success) {
      res
        .status(400)
        .json({ error: "Check the message and choose up to 20 customers." });
      return;
    }
    try {
      res.json(await previewVehicleWatchTask(String(req.params.id), p.data));
    } catch (error) {
      failure(req, res, error);
    }
  },
);
router.post(
  "/staff/vehicle-watch-tasks/:id/send",
  requireStaff,
  requirePermission("sales.manage"),
  async (req, res) => {
    const p = preview
      .extend({
        previewHash: z.string().regex(/^[a-f0-9]{64}$/),
        requestId: z.uuid(),
      })
      .safeParse(req.body);
    if (!p.success || !z.uuid().safeParse(req.params.id).success) {
      res
        .status(400)
        .json({ error: "Review the message and recipients before sending." });
      return;
    }
    try {
      res.json(
        await sendVehicleWatchTask(
          String(req.params.id),
          p.data,
          staffLabel(req),
        ),
      );
    } catch (error) {
      failure(req, res, error);
    }
  },
);
export default router;
