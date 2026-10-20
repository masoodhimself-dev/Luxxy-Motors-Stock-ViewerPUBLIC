import { Router } from "express";
import { and, eq, sql } from "drizzle-orm";
import { db, stockChangeTasksTable } from "@workspace/db";
import {
  requirePermission,
  requireStaff,
  staffLabel,
} from "../middlewares/staff-auth";
import { currentDealerId } from "../lib/tenant-context";
import {
  activeStockPlatform,
  readStockChangeTasks,
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
