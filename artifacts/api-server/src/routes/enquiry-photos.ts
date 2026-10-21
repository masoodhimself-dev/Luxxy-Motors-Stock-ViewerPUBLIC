import { Router, type Request } from "express";
import { randomBytes, randomUUID, createHash } from "node:crypto";
import { z } from "zod/v4";
import { pool } from "@workspace/db";
import { currentDealerId } from "../lib/tenant-context";
import { requireStaff, requirePermission } from "../middlewares/staff-auth";
import { siteOrigin } from "../lib/enquiry-links";
import { serviceBookJpeg } from "../lib/service-book-jpeg";
const router = Router(),
  uuid = z.string().uuid();
const hash = (v: string) => createHash("sha256").update(v).digest("hex");
const key = (dealer: string, id: string) => `enquiry-photos:${dealer}:${id}`;
class PhotoError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}
const headers = {
  "Cache-Control": "no-store, private",
  "Referrer-Policy": "no-referrer",
  "X-Robots-Tag": "noindex, nofollow",
  "X-Content-Type-Options": "nosniff",
};
router.use(
  [
    "/staff/enquiries/:id/photos",
    "/staff/enquiries/:id/photo-upload-session",
    "/enquiry-photo-upload",
  ],
  (req, res, next) => {
    res.set(headers);
    const origin = req.get("origin");
    if (origin && origin !== siteOrigin()) {
      res
        .status(403)
        .json({ error: "Open photo uploads on this dealership website." });
      return;
    }
    next();
  },
);
router.use(
  ["/staff/enquiries/:id/photos", "/staff/enquiries/:id/photo-upload-session"],
  requireStaff,
  requirePermission("sales.manage"),
);
const fail = (res: any, e: unknown) =>
  res.status(e instanceof PhotoError ? e.status : 503).json({
    error:
      e instanceof PhotoError
        ? e.message
        : "Photos could not be updated. Refresh before trying again.",
  });
async function entry(
  client: Pick<typeof pool, "query">,
  id: string,
  lock = false,
) {
  if (!uuid.safeParse(id).success)
    throw new PhotoError("Enquiry not found.", 404);
  const row = (
    await client.query(
      `SELECT id,customer_name,vehicle_title,merged_into_id FROM enquiries WHERE dealer_id=$1 AND id=$2${lock ? " FOR UPDATE" : ""}`,
      [currentDealerId(), id],
    )
  ).rows[0];
  if (!row) throw new PhotoError("Enquiry not found.", 404);
  if (row.merged_into_id)
    throw new PhotoError(
      "This enquiry was merged. Open the current enquiry before adding photos.",
      409,
    );
  return row;
}
export const enquiryPhotoMetadata = (row: any, enquiryId: string) => ({
  id: row.id,
  url: `/api/staff/enquiries/${enquiryId}/photos/${row.id}`,
  byteSize: row.byte_size,
  width: row.width,
  height: row.height,
  createdAt: new Date(row.created_at).toISOString(),
});
router.get("/staff/enquiries/:id/photos", async (req, res) => {
  try {
    await entry(pool, req.params.id);
    const rows = (
      await pool.query(
        "SELECT id,byte_size,width,height,created_at FROM enquiry_photos WHERE dealer_id=$1 AND enquiry_id=$2 ORDER BY created_at,id",
        [currentDealerId(), req.params.id],
      )
    ).rows;
    res.json({
      photos: rows.map((row) => enquiryPhotoMetadata(row, req.params.id)),
      remaining: Math.max(0, 2 - rows.length),
    });
  } catch (e) {
    fail(res, e);
  }
});
router.get("/staff/enquiries/:id/photos/:photo", async (req, res) => {
  try {
    await entry(pool, req.params.id);
    if (!uuid.safeParse(req.params.photo).success)
      throw new PhotoError("Photo not found.", 404);
    const row = (
      await pool.query(
        "SELECT jpeg FROM enquiry_photos WHERE dealer_id=$1 AND enquiry_id=$2 AND id=$3",
        [currentDealerId(), req.params.id, req.params.photo],
      )
    ).rows[0];
    if (!row) throw new PhotoError("Photo not found.", 404);
    res.type("image/jpeg").send(row.jpeg);
  } catch (e) {
    fail(res, e);
  }
});
router.delete("/staff/enquiries/:id/photos/:photo", async (req, res) => {
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    await entry(c, req.params.id, true);
    if (!uuid.safeParse(req.params.photo).success)
      throw new PhotoError("Photo not found.", 404);
    await c.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
      key(currentDealerId(), req.params.id),
    ]);
    const row = await c.query(
      "DELETE FROM enquiry_photos WHERE dealer_id=$1 AND enquiry_id=$2 AND id=$3 RETURNING id",
      [currentDealerId(), req.params.id, req.params.photo],
    );
    await c.query("COMMIT");
    res.json({ removed: Boolean(row.rows.length) });
  } catch (e) {
    await c.query("ROLLBACK");
    fail(res, e);
  } finally {
    c.release();
  }
});
router.post("/staff/enquiries/:id/photo-upload-session", async (req, res) => {
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    await entry(c, req.params.id, true);
    const dealer = currentDealerId();
    await c.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
      key(dealer, req.params.id),
    ]);
    const n = Number(
      (
        await c.query(
          "SELECT count(*) FROM enquiry_photos WHERE dealer_id=$1 AND enquiry_id=$2",
          [dealer, req.params.id],
        )
      ).rows[0].count,
    );
    if (n >= 2)
      throw new PhotoError(
        "This enquiry already has two photos. Remove a photo first.",
        409,
      );
    const token = randomBytes(32).toString("base64url"),
      id = randomUUID(),
      expires = new Date(Date.now() + 15 * 60 * 1000);
    await c.query(
      "UPDATE enquiry_photo_upload_sessions SET revoked_at=now() WHERE dealer_id=$1 AND enquiry_id=$2 AND token_hash IS NOT NULL AND revoked_at IS NULL AND completed_at IS NULL",
      [dealer, req.params.id],
    );
    await c.query(
      "INSERT INTO enquiry_photo_upload_sessions(id,dealer_id,enquiry_id,token_hash,created_by,expires_at) VALUES($1,$2,$3,$4,$5,$6)",
      [id, dealer, req.params.id, hash(token), req.staff!.authUserId, expires],
    );
    await c.query("COMMIT");
    res.status(201).json({
      id,
      url: `${siteOrigin()}/enquiry-photo-upload#${token}`,
      expiresAt: expires.toISOString(),
    });
  } catch (e) {
    await c.query("ROLLBACK");
    fail(res, e);
  } finally {
    c.release();
  }
});
router.delete(
  "/staff/enquiries/:id/photo-upload-session/:session",
  async (req, res) => {
    const c = await pool.connect();
    try {
      await c.query("BEGIN");
      await entry(c, req.params.id, true);
      if (!uuid.safeParse(req.params.session).success)
        throw new PhotoError("Upload link not found.", 404);
      await c.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
        key(currentDealerId(), req.params.id),
      ]);
      await c.query(
        "UPDATE enquiry_photo_upload_sessions SET revoked_at=now() WHERE dealer_id=$1 AND enquiry_id=$2 AND id=$3",
        [currentDealerId(), req.params.id, req.params.session],
      );
      await c.query("COMMIT");
      res.json({ revoked: true });
    } catch (e) {
      await c.query("ROLLBACK");
      fail(res, e);
    } finally {
      c.release();
    }
  },
);
const tokenFrom = (req: Request) => req.get("x-enquiry-upload-token") || "";
async function session(c: Pick<typeof pool, "query">, token: string) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token))
    throw new PhotoError(
      "This upload link is incomplete. Ask staff for a new QR code.",
      410,
    );
  const row = (
    await c.query(
      `SELECT s.*,e.customer_name,e.vehicle_title,e.merged_into_id FROM enquiry_photo_upload_sessions s JOIN enquiries e ON e.id=s.enquiry_id AND e.dealer_id=s.dealer_id JOIN portal_users u ON u.auth_user_id=s.created_by AND u.dealer_id=s.dealer_id AND u.disabled_at IS NULL AND u.role IN ('owner','salesperson') WHERE s.dealer_id=$1 AND s.token_hash=$2 AND s.revoked_at IS NULL AND s.expires_at>now()`,
      [currentDealerId(), hash(token)],
    )
  ).rows[0];
  if (!row || row.merged_into_id)
    throw new PhotoError(
      "This upload link expired, was cancelled or is no longer authorised. Ask staff for a new QR code.",
      410,
    );
  return row;
}
router.get("/enquiry-photo-upload", async (req, res) => {
  try {
    const s = await session(pool, tokenFrom(req));
    const n = Number(
      (
        await pool.query(
          "SELECT count(*) FROM enquiry_photos WHERE dealer_id=$1 AND enquiry_id=$2",
          [currentDealerId(), s.enquiry_id],
        )
      ).rows[0].count,
    );
    res.json({
      title: s.vehicle_title || "Enquiry photos",
      customerName: s.customer_name,
      remaining: Math.max(0, 2 - n),
      expiresAt: new Date(s.expires_at).toISOString(),
      completed: Boolean(s.completed_at),
    });
  } catch (e) {
    fail(res, e);
  }
});
const upload = z
  .object({
    requestId: uuid,
    photos: z.array(z.string().max(690000)).min(1).max(2),
  })
  .strict();
async function save(req: Request, res: any, phone: boolean) {
  const parsed = upload.safeParse(req.body);
  if (!parsed.success) {
    res
      .status(400)
      .json({ error: "Choose one or two compressed JPEG photos." });
    return;
  }
  let photos: ReturnType<typeof serviceBookJpeg>[];
  try {
    photos = parsed.data.photos.map(serviceBookJpeg);
  } catch (e) {
    res.status(400).json({ error: (e as Error).message });
    return;
  }
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    const dealer = currentDealerId(),
      initial = phone ? await session(c, tokenFrom(req)) : null,
      id = phone ? String(initial!.enquiry_id) : String(req.params.id);
    await entry(c, id, true);
    await c.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
      key(dealer, id),
    ]);
    const s = phone
      ? await session(c, tokenFrom(req))
      : (
          await c.query(
            "SELECT * FROM enquiry_photo_upload_sessions WHERE id=$1",
            [parsed.data.requestId],
          )
        ).rows[0];
    const digest = hash(JSON.stringify(parsed.data));
    if (s?.completed_at) {
      if (
        s.dealer_id !== dealer ||
        s.enquiry_id !== id ||
        s.request_id !== parsed.data.requestId ||
        s.request_hash !== digest
      )
        throw new PhotoError(
          "This upload request was already used for different photos.",
          409,
        );
      await c.query("COMMIT");
      res.json({ uploaded: s.result_ids, replayed: true });
      return;
    }
    if (s && !phone) throw new PhotoError("Choose a new upload request.", 409);
    const count = Number(
      (
        await c.query(
          "SELECT count(*) FROM enquiry_photos WHERE dealer_id=$1 AND enquiry_id=$2",
          [dealer, id],
        )
      ).rows[0].count,
    );
    if (count + photos.length > 2)
      throw new PhotoError(
        "Only two custom photos are allowed on this enquiry. Remove a photo first.",
        409,
      );
    const ids: string[] = [];
    for (const p of photos) {
      const pid = randomUUID();
      ids.push(pid);
      await c.query(
        "INSERT INTO enquiry_photos(id,dealer_id,enquiry_id,jpeg,byte_size,width,height,uploaded_by) VALUES($1,$2,$3,decode($4,'hex'),$5,$6,$7,$8)",
        [
          pid,
          dealer,
          id,
          p.bytes.toString("hex"),
          p.bytes.length,
          p.width,
          p.height,
          phone ? s.created_by : req.staff!.authUserId,
        ],
      );
    }
    if (phone) {
      await c.query(
        "UPDATE enquiry_photo_upload_sessions SET request_id=$2,request_hash=$3,result_ids=$4::jsonb,completed_at=now() WHERE id=$1",
        [s.id, parsed.data.requestId, digest, JSON.stringify(ids)],
      );
    } else
      await c.query(
        "INSERT INTO enquiry_photo_upload_sessions(id,dealer_id,enquiry_id,created_by,expires_at,request_id,request_hash,result_ids,completed_at) VALUES($1,$2,$3,$4,now()+interval '15 minutes',$1,$5,$6::jsonb,now())",
        [
          parsed.data.requestId,
          dealer,
          id,
          req.staff!.authUserId,
          digest,
          JSON.stringify(ids),
        ],
      );
    await c.query("COMMIT");
    res.status(201).json({ uploaded: ids, replayed: false });
  } catch (e) {
    await c.query("ROLLBACK");
    fail(res, e);
  } finally {
    c.release();
  }
}
router.post("/staff/enquiries/:id/photos", (req, res) => save(req, res, false));
router.post("/enquiry-photo-upload", (req, res) => save(req, res, true));
export default router;
