import { Router, type IRouter } from 'express';
import { and, asc, eq, inArray, or, sql } from 'drizzle-orm';
import { db, enquiriesTable, enquiryEventsTable } from '@workspace/db';
import { EnquiryMergeError, parseEnquiryMergeInput, planEnquiryMerge } from '@workspace/vehicle-meta';
import { requirePermission, requireStaff, staffLabel } from '../middlewares/staff-auth';

const router: IRouter = Router();
const dealerId = () => process.env.STOCK_DEALER_ID ?? 'luxxy-motors';

router.post('/staff/enquiries/:id/merge', requireStaff, requirePermission('sales.manage'), async (req, res) => {
  try {
    // Validate before touching the database. The path, never the body, chooses the main record.
    const input = parseEnquiryMergeInput(req.body, String(req.params.id));
    const result = await db.transaction(async tx => {
      const dealer = dealerId();
      // Serialise case membership changes, including two merges with disjoint selected IDs
      // that might otherwise observe an old membership while groups are flattened.
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`enquiry-merge:${dealer}`}))`);
      const records = await tx.select().from(enquiriesTable).where(and(eq(enquiriesTable.dealerId, dealer), or(inArray(enquiriesTable.id, input.recordIds), inArray(enquiriesTable.mergedIntoId, input.recordIds)))).orderBy(asc(enquiriesTable.id)).for('update');
      const plan = planEnquiryMerge(input, records, { id: req.staff!.authUserId, name: staffLabel(req) });
      for (const change of plan.updates) {
        await tx.update(enquiriesTable).set(change.update).where(and(eq(enquiriesTable.dealerId, dealer), eq(enquiriesTable.id, change.id)));
      }
      await tx.insert(enquiryEventsTable).values(plan.events.map(event => {
        const original = records.find(record => record.id === event.enquiryId)!;
        return { ...event, dealerId: dealer, kind: 'records_merged' as const, actor: 'dealer' as const, vehicleId: original.vehicleId, vehicleTitle: original.vehicleTitle, vehicleUrl: original.vehicleUrl };
      }));
      return { primaryId: plan.primaryId, recordIds: plan.recordIds, cancelledAppointmentIds: plan.cancelledAppointmentIds };
    });
    res.json(result);
  } catch (error) {
    if (error instanceof EnquiryMergeError) { res.status(error.status).json({ error: error.message }); return; }
    req.log.error({ err: error }, 'Unable to merge enquiries');
    res.status(500).json({ error: 'The records could not be merged. Refresh and try again.' });
  }
});

export default router;
