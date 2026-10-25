import { db } from '@workspace/db';
import { sql } from 'drizzle-orm';
import { canonicalCustomerPhone } from '@workspace/vehicle-meta';
import { z } from 'zod/v4';
import { activeStockPlatform, readStockChangeTasks } from './stock-change-tasks';
import { readPriceUpdateClaim, stockPriceIdentity } from './price-update-dedup';

/** Provenance only: staff wording stays editable and is never regenerated here. */
export const stockChangeMessageSchema = z.object({
  taskId: z.string().uuid(), revision: z.number().int().nonnegative(),
}).strict();
export type StockChangeMessageContext = z.infer<typeof stockChangeMessageSchema>;
export class StockChangeMessageError extends Error {
  constructor(message: string, readonly status = 409, readonly code: 'price_update_changed' | 'price_update_already_approved' = 'price_update_changed') { super(message); }
}
export function savedStockChangeContext(saved: { savedDraft?: { content?: unknown } | null }) {
  const content = saved.savedDraft?.content;
  if (!content || typeof content !== 'object' || !('stockChange' in content)) return undefined;
  const result = stockChangeMessageSchema.safeParse(content.stockChange);
  if (!result.success) throw new StockChangeMessageError('This saved price-update draft needs review. Discard it before starting a fresh message.');
  return result.data;
}
export function requireSavedStockChangeContext(
  submitted: StockChangeMessageContext | undefined,
  saved: { savedDraft?: { content?: unknown } | null },
) {
  const previous = savedStockChangeContext(saved);
  if (previous && (!submitted || previous.taskId !== submitted.taskId || previous.revision !== submitted.revision))
    throw new StockChangeMessageError('This saved draft is a price update. Reopen it with its price details, or discard it before starting a fresh message.');
}
// Reuse the caller's transaction. No values are interpolated into SQL text.
export const stockContextQuery = (executor: Pick<typeof db, 'execute'>) => async (text: string, values: unknown[] = []) => {
  const chunks = text.split(/(\$[1-9][0-9]*)/g).filter(Boolean).map(chunk => /^\$[1-9][0-9]*$/.test(chunk) ? sql`${values[Number(chunk.slice(1)) - 1]}` : sql.raw(chunk));
  const result = await executor.execute(sql.join(chunks, sql``));
  return {rows: result.rows as Record<string, any>[]};
};
export type StockChangeContextReader = Pick<typeof db, 'execute'> | {query: (text:string, values?:unknown[]) => Promise<{rows:Record<string, any>[]}>; activePlatform:string};
export async function validateStockChangeMessage(
  context: StockChangeMessageContext | undefined,
  target: { dealerId: string; enquiryId: string; email?: string; phone?: string; priceClaimSource?: string },
  executor: StockChangeContextReader = db,
) {
  if (!context) return undefined;
  const parsed = stockChangeMessageSchema.safeParse(context);
  if (!parsed.success) throw new StockChangeMessageError('This price-update link needs review. Create a fresh message from the current price reduction.');
  const query = 'execute' in executor ? stockContextQuery(executor) : executor.query;
  const activePlatform = 'execute' in executor ? await activeStockPlatform(executor) : executor.activePlatform;
  const configuredThreshold = Number(process.env.STOCK_MISSING_HIDE_THRESHOLD);
  const missingThreshold = Number.isFinite(configuredThreshold) && configuredThreshold >= 0 ? configuredThreshold : 2;
  const { tasks } = await readStockChangeTasks(target.dealerId, {id: context.taskId, query, activePlatform, missingThreshold});
  const task = tasks[0];
  if (!task || task.kind !== 'price_drop' || task.status !== 'open' || task.revision !== context.revision || !task.publiclyVisible)
    throw new StockChangeMessageError('This price reduction has changed or is no longer available. Review the latest car and price before preparing another message.');
  const current = (await query('SELECT inventory_status FROM vehicles WHERE dealer_id=$1 AND id=$2', [target.dealerId, task.vehicleId])).rows[0];
  if (current?.inventory_status !== 'available')
    throw new StockChangeMessageError('This car is no longer available. Review its stock status before contacting interested customers.');
  const customer = task.affectedCustomers.find(person => person.enquiryId === target.enquiryId);
  if (!customer)
    throw new StockChangeMessageError('This customer is no longer eligible for this price update. Review their enquiry and any agreed sale or reservation.');
  if (target.email && (!customer.email || customer.email.trim().toLowerCase() !== target.email.trim().toLowerCase()))
    throw new StockChangeMessageError('The customer email changed or cannot receive this price update. Review the enquiry contact details.');
  if (target.phone && (!customer.phone || canonicalCustomerPhone(customer.phone) !== canonicalCustomerPhone(target.phone)))
    throw new StockChangeMessageError('Use this customer’s current phone number for the price update. Review their enquiry contact details.');
  // The same verified address may both watch the car and have an enquiry.
  // A saved draft is not a new entitlement to contact it for the same drop.
  const email = target.email || customer.email;
  if (email) {
    const identity = await stockPriceIdentity(query, target.dealerId, context.taskId, email);
    if (identity) {
      const claim = await readPriceUpdateClaim(query, identity);
      if (claim && claim.source_key !== target.priceClaimSource)
        throw new StockChangeMessageError('A price update for this customer is already approved, sent or awaiting a delivery check. Review their conversation before sending another update.', 409, 'price_update_already_approved');
    }
    // Also protect candidate deliveries created before the shared claim was
    // installed, including uncertainty that must never invite a second send.
    const watch = (await query(`SELECT 1 FROM vehicle_watch_deliveries d JOIN vehicle_watch_events e ON e.id=d.event_id AND e.dealer_id=d.dealer_id JOIN vehicle_watches w ON w.id=d.watch_id AND w.dealer_id=d.dealer_id JOIN stock_change_tasks t ON t.dealer_id=e.dealer_id AND t.vehicle_id=e.vehicle_id AND e.change_key='price:'||t.change_key WHERE t.dealer_id=$1 AND t.id=$2 AND w.email=$3 AND e.kind='price_drop' AND d.status IN ('processing','sent','uncertain') LIMIT 1`, [target.dealerId,context.taskId,email.trim().toLowerCase()])).rows[0];
    if (watch)
      throw new StockChangeMessageError('This customer already has a Watch price update approved, sent or awaiting a delivery check. Review their conversation before sending another update.', 409, 'price_update_already_approved');
  }
  return task;
}
