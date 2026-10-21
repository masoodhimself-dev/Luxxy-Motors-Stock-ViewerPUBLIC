import { Router, type Request, type Response } from "express";
import { createHash } from "node:crypto";
import { mkdtemp, open, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import { pool } from "@workspace/db";
import { currentDealerId } from "../lib/tenant-context";
import { requireStaff, requirePermission } from "../middlewares/staff-auth";
import { siteOrigin } from "../lib/enquiry-links";
import { findPublicVehicle } from "./stock";
import {
  mediaStorageConfigured,
  videoRange,
  videoStorage,
} from "../lib/media-storage";
import {
  compressVehicleVideo,
  videoLimits,
  VideoError,
} from "../lib/vehicle-video";
import { serviceLifecycle } from "../lib/service-lifecycle";
const router = Router();
const uuid = (v: string) => /^[\da-f]{8}(-[\da-f]{4}){3}-[\da-f]{12}$/i.test(v);
let active = false;
const carExists = async (id: string) =>
  uuid(id) &&
  Boolean(
    (
      await pool.query("SELECT id FROM vehicles WHERE dealer_id=$1 AND id=$2", [
        currentDealerId(),
        id,
      ])
    ).rows.length,
  );
const metadata = (row: any) => ({
  id: row.id,
  status:
    row.status === "processing" &&
    Date.now() - new Date(row.updated_at).getTime() > 180000
      ? "failed"
      : row.status,
  published: row.published,
  revision: row.revision,
  durationMs: row.duration_ms,
  byteSize: row.byte_size,
  createdAt: row.created_at,
  previewUrl:
    row.status === "ready"
      ? `/api/staff/inventory/${row.vehicle_id}/videos/${row.id}/media`
      : null,
});
router.use(
  "/staff/inventory/:vehicleId/videos",
  requireStaff,
  requirePermission("sales.manage"),
  (_req, res, next) => {
    res.set("Cache-Control", "no-store");
    if (_req.get("origin") && _req.get("origin") !== siteOrigin()) {
      res.status(403).json({ error: "Open videos on the dealership website." });
      return;
    }
    next();
  },
);
const fail = (req: Request, res: Response, error: unknown) => {
  if (error instanceof VideoError) {
    res.status(error.status).json({ error: error.message });
    return;
  }
  req.log.error("Vehicle video operation failed");
  res
    .status(503)
    .json({
      error:
        "Video processing or storage is unavailable. Refresh the video status before retrying.",
    });
};
router.get("/staff/inventory/:vehicleId/videos", async (req, res) => {
  try {
    if (!(await carExists(req.params.vehicleId))) {
      res.status(404).json({ error: "Car not found." });
      return;
    }
    const rows = (
      await pool.query(
        "SELECT * FROM vehicle_videos WHERE dealer_id=$1 AND vehicle_id=$2 ORDER BY published DESC,created_at DESC LIMIT 10",
        [currentDealerId(), req.params.vehicleId],
      )
    ).rows;
    res.json({
      enabled: mediaStorageConfigured(),
      videos: rows.map(metadata),
      shareUrl: `${siteOrigin()}/vehicle/${req.params.vehicleId}?video=1#walkaround`,
    });
  } catch (error) {
    fail(req, res, error);
  }
});
router.put("/staff/inventory/:vehicleId/videos/:uploadId", async (req, res) => {
  let directory: string | undefined;
  let owned = false;
  let uploadDeadline: ReturnType<typeof setTimeout> | undefined;
  try {
    if (!(await carExists(req.params.vehicleId)) || !uuid(req.params.uploadId))
      throw new VideoError("Car or upload not found.", 404);
    if (!mediaStorageConfigured())
      throw new VideoError(
        "Video storage must be configured before uploading.",
        503,
      );
    if (
      !["video/mp4", "video/quicktime", "video/webm"].includes(
        (req.get("content-type") || "").split(";")[0],
      )
    )
      throw new VideoError("Choose an MP4, MOV or WebM video.");
    if (active || serviceLifecycle.isDraining()) {
      res.set("Retry-After", "10");
      throw new VideoError(
        "Another video is processing. Please try again shortly.",
        429,
      );
    }
    active = true;
    owned = true;
    req.setTimeout(60000, () => req.destroy());
    uploadDeadline = setTimeout(() => req.destroy(), 180000);
    uploadDeadline.unref();
    if (Number(req.get("content-length")) > videoLimits.sourceBytes)
      throw new VideoError("Choose a source video smaller than 200 MB.", 413);
    await serviceLifecycle.run(async () => {
      directory = await mkdtemp(path.join(tmpdir(), "luxxy-video-"));
      const input = path.join(directory, "input");
      const output = path.join(directory, "clip.mp4");
      const handle = await open(input, "wx", 0o600);
      const digest = createHash("sha256");
      let size = 0;
      try {
        for await (const data of req) {
          const chunk = Buffer.from(data);
          size += chunk.length;
          if (size > videoLimits.sourceBytes)
            throw new VideoError(
              "Choose a source video smaller than 200 MB.",
              413,
            );
          digest.update(chunk);
          await handle.write(chunk);
        }
      } finally {
        await handle.close();
      }
      if (uploadDeadline) clearTimeout(uploadDeadline);
      if (!size) throw new VideoError("Choose a video file.");
      const sourceHash = digest.digest("hex");
      const dealer = currentDealerId();
      const client = await pool.connect();
      let replay: any;
      try {
        await client.query("BEGIN");
        await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
          `video:${dealer}`,
        ]);
        const existing = (
          await client.query("SELECT * FROM vehicle_videos WHERE id=$1", [
            req.params.uploadId,
          ])
        ).rows[0];
        if (existing) {
          if (
            existing.dealer_id !== dealer ||
            existing.vehicle_id !== req.params.vehicleId ||
            existing.source_digest !== sourceHash
          )
            throw new VideoError(
              "This upload reference was already used. Select the file again.",
              409,
            );
          if (existing.status === "ready") replay = existing;
          else if (
            existing.status === "processing" &&
            Date.now() - new Date(existing.updated_at).getTime() < 180000
          )
            throw new VideoError(
              "This video is still processing. Refresh its status.",
              409,
            );
          else
            await client.query(
              "UPDATE vehicle_videos SET status='processing',updated_at=now() WHERE id=$1 AND dealer_id=$2",
              [req.params.uploadId, dealer],
            );
        } else {
          const usage = (
            await client.query(
              "SELECT count(*) AS count,coalesce(sum(coalesce(byte_size,5242880)),0) AS bytes FROM vehicle_videos WHERE dealer_id=$1",
              [dealer],
            )
          ).rows[0];
          if (
            Number(usage.count) >= videoLimits.storedUploads ||
            Number(usage.bytes) + videoLimits.outputBytes >
              videoLimits.storedBytes
          )
            throw new VideoError(
              "Video storage allowance reached. Ask the platform operator to review retained clips.",
              429,
            );
          const count = Number(
            (
              await client.query(
                "SELECT count(*) FROM vehicle_videos WHERE dealer_id=$1 AND created_at>now()-interval '1 day'",
                [dealer],
              )
            ).rows[0].count,
          );
          if (count >= videoLimits.dailyUploads)
            throw new VideoError(
              "The daily video upload limit has been reached.",
              429,
            );
          await client.query(
            "INSERT INTO vehicle_videos(id,dealer_id,vehicle_id,source_digest,object_key,status,created_by) VALUES($1,$2,$3,$4,$5,'processing',$6)",
            [
              req.params.uploadId,
              dealer,
              req.params.vehicleId,
              sourceHash,
              `${req.params.uploadId}.mp4`,
              req.staff!.authUserId,
            ],
          );
        }
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
      if (replay) {
        res.json({ video: metadata(replay), replayed: true });
        return;
      }
      try {
        const result = await compressVehicleVideo(input, output);
        await videoStorage().put(`${req.params.uploadId}.mp4`, output);
        const row = (
          await pool.query(
            "UPDATE vehicle_videos SET status='ready',duration_ms=$3,byte_size=$4,width=$5,height=$6,updated_at=now() WHERE id=$1 AND dealer_id=$2 RETURNING *",
            [
              req.params.uploadId,
              dealer,
              Math.min(30000, Math.round(result.duration * 1000)),
              result.byteSize,
              result.width,
              result.height,
            ],
          )
        ).rows[0];
        if (!res.destroyed)
          res.status(201).json({ video: metadata(row), replayed: false });
      } catch (error) {
        await pool.query(
          "UPDATE vehicle_videos SET status='failed',updated_at=now() WHERE id=$1 AND dealer_id=$2",
          [req.params.uploadId, dealer],
        );
        throw error;
      }
    });
  } catch (error) {
    if (!res.destroyed) fail(req, res, error);
  } finally {
    serviceLifecycle.finishRequest(req);
    if (uploadDeadline) clearTimeout(uploadDeadline);
    if (owned) active = false;
    if (directory) await rm(directory, { recursive: true, force: true });
  }
});
router.post(
  "/staff/inventory/:vehicleId/videos/:uploadId/publish",
  async (req, res) => {
    const client = await pool.connect();
    try {
      if (
        !uuid(req.params.vehicleId) ||
        !uuid(req.params.uploadId) ||
        !Number.isInteger(req.body?.expectedRevision) ||
        req.body?.confirm !== true
      )
        throw new VideoError("Review the video before publishing.", 400);
      await client.query("BEGIN");
      const dealer = currentDealerId();
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
        `video:${dealer}:${req.params.vehicleId}`,
      ]);
      const row = (
        await client.query(
          "SELECT * FROM vehicle_videos WHERE id=$1 AND dealer_id=$2 AND vehicle_id=$3 FOR UPDATE",
          [req.params.uploadId, dealer, req.params.vehicleId],
        )
      ).rows[0];
      if (!row || row.status !== "ready")
        throw new VideoError("The video is not ready.", 409);
      if (row.revision !== req.body.expectedRevision)
        throw new VideoError(
          "This video changed. Refresh before publishing.",
          409,
        );
      await client.query(
        "UPDATE vehicle_videos SET published=false,revision=revision+1 WHERE dealer_id=$1 AND vehicle_id=$2 AND published AND id<>$3",
        [dealer, req.params.vehicleId, row.id],
      );
      await client.query(
        "UPDATE vehicle_videos SET published=true,revision=revision+1,updated_at=now() WHERE id=$1",
        [row.id],
      );
      await client.query("COMMIT");
      res.json({ published: true });
    } catch (error) {
      await client.query("ROLLBACK");
      fail(req, res, error);
    } finally {
      client.release();
    }
  },
);
router.post(
  "/staff/inventory/:vehicleId/videos/:uploadId/unpublish",
  async (req, res) => {
    try {
      if (
        !uuid(req.params.uploadId) ||
        !uuid(req.params.vehicleId) ||
        !Number.isInteger(req.body?.expectedRevision)
      )
        throw new VideoError("Check the video request.", 400);
      const result = await pool.query(
        "UPDATE vehicle_videos SET published=false,revision=revision+1,updated_at=now() WHERE id=$1 AND dealer_id=$2 AND vehicle_id=$3 AND revision=$4 RETURNING id",
        [
          req.params.uploadId,
          currentDealerId(),
          req.params.vehicleId,
          req.body.expectedRevision,
        ],
      );
      if (!result.rows.length)
        throw new VideoError(
          "This video changed. Refresh before removing it.",
          409,
        );
      res.json({ published: false });
    } catch (error) {
      fail(req, res, error);
    }
  },
);
async function stream(req: Request, res: Response, row: any) {
  if (!row || row.status !== "ready") {
    res.status(404).end();
    return;
  }
  const range = req.get("range");
  try {
    videoRange(range, row.byte_size);
  } catch {
    res.status(416).set("Content-Range", `bytes */${row.byte_size}`).end();
    return;
  }
  const object = await videoStorage().read(row.object_key, range);
  res.set({
    "Content-Type": "video/mp4",
    "Accept-Ranges": "bytes",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "Content-Length": String(
      object.selected
        ? object.selected.end - object.selected.start + 1
        : object.size,
    ),
  });
  if (object.selected)
    res
      .status(206)
      .set(
        "Content-Range",
        `bytes ${object.selected.start}-${object.selected.end}/${object.size}`,
      );
  if (req.method === "HEAD") {
    (object.body as Readable).destroy();
    res.end();
    return;
  }
  await pipeline(object.body as Readable, res);
}
router.get(
  "/staff/inventory/:vehicleId/videos/:uploadId/media",
  async (req, res) => {
    try {
      if (!uuid(req.params.uploadId) || !uuid(req.params.vehicleId)) {
        res.status(404).end();
        return;
      }
      await stream(
        req,
        res,
        (
          await pool.query(
            "SELECT * FROM vehicle_videos WHERE id=$1 AND dealer_id=$2 AND vehicle_id=$3",
            [req.params.uploadId, currentDealerId(), req.params.vehicleId],
          )
        ).rows[0],
      );
    } catch (error) {
      if (!res.headersSent) fail(req, res, error);
      else res.destroy();
    }
  },
);
router.get("/vehicles/:vehicleId/video", async (req, res) => {
  try {
    if (!(await findPublicVehicle(req.params.vehicleId))) {
      res.status(404).json({ error: "Car not available." });
      return;
    }
    const row = (
      await pool.query(
        "SELECT id,duration_ms FROM vehicle_videos WHERE dealer_id=$1 AND vehicle_id=$2 AND published AND status='ready'",
        [currentDealerId(), req.params.vehicleId],
      )
    ).rows[0];
    res
      .set("Cache-Control", "no-store")
      .json({
        video: row
          ? {
              id: row.id,
              durationMs: row.duration_ms,
              url: `/api/vehicles/${req.params.vehicleId}/video/media`,
              shareUrl: `${siteOrigin()}/vehicle/${req.params.vehicleId}?video=1#walkaround`,
            }
          : null,
      });
  } catch (error) {
    fail(req, res, error);
  }
});
router.get("/vehicles/:vehicleId/video/media", async (req, res) => {
  try {
    if (!(await findPublicVehicle(req.params.vehicleId))) {
      res.status(404).end();
      return;
    }
    await stream(
      req,
      res,
      (
        await pool.query(
          "SELECT * FROM vehicle_videos WHERE dealer_id=$1 AND vehicle_id=$2 AND published AND status='ready'",
          [currentDealerId(), req.params.vehicleId],
        )
      ).rows[0],
    );
  } catch (error) {
    if (!res.headersSent) fail(req, res, error);
    else res.destroy();
  }
});
export default router;
