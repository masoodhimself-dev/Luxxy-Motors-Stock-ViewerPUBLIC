import { currentDealerId } from "../lib/tenant-context";
import { Router, type IRouter } from "express";
import { and, desc, eq, isNotNull } from "drizzle-orm";
import { GetRecentHandoversResponse } from "@workspace/api-zod";
import { db, salesTable, vehiclesTable } from "@workspace/db";
import { getOrCreateSettings } from "./dealer-settings";

const router: IRouter = Router();

function dealerId() {
  return currentDealerId();
}

function handoverMonth(completedAt: Date) {
  return new Intl.DateTimeFormat("en-GB", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(completedAt);
}

/**
 * Public social proof is deliberately separate from saleSummary. Keep this
 * projection allowlisted: no sale, customer, payment, registration, document,
 * fulfilment, signature, address, note, or internal identifier may cross it.
 */
router.get("/recent-handovers", async (req, res): Promise<void> => {
  try {
    const settings = await getOrCreateSettings();
    if (!settings.recentHandovers.enabled) {
      res.json(GetRecentHandoversResponse.parse({ schemaVersion: 1, handovers: [] }));
      return;
    }

    const count = Math.min(6, Math.max(1, settings.recentHandovers.count));
    const rows = await db
      .select({
        completedAt: salesTable.completedAt,
        make: vehiclesTable.make,
        model: vehiclesTable.model,
        trim: vehiclesTable.trim,
        year: vehiclesTable.year,
        bodyType: vehiclesTable.bodyType,
        fuel: vehiclesTable.fuel,
        transmission: vehiclesTable.transmission,
      })
      .from(salesTable)
      .innerJoin(vehiclesTable, eq(vehiclesTable.id, salesTable.vehicleId))
      .where(
        and(
          eq(salesTable.dealerId, dealerId()),
          eq(salesTable.status, "completed"),
          isNotNull(salesTable.completedAt),
          eq(vehiclesTable.dealerId, dealerId()),
        ),
      )
      .orderBy(desc(salesTable.completedAt))
      .limit(count);

    res.json(
      GetRecentHandoversResponse.parse({
        schemaVersion: 1,
        handovers: rows
          .filter((row): row is typeof row & { completedAt: Date } => row.completedAt !== null)
          .map((row) => ({
            vehicle: {
              make: row.make,
              model: row.model,
              trim: row.trim,
              year: row.year,
              bodyType: row.bodyType,
              fuel: row.fuel,
              transmission: row.transmission,
            },
            handoverMonth: handoverMonth(row.completedAt),
          })),
      }),
    );
  } catch (error) {
    req.log.error({ err: error }, "Recent handovers route failed");
    res.status(500).json({ error: "Unable to load recent handovers" });
  }
});

export default router;