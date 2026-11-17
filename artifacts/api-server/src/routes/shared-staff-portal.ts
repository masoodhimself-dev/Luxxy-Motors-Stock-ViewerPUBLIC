import { getAuth } from "@clerk/express";
import { pool } from "@workspace/db";
import { Router, type Request, type RequestHandler } from "express";
import { isStaffRole, permissionsForRole, type StaffRole } from "../lib/staff-permissions";
import { runWithTenant, type TenantContext } from "../lib/tenant-context";
import { sharedStaffPortalForHost, sharedStaffScopeIncludes, type SharedStaffDealerScope } from "../lib/shared-staff-portal";

type Membership = {
  dealerId: string;
  authUserId: string;
  dealerName: string;
  canonicalOrigin: string;
  platform: "cazoo" | "autotrader";
  retailerId: string;
  sourceUrl: string;
  role: StaffRole;
  name: string | null;
  email: string | null;
};

async function readMemberships(userId: string, dealerIds: SharedStaffDealerScope): Promise<Membership[]> {
  const result = await pool.query<Membership>(`
    SELECT d.id AS "dealerId", d.name AS "dealerName", d.canonical_origin AS "canonicalOrigin",
      d.stock_platform AS platform, d.retailer_id AS "retailerId", d.source_url AS "sourceUrl",
      COALESCE(legacy.auth_user_id,s.auth_user_id) AS "authUserId",
      COALESCE(legacy.role,s.role) AS role, COALESCE(legacy.name,s.name) AS name, s.email
    FROM portal_users s
    JOIN dealerships d ON d.id=s.dealer_id
    LEFT JOIN portal_users legacy ON legacy.dealer_id=s.dealer_id
      AND legacy.id=s.legacy_portal_user_id AND NOT legacy.shared_staff_identity
    WHERE s.auth_user_id=$1 AND s.disabled_at IS NULL AND s.shared_staff_identity AND d.status='active' AND d.plan='full_portal'
      AND ($2::text[] IS NULL OR s.dealer_id=ANY($2::text[]))
      AND (s.legacy_portal_user_id IS NULL OR (legacy.id IS NOT NULL AND legacy.disabled_at IS NULL))
      AND NOT EXISTS (SELECT 1 FROM dealer_demos m WHERE m.dealer_id=d.id AND m.converted_at IS NULL)
    ORDER BY d.name,d.id
  `, [userId, dealerIds === "*" ? null : dealerIds]);
  return result.rows.filter((row) => isStaffRole(row.role) && sharedStaffScopeIncludes(dealerIds, row.dealerId));
}

const staffPage = /^\/(?:portal(?:\/leads\/[a-f0-9-]{36})?\/?|join\/?|sign-(?:in|up)(?:\/.*)?)$/i;
const scopedPage = /^\/dealers\/([a-z0-9][a-z0-9-]{1,62})\/portal(?:\/leads\/[a-f0-9-]{36})?\/?$/;
const staticPage = /^\/(?:assets\/|brand\/|favicon\.svg$|portal\.webmanifest$)/;
const apiRoot = /^\/(?:staff|leads|sale-workspace|sale-operations|sale-return-inspection|sales-terms|dealer-integrations|dealer-settings|dealer-operations|email-templates|features|test-drive-bookings)(?:\/|$)/i;
const apiRead = /^\/(?:portal\/(?:session|worklist)|ai\/status|stock|enquiries(?:\/availability)?|reservations|contact-intents|website-assets\/[a-f0-9-]{36}|vehicles\/[a-f0-9-]{36}(?:\/brochure\.pdf)?)(?:\/)?$/i;
const apiOther = /^\/(?:enquiries\/[a-f0-9-]{36}\/status|test-drive-bookings\/[a-f0-9-]{36}\/decision|reservations\/[a-f0-9-]{36}\/cancel|customer-intake-sessions|postcodes(?:\/.*)?|mot-mileage-estimate)\/?$/i;

function requestOriginMatches(req: Request, origin: string) {
  const supplied = req.get("origin");
  const site = req.get("sec-fetch-site");
  return (!supplied || supplied === origin) && (!site || site === "same-origin" || site === "none");
}

function tenantForMember({ dealerId, canonicalOrigin, platform, retailerId, sourceUrl }: Membership): TenantContext {
  return { dealerId, canonicalOrigin, platform, retailerId, sourceUrl, kind: "website", plan: "full_portal" };
}

export function createSharedStaffPortal(
  api: ReturnType<typeof Router>,
  invitations: ReturnType<typeof Router>,
  deps = { readMemberships, userId: (req: Request) => getAuth(req).userId },
): RequestHandler {
  const router = Router();
  router.use((_req, res, next) => {
    res.set({ "Cache-Control": "private, no-store", "X-Robots-Tag": "noindex, nofollow", "Referrer-Policy": "no-referrer" });
    next();
  });
  router.get("/", (_req, res) => { res.redirect(302, "/portal"); });
  router.get("/robots.txt", (_req, res) => { res.type("text").send("User-agent: *\nDisallow: /\n"); });
  router.get("/api/staff-portal/memberships", async (req, res) => {
    const config = sharedStaffPortalForHost(req.get("host"));
    if (!config || !requestOriginMatches(req, config.origin)) { res.sendStatus(403); return; }
    const userId = deps.userId(req);
    if (!userId) { res.status(401).json({ error: "Sign in to open your dealership workspace." }); return; }
    const memberships = await deps.readMemberships(userId, config.dealerIds);
    res.json({ dealerships: memberships.map(({ dealerId, dealerName, role }) => ({ dealerId, dealerName, role })) });
  });
  router.use("/api/account-invitations", invitations);
  router.use("/dealers/:dealerId/api", async (req, res, next) => {
    const config = sharedStaffPortalForHost(req.get("host"));
    const read = req.method === "GET" || req.method === "HEAD";
    if (!config || !requestOriginMatches(req, config.origin)) {
      res.status(403).json({ error: "Open the workspace on the staff portal." });
      return;
    }
    const id = typeof req.params.dealerId === "string" ? req.params.dealerId : "";
    const aiAssist = req.method === "POST" && /^\/ai\/assist\/?$/i.test(req.path);
    if (!sharedStaffScopeIncludes(config.dealerIds, id) || /^\/staff\/push(?:\/|$)/i.test(req.path) ||
      !(apiRoot.test(req.path) || (read && apiRead.test(req.path)) || aiAssist || apiOther.test(req.path))) {
      res.status(404).json({ error: "This action is unavailable on the staff portal." });
      return;
    }
    const userId = deps.userId(req);
    if (!userId) { res.status(401).json({ error: "Sign in to continue." }); return; }
    const [member] = await deps.readMemberships(userId, [id]);
    if (!member || member.dealerId !== id || !isStaffRole(member.role)) {
      res.status(403).json({ error: "This account does not have access to this dealership workspace." });
      return;
    }
    // Authorize the signed-in shared identity first. An explicitly linked
    // member acts as the same dealership staff record for existing assignments.
    req.staff = { authUserId: member.authUserId, role: member.role, permissions: permissionsForRole(member.role), email: member.email, name: member.name };
    // The central browser origin was checked above. The scoped router retains
    // the dealership's canonical origin for customer links and email routing.
    if (req.get("origin")) req.headers.origin = member.canonicalOrigin;
    runWithTenant(tenantForMember(member), () => api(req, res, next));
  });
  router.use(async (req, res, next) => {
    const config = sharedStaffPortalForHost(req.get("host"));
    const page = scopedPage.exec(req.path);
    if (!config || (req.method !== "GET" && req.method !== "HEAD") ||
      !(staffPage.test(req.path) || staticPage.test(req.path) || (page && sharedStaffScopeIncludes(config.dealerIds, page[1])))) {
      res.status(404).json({ error: "This page is unavailable on the staff portal." });
      return;
    }
    res.locals.sharedStaffPortal = { publishableKey: config.publishableKey };
    if (!page) { next(); return; }
    const userId = deps.userId(req);
    const [member] = userId ? await deps.readMemberships(userId, [page[1]]) : [];
    if (member?.dealerId === page[1]) runWithTenant(tenantForMember(member), next);
    else next();
  });
  return (req, res, next) => {
    // Render can send its readiness probes on any verified custom hostname.
    if ((req.method === "GET" || req.method === "HEAD") && /^\/api\/(healthz|readyz)\/?$/.test(req.path)) {
      next();
      return;
    }
    if (sharedStaffPortalForHost(req.get("host"))) router(req, res, next);
    else next();
  };
}
