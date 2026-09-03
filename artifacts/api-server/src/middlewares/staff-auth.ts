import type { NextFunction, Request, RequestHandler, Response } from "express";
import { getAuth, clerkClient } from "@clerk/express";
import { eq, sql } from "drizzle-orm";
import { db, portalUsersTable, type PortalUser } from "@workspace/db";

/**
 * Portal authorization.
 *
 * Clerk owns identity: `clerkMiddleware` in app.ts validates the session and
 * `getAuth` reports who is signed in. This module answers the separate
 * question of whether that person is allowed to run the dealership.
 *
 * A signed-in Clerk account gets in when either
 *   - its email is listed in `PORTAL_STAFF_EMAILS`, or
 *   - `PORTAL_STAFF_EMAILS` is unset and no staff row exists yet, in which
 *     case the first account to sign in claims the portal.
 *
 * Anything else is a 403. The claim rule exists so a freshly provisioned
 * project is usable without a secret, and closes permanently the moment the
 * dealer signs in for the first time.
 */

export type StaffIdentity = {
  authUserId: string;
  email: string | null;
  name: string | null;
};

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      staff?: StaffIdentity;
    }
  }
}

const dealerId = () => process.env.STOCK_DEALER_ID ?? "luxxy-motors";

function allowedEmails(): string[] {
  return (process.env.PORTAL_STAFF_EMAILS ?? "")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * Server-to-server access for automated callers (the integration suite, future
 * schedulers). Mirrors the existing stock-import secret: unset means no token
 * access at all, so this can never silently weaken a deployed portal.
 */
function machineToken(req: Request): StaffIdentity | null {
  const expected = process.env.PORTAL_API_TOKEN;
  if (!expected) return null;
  const provided = req.get("x-portal-token");
  if (!provided || provided !== expected) return null;
  return { authUserId: "machine", email: null, name: "Automation" };
}

async function clerkIdentity(req: Request): Promise<StaffIdentity | null> {
  const auth = getAuth(req);
  const authUserId = auth?.userId;
  if (!authUserId) return null;

  let email: string | null = null;
  let name: string | null = null;
  try {
    const user = await clerkClient.users.getUser(authUserId);
    email =
      user.primaryEmailAddress?.emailAddress ??
      user.emailAddresses[0]?.emailAddress ??
      null;
    name =
      [user.firstName, user.lastName].filter(Boolean).join(" ").trim() ||
      user.username ||
      email;
  } catch (error) {
    req.log.warn({ err: error, authUserId }, "Unable to read Clerk profile");
  }
  return { authUserId, email, name };
}

async function resolveStaffRow(
  identity: StaffIdentity,
): Promise<PortalUser | null> {
  const [existing] = await db
    .select()
    .from(portalUsersTable)
    .where(eq(portalUsersTable.authUserId, identity.authUserId));
  if (existing) {
    await db
      .update(portalUsersTable)
      .set({
        lastSeenAt: new Date(),
        email: identity.email ?? existing.email,
        name: identity.name ?? existing.name,
      })
      .where(eq(portalUsersTable.id, existing.id));
    return existing;
  }

  const listed = allowedEmails();
  const emailAllowed =
    listed.length > 0 &&
    identity.email != null &&
    listed.includes(identity.email.toLowerCase());

  if (!emailAllowed) {
    if (listed.length > 0) return null;
    const [{ count }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(portalUsersTable);
    if (count > 0) return null;
  }

  const [created] = await db
    .insert(portalUsersTable)
    .values({
      dealerId: dealerId(),
      authUserId: identity.authUserId,
      email: identity.email,
      name: identity.name,
    })
    .onConflictDoNothing()
    .returning();
  if (created) return created;

  const [row] = await db
    .select()
    .from(portalUsersTable)
    .where(eq(portalUsersTable.authUserId, identity.authUserId));
  return row ?? null;
}

export type PortalAccess =
  | { state: "signed_out" }
  | { state: "forbidden"; identity: StaffIdentity }
  | { state: "allowed"; identity: StaffIdentity; user: PortalUser | null };

export async function portalAccess(req: Request): Promise<PortalAccess> {
  const machine = machineToken(req);
  if (machine) return { state: "allowed", identity: machine, user: null };

  const identity = await clerkIdentity(req);
  if (!identity) return { state: "signed_out" };

  const user = await resolveStaffRow(identity);
  if (!user) return { state: "forbidden", identity };
  return {
    state: "allowed",
    identity: { ...identity, name: identity.name ?? user.name },
    user,
  };
}

/**
 * Rejects anyone who is not signed in as authorized dealership staff.
 *
 * Typed as `RequestHandler<any>` so that Express still infers route params
 * from the path literal on routes that mount it ahead of their handler.
 */
export const requireStaff: RequestHandler<any> = (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  void portalAccess(req)
    .then((access) => {
      if (access.state === "signed_out") {
        res.status(401).json({ error: "Sign in to use the dealer portal." });
        return;
      }
      if (access.state === "forbidden") {
        res.status(403).json({
          error: "This account is not authorised for the Luxxy Motors portal.",
        });
        return;
      }
      req.staff = access.identity;
      next();
    })
    .catch((error) => {
      req.log.error({ err: error }, "Portal authorization failed");
      res.status(500).json({ error: "Unable to verify portal access." });
    });
};

export function staffLabel(req: Request): string {
  return req.staff?.name || req.staff?.email || "Dealer";
}
