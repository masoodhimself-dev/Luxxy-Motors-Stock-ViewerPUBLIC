import { Router } from "express";
import { and, eq, sql } from "drizzle-orm";
import {
  db,
  stockChangeTasksTable,
  stockChangeSettingsTable,
} from "@workspace/db";
import {
  requirePermission,
  requireStaff,
  staffLabel,
} from "../middlewares/staff-auth";
import { currentDealerId } from "../lib/tenant-context";
import {
  activeStockPlatform,
  readStockChangeTasks,
  readStockChangeSettings,
  updateStockChangeCustomer,
  StockChangeActionError,
} from "../lib/stock-change-tasks";
import { z } from "zod/v4";
const router = Router();
const uuid = z.uuid();
const review = z
  .object({
    expectedRevision: z.number().int().nonnegative(),
    action: z.literal("reviewed"),
    note: z.string().trim().max(2000).optional(),
  })
  .strict();
const customerAction = z
  .object({
    expectedRevision: z.number().int().nonnegative(),
    expectedCustomerRevision: z.number().int().nonnegative(),
    action: z.enum(["contacted", "not_needed", "follow_up"]),
    channel: z.enum(["call", "email", "whatsapp"]).optional(),
    followUpAt: z.iso.datetime({ offset: true }).optional(),
    note: z.string().trim().max(2000).optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.action === "contacted" && !value.channel)
      ctx.addIssue({
        code: "custom",
        message: "Choose the contact channel.",
        path: ["channel"],
      });
    if (value.action === "follow_up" && !value.followUpAt)
      ctx.addIssue({
        code: "custom",
        message: "Choose a future follow-up date.",
        path: ["followUpAt"],
      });
    if (value.action !== "follow_up" && value.followUpAt)
      ctx.addIssue({
        code: "custom",
        message: "Only follow-up can have a reminder date.",
        path: ["followUpAt"],
      });
    if (value.action !== "contacted" && value.channel)
      ctx.addIssue({
        code: "custom",
        message: "Only confirmed contact can have a channel.",
        path: ["channel"],
      });
  });
const settings = z
  .object({
    minimumReduction: z.number().int().min(0).max(1000000),
    contactIntervalDays: z.number().int().min(0).max(365),
    revision: z.number().int().nonnegative(),
  })
  .strict();
const threshold = () => {
  const value = Number(process.env.STOCK_MISSING_HIDE_THRESHOLD);
  return Number.isFinite(value) && value >= 0 ? value : 2;
};
function failed(
  req: import("express").Request,
  res: import("express").Response,
  error: unknown,
) {
  req.log.error({ err: error }, "Stock-change task request failed");
  res.status(503).json({
    error: "Stock changes could not be loaded or saved. Try again shortly.",
  });
}
router.get("/staff/stock-change-settings", requireStaff, async (req, res) => {
  try {
    res.setHeader("Cache-Control", "no-store");
    res.json(await readStockChangeSettings(currentDealerId()));
  } catch (error) {
    failed(req, res, error);
  }
});
router.put(
  "/staff/stock-change-settings",
  requireStaff,
  requirePermission("settings.publish"),
  async (req, res) => {
    const parsed = settings.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error:
          "Enter a minimum reduction in pounds and a contact interval from 0 to 365 days.",
        details: parsed.error.issues,
      });
      return;
    }
    try {
      const result = await db.transaction(async (tx) => {
        await tx.execute(
          sql`SELECT pg_advisory_xact_lock(hashtext(${`stock-change-settings:${currentDealerId()}`}))`,
        );
        const current = await readStockChangeSettings(currentDealerId(), tx);
        if (current.revision !== parsed.data.revision)
          throw new StockChangeActionError(
            409,
            "These settings changed. Refresh before saving.",
          );
        const [row] = await tx
          .insert(stockChangeSettingsTable)
          .values({
            dealerId: currentDealerId(),
            minimumReduction: parsed.data.minimumReduction,
            contactIntervalDays: parsed.data.contactIntervalDays,
            revision: current.revision + 1,
          })
          .onConflictDoUpdate({
            target: stockChangeSettingsTable.dealerId,
            set: {
              minimumReduction: parsed.data.minimumReduction,
              contactIntervalDays: parsed.data.contactIntervalDays,
              revision: current.revision + 1,
              updatedAt: new Date(),
            },
          })
          .returning();
        return {
          minimumReduction: row.minimumReduction,
          contactIntervalDays: row.contactIntervalDays,
          revision: row.revision,
        };
      });
      res.setHeader("Cache-Control", "no-store");
      res.json(result);
    } catch (error) {
      if (error instanceof StockChangeActionError) {
        res.status(error.status).json({ error: error.message });
        return;
      }
      failed(req, res, error);
    }
  },
);
router.patch(
  "/staff/stock-change-tasks/:id/customers/:enquiryId",
  requireStaff,
  requirePermission("sales.manage"),
  async (req, res) => {
    if (
      !uuid.safeParse(req.params.id).success ||
      !uuid.safeParse(req.params.enquiryId).success
    ) {
      res.status(404).json({ error: "Stock change or customer not found." });
      return;
    }
    const parsed = customerAction.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: "Choose a customer outcome and refresh before saving.",
        details: parsed.error.issues,
      });
      return;
    }
    try {
      res.setHeader("Cache-Control", "no-store");
      res.json(
        await updateStockChangeCustomer({
          ...parsed.data,
          dealerId: currentDealerId(),
          taskId: req.params.id,
          enquiryId: req.params.enquiryId,
          staffName: staffLabel(req),
          missingThreshold: threshold(),
        }),
      );
    } catch (error) {
      if (error instanceof StockChangeActionError) {
        res.status(error.status).json({ error: error.message });
        return;
      }
      failed(req, res, error);
    }
  },
);
router.get("/staff/stock-change-tasks", requireStaff, async (req, res) => {
  try {
    res.setHeader("Cache-Control", "no-store");
    res.json(
      await readStockChangeTasks(currentDealerId(), {
        missingThreshold: threshold(),
      }),
    );
  } catch (error) {
    failed(req, res, error);
  }
});
router.get("/staff/stock-change-tasks/:id", requireStaff, async (req, res) => {
  if (!uuid.safeParse(req.params.id).success) {
    res.status(404).json({ error: "Stock change not found." });
    return;
  }
  try {
    const { tasks } = await readStockChangeTasks(currentDealerId(), {
      id: req.params.id,
      missingThreshold: threshold(),
    });
    if (!tasks[0]) {
      res.status(404).json({ error: "Stock change not found." });
      return;
    }
    res.setHeader("Cache-Control", "no-store");
    res.json(tasks[0]);
  } catch (error) {
    failed(req, res, error);
  }
});
router.patch(
  "/staff/stock-change-tasks/:id",
  requireStaff,
  requirePermission("stock.manage"),
  async (req, res) => {
    const parsed = review.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: "Refresh the stock change and choose Mark reviewed.",
        details: parsed.error.issues,
      });
      return;
    }
    if (!uuid.safeParse(req.params.id).success) {
      res.status(404).json({ error: "Stock change not found." });
      return;
    }
    try {
      const platform = await activeStockPlatform();
      const before = (
        await readStockChangeTasks(currentDealerId(), {
          id: req.params.id,
          missingThreshold: threshold(),
        })
      ).tasks[0];
      if (
        before?.kind === "price_drop" &&
        before.affectedCustomers.some(
          (person) =>
            person.outcome.status === "pending" ||
            person.outcome.status === "follow_up",
        )
      ) {
        res.status(409).json({
          error:
            "Finish each customer outcome before marking this price change reviewed. Contact them, choose Not needed, or leave the task open for follow-up.",
          task: before,
        });
        return;
      }
      const updated = await db
        .update(stockChangeTasksTable)
        .set({
          status: "reviewed",
          reviewedAt: new Date(),
          reviewedBy: staffLabel(req),
          note: parsed.data.note ?? null,
          revision: sql`${stockChangeTasksTable.revision}+1`,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(stockChangeTasksTable.id, req.params.id),
            eq(stockChangeTasksTable.dealerId, currentDealerId()),
            eq(stockChangeTasksTable.revision, parsed.data.expectedRevision),
            eq(stockChangeTasksTable.status, "open"),
            sql`(${stockChangeTasksTable.kind}<>'price_drop' OR NOT EXISTS (
              SELECT 1 FROM enquiries e LEFT JOIN stock_change_customer_outcomes o ON o.dealer_id=e.dealer_id AND o.enquiry_id=e.id AND o.task_id=${stockChangeTasksTable.id}
              WHERE e.dealer_id=${currentDealerId()} AND e.vehicle_id=${stockChangeTasksTable.vehicleId} AND e.status<>'closed' AND e.merged_into_id IS NULL AND coalesce(o.status,'pending') IN ('pending','follow_up')
              AND NOT EXISTS (SELECT 1 FROM sale_workspace s WHERE s.dealer_id=e.dealer_id AND s.state#>>'{draft,vehicleId}'=e.vehicle_id::text AND (s.state#>>'{draft,sourceEnquiryId}'=e.id::text OR (nullif(e.email,'') IS NOT NULL AND lower(s.state#>>'{draft,email}')=lower(e.email)) OR (nullif(e.phone,'') IS NOT NULL AND nullif(regexp_replace(regexp_replace(regexp_replace(s.state#>>'{draft,phone}','[^0-9]','','g'),'^00',''),'^0','44'),'')=nullif(regexp_replace(regexp_replace(regexp_replace(e.phone,'[^0-9]','','g'),'^00',''),'^0','44'),''))) AND coalesce(s.state#>>'{lifecycle,status}','')<>'released')
              AND NOT EXISTS (SELECT 1 FROM leads l WHERE l.dealer_id=e.dealer_id AND l.vehicle_id=e.vehicle_id AND (l.enquiry_id=e.id OR (nullif(e.email,'') IS NOT NULL AND lower(l.email)=lower(e.email)) OR (nullif(e.phone,'') IS NOT NULL AND nullif(regexp_replace(regexp_replace(regexp_replace(l.phone,'[^0-9]','','g'),'^00',''),'^0','44'),'')=nullif(regexp_replace(regexp_replace(regexp_replace(e.phone,'[^0-9]','','g'),'^00',''),'^0','44'),''))) AND l.closed_at IS NULL AND (l.deposit_pence>0 OR l.stage IN ('reserved','sale_agreed')))
            ))`,
            sql`EXISTS (SELECT 1 FROM vehicles v WHERE v.dealer_id=${currentDealerId()} AND v.id=${stockChangeTasksTable.vehicleId} AND v.source=${platform} AND v.archived_at IS NULL AND v.inventory_status IN ('available','reserved') AND ((${stockChangeTasksTable.kind}='missing_stock' AND v.source_status='missing') OR (${stockChangeTasksTable.kind}='price_drop' AND v.currency='GBP' AND v.source_status='live' AND v.missing_count<${threshold()} AND coalesce(v.website_price_override,v.source_price)=${stockChangeTasksTable.currentPrice})))`,
          ),
        )
        .returning({ id: stockChangeTasksTable.id });
      const { tasks } = await readStockChangeTasks(currentDealerId(), {
        id: req.params.id,
        missingThreshold: threshold(),
      });
      if (!tasks[0]) {
        res.status(404).json({ error: "Stock change not found." });
        return;
      }
      if (!updated[0]) {
        res.status(409).json({
          error:
            "This stock change has changed. Refresh before marking it reviewed.",
          revision: tasks[0].revision,
          task: tasks[0],
        });
        return;
      }
      res.json(tasks[0]);
    } catch (error) {
      failed(req, res, error);
    }
  },
);
export default router;
