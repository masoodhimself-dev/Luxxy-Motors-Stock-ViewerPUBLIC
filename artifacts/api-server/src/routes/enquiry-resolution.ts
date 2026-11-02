import { Router } from "express";
import { pool } from "@workspace/db";
import { z } from "zod/v4";
import { currentDealerId } from "../lib/tenant-context";
import {
  requirePermission,
  requireStaff,
  staffLabel,
} from "../middlewares/staff-auth";

type Row = Record<string, any>;
type Client = {
  query: (text: string, values?: any[]) => Promise<{ rows: Row[] }>;
  release: () => void;
};
type Database = { connect: () => Promise<Client> };
const idSchema = z.string().uuid();
const inputSchema = z
  .object({
    expectedRevision: z.number().int().min(0),
    status: z.literal("closed"),
  })
  .strict();
type Input = z.infer<typeof inputSchema>;
export class EnquiryResolutionError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

/** Resolves only the selected original. Linked enquiries retain their own work and status. */
export class EnquiryResolutionStore {
  constructor(
    private database: Database = pool,
    private options: { clock?: () => Date } = {},
  ) {}
  async update(
    dealer: string,
    id: string,
    input: Input,
    staff: { id: string; name: string },
  ) {
    if (
      !idSchema.safeParse(id).success ||
      !inputSchema.safeParse(input).success ||
      !staff.id
    )
      throw new EnquiryResolutionError(
        "Check the enquiry and requested status.",
        400,
      );
    const client = await this.database.connect();
    try {
      await client.query("BEGIN");
      // Merge membership cannot change under this selected-record operation.
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
        `enquiry-merge:${dealer}`,
      ]);
      const entry = (
        await client.query(
          "SELECT * FROM enquiries WHERE dealer_id=$1 AND id=$2::uuid FOR UPDATE",
          [dealer, id],
        )
      ).rows[0];
      if (!entry) throw new EnquiryResolutionError("Enquiry not found.", 404);
      if (entry.workspace_revision !== input.expectedRevision)
        throw new EnquiryResolutionError(
          "This enquiry changed. Refresh and review it before changing its status.",
          409,
        );
      if (input.status === "closed") {
        if (
          entry.appointment_at &&
          !entry.appointment_cancelled_at &&
          !["completed", "no_show"].includes(entry.attendance)
        )
          throw new EnquiryResolutionError(
            "Record the test-drive outcome or cancel the appointment before marking this enquiry done.",
            409,
          );
        if (entry.follow_up_at && !entry.follow_up_completed_at)
          throw new EnquiryResolutionError(
            "Complete or cancel the outstanding follow-up before marking this enquiry done.",
            409,
          );
        // A plain read avoids reversing the receiving worker's reply-row/enquiry-row lock order.
        // The enquiry lock also serialises accepted customer-message revisions.
        const pending = (
          await client.query(
            "SELECT id FROM enquiry_email_replies WHERE dealer_id=$1 AND enquiry_id=$2::uuid AND resolved_at IS NULL LIMIT 1",
            [dealer, id],
          )
        ).rows.length;
        if (pending)
          throw new EnquiryResolutionError(
            "Reply to or mark the incoming email handled before marking this enquiry done.",
            409,
          );
        const sending = (
          await client.query(
            "SELECT id FROM email_outbox WHERE dealer_id=$1 AND enquiry_id=$2::uuid AND status IN ('queued','sending','unknown') LIMIT 1",
            [dealer, id],
          )
        ).rows.length;
        if (sending)
          throw new EnquiryResolutionError(
            "An email is queued or awaiting its sending result. Check it before marking this enquiry done.",
            409,
          );
      }
      if (entry.status === input.status) {
        await client.query("COMMIT");
        return {
          id,
          status: entry.status as "closed",
          workspaceRevision: entry.workspace_revision,
          updatedAt: entry.updated_at,
          changed: false,
        };
      }
      const now = this.options.clock?.() ?? new Date();
      const changed = (
        await client.query(
          "UPDATE enquiries SET status=$3::enquiry_status,workspace_revision=workspace_revision+1,updated_at=$4 WHERE dealer_id=$1 AND id=$2::uuid RETURNING id,status,workspace_revision,updated_at",
          [dealer, id, input.status, now],
        )
      ).rows[0]!;
      await client.query(
        "INSERT INTO enquiry_events(dealer_id,enquiry_id,vehicle_id,vehicle_title,vehicle_url,kind,actor,summary,detail,occurred_at) VALUES($1,$2::uuid,$3::uuid,$4,$5,'conversation_logged','dealer',$6,$7::jsonb,$8)",
        [
          dealer,
          id,
          entry.vehicle_id,
          entry.vehicle_title,
          entry.vehicle_url,
          "Enquiry marked done",
          JSON.stringify({
            action: "enquiry_resolution",
            previousStatus: entry.status,
            status: input.status,
            expectedRevision: input.expectedRevision,
            staffId: staff.id,
            staffName: staff.name,
            note: "Marked done. Messages and linked records have been kept.",
          }),
          now,
        ],
      );
      await client.query("COMMIT");
      return {
        id,
        status: changed.status as "closed",
        workspaceRevision: changed.workspace_revision,
        updatedAt: changed.updated_at,
        changed: true,
      };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}

export function enquiryResolutionRouter(store = new EnquiryResolutionStore()) {
  const router = Router();
  router.post(
    "/staff/enquiries/:id/resolution",
    requireStaff,
    requirePermission("sales.manage"),
    async (req, res) => {
      res.set("Cache-Control", "no-store");
      const parsed = inputSchema.safeParse(req.body),
        id = String(req.params.id);
      if (!idSchema.safeParse(id).success || !parsed.success) {
        res
          .status(400)
          .json({ error: "Check the enquiry and requested status." });
        return;
      }
      try {
        res.json(
          await store.update(currentDealerId(), id, parsed.data, {
            id: req.staff!.authUserId,
            name: staffLabel(req),
          }),
        );
      } catch (error) {
        if (error instanceof EnquiryResolutionError) {
          res.status(error.status).json({ error: error.message });
          return;
        }
        req.log.error("Unable to change enquiry resolution");
        res.status(503).json({
          error: "Unable to change this enquiry. Refresh and try again.",
        });
      }
    },
  );
  return router;
}
export default enquiryResolutionRouter();
