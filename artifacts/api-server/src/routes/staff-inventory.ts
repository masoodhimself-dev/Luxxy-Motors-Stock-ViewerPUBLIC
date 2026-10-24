import { Router } from "express";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { z } from "zod/v4";
import { db } from "@workspace/db";
import { requireStaff, requirePermission } from "../middlewares/staff-auth";
import { currentDealerId } from "../lib/tenant-context";
import { siteOrigin } from "../lib/enquiry-links";
import { serviceBookJpeg } from "../lib/service-book-jpeg";
import { inventoryHistory, inventoryActivityFields, inventoryActivityJoins } from "../lib/inventory-history";
import { HistoryCursorError, parseHistoryCursor } from "../lib/history-cursor";
const router = Router();
const hash = (s: string) => createHash("sha256").update(s).digest("hex");
const uuid = z.string().uuid();
router.use(["/staff/inventory", "/service-book-upload"], (req, res, next) => {
  res.set({
    "Cache-Control": "no-store",
    "Referrer-Policy": "no-referrer",
    "X-Robots-Tag": "noindex, nofollow",
    "X-Content-Type-Options": "nosniff",
  });
  if (req.get("origin") && req.get("origin") !== siteOrigin()) {
    res
      .status(403)
      .json({ error: "Open this page on the dealership website." });
    return;
  }
  next();
});
router.use("/staff/inventory", requireStaff, (req, res, next) => {
  if (!["GET", "HEAD"].includes(req.method)) {
    requirePermission("sales.manage")(req, res, next);
    return;
  }
  next();
});
const vehicle = (id: string) =>
  db.execute(
    sql`SELECT v.id,v.title,v.make,v.model,v.variant,v.trim,coalesce(v.website_title_override,v.title) AS display_title,coalesce(v.website_price_override,v.source_price) AS price,v.plate,v.vrm,v.registration,v.year,v.mileage,v.fuel,v.transmission,v.body_type,v.engine_size,v.engine_cc,v.colour,v.doors,v.seats,v.inventory_status,v.source_status,v.missing_count,v.archived_at,coalesce(v.website_hero_image_override,v.source_hero_image) AS photo,${inventoryActivityFields} FROM vehicles v ${inventoryActivityJoins} WHERE v.id=${id}::uuid AND v.dealer_id=${currentDealerId()}`,
  );
router.get("/staff/inventory", async (req, res) => {
  const input = z.object({ scope: z.enum(["current", "archived"]).default("current"), q: z.string().trim().max(200).default(""), cursor: z.string().max(250).optional() }).safeParse(req.query);
  if (!input.success || (input.data.cursor && input.data.scope !== "archived")) { res.status(400).json({ error: "Check the inventory search." }); return; }
  try {
    res.json(await inventoryHistory(currentDealerId(), { ...input.data, cursor: parseHistoryCursor(input.data.cursor) }));
  } catch (error) {
    if (error instanceof HistoryCursorError) { res.status(400).json({ error: error.message }); return; }
    req.log.error({ err: error }, "Unable to load inventory");
    res.status(500).json({ error: "Inventory could not be loaded." });
  }
});
router.get("/staff/inventory/:id", async (req, res) => {
  if (!uuid.safeParse(req.params.id).success) {
    res.status(400).json({ error: "Invalid vehicle." });
    return;
  }
  const car = (await vehicle(req.params.id)).rows[0];
  if (!car) {
    res.status(404).json({ error: "Car not found." });
    return;
  }
  const prep = await db.execute(
    sql`SELECT revision,tasks,assigned_to_id,due_date,notes,updated_at FROM vehicle_preparation WHERE vehicle_id=${req.params.id}::uuid AND dealer_id=${currentDealerId()}`,
  );
  const photos = await db.execute(
    sql`SELECT id,category,byte_size,width,height,created_at FROM vehicle_service_photos WHERE vehicle_id=${req.params.id}::uuid AND dealer_id=${currentDealerId()} ORDER BY created_at,id`,
  );
  const vehiclePhotos = await db.execute(
    sql`SELECT i.source_url AS url,i.caption FROM vehicle_images i JOIN vehicles v ON v.id=i.vehicle_id WHERE v.id=${req.params.id}::uuid AND v.dealer_id=${currentDealerId()} AND i.is_active=true ORDER BY i.is_hero DESC,i.sort_order,i.id LIMIT 100`,
  );
  res.json({
    dealerId: currentDealerId(),
    car,
    vehiclePhotos: vehiclePhotos.rows,
    preparation: prep.rows[0] ?? {
      revision: 0,
      tasks: {
        cleaning: "pending",
        inspection: "pending",
        mot: "pending",
        servicing: "pending",
      },
      assigned_to_id: null,
      due_date: null,
      notes: "",
    },
    photos: photos.rows,
  });
});
const task = z.enum(["pending", "done", "not_required"]);
const preparation = z
  .object({
    revision: z.number().int().min(0),
    tasks: z
      .object({ cleaning: task, inspection: task, mot: task, servicing: task })
      .strict(),
    assignedToId: uuid.nullable(),
    dueDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .refine(
        (s) =>
          !isNaN(Date.parse(s)) && new Date(s).toISOString().slice(0, 10) === s,
      )
      .nullable(),
    notes: z.string().max(2000),
  })
  .strict();
router.put("/staff/inventory/:id/preparation", async (req, res) => {
  const parsed = preparation.safeParse(req.body);
  if (!uuid.safeParse(req.params.id).success || !parsed.success) {
    res.status(400).json({ error: "Check the preparation fields." });
    return;
  }
  const id = req.params.id,
    d = parsed.data,
    dealer = currentDealerId();
  const result = await db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtext(${`staff-inventory:${dealer}:${id}`}))`,
    );
    if (
      !(
        await tx.execute(
          sql`SELECT id FROM vehicles WHERE id=${id}::uuid AND dealer_id=${dealer}`,
        )
      ).rows.length
    )
      return 404;
    if (
      d.assignedToId &&
      !(
        await tx.execute(
          sql`SELECT id FROM portal_users WHERE id=${d.assignedToId}::uuid AND dealer_id=${dealer} AND disabled_at IS NULL`,
        )
      ).rows.length
    )
      return 400;
    const old = (
      await tx.execute(
        sql`SELECT revision FROM vehicle_preparation WHERE vehicle_id=${id}::uuid AND dealer_id=${dealer}`,
      )
    ).rows[0];
    if (Number(old?.revision ?? 0) !== d.revision) return 409;
    await tx.execute(
      sql`INSERT INTO vehicle_preparation(vehicle_id,dealer_id,revision,tasks,assigned_to_id,due_date,notes,updated_by) VALUES (${id}::uuid,${dealer},1,${JSON.stringify(d.tasks)}::jsonb,${d.assignedToId}::uuid,${d.dueDate},${d.notes},${req.staff!.authUserId}) ON CONFLICT(vehicle_id) DO UPDATE SET revision=vehicle_preparation.revision+1,tasks=excluded.tasks,assigned_to_id=excluded.assigned_to_id,due_date=excluded.due_date,notes=excluded.notes,updated_by=excluded.updated_by,updated_at=now()`,
    );
    return 200;
  });
  res.status(result).json(
    result === 200
      ? { saved: true }
      : {
          error:
            result === 409
              ? "Preparation changed elsewhere. Refresh before saving."
              : result === 404
                ? "Car not found."
                : "Choose a staff member from this dealership.",
        },
  );
});
router.post("/staff/inventory/:id/upload-session", async (req, res) => {
  if (
    !uuid.safeParse(req.params.id).success ||
    !(await vehicle(req.params.id)).rows.length
  ) {
    res.status(404).json({ error: "Car not found." });
    return;
  }
  const category = z
    .enum(["service_book", "pre_accident"])
    .default("service_book")
    .safeParse(req.body?.category);
  if (!category.success) {
    res.status(400).json({ error: "Choose a photo category." });
    return;
  }
  const dealer = currentDealerId(),
    id = randomUUID(),
    token = randomBytes(32).toString("base64url"),
    expires = new Date(Date.now() + 15 * 60 * 1000);
  const result = await db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtext(${`staff-inventory:${dealer}:${req.params.id}`}))`,
    );
    const count = Number(
      (
        await tx.execute(
          sql`SELECT count(*) AS n FROM vehicle_service_photos WHERE vehicle_id=${req.params.id}::uuid AND dealer_id=${dealer} AND category=${category.data}`,
        )
      ).rows[0]?.n,
    );
    if (count >= 3) return false;
    await tx.execute(
      sql`UPDATE vehicle_service_upload_sessions SET revoked_at=now() WHERE vehicle_id=${req.params.id}::uuid AND dealer_id=${dealer} AND completed_at IS NULL AND revoked_at IS NULL`,
    );
    await tx.execute(
      sql`INSERT INTO vehicle_service_upload_sessions(id,vehicle_id,dealer_id,token_hash,created_by,expires_at,category) VALUES(${id}::uuid,${req.params.id}::uuid,${dealer},${hash(token)},${req.staff!.authUserId},${expires},${category.data})`,
    );
    return true;
  });
  if (!result) {
    res.status(409).json({
      error: "This category already has three photos. Remove a photo first.",
    });
    return;
  }
  res.status(201).json({
    id,
    category: category.data,
    url: `${siteOrigin()}/staff-upload#${token}`,
    expiresAt: expires.toISOString(),
  });
});
router.delete(
  "/staff/inventory/:id/upload-session/:session",
  async (req, res) => {
    if (
      !uuid.safeParse(req.params.id).success ||
      !uuid.safeParse(req.params.session).success
    ) {
      res.status(400).json({ error: "Invalid session." });
      return;
    }
    await db.transaction(async (tx) => {
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(hashtext(${`staff-inventory:${currentDealerId()}:${req.params.id}`}))`,
      );
      await tx.execute(
        sql`UPDATE vehicle_service_upload_sessions SET revoked_at=now() WHERE id=${req.params.session}::uuid AND vehicle_id=${req.params.id}::uuid AND dealer_id=${currentDealerId()}`,
      );
    });
    res.json({ revoked: true });
  },
);
router.get("/staff/inventory/:id/photos/:photo", async (req, res) => {
  if (
    !uuid.safeParse(req.params.id).success ||
    !uuid.safeParse(req.params.photo).success
  ) {
    res.status(404).end();
    return;
  }
  const row = (
    await db.execute(
      sql`SELECT encode(jpeg,'hex') AS bytes FROM vehicle_service_photos WHERE id=${req.params.photo}::uuid AND vehicle_id=${req.params.id}::uuid AND dealer_id=${currentDealerId()}`,
    )
  ).rows[0];
  if (!row) {
    res.status(404).end();
    return;
  }
  res.type("image/jpeg").send(Buffer.from(String(row.bytes), "hex"));
});
router.delete("/staff/inventory/:id/photos/:photo", async (req, res) => {
  if (
    !uuid.safeParse(req.params.id).success ||
    !uuid.safeParse(req.params.photo).success
  ) {
    res.status(400).json({ error: "Invalid photo." });
    return;
  }
  await db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtext(${`staff-inventory:${currentDealerId()}:${req.params.id}`}))`,
    );
    await tx.execute(
      sql`DELETE FROM vehicle_service_photos WHERE id=${req.params.photo}::uuid AND vehicle_id=${req.params.id}::uuid AND dealer_id=${currentDealerId()}`,
    );
  });
  res.json({ removed: true });
});
async function session(tx: Pick<typeof db, "execute">, token: string) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
  const row = (
    await tx.execute(
      sql`SELECT s.*,coalesce(v.website_title_override,v.title) AS title,v.plate,v.vrm,v.registration FROM vehicle_service_upload_sessions s JOIN vehicles v ON v.id=s.vehicle_id AND v.dealer_id=s.dealer_id WHERE s.token_hash=${hash(token)} AND s.dealer_id=${currentDealerId()}`,
    )
  ).rows[0];
  if (!row || row.revoked_at) return null;
  const member = (
    await tx.execute(
      sql`SELECT role FROM portal_users WHERE auth_user_id=${String(row.created_by)} AND dealer_id=${currentDealerId()} AND disabled_at IS NULL`,
    )
  ).rows[0];
  if (!member || !["owner", "salesperson"].includes(String(member.role)))
    return null;
  return row;
}
const bearer = (req: import("express").Request) =>
  req.get("x-service-upload-token") ?? "";
router.get("/service-book-upload", async (req, res) => {
  const row = await session(db, bearer(req));
  if (!row || new Date(String(row.expires_at)).getTime() < Date.now()) {
    res.status(410).json({
      error:
        "This upload link has expired or was cancelled. Ask staff for a new QR code.",
    });
    return;
  }
  const n = Number(
    (
      await db.execute(
        sql`SELECT count(*) AS n FROM vehicle_service_photos WHERE vehicle_id=${String(row.vehicle_id)}::uuid AND dealer_id=${currentDealerId()} AND category=${String(row.category)}`,
      )
    ).rows[0]?.n,
  );
  res.json({
    category: row.category,
    title: row.title,
    registration: row.plate ?? row.vrm ?? row.registration,
    remaining: Math.max(0, 3 - n),
    expiresAt: row.expires_at,
    completed: Boolean(row.completed_at),
  });
});
const upload = z
  .object({
    requestId: uuid,
    photos: z.array(z.string().max(690000)).min(1).max(3),
  })
  .strict();
router.post("/service-book-upload", async (req, res) => {
  const input = upload.safeParse(req.body);
  if (!input.success) {
    res.status(400).json({ error: "Choose one to three compressed photos." });
    return;
  }
  let photos: ReturnType<typeof serviceBookJpeg>[];
  try {
    photos = input.data.photos.map(serviceBookJpeg);
  } catch (e) {
    res.status(400).json({ error: (e as Error).message });
    return;
  }
  const digest = hash(JSON.stringify(input.data)),
    dealer = currentDealerId();
  const result = await db.transaction(async (tx) => {
    const row = await session(tx, bearer(req));
    if (!row) return { status: 410, error: "Upload link unavailable." };
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtext(${`staff-inventory:${dealer}:${row.vehicle_id}`}))`,
    );
    // Re-read under the vehicle lock: concurrent uploads/revocations cannot bypass the limit.
    const fresh = await session(tx, bearer(req));
    if (!fresh) return { status: 410, error: "Upload link unavailable." };
    if (fresh.completed_at)
      return fresh.request_id === input.data.requestId &&
        fresh.request_hash === digest
        ? { status: 200, ids: fresh.result_ids, replayed: true }
        : { status: 409, error: "This link has already been used." };
    if (new Date(String(fresh.expires_at)).getTime() < Date.now())
      return {
        status: 410,
        error: "Upload link expired. Ask staff for a new QR code.",
      };
    const count = Number(
      (
        await tx.execute(
          sql`SELECT count(*) AS n FROM vehicle_service_photos WHERE vehicle_id=${String(fresh.vehicle_id)}::uuid AND dealer_id=${dealer} AND category=${String(fresh.category)}`,
        )
      ).rows[0]?.n,
    );
    if (count + photos.length > 3)
      return {
        status: 409,
        error: "Only three photos are allowed per category.",
      };
    const ids: string[] = [];
    for (const p of photos) {
      const id = randomUUID();
      ids.push(id);
      await tx.execute(
        sql`INSERT INTO vehicle_service_photos(id,vehicle_id,dealer_id,jpeg,byte_size,width,height,uploaded_by,category) VALUES(${id}::uuid,${String(fresh.vehicle_id)}::uuid,${dealer},decode(${p.bytes.toString("hex")},'hex'),${p.bytes.length},${p.width},${p.height},${String(fresh.created_by)},${String(fresh.category)})`,
      );
    }
    await tx.execute(
      sql`UPDATE vehicle_service_upload_sessions SET request_id=${input.data.requestId}::uuid,request_hash=${digest},result_ids=${JSON.stringify(ids)}::jsonb,completed_at=now() WHERE id=${String(fresh.id)}::uuid AND dealer_id=${dealer}`,
    );
    return { status: 201, ids, replayed: false };
  });
  res
    .status(result.status)
    .json(
      "error" in result
        ? { error: result.error }
        : { uploaded: result.ids, replayed: result.replayed },
    );
});

router.put("/staff/inventory/:id/plate", async (req, res) => {
  const input = z
    .object({
      plate: z
        .string()
        .trim()
        .transform((s) => s.replace(/\s/g, " ").replace(/ /g, "").toUpperCase())
        .pipe(z.string().regex(/^[A-Z0-9]{2,8}$/)),
      expectedPlate: z.string().nullable(),
    })
    .strict()
    .safeParse(req.body);
  if (!uuid.safeParse(req.params.id).success || !input.success) {
    res
      .status(400)
      .json({
        error: "Enter a registration containing 2–8 letters and numbers.",
      });
    return;
  }
  const result = await db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtext(${`stock-import:${currentDealerId()}`}))`,
    );
    const row = (
      await tx.execute(
        sql`SELECT plate,vrm FROM vehicles WHERE id=${req.params.id}::uuid AND dealer_id=${currentDealerId()} FOR UPDATE`,
      )
    ).rows[0];
    if (!row) return 404;
    if ((row.plate ?? row.vrm ?? null) !== input.data.expectedPlate) return 409;
    const correction = {
      plateCorrection: {
        plate: input.data.plate,
        previous: row.plate ?? row.vrm ?? null,
        by: req.staff!.authUserId,
        at: new Date().toISOString(),
      },
    };
    await tx.execute(
      sql`UPDATE vehicles SET plate=${input.data.plate},vrm=${input.data.plate},vrm_verified=false,audit_metadata=coalesce(audit_metadata,'{}'::jsonb)||${JSON.stringify(correction)}::jsonb,updated_at=now() WHERE id=${req.params.id}::uuid AND dealer_id=${currentDealerId()}`,
    );
    return 200;
  });
  res
    .status(result)
    .json(
      result === 200
        ? { saved: true }
        : {
            error:
              result === 404
                ? "Car not found."
                : "The registration changed elsewhere. Refresh before saving.",
          },
    );
});
router.get("/staff/inventory/:id/customers", async (req, res) => {
  if (!uuid.safeParse(req.params.id).success) {
    res.status(400).json({ error: "Invalid vehicle." });
    return;
  }
  const rows = await db.execute(
    sql`SELECT id,customer_name AS "customerName",reference,email FROM enquiries WHERE dealer_id=${currentDealerId()} AND vehicle_id=${req.params.id}::uuid ORDER BY created_at DESC LIMIT 100`,
  );
  res.json({ customers: rows.rows });
});
router.post("/staff/inventory/:id/unreserve", async (req, res) => {
  if (!uuid.safeParse(req.params.id).success || req.body?.confirm !== true) {
    res
      .status(400)
      .json({ error: "Confirm that you want to release this reservation." });
    return;
  }
  const dealer = currentDealerId(),
    id = req.params.id;
  const result = await db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtext(${`sale-workspace:${dealer}`}))`,
    );
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtext(${`sale-vehicle:${id}`}))`,
    );
    const car = (
      await tx.execute(
        sql`SELECT inventory_status FROM vehicles WHERE id=${id}::uuid AND dealer_id=${dealer} FOR UPDATE`,
      )
    ).rows[0];
    if (!car) return { status: 404, error: "Car not found." };
    if (car.inventory_status !== "reserved")
      return {
        status: 409,
        error: "This car is no longer reserved. Refresh its status.",
      };
    const sales = (
      await tx.execute(
        sql`SELECT id,state FROM sale_workspace WHERE dealer_id=${dealer} AND state#>>'{draft,vehicleId}'=${id} FOR UPDATE`,
      )
    ).rows;
    const leads = (
      await tx.execute(
        sql`SELECT id,stage,deposit_pence FROM leads WHERE dealer_id=${dealer} AND vehicle_id=${id}::uuid AND stage IN ('reserved','sale_agreed','collected') FOR UPDATE`,
      )
    ).rows;
    const external = (
      await tx.execute(
        sql`SELECT e.id FROM lead_events e JOIN leads l ON l.id=e.lead_id WHERE l.dealer_id=${dealer} AND l.vehicle_id=${id}::uuid AND e.payload->>'kind'='online_stripe_reservation' AND coalesce(e.payload#>>'{reservation,status}','') NOT IN ('cancelled','expired') LIMIT 1`,
      )
    ).rows;
    const legacy = (
      await tx.execute(
        sql`SELECT id FROM sales WHERE dealer_id=${dealer} AND vehicle_id=${id}::uuid AND status IN ('draft','ready','signing','signed','completed') LIMIT 1`,
      )
    ).rows;
    if (external.length || legacy.length)
      return {
        status: 409,
        error:
          "This car has a payment-provider reservation or active sale. Cancel it from Reservations or Sales first.",
      };
    for (const row of sales) {
      const state = row.state as any;
      if (state.lifecycle?.status === "released") continue;
      const paid = (state.payments ?? [])
        .filter((p: any) => p.status === "confirmed")
        .reduce((n: number, p: any) => n + Number(p.signedAmountPence), 0);
      if (
        state.lifecycle?.status === "sold" ||
        paid > 0 ||
        (state.payments ?? []).some((p: any) => p.status === "pending")
      )
        return {
          status: 409,
          error:
            "Review this car’s sale and refund or cancel its outstanding payments before unreserving.",
        };
    }
    if (
      leads.some((l) => Number(l.deposit_pence) > 0 || l.stage === "collected")
    )
      return {
        status: 409,
        error:
          "Review the customer’s reservation and payment before releasing this car.",
      };
    const now = new Date().toISOString();
    for (const row of sales) {
      const state = row.state as any;
      if (state.lifecycle?.status !== "reserved") continue;
      state.lifecycle = {
        ...state.lifecycle,
        status: "released",
        changedAt: now,
      };
      state.revision += 1;
      state.updatedAt = now;
      state.events.push({
        id: randomUUID(),
        type: "reservation-cancelled",
        description: "Reservation released from vehicle workspace",
        actor: req.staff!.authUserId,
        occurredAt: now,
      });
      await tx.execute(
        sql`UPDATE sale_workspace SET state=${JSON.stringify(state)}::jsonb,revision=${state.revision},updated_at=now() WHERE id=${String(row.id)}::uuid AND dealer_id=${dealer}`,
      );
    }
    for (const lead of leads) {
      await tx.execute(
        sql`UPDATE leads SET stage='qualifying',updated_at=now() WHERE id=${String(lead.id)}::uuid AND dealer_id=${dealer}`,
      );
      await tx.execute(
        sql`INSERT INTO lead_events(lead_id,type,actor_type,actor,body,payload) VALUES(${String(lead.id)}::uuid,'note_added','staff',${req.staff!.authUserId},'Reservation released from vehicle workspace',${JSON.stringify({ kind: "online_reservation_cancelled", reservationId: lead.id, amountReceivedPence: 0 })}::jsonb)`,
      );
    }
    await tx.execute(
      sql`UPDATE vehicles SET inventory_status='available',audit_metadata=coalesce(audit_metadata,'{}'::jsonb)||${JSON.stringify({ saleWorkspaceId: null, saleWorkspaceStatus: "released", reservationReleasedBy: req.staff!.authUserId, reservationReleasedAt: now })}::jsonb,updated_at=now() WHERE id=${id}::uuid AND dealer_id=${dealer}`,
    );
    return { status: 200 };
  });
  res
    .status(result.status)
    .json("error" in result ? { error: result.error } : { released: true });
});

export default router;
