import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { Router, type IRouter, type Response } from "express";
import { and, eq, sql } from "drizzle-orm";
import {
  CompleteCustomerIntakeSessionBody,
  CompleteCustomerIntakeSessionParams,
  CompleteCustomerIntakeSessionResponse,
  CreateCustomerIntakeSessionBody,
  CreateCustomerIntakeSessionResponse,
  GetCustomerIntakeSessionParams,
  GetCustomerIntakeSessionResponse,
} from "@workspace/api-zod";
import {
  customerIntakeSessionsTable,
  customerTable,
  db,
  vehiclesTable,
} from "@workspace/db";

const router: IRouter = Router();
const SESSION_LIFETIME_MS = 24 * 60 * 60 * 1000;
const rateLimits = new Map<string, { count: number; resetAt: number }>();
type SessionWithToken = typeof customerIntakeSessionsTable.$inferSelect & {
  rawToken?: string;
};

function checkRateLimit(key: string, max: number, windowMs: number) {
  const now = Date.now();
  const current = rateLimits.get(key);
  if (!current || current.resetAt <= now) {
    rateLimits.set(key, { count: 1, resetAt: now + windowMs });
    if (rateLimits.size > 5000) {
      for (const [entryKey, entry] of rateLimits) {
        if (entry.resetAt <= now) rateLimits.delete(entryKey);
      }
    }
    return { allowed: true, retryAfterSeconds: 0 };
  }
  current.count += 1;
  return {
    allowed: current.count <= max,
    retryAfterSeconds: Math.max(1, Math.ceil((current.resetAt - now) / 1000)),
  };
}

function rejectRateLimited(res: Response, retryAfterSeconds: number) {
  res.setHeader("Retry-After", String(retryAfterSeconds));
  res.status(429).json({ error: "Too many requests. Please try again shortly." });
}

function dealerId() {
  return process.env.STOCK_DEALER_ID ?? "luxxy-motors";
}

function tokenHash(token: string) {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error("SESSION_SECRET is required for customer intake sessions");
  return createHmac("sha256", secret).update(token).digest("hex");
}

function tokenMatches(stored: string, candidate: string) {
  const actual = tokenHash(candidate);
  const a = Buffer.from(stored, "hex");
  const b = Buffer.from(actual, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

function publicSession(
  session: SessionWithToken,
  customer: typeof customerTable.$inferSelect | undefined,
) {
  return {
    id: session.id,
    vehicleId: session.vehicleId,
    status: session.status,
    expiresAt: session.expiresAt,
    customerDetailsPath: `/customer-details/${session.rawToken ?? ""}`,
    customer: customer
      ? {
          id: customer.id,
          name: customer.name,
          email: customer.email,
          phone: customer.phone,
        }
      : null,
  };
}

async function findSession(token: string) {
  const sessionHash = tokenHash(token);
  const [session] = await db
    .select()
    .from(customerIntakeSessionsTable)
    .where(
      and(
        eq(customerIntakeSessionsTable.tokenHash, sessionHash),
        eq(customerIntakeSessionsTable.dealerId, dealerId()),
      ),
    );
  if (!session || !tokenMatches(session.tokenHash, token)) return null;
  return session;
}

async function sessionResponse(session: typeof customerIntakeSessionsTable.$inferSelect) {
  let current = session;
  if (current.status === "pending" && current.expiresAt.getTime() <= Date.now()) {
    const [expired] = await db
      .update(customerIntakeSessionsTable)
      .set({ status: "expired" })
      .where(
        and(
          eq(customerIntakeSessionsTable.id, current.id),
          eq(customerIntakeSessionsTable.status, "pending"),
        ),
      )
      .returning();
    current = expired ?? { ...current, status: "expired" };
  }
  const customer = current.customerId
    ? (
        await db
          .select()
          .from(customerTable)
          .where(
            and(
              eq(customerTable.id, current.customerId),
              eq(customerTable.dealerId, dealerId()),
            ),
          )
      )[0]
    : undefined;
  return { current, customer };
}

router.post("/customer-intake-sessions", async (req, res): Promise<void> => {
  const createLimit = checkRateLimit(
    `create:${dealerId()}:${req.ip}`,
    30,
    60 * 60 * 1000,
  );
  if (!createLimit.allowed) {
    rejectRateLimited(res, createLimit.retryAfterSeconds);
    return;
  }
  const parsed = CreateCustomerIntakeSessionBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [vehicle] = await db
    .select({ id: vehiclesTable.id })
    .from(vehiclesTable)
    .where(
      and(
        eq(vehiclesTable.id, parsed.data.vehicleId),
        eq(vehiclesTable.dealerId, dealerId()),
      ),
    );
  if (!vehicle) {
    res.status(404).json({ error: "Vehicle not found" });
    return;
  }

  try {
    const rawToken = randomBytes(32).toString("base64url");
    const [session] = await db
      .insert(customerIntakeSessionsTable)
      .values({
        dealerId: dealerId(),
        vehicleId: parsed.data.vehicleId,
        tokenHash: tokenHash(rawToken),
        status: "pending",
        expiresAt: new Date(Date.now() + SESSION_LIFETIME_MS),
      })
      .returning();
    const response = {
      ...session,
      rawToken,
    } as SessionWithToken;
    res.status(201).json(
      CreateCustomerIntakeSessionResponse.parse(publicSession(response, undefined)),
    );
  } catch (error) {
    req.log.error({ err: error }, "Unable to create customer intake session");
    res.status(500).json({ error: "Unable to create customer details link." });
  }
});

router.get("/customer-intake-sessions/:token", async (req, res): Promise<void> => {
  const parsed = GetCustomerIntakeSessionParams.safeParse(req.params);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  try {
    const readLimit = checkRateLimit(
      `read:${tokenHash(parsed.data.token)}`,
      120,
      60 * 1000,
    );
    if (!readLimit.allowed) {
      rejectRateLimited(res, readLimit.retryAfterSeconds);
      return;
    }
    const session = await findSession(parsed.data.token);
    if (!session) {
      res.status(404).json({ error: "Customer details link not found." });
      return;
    }
    const { current, customer } = await sessionResponse(session);
    if (current.status === "expired") {
      res.status(410).json({ error: "This customer details link has expired." });
      return;
    }
    res.json(
      GetCustomerIntakeSessionResponse.parse({
        ...publicSession({ ...current, rawToken: parsed.data.token }, customer),
        customerDetailsPath: `/customer-details/${parsed.data.token}`,
      }),
    );
  } catch (error) {
    req.log.error({ err: error }, "Unable to load customer intake session");
    res.status(500).json({ error: "Unable to load customer details link." });
  }
});

router.post(
  "/customer-intake-sessions/:token/complete",
  async (req, res): Promise<void> => {
    const parsedParams = CompleteCustomerIntakeSessionParams.safeParse(req.params);
    if (!parsedParams.success) {
      res.status(400).json({ error: parsedParams.error.message });
      return;
    }
    const parsedBody = CompleteCustomerIntakeSessionBody.safeParse(req.body);
    if (!parsedBody.success) {
      res.status(400).json({ error: parsedBody.error.message });
      return;
    }

    try {
      const completeLimit = checkRateLimit(
        `complete:${tokenHash(parsedParams.data.token)}`,
        10,
        15 * 60 * 1000,
      );
      if (!completeLimit.allowed) {
        rejectRateLimited(res, completeLimit.retryAfterSeconds);
        return;
      }
      const session = await findSession(parsedParams.data.token);
      if (!session) {
        res.status(404).json({ error: "Customer details link not found." });
        return;
      }

      const result = await db.transaction(async (tx) => {
        await tx.execute(
          sql`select pg_advisory_xact_lock(hashtext(${"customer-intake:" + session.id}))`,
        );
        const [locked] = await tx
          .select()
          .from(customerIntakeSessionsTable)
          .where(eq(customerIntakeSessionsTable.id, session.id));
        if (!locked) throw new Error("Customer details link not found.");
        if (locked.status === "completed" && locked.customerId) {
          const [existing] = await tx
            .select()
            .from(customerTable)
            .where(eq(customerTable.id, locked.customerId));
          return { session: locked, customer: existing };
        }
        if (locked.status !== "pending") throw new Error("This customer details link has expired.");
        if (locked.expiresAt.getTime() <= Date.now()) {
          await tx
            .update(customerIntakeSessionsTable)
            .set({ status: "expired" })
            .where(eq(customerIntakeSessionsTable.id, locked.id));
          throw new Error("This customer details link has expired.");
        }
        const [customer] = await tx
          .insert(customerTable)
          .values({
            dealerId: dealerId(),
            name: parsedBody.data.name.trim(),
            email: parsedBody.data.email?.trim().toLowerCase() || null,
            phone: parsedBody.data.phone?.trim() || null,
          })
          .returning();
        const [completed] = await tx
          .update(customerIntakeSessionsTable)
          .set({
            status: "completed",
            customerId: customer.id,
            completedAt: new Date(),
          })
          .where(eq(customerIntakeSessionsTable.id, locked.id))
          .returning();
        return { session: completed, customer };
      });

      res.json(
        CompleteCustomerIntakeSessionResponse.parse({
          ...publicSession(
            { ...result.session, rawToken: parsedParams.data.token },
            result.customer,
          ),
          customerDetailsPath: `/customer-details/${parsedParams.data.token}`,
        }),
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to save customer details.";
      if (message.includes("expired")) {
        res.status(410).json({ error: message });
        return;
      }
      if (message.includes("not found")) {
        res.status(404).json({ error: message });
        return;
      }
      req.log.error({ err: error }, "Unable to complete customer intake session");
      res.status(500).json({ error: "Unable to save customer details." });
    }
  },
);

export default router;