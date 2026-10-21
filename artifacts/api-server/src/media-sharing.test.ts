import test from "node:test";
import assert from "node:assert/strict";
import { promisify } from "node:util";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID, createHash } from "node:crypto";
import { createServer, request as httpRequest } from "node:http";
import express from "express";
import {
  db,
  engine,
  pool,
  dealershipsTable,
  portalUsersTable,
  vehiclesTable,
  dealerSettingsTable,
  enquiriesTable,
} from "./test/tenant-test-db";
import { runWithTenant } from "./lib/tenant-context";
import {
  videoBinaries,
  validateVideoProbe,
  compressVehicleVideo,
  probeVideo,
} from "./lib/vehicle-video";
import { videoRange } from "./lib/media-storage";
import { validatePhoneSharePayload } from "./lib/phone-share";
import videos from "./routes/vehicle-videos";
import shares from "./routes/phone-shares";
import { draftSchema, previewEnquiryEmail } from "./routes/enquiry-emails";
import { dealerIntegrationsStore } from "./lib/dealer-integrations-store";
import { dealerProfile } from "./lib/enquiry-notifications";
globalThis.fetch = async () => {
  throw new Error("External requests forbidden in media tests");
};
const exec = promisify(execFile);
process.env.MULTI_TENANT_ENABLED = "true";
process.env.INTEGRATIONS_ENCRYPTION_KEY = "ab".repeat(32);
process.env.SESSION_SECRET = "fictional-media-test-only";
const a = {
    dealerId: "media-a",
    canonicalOrigin: "https://a.example.test",
    platform: "autotrader" as const,
    retailerId: "fictional-a",
    sourceUrl:
      "https://www.autotrader.co.uk/cars/retailer/stock?retailerId=fictional-a",
    kind: "website" as const,
  },
  b = {
    ...a,
    dealerId: "media-b",
    canonicalOrigin: "https://b.example.test",
    retailerId: "fictional-b",
  };
const dir = await mkdtemp(join(tmpdir(), "luxxy-media-test-"));
process.env.VIDEO_STORAGE_DIR = join(dir, "storage");
const clip = join(dir, "source.mp4"),
  long = join(dir, "long.mp4");
await exec(videoBinaries().ffmpeg, [
  "-v",
  "error",
  "-f",
  "lavfi",
  "-i",
  "testsrc2=size=1280x720:rate=30",
  "-t",
  "1",
  "-c:v",
  "libx264",
  "-threads",
  "1",
  "-pix_fmt",
  "yuv420p",
  "-metadata",
  "title=PRIVATE-SOURCE",
  "-y",
  clip,
]);
await exec(videoBinaries().ffmpeg, [
  "-v",
  "error",
  "-f",
  "lavfi",
  "-i",
  "color=size=128x96:rate=10",
  "-t",
  "31",
  "-c:v",
  "libx264",
  "-threads",
  "1",
  "-y",
  long,
]);
const bytes = await readFile(clip);
test("video probe rejects long, missing and oversized streams", () => {
  assert.equal(
    validateVideoProbe({
      format: { duration: "30" },
      streams: [{ codec_type: "video", width: 1920, height: 1080 }],
    }).duration,
    30,
  );
  for (const duration of ["30.01", "0", "NaN"])
    assert.throws(() =>
      validateVideoProbe({
        format: { duration },
        streams: [{ codec_type: "video", width: 100, height: 100 }],
      }),
    );
  assert.throws(() =>
    validateVideoProbe({
      format: { duration: "1" },
      streams: [{ codec_type: "video", width: 9999, height: 9999 }],
    }),
  );
});
test("real compression yields H264 under5MB, bounded720px, and removes private metadata", async () => {
  const output = join(dir, "compressed.mp4"),
    r = await compressVehicleVideo(clip, output);
  assert.ok(r.byteSize < 5 * 1024 * 1024);
  assert.ok(Math.max(r.width, r.height) <= 720);
  const info = JSON.parse(
    (
      await exec(videoBinaries().ffprobe, [
        "-v",
        "error",
        "-show_streams",
        "-show_format",
        "-of",
        "json",
        output,
      ])
    ).stdout,
  );
  assert.equal(info.streams[0].codec_name, "h264");
  assert.equal(info.format.tags?.title, undefined);
  await assert.rejects(probeVideo(long), /30 seconds/);
});
test("thirty-second audio clips, MOV and WebM compress, while disguised playlists are rejected", async () => {
  const audio = join(dir, "audio.mov");
  await exec(videoBinaries().ffmpeg, [
    "-v",
    "error",
    "-f",
    "lavfi",
    "-i",
    "color=size=160x120:rate=25",
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=440:sample_rate=48000",
    "-t",
    "30",
    "-c:v",
    "libx264",
    "-threads",
    "1",
    "-c:a",
    "aac",
    "-y",
    audio,
  ]);
  const result = await compressVehicleVideo(audio, join(dir, "audio-out.mp4"));
  assert.ok(result.duration <= 30);
  assert.equal(result.width, 160);
  assert.equal(result.height, 120);
  const webm = join(dir, "sample.webm");
  await exec(videoBinaries().ffmpeg, [
    "-v",
    "error",
    "-f",
    "lavfi",
    "-i",
    "color=size=120x160:rate=10",
    "-t",
    "0.5",
    "-c:v",
    "libvpx",
    "-live",
    "1",
    "-threads",
    "1",
    "-y",
    webm,
  ]);
  assert.ok(
    (await compressVehicleVideo(webm, join(dir, "webm-out.mp4"))).byteSize > 0,
  );
  const playlist = join(dir, "disguised.mp4");
  await writeFile(playlist, `ffconcat version 1.0\nfile '${clip}'\n`);
  await assert.rejects(probeVideo(playlist), /could not be read/);
});
test("Safari byte ranges are bounded and multiple/invalid ranges refused", () => {
  assert.deepEqual(videoRange("bytes=0-9", 100), { start: 0, end: 9 });
  assert.deepEqual(videoRange("bytes=-10", 100), { start: 90, end: 99 });
  assert.deepEqual(videoRange("bytes=90-", 100), { start: 90, end: 99 });
  for (const range of [
    "bytes=100-",
    "bytes=9-1",
    "bytes=0-1,3-4",
    "bytes=-0",
    "items=0-1",
  ])
    assert.throws(() => videoRange(range, 100));
});
test("private packs reject executable files, unsafe filenames, invalid base64 and too many attachments", () => {
  for (const file of [
    { filename: "../i.pdf", content: "YWJj", contentType: "application/pdf" },
    { filename: "p.html", content: "YWJj", contentType: "text/html" },
    { filename: "i.pdf", content: "@@", contentType: "application/pdf" },
  ])
    assert.throws(() =>
      validatePhoneSharePayload({
        title: "Invoice",
        message: "",
        files: [file],
      }),
    );
  assert.throws(() =>
    validatePhoneSharePayload({
      title: "Invoice",
      message: "",
      files: Array(9).fill({
        filename: "i.pdf",
        content: "YWJj",
        contentType: "application/pdf",
      }),
    }),
  );
});
test("isolated real HTTP media and QR workflow", async (t) => {
  for (const file of (await readdir("../../lib/db/drizzle"))
    .filter((n) => /^\d+.*\.sql$/.test(n))
    .sort())
    await engine.exec(
      await readFile(join("../../lib/db/drizzle", file), "utf8"),
    );
  const carA = randomUUID(),
    carB = randomUUID();
  for (const tenant of [a, b]) {
    await db.insert(dealershipsTable).values({
      id: tenant.dealerId,
      name: tenant.dealerId,
      status: "active",
      canonicalOrigin: tenant.canonicalOrigin,
      stockPlatform: "autotrader",
      retailerId: tenant.retailerId,
      sourceUrl: tenant.sourceUrl,
    });
    await db.insert(portalUsersTable).values({
      dealerId: tenant.dealerId,
      authUserId: tenant.dealerId,
      role: "owner",
    });
    await db.insert(vehiclesTable).values({
      id: tenant === a ? carA : carB,
      dealerId: tenant.dealerId,
      source: "autotrader",
      advertId: tenant.dealerId,
      title: "Fictional car",
      sourcePrice: 9000,
    });
    await db.insert(dealerSettingsTable).values({
      dealerId: tenant.dealerId,
      config: {
        identity: { name: "Fictional Motors" },
        contact: { phone: "07700900101", email: "staff@example.test" },
        address: {
          street: "1 Test Road",
          city: "London",
          postcode: "ZZ1 1ZZ",
        },
      },
    });
  }
  await db
    .insert(portalUsersTable)
    .values({ dealerId: a.dealerId, authUserId: "accounts", role: "accounts" });
  const app = express();
  app.use(express.json({ limit: "32kb" }));
  app.use((req, _res, next) => {
    (req as any).log = { error() {}, warn() {} };
    runWithTenant(req.get("host") === "b.example.test" ? b : a, next);
  });
  app.use("/api", videos);
  app.use("/api", shares);
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw Error("No server");
  const call = (
    path: string,
    o: {
      method?: string;
      body?: unknown;
      user?: string;
      host?: string;
      headers?: Record<string, string>;
    } = {},
  ) =>
    new Promise<{ status: number; headers: any; bytes: Buffer; json: any }>(
      (resolve, reject) => {
        const raw = Buffer.isBuffer(o.body),
          body = raw
            ? (o.body as Buffer)
            : o.body
              ? Buffer.from(JSON.stringify(o.body))
              : undefined;
        const req = httpRequest(
          `http://127.0.0.1:${address.port}/api${path}`,
          {
            method: o.method || "GET",
            headers: {
              host: o.host || "a.example.test",
              "x-test-user": o.user ?? a.dealerId,
              ...(body
                ? {
                    "Content-Type": raw ? "video/mp4" : "application/json",
                    "Content-Length": String(body.length),
                  }
                : {}),
              ...o.headers,
            },
          },
          (res) => {
            const parts: Buffer[] = [];
            res.on("data", (c) => parts.push(c));
            res.on("end", () => {
              const data = Buffer.concat(parts);
              let json: any;
              try {
                json = JSON.parse(data.toString());
              } catch {}
              resolve({
                status: res.statusCode!,
                headers: res.headers,
                bytes: data,
                json,
              });
            });
          },
        );
        req.on("error", reject);
        req.end(body);
      },
    );
  const id = randomUUID(),
    base = `/staff/inventory/${carA}/videos`,
    upload = `${base}/${id}`;
  try {
    await t.test(
      "upload is authenticated, role/origin checked and dealer scoped",
      async () => {
        assert.equal(
          (await call(upload, { method: "PUT", body: bytes, user: "" })).status,
          401,
        );
        assert.equal(
          (await call(upload, { method: "PUT", body: bytes, user: "accounts" }))
            .status,
          403,
        );
        assert.equal(
          (
            await call(`/staff/inventory/${carB}/videos/${randomUUID()}`, {
              method: "PUT",
              body: bytes,
            })
          ).status,
          404,
        );
        assert.equal(
          (
            await call(upload, {
              method: "PUT",
              body: bytes,
              headers: { origin: "https://evil.example" },
            })
          ).status,
          403,
        );
      },
    );
    await t.test(
      "real uploaded clip stays private until explicit publishing, with exact retries",
      async () => {
        const made = await call(upload, { method: "PUT", body: bytes });
        assert.equal(made.status, 201, JSON.stringify(made.json));
        assert.equal(made.json.video.published, false);
        assert.equal(made.json.video.objectKey, undefined);
        assert.equal(
          (await call(upload, { method: "PUT", body: bytes })).json.replayed,
          true,
        );
        assert.equal(
          (
            await call(upload, {
              method: "PUT",
              body: Buffer.from("different"),
            })
          ).status,
          409,
        );
        assert.equal((await call(`/vehicles/${carA}/video`)).json.video, null);
        assert.equal((await call(`${upload}/media`, { user: "" })).status, 401);
        assert.equal(
          (
            await call(`${upload}/media`, {
              host: "b.example.test",
              user: b.dealerId,
            })
          ).status,
          404,
        );
      },
    );
    await t.test(
      "publish requires review and revision, media supports bounded range and HEAD",
      async () => {
        assert.equal(
          (
            await call(`${upload}/publish`, {
              method: "POST",
              body: { expectedRevision: 1 },
            })
          ).status,
          400,
        );
        assert.equal(
          (
            await call(`${upload}/publish`, {
              method: "POST",
              body: { expectedRevision: 99, confirm: true },
            })
          ).status,
          409,
        );
        assert.equal(
          (
            await call(`${upload}/publish`, {
              method: "POST",
              body: { expectedRevision: 1, confirm: true },
            })
          ).status,
          200,
        );
        const playback = await call(`/vehicles/${carA}/video/media`, {
          user: "",
          headers: { range: "bytes=0-99" },
        });
        assert.equal(playback.status, 206);
        assert.equal(playback.bytes.length, 100);
        assert.match(playback.headers["content-range"], /^bytes 0-99\//);
        assert.equal(
          (
            await call(`/vehicles/${carA}/video/media`, {
              method: "HEAD",
              user: "",
              headers: { range: "bytes=0-99" },
            })
          ).bytes.length,
          0,
        );
        assert.equal(
          (
            await call(`/vehicles/${carA}/video/media`, {
              user: "",
              headers: { range: "bytes=0-9,20-30" },
            })
          ).status,
          416,
        );
      },
    );
    await t.test(
      "published video remains manageable after many failed replacements",
      async () => {
        const failures: string[] = [];
        for (let i = 0; i < 11; i++) {
          const failed = randomUUID();
          failures.push(failed);
          await pool.query(
            "INSERT INTO vehicle_videos(id,dealer_id,vehicle_id,source_digest,object_key,status,created_by,created_at) VALUES($1,$2,$3,'test','test.mp4','failed','test',now()+interval '1 minute')",
            [failed, a.dealerId, carA],
          );
        }
        const listed = await call(base);
        assert.equal(listed.json.videos[0].id, id);
        assert.equal(listed.json.videos[0].published, true);
        await pool.query(
          "DELETE FROM vehicle_videos WHERE id=ANY($1::uuid[])",
          [failures],
        );
      },
    );
    await t.test(
      "thirty-second audio upload is accepted by the migrated database as a private draft",
      async () => {
        const created = await call(`${base}/${randomUUID()}`, {
          method: "PUT",
          body: await readFile(join(dir, "audio.mov")),
          headers: { "content-type": "video/quicktime" },
        });
        assert.equal(created.status, 201, JSON.stringify(created.json));
        assert.ok(created.json.video.durationMs > 29000);
        assert.ok(created.json.video.durationMs <= 30000);
        assert.equal(created.json.video.published, false);
      },
    );
    await t.test(
      "long or malformed replacements leave published clip intact",
      async () => {
        assert.equal(
          (
            await call(`${base}/${randomUUID()}`, {
              method: "PUT",
              body: await readFile(long),
            })
          ).status,
          422,
        );
        assert.equal(
          (
            await call(`${base}/${randomUUID()}`, {
              method: "PUT",
              body: Buffer.from("not video"),
            })
          ).status,
          422,
        );
        assert.equal((await call(`/vehicles/${carA}/video`)).json.video.id, id);
      },
    );
    await t.test(
      "unpublish is revision guarded and removes public playback",
      async () => {
        assert.equal(
          (
            await call(`${upload}/unpublish`, {
              method: "POST",
              body: { expectedRevision: 1 },
            })
          ).status,
          409,
        );
        assert.equal(
          (
            await call(`${upload}/unpublish`, {
              method: "POST",
              body: { expectedRevision: 2 },
            })
          ).status,
          200,
        );
        assert.equal(
          (await call(`/vehicles/${carA}/video/media`, { user: "" })).status,
          404,
        );
      },
    );
    const saleId = randomUUID(),
      docId = randomUUID(),
      pdf = Buffer.from("%PDF-1.4\nFICTIONAL INVOICE");
    const document = {
      id: docId,
      title: "Sales invoice",
      number: "INV-TEST",
      type: "invoice",
      invoiceKind: "full",
      snapshot: {
        draft: {
          customer: "Fictional buyer",
          vehicle: "Fictional car",
          roadTaxGuide: false,
        },
        branding: { identity: { name: "Fictional Motors" } },
      },
    };
    const frozen = {
      id: saleId,
      documents: [document],
      documentArchives: {
        [docId]: {
          content: pdf.toString("base64"),
          sha256: createHash("sha256").update(pdf).digest("hex"),
        },
      },
    };
    await pool.query(
      "INSERT INTO sale_workspace(id,dealer_id,reference,revision,state)VALUES($1,$2,$3,1,$4::jsonb)",
      [saleId, a.dealerId, "FICTIONAL-QR", JSON.stringify(frozen)],
    );
    const input = {
      requestId: randomUUID(),
      token: "cd".repeat(32),
      source: { kind: "document", saleId, documentId: docId },
    };
    let grant: any;
    await t.test(
      "invoice sharing permits accounts staff and gives exactly the immutable PDF without sending",
      async () => {
        assert.equal(
          (
            await call("/staff/phone-shares", {
              method: "POST",
              body: input,
              user: "",
            })
          ).status,
          401,
        );
        assert.equal(
          (
            await call("/staff/phone-shares", {
              method: "POST",
              body: input,
              user: b.dealerId,
              host: "b.example.test",
            })
          ).status,
          404,
        );
        const created = await call("/staff/phone-shares", {
          method: "POST",
          body: input,
          user: "accounts",
        });
        assert.equal(created.status, 201, JSON.stringify(created.json));
        grant = created.json;
        assert.match(grant.url, /\/phone-share#[a-f0-9]{64}$/);
        const opened = await call("/phone-shares", {
          user: "",
          headers: { "x-phone-share-token": input.token },
        });
        assert.equal(opened.status, 200);
        assert.equal(opened.json.files[0].content, pdf.toString("base64"));
        assert.equal(opened.headers["cache-control"], "no-store");
        assert.deepEqual(
          (
            await pool.query("SELECT state FROM sale_workspace WHERE id=$1", [
              saleId,
            ])
          ).rows[0].state,
          frozen,
        );
      },
    );
    await t.test(
      "QR retries, conflicting requests, dealer isolation, revocation and expiry",
      async () => {
        assert.equal(
          (await call("/staff/phone-shares", { method: "POST", body: input }))
            .json.replayed,
          true,
        );
        assert.equal(
          (
            await call("/staff/phone-shares", {
              method: "POST",
              body: {
                ...input,
                source: { ...input.source, documentId: randomUUID() },
              },
            })
          ).status,
          409,
        );
        assert.equal(
          (
            await call("/phone-shares", {
              user: "",
              host: "b.example.test",
              headers: { "x-phone-share-token": input.token },
            })
          ).status,
          404,
        );
        assert.equal(
          (
            await call(`/staff/phone-shares/${grant.id}/revoke`, {
              method: "POST",
              body: {},
              user: "accounts",
            })
          ).status,
          200,
        );
        assert.equal(
          (
            await call("/phone-shares", {
              user: "",
              headers: { "x-phone-share-token": input.token },
            })
          ).status,
          404,
        );
        const next = {
            ...input,
            requestId: randomUUID(),
            token: "ef".repeat(32),
          },
          created = await call("/staff/phone-shares", {
            method: "POST",
            body: next,
          });
        assert.equal(created.status, 201);
        await pool.query(
          "UPDATE customer_phone_shares SET created_at=now()-interval '2 days',expires_at=now()-interval '1 day' WHERE id=$1",
          [created.json.id],
        );
        assert.equal(
          (
            await call("/phone-shares", {
              user: "",
              headers: { "x-phone-share-token": next.token },
            })
          ).status,
          404,
        );
      },
    );
    await t.test(
      "reviewed enquiry pack requires the current preview and makes no provider delivery",
      async () => {
        const enquiryId = randomUUID();
        await db.insert(enquiriesTable).values({
          id: enquiryId,
          dealerId: a.dealerId,
          type: "general",
          customerName: "Fictional buyer",
          email: "buyer@example.test",
          message: "Question",
        });
        const draft = draftSchema.parse({
          to: "buyer@example.test",
          subject: "Your enquiry",
          message: "Thank you for calling.",
          includeVehicle: false,
          includeAppointment: false,
          photoIds: [],
          documentIds: [],
          expectedRevision: 0,
        });
        const prepared = await runWithTenant(a, async () =>
          previewEnquiryEmail(
            enquiryId,
            draft,
            await dealerIntegrationsStore.readPrivate(),
            await dealerProfile(),
          ),
        );
        const source = {
            kind: "enquiry",
            enquiryId,
            draft,
            previewHash: prepared.previewHash,
          },
          body = { requestId: randomUUID(), token: "12".repeat(32), source };
        assert.equal(
          (await call("/staff/phone-shares", { method: "POST", body })).status,
          201,
        );
        assert.equal(
          (
            await call("/staff/phone-shares", {
              method: "POST",
              body: {
                ...body,
                requestId: randomUUID(),
                token: "34".repeat(32),
                source: { ...source, previewHash: "a".repeat(64) },
              },
            })
          ).status,
          409,
        );
        assert.equal(
          Number(
            (await pool.query("SELECT count(*) FROM enquiry_emails")).rows[0]
              .count,
          ),
          0,
        );
      },
    );
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await engine.close();
    await rm(dir, { recursive: true, force: true });
  }
});
