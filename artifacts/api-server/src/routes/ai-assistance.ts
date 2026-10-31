import { publicAiMot } from "../lib/ai-public-facts";
import { pool, db, enquiriesTable } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { requireStaff, requirePermission } from "../middlewares/staff-auth";
import { AiAssistanceStore } from "../lib/ai-assistance-store";
import { aiAssistanceRouter } from "../lib/ai-assistance-router";
import { readPublicStockCars, findVisibleStockVehicle } from "./stock";
export default aiAssistanceRouter({
  store: new AiAssistanceStore(pool),
  getSettings: async (dealer) =>
    (
      await pool.query(
        "SELECT config FROM dealer_settings WHERE dealer_id=$1",
        [dealer],
      )
    ).rows[0]?.config,
  getCars: readPublicStockCars,
  getCar: findVisibleStockVehicle,
  getEnquiry: async (dealer, id) =>
    (
      await db
        .select()
        .from(enquiriesTable)
        .where(
          and(eq(enquiriesTable.dealerId, dealer), eq(enquiriesTable.id, id)),
        )
    )[0] ?? null,
  motFact: async (car) => {
    const registration = String(car.registration ?? "")
      .replace(/\s/g, "")
      .toUpperCase();
    if (!/^[A-Z0-9]{5,8}$/.test(registration)) return null;
    const row = (
      await pool.query(
        "SELECT data FROM mot_history_cache WHERE registration=$1 AND expires_at>now()",
        [registration],
      )
    ).rows[0];
    return publicAiMot(row?.data, registration);
  },
  staffAccess: [requireStaff, requirePermission("sales.manage")],
});
