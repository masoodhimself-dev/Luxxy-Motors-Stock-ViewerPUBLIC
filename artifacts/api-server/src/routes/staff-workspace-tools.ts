import { Router, type Request, type Response } from "express";
import { pool } from "@workspace/db";
import {
  requireStaff,
  requirePermission,
  staffLabel,
} from "../middlewares/staff-auth";
import { enforceStaffWriteOrigin } from "../middlewares/staff-write-origin";
import { currentDealerId } from "../lib/tenant-context";
import { roleHasPermission } from "../lib/staff-permissions";
import {
  ReplyPresenceStore,
  publicPresence,
  reportRange,
  searchWorkspace,
  validWorkspaceId,
  workspaceReport,
  workspaceReportCsv,
  WorkspaceToolsError,
  type WorkspaceDatabase,
} from "../lib/staff-workspace-tools";
export function staffWorkspaceToolsRouter(database: WorkspaceDatabase = pool) {
  const router = Router(),
    presence = new ReplyPresenceStore(database);
  router.use("/staff/workspace", requireStaff, (_req, res, next) => {
    res.set({
      "Cache-Control": "no-store, private",
      "X-Robots-Tag": "noindex, nofollow",
    });
    next();
  });
  const fail = (req: Request, res: Response, error: unknown) => {
    if (error instanceof WorkspaceToolsError)
      return res.status(error.status).json({ error: error.message });
    req.log?.error({ err: error }, "Staff workspace tools failed");
    return res
      .status(503)
      .json({
        error: "Workspace tools could not load. Refresh and try again.",
      });
  };
  router.get("/staff/workspace/search", async (req, res) => {
    try {
      if (
        !roleHasPermission(req.staff?.role, "sales.manage") &&
        !roleHasPermission(req.staff?.role, "finance.export")
      )
        throw new WorkspaceToolsError("Search access is unavailable.", 403);
      res.json(
        await searchWorkspace(
          database,
          currentDealerId(),
          typeof req.query.q === "string" ? req.query.q : "",
          roleHasPermission(req.staff?.role, "sales.manage"),
        ),
      );
    } catch (e) {
      fail(req, res, e);
    }
  });
  router.all(
    "/staff/workspace/presence/:id",
    requirePermission("sales.manage"),
    async (req, res) => {
      try {
        const id = String(req.params.id),
          session = String(
            req.method === "GET"
              ? req.query.session
              : (req.body?.session ?? ""),
          );
        if (!validWorkspaceId(id) || !validWorkspaceId(session))
          throw new WorkspaceToolsError(
            "Choose a valid enquiry and browser session.",
          );
        const dealer = currentDealerId(),
          staff = req.staff!;
        if (req.method === "GET")
          return res.json({
            presence: publicPresence(
              await presence.read(dealer, id),
              staff.authUserId,
              session,
            ),
          });
        if (!enforceStaffWriteOrigin(req, res)) return;
        if (req.method === "DELETE") {
          await presence.release(dealer, id, staff.authUserId, session);
          return res.json({ released: true });
        }
        if (req.method !== "POST")
          return res
            .status(405)
            .set("Allow", "GET, POST, DELETE")
            .json({ error: "Method not allowed." });
        if (
          req.body?.takeover !== undefined &&
          typeof req.body.takeover !== "boolean"
        )
          throw new WorkspaceToolsError("Check the take-over request.");
        const result = await presence.claim(
          dealer,
          id,
          { id: staff.authUserId, name: staffLabel(req) },
          session,
          req.body?.takeover === true,
        );
        return res.json({
          claimed: result.claimed,
          presence: publicPresence(result.presence, staff.authUserId, session),
        });
      } catch (e) {
        return fail(req, res, e);
      }
    },
  );
  router.get(
    ["/staff/workspace/report", "/staff/workspace/report.csv"],
    requirePermission("finance.export"),
    async (req, res) => {
      try {
        if (req.staff?.role !== "owner")
          throw new WorkspaceToolsError(
            "Only an owner can view this operations report.",
            403,
          );
        const range = reportRange(req.query.from, req.query.to),
          report = await workspaceReport(
            database,
            currentDealerId(),
            range.from,
            range.to,
          );
        if (req.path.endsWith(".csv"))
          return res
            .type("text/csv")
            .set(
              "Content-Disposition",
              'attachment; filename="dealer-operations.csv"',
            )
            .send(workspaceReportCsv(report));
        return res.json(report);
      } catch (e) {
        return fail(req, res, e);
      }
    },
  );
  return router;
}
export default staffWorkspaceToolsRouter();
