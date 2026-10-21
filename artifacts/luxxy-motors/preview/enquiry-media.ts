// In-memory, loopback-only UI examples. Production does not import this module.
import { randomBytes, randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { serviceBookJpeg } from "../../api-server/src/lib/service-book-jpeg";
import { readPreviewEnquiries } from "./reservations";
import { previewStock } from "./stock";

type Photo = {
  id: string;
  bytes: Buffer;
  width: number;
  height: number;
  createdAt: string;
};
const photos = new Map<string, Photo[]>();
const requests = new Map<string, { body: string; ids: string[] }>();
const sessions = new Map<
  string,
  { id: string; enquiryId: string; expiresAt: string; completed: boolean }
>();
export const previewMediaEnabled = () =>
  process.env.MEDIA_SHARING_PREVIEW === "true";
export function previewEnquiryMedia(
  enquiryId: string,
  vehicleId: string | null | undefined,
  host: string,
) {
  const customPhotos = previewMediaEnabled()
    ? (photos.get(enquiryId) || []).map(
        ({ id, bytes, width, height, createdAt }) => ({
          id,
          url: `/api/staff/enquiries/${enquiryId}/photos/${id}`,
          byteSize: bytes.length,
          width,
          height,
          createdAt,
        }),
      )
    : [];
  const car = previewStock.cars.find((car) => car.id === vehicleId);
  return {
    customPhotos,
    vehiclePhotos: (car?.images || [])
      .slice(0, 100)
      .map((image, index) => ({ index, url: typeof image === 'string' ? image : image.url })),
    videoAvailable: Boolean(car && previewMediaEnabled()),
    videoUrl:
      car && previewMediaEnabled()
        ? `http://${host}/vehicle/${car.id}?video=1#walkaround`
        : null,
  };
}
export async function enquiryMediaPreview(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
) {
  const match =
    /^\/api\/staff\/enquiries\/([^/]+)\/(photos(?:\/([^/]+))?|photo-upload-session(?:\/([^/]+))?)$/.exec(
      url.pathname,
    );
  const phone = url.pathname === "/api/enquiry-photo-upload";
  if (!match && !phone) return false;
  const send = (status: number, body: unknown) => {
    res.statusCode = status;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify(body));
    return true;
  };
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("X-Robots-Tag", "noindex, nofollow");
  const remote = (req.socket.remoteAddress || "").replace(/^::ffff:/, "");
  if (
    !["127.0.0.1", "::1"].includes(remote) ||
    !/^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/.test(
      req.headers.host || "",
    ) ||
    (req.headers.origin && req.headers.origin !== `http://${req.headers.host}`)
  )
    return send(403, { error: "Photo examples are loopback-only." });
  if (!previewMediaEnabled())
    return send(409, {
      error:
        "Phone photo uploads need the authenticated server. Enable the isolated media preview to test fictional photos locally.",
    });
  const token = String(req.headers["x-enquiry-upload-token"] || ""),
    session = phone ? sessions.get(token) : undefined;
  if (phone && (!session || Date.parse(session.expiresAt) <= Date.now()))
    return send(410, {
      error:
        "This upload link expired or was cancelled. Ask staff for a new QR code.",
    });
  const id = match?.[1] || session!.enquiryId;
  const entry = (await readPreviewEnquiries()).find(
    (entry) => entry.id === id && !entry.mergedIntoId,
  );
  if (!entry) return send(phone ? 410 : 404, { error: "Enquiry not found." });
  const current = photos.get(id) || [];
  if (phone && req.method === "GET")
    return send(200, {
      title: entry.vehicleTitle || "Enquiry photos",
      customerName: entry.customerName,
      remaining: Math.max(0, 2 - current.length),
      expiresAt: session!.expiresAt,
      completed: session!.completed,
    });
  if (match?.[2] === "photos" && req.method === "GET")
    return send(200, {
      photos: previewEnquiryMedia(
        id,
        entry.vehicleId,
        req.headers.host || "localhost",
      ).customPhotos,
      remaining: Math.max(0, 2 - current.length),
    });
  if (match?.[3]) {
    const photo = current.find((photo) => photo.id === match[3]);
    if (!photo) return send(404, { error: "Photo not found." });
    if (req.method === "GET") {
      res.setHeader("Content-Type", "image/jpeg");
      res.end(photo.bytes);
      return true;
    }
    if (req.method === "DELETE") {
      photos.set(
        id,
        current.filter((photo) => photo.id !== match[3]),
      );
      return send(200, { removed: true });
    }
  }
  if (
    match?.[2].startsWith("photo-upload-session") &&
    req.method === "DELETE"
  ) {
    for (const [key, s] of sessions)
      if (s.id === match[4] && s.enquiryId === id) sessions.delete(key);
    return send(200, { revoked: true });
  }
  if (match?.[2] === "photo-upload-session" && req.method === "POST") {
    if (current.length >= 2)
      return send(409, {
        error: "Only two custom photos are allowed. Remove a photo first.",
      });
    for (const [key, s] of sessions)
      if (s.enquiryId === id) sessions.delete(key);
    const token = randomBytes(32).toString("base64url"),
      s = {
        id: randomUUID(),
        enquiryId: id,
        expiresAt: new Date(Date.now() + 15 * 60000).toISOString(),
        completed: false,
      };
    sessions.set(token, s);
    return send(201, {
      id: s.id,
      url: `http://${req.headers.host}/enquiry-photo-upload#${token}`,
      expiresAt: s.expiresAt,
    });
  }
  if (req.method === "POST" && (phone || match?.[2] === "photos")) {
    let raw = "";
    for await (const part of req) {
      raw += String(part);
      if (Buffer.byteLength(raw) > 1450000)
        return send(413, { error: "Choose up to two compressed photos." });
    }
    try {
      const body = JSON.parse(raw),
        key = `${id}:${String(body.requestId)}`;
      if (
        !/^[a-f0-9-]{36}$/i.test(body.requestId || "") ||
        !Array.isArray(body.photos) ||
        body.photos.length < 1 ||
        body.photos.length > 2
      )
        return send(400, { error: "Choose one or two compressed photos." });
      const previous = requests.get(key);
      if (previous)
        return previous.body === raw
          ? send(200, { uploaded: previous.ids, replayed: true })
          : send(409, {
              error: "Upload request changed. Choose the photos again.",
            });
      if (session?.completed)
        return send(409, { error: "This upload link was already used." });
      const decoded = body.photos.map(serviceBookJpeg);
      if (current.length + decoded.length > 2)
        return send(409, {
          error: "Only two custom photos are allowed. Remove a photo first.",
        });
      const added: Photo[] = decoded.map(
        (photo: ReturnType<typeof serviceBookJpeg>) => ({
          id: randomUUID(),
          bytes: photo.bytes,
          width: photo.width,
          height: photo.height,
          createdAt: new Date().toISOString(),
        }),
      );
      photos.set(id, [...current, ...added]);
      requests.set(key, { body: raw, ids: added.map((photo) => photo.id) });
      if (session) session.completed = true;
      return send(201, {
        uploaded: added.map((photo) => photo.id),
        replayed: false,
      });
    } catch {
      return send(400, { error: "Choose valid compressed JPEG photos." });
    }
  }
  return send(405, { error: "Method not allowed." });
}
