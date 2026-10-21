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
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
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
import enquiryPhotos from "./routes/enquiry-photos";
import { createEnquiryEmailRouter } from "./routes/enquiry-emails";
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
const jpeg = Buffer.from([255,216,255,225,0,8,69,88,73,70,0,0,255,192,0,11,8,0,2,0,2,1,1,17,0,255,218,0,8,1,1,0,0,63,0,1,2,3,255,217]).toString("base64");
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
test("registered enquiry-photo migration upgrades an existing database without changing its enquiry", async () => {
  const source = "../../lib/db/drizzle";
  const journal = JSON.parse(await readFile(join(source,"meta/_journal.json"),"utf8"));
  assert.equal(journal.entries.at(-1).tag,"0050_enquiry_photos");
  const earlier = journal.entries.slice(0,-1);
  const local = new PGlite(), database = drizzle(local), id=randomUUID();
  try {
    // Older migrations contain multi-command batches supported by PostgreSQL,
    // but not PGlite's prepared adapter. Build that baseline with exec, then
    // exercise the real migrator and journal for the new incremental upgrade.
    for (const item of earlier) await local.exec(await readFile(join(source,`${item.tag}.sql`),"utf8"));
    await local.exec("CREATE SCHEMA drizzle; CREATE TABLE drizzle.__drizzle_migrations(id serial PRIMARY KEY,hash text NOT NULL,created_at bigint)");
    await local.query("INSERT INTO drizzle.__drizzle_migrations(hash,created_at)VALUES('historical-fixture',$1)",[earlier.at(-1).when]);
    await local.query("INSERT INTO dealerships(id,name,status,canonical_origin,stock_platform,retailer_id,source_url) VALUES('migration-photos','Fictional migration dealer','active','https://migration.example.test','autotrader','fictional','https://www.autotrader.co.uk/fictional')");
    await local.query("INSERT INTO enquiries(id,dealer_id,type,customer_name,message)VALUES($1,'migration-photos','general','Preserved buyer','Keep this enquiry')",[id]);
    const before=(await local.query("SELECT * FROM enquiries WHERE id=$1",[id])).rows[0];
    await migrate(database,{migrationsFolder:source});
    assert.deepEqual((await local.query("SELECT * FROM enquiries WHERE id=$1",[id])).rows[0],before);
    for (const name of ['enquiry_photos','enquiry_photo_upload_sessions','customer_email_preparations']) assert.equal((await local.query<{name:string}>("SELECT to_regclass($1) AS name",[name])).rows[0].name,name);
    await migrate(database,{migrationsFolder:source});
    assert.equal(Number((await local.query<{n:number}>("SELECT count(*) AS n FROM drizzle.__drizzle_migrations")).rows[0].n),2);
  } finally {await local.close();}
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
  app.use("/api", enquiryPhotos);
  const sentEmails: any[] = [];
  app.use("/api", createEnquiryEmailRouter({settings: async()=>({...await dealerIntegrationsStore.readPrivate(),resend:{enabled:true,apiKey:"re_fictional",from:"sales@example.test",replyTo:""}}),send:async(_settings,request)=>{sentEmails.push(request);return randomUUID();}}));
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
          vehicleId: carA,
          email: "buyer@example.test",
          phone: "07700 900123",
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
        assert.equal(grant.customerPhone, "07700 900123");
        assert.equal(grant.customerName, "Fictional buyer");
        assert.equal(grant.vehicleId, carA);
        assert.equal(grant.customerEmail, "buyer@example.test");
        assert.equal(grant.hasAttachments, true);
        assert.match(grant.message, /Fictional car/);
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
    await t.test("phone-only enquiries share full reviewed text without email, while stale revisions and cross-dealer access fail", async () => {
      const enquiryId = randomUUID();
      await db.insert(enquiriesTable).values({id:enquiryId,dealerId:a.dealerId,type:'general',customerName:'Fictional phone buyer',email:null,phone:'07700 900456',message:'Question'});
      const source = {kind:'enquiry-message',enquiryId,draft:{to:'',subject:'Your enquiry',message:'Hello, here are the details you requested.',includeVehicle:false,includeAppointment:false,photoIds:[],documentIds:[],expectedRevision:0}};
      const body = {requestId:randomUUID(),token:'56'.repeat(32),source};
      const created = await call('/staff/phone-shares',{method:'POST',body});
      assert.equal(created.status,201,JSON.stringify(created.json));
      assert.equal((await call('/staff/phone-shares',{method:'POST',body:{...body,requestId:randomUUID(),token:'61'.repeat(32)},user:'accounts'})).status,403);
      assert.equal(created.json.customerPhone,'07700 900456');
      assert.equal(created.json.hasAttachments,false);
      assert.match(created.json.message,/Hello, here are the details you requested/);
      const replay = await call('/staff/phone-shares',{method:'POST',body});
      assert.deepEqual(replay.json,{...created.json,replayed:true});
      assert.equal((await call('/staff/phone-shares',{method:'POST',body:{...body,requestId:randomUUID(),token:'57'.repeat(32)},user:b.dealerId,host:'b.example.test'})).status,404);
      assert.equal((await call('/staff/phone-shares',{method:'POST',body:{...body,requestId:randomUUID(),token:'58'.repeat(32),source:{...source,draft:{...source.draft,expectedRevision:1}}}})).status,409);
      const confirmation={requestId:randomUUID(),enquiryId,grantId:created.json.id,phone:'07700 900456',message:created.json.message,confirmed:true};
      assert.equal(Number((await pool.query("SELECT count(*) FROM enquiry_events WHERE enquiry_id=$1",[enquiryId])).rows[0].count),0);
      const saved=await call('/staff/phone-shares/confirm-whatsapp',{method:'POST',body:confirmation});
      assert.equal(saved.status,201,JSON.stringify(saved.json));
      assert.equal(saved.json.enquiryId,enquiryId);
      assert.equal((await call('/staff/phone-shares/confirm-whatsapp',{method:'POST',body:confirmation})).status,200);
      assert.equal((await call('/staff/phone-shares/confirm-whatsapp',{method:'POST',body:{...confirmation,message:'Changed'}})).status,409);
      assert.equal((await call('/staff/phone-shares/confirm-whatsapp',{method:'POST',body:{...confirmation,requestId:randomUUID()},user:'accounts'})).status,403);
      assert.equal((await call('/staff/phone-shares/confirm-whatsapp',{method:'POST',body:{...confirmation,requestId:randomUUID()},user:b.dealerId,host:'b.example.test'})).status,409);
      const history=(await pool.query('SELECT summary,detail FROM enquiry_events WHERE enquiry_id=$1',[enquiryId])).rows;
      assert.equal(history.length,1);assert.equal(history[0].detail.message,created.json.message);assert.equal(history[0].detail.deliveryVerified,false);assert.match(history[0].detail.note,/Staff confirmed sent on WhatsApp/);
      assert.equal((await pool.query('SELECT status FROM enquiries WHERE id=$1',[enquiryId])).rows[0].status,'contacted');
      const matches=await call('/staff/phone-shares/enquiries?q='+encodeURIComponent('+44 7700 900456'));
      assert.equal(matches.status,200,JSON.stringify(matches.json));assert.equal(matches.json.enquiries[0].id,enquiryId);
      const owned=await call('/staff/phone-shares/enquiries?id='+enquiryId,{user:b.dealerId,host:'b.example.test'});
      assert.equal(owned.json.enquiries.length,0);
      assert.equal(Number((await pool.query('SELECT count(*) FROM enquiry_emails')).rows[0].count),0);
    });
    await t.test("explicit new-customer confirmation creates one enquiry and does not affect appointments or money",async()=>{
      const input={requestId:randomUUID(),newCustomer:{name:'Fictional new video customer'},vehicleId:carA,phone:'+447700900999',message:'Here is your video: https://a.example.test/vehicle/'+carA,confirmed:true};
      const created=await call('/staff/phone-shares/confirm-whatsapp',{method:'POST',body:input});
      assert.equal(created.status,201,JSON.stringify(created.json));
      assert.equal((await call('/staff/phone-shares/confirm-whatsapp',{method:'POST',body:input})).json.enquiryId,created.json.enquiryId);
      const entry=(await pool.query('SELECT * FROM enquiries WHERE id=$1',[created.json.enquiryId])).rows[0];
      assert.equal(entry.customer_name,input.newCustomer.name);assert.equal(entry.phone,input.phone);assert.equal(entry.vehicle_id,carA);assert.equal(entry.appointment_at,null);
      assert.equal((await call('/staff/phone-shares/confirm-whatsapp',{method:'POST',body:{...input,requestId:randomUUID(),confirmed:false}})).status,400);
      assert.equal((await call('/staff/phone-shares/confirm-whatsapp',{method:'POST',body:{...input,requestId:randomUUID(),vehicleId:carB}})).status,404);
    });
    await t.test("reservation sharing uses saved payment facts, includes archived receipts, and does not change payment or email records", async () => {
      const id=randomUUID();
      const reservation={id,dealerId:a.dealerId,reference:'FICTIONAL-RES',vehicleId:carA,vehicleTitle:'Fictional car',customerName:'Fictional buyer',email:'buyer@example.test',phone:'07700 900789',depositPence:10000,amountReceivedPence:10000,amountRefundedPence:0,paymentStatus:'confirmed',status:'reserved',mode:'live',expiresAt:new Date(Date.now()+86400000).toISOString(),saleId};
      const receiptId=randomUUID();
      const receipt={id:receiptId,number:'RCPT-TEST',type:'receipt',paymentId:'deposit',snapshot:{payments:[{id:'deposit',kind:'deposit'}]}};
      const sale={...frozen,documents:[...frozen.documents,receipt],documentArchives:{...frozen.documentArchives,[receiptId]:{content:pdf.toString('base64')}}};
      await pool.query('UPDATE sale_workspace SET state=$1::jsonb WHERE id=$2',[JSON.stringify(sale),saleId]);
      await pool.query("INSERT INTO leads(id,dealer_id,customer_name,stage,source)VALUES($1,$2,'Fictional buyer','reserved','website_form')",[id,a.dealerId]);
      await pool.query("INSERT INTO lead_events(lead_id,type,actor_type,payload)VALUES($1,'note_added','system',$2::jsonb)",[id,JSON.stringify({kind:'online_stripe_reservation',reservation})]);
      const body={requestId:randomUUID(),token:'59'.repeat(32),source:{kind:'reservation',reservationId:id}};
      const created=await call('/staff/phone-shares',{method:'POST',body});
      assert.equal(created.status,201,JSON.stringify(created.json));
      assert.equal(created.json.customerPhone,reservation.phone);assert.equal(created.json.hasAttachments,true);
      const opened=await call('/phone-shares',{user:'',headers:{'x-phone-share-token':body.token}});
      assert.equal(opened.json.files[0].content,pdf.toString('base64'));
      assert.match(opened.json.message,/100/);
      assert.equal((await call('/staff/phone-shares',{method:'POST',body:{...body,requestId:randomUUID(),token:'60'.repeat(32)},user:b.dealerId,host:'b.example.test'})).status,404);
      assert.deepEqual((await pool.query("SELECT payload->'reservation' AS record FROM lead_events WHERE lead_id=$1",[id])).rows[0].record,reservation);
      assert.deepEqual((await pool.query('SELECT state FROM sale_workspace WHERE id=$1',[saleId])).rows[0].state,sale);
    });
    await t.test('enquiry photos require sales access, stay tenant scoped and cap two with exact upload retries',async()=>{
      const enquiryId=randomUUID();await db.insert(enquiriesTable).values({id:enquiryId,dealerId:a.dealerId,type:'general',customerName:'Fictional photo buyer',email:'photo@example.test',vehicleId:carA,message:'Photo question'});
      const base=`/staff/enquiries/${enquiryId}/photos`,body={requestId:randomUUID(),photos:[jpeg,jpeg]};
      assert.equal((await call(base,{method:'POST',body,user:''})).status,401);
      assert.equal((await call(base,{method:'POST',body,user:'accounts'})).status,403);
      assert.equal((await call(base,{method:'POST',body,user:b.dealerId,host:'b.example.test'})).status,404);
      assert.equal((await call(base,{method:'POST',body,headers:{origin:'https://evil.example'}})).status,403);
      assert.equal((await call(base,{method:'POST',body:{...body,photos:['bad']}})).status,400);
      const made=await call(base,{method:'POST',body});assert.equal(made.status,201,JSON.stringify(made.json));assert.equal(made.json.uploaded.length,2);
      assert.deepEqual((await call(base,{method:'POST',body})).json,{...made.json,replayed:true});
      assert.equal((await call(base,{method:'POST',body:{...body,photos:[jpeg]}})).status,409);
      assert.equal((await call(base,{method:'POST',body:{requestId:randomUUID(),photos:[jpeg]}})).status,409);
      const list=await call(base);assert.equal(list.json.remaining,0);assert.equal(list.json.photos.length,2);const p=list.json.photos[0];assert.equal(p.width,2);assert.equal(p.height,2);assert.equal(p.url,`/api${base}/${p.id}`);
      const image=await call(`${base}/${p.id}`);assert.equal(image.status,200);assert.equal(image.headers['content-type'],'image/jpeg');assert.equal(image.bytes[0],255);assert.equal(image.bytes[1],216);assert.equal(image.bytes.includes(Buffer.from('EXIF')),false);
      assert.equal((await call(`${base}/${p.id}`,{user:b.dealerId,host:'b.example.test'})).status,404);
      await call(`${base}/${p.id}`,{method:'DELETE'});assert.equal((await call(base)).json.remaining,1);
      assert.equal((await pool.query('SELECT workspace_revision FROM enquiries WHERE id=$1',[enquiryId])).rows[0].workspace_revision,0);
    });
    await t.test('phone enquiry uploads use a hashed 15-minute capability, creator permission, revocation and bounded retry',async()=>{
      const enquiryId=randomUUID();await db.insert(enquiriesTable).values({id:enquiryId,dealerId:a.dealerId,type:'general',customerName:'Fictional QR buyer',message:'Photo question'});
      const base=`/staff/enquiries/${enquiryId}/photo-upload-session`;
      const make=async()=>{const r=await call(base,{method:'POST',body:{}});assert.equal(r.status,201,JSON.stringify(r.json));return r.json;};
      let s=await make(),token=new URL(s.url).hash.slice(1);const headers={'x-enquiry-upload-token':token};
      assert.ok(s.url.startsWith('https://a.example.test/enquiry-photo-upload#'));assert.ok(Date.parse(s.expiresAt)-Date.now()<=900000);
      const stored=(await pool.query('SELECT token_hash FROM enquiry_photo_upload_sessions WHERE id=$1',[s.id])).rows[0];assert.equal(stored.token_hash,createHash('sha256').update(token).digest('hex'));assert.notEqual(stored.token_hash,token);
      assert.equal((await call('/enquiry-photo-upload',{user:'',headers})).json.remaining,2);
      assert.equal((await call('/enquiry-photo-upload',{user:'',host:'b.example.test',headers})).status,410);
      await pool.query('UPDATE portal_users SET disabled_at=now() WHERE dealer_id=$1 AND auth_user_id=$1',[a.dealerId]);assert.equal((await call('/enquiry-photo-upload',{user:'',headers})).status,410);await pool.query('UPDATE portal_users SET disabled_at=NULL WHERE dealer_id=$1 AND auth_user_id=$1',[a.dealerId]);
      const body={requestId:randomUUID(),photos:[jpeg]};const uploaded=await call('/enquiry-photo-upload',{method:'POST',body,user:'',headers});assert.equal(uploaded.status,201,JSON.stringify(uploaded.json));assert.equal((await call('/enquiry-photo-upload',{method:'POST',body,user:'',headers})).json.replayed,true);assert.equal((await call('/enquiry-photo-upload',{method:'POST',body:{...body,requestId:randomUUID()},user:'',headers})).status,409);
      await call(`${base}/${s.id}`,{method:'DELETE'});assert.equal((await call('/enquiry-photo-upload',{method:'POST',body,user:'',headers})).status,410);
      s=await make();token=new URL(s.url).hash.slice(1);await pool.query("UPDATE enquiry_photo_upload_sessions SET expires_at=now()-interval '1 second' WHERE id=$1",[s.id]);assert.equal((await call('/enquiry-photo-upload',{user:'',headers:{'x-enquiry-upload-token':token}})).status,410);
      const fresh=await make(),latest=await make();assert.equal((await call('/enquiry-photo-upload',{user:'',headers:{'x-enquiry-upload-token':new URL(fresh.url).hash.slice(1)}})).status,410);assert.equal((await call('/enquiry-photo-upload',{user:'',headers:{'x-enquiry-upload-token':new URL(latest.url).hash.slice(1)}})).status,200);
    });
    await t.test('reviewed custom photos, public gallery links and published video are frozen in email and WhatsApp previews',async()=>{
      const enquiryId=randomUUID();await db.insert(enquiriesTable).values({id:enquiryId,dealerId:a.dealerId,type:'general',customerName:'Fictional media buyer',email:'media@example.test',phone:'07700900123',vehicleId:carA,message:'Please send these'});
      const made=await call(`/staff/enquiries/${enquiryId}/photos`,{method:'POST',body:{requestId:randomUUID(),photos:[jpeg]}});assert.equal(made.status,201,JSON.stringify(made.json));const photoId=made.json.uploaded[0];
      const imageId=randomUUID(),videoId=randomUUID();await pool.query("INSERT INTO vehicle_images(id,vehicle_id,source_url,caption,sort_order)VALUES($1,$2,'https://images.example.test/car-front.jpg','Front',0)",[imageId,carA]);await pool.query("INSERT INTO vehicle_videos(id,dealer_id,vehicle_id,source_digest,object_key,status,published,duration_ms,byte_size,created_by)VALUES($1,$2,$3,'fixture','fixture.mp4','ready',false,1000,100,'fictional')",[videoId,a.dealerId,carA]);
      const context=await call(`/staff/enquiries/${enquiryId}/email-context`);assert.equal(context.status,200,JSON.stringify(context.json));assert.equal(context.json.customPhotos[0].id,photoId);assert.equal(context.json.vehiclePhotos[0].url,'https://images.example.test/car-front.jpg');assert.equal(context.json.videoAvailable,false);
      const draft=draftSchema.parse({to:'media@example.test',subject:'Your car photos',message:'Here are the photos and video we discussed.',includeVehicle:false,includeAppointment:false,photoIds:[],documentIds:[],customPhotoIds:[photoId],vehiclePhotoIndices:[0],includeVideo:true,expectedRevision:0});
      const preview=async(d:any=draft)=>runWithTenant(a,async()=>previewEnquiryEmail(enquiryId,d,await dealerIntegrationsStore.readPrivate(),await dealerProfile()));
      await assert.rejects(()=>preview(),/no published video/);await pool.query('UPDATE vehicle_videos SET published=true WHERE id=$1',[videoId]);const result=await preview();assert.equal(result.attachments.length,1);assert.equal(Buffer.from(result.attachments[0].content,'base64').includes(Buffer.from('EXIF')),false);assert.match(result.rendered.text,/https:\/\/images.example.test\/car-front.jpg/);assert.match(result.rendered.text,/\?video=1#walkaround/);
      const body={requestId:randomUUID(),token:'63'.repeat(32),source:{kind:'enquiry',enquiryId,draft,previewHash:result.previewHash}};const pack=await call('/staff/phone-shares',{method:'POST',body});assert.equal(pack.status,201,JSON.stringify(pack.json));const opened=await call('/phone-shares',{user:'',headers:{'x-phone-share-token':body.token}});assert.equal(opened.json.files.length,1);assert.match(opened.json.message,/car-front.jpg/);assert.match(opened.json.message,/video=1/);
      await pool.query("UPDATE vehicle_images SET source_url='https://images.example.test/replacement.jpg' WHERE id=$1",[imageId]);assert.notEqual((await preview()).previewHash,result.previewHash);assert.equal((await call('/staff/phone-shares',{method:'POST',body:{...body,requestId:randomUUID(),token:'64'.repeat(32)}})).status,409);
      await call(`/staff/enquiries/${enquiryId}/photos/${photoId}`,{method:'DELETE'});await assert.rejects(()=>preview(),/removed or belongs/);assert.equal((await call('/phone-shares',{user:'',headers:{'x-phone-share-token':body.token}})).json.files.length,1);
      await pool.query('UPDATE vehicle_videos SET published=false WHERE id=$1',[videoId]);await pool.query('DELETE FROM vehicle_images WHERE id=$1',[imageId]);
      assert.equal(draftSchema.safeParse({...draft,customPhotoIds:[photoId,photoId]}).success,false);assert.equal(draftSchema.safeParse({...draft,vehiclePhotoIndices:[0,1,2,3,4]}).success,false);assert.equal(draftSchema.safeParse({...draft,vehiclePhotoUrls:['https://evil.example']}).success,false);
    });
    await t.test('internal email fallback creates one explicit contact and revalidates sharing packs without marking sent',async()=>{
      const body={requestId:randomUUID(),newCustomer:{name:'Fictional email-only buyer',email:'new@example.test'},email:'new@example.test',vehicleId:carA};
      assert.equal((await call('/staff/phone-shares/email-enquiry',{method:'POST',body,user:'accounts'})).status,403);
      const made=await call('/staff/phone-shares/email-enquiry',{method:'POST',body});assert.equal(made.status,201,JSON.stringify(made.json));assert.equal(made.json.customerEmail,'new@example.test');assert.equal((await call('/staff/phone-shares/email-enquiry',{method:'POST',body})).json.enquiry.id,made.json.enquiry.id);assert.equal((await call('/staff/phone-shares/email-enquiry',{method:'POST',body:{...body,email:'other@example.test'}})).status,409);
      const row=(await pool.query('SELECT * FROM enquiries WHERE id=$1',[made.json.enquiry.id])).rows[0];assert.equal(row.status,'new');assert.equal(row.appointment_at,null);assert.equal(Number((await pool.query('SELECT count(*) FROM enquiry_events WHERE enquiry_id=$1',[row.id])).rows[0].count),0);
      const selected={requestId:randomUUID(),enquiryId:row.id,email:'reviewed@example.test'};assert.equal((await call('/staff/phone-shares/email-enquiry',{method:'POST',body:selected})).json.customerEmail,'reviewed@example.test');assert.equal((await pool.query('SELECT email FROM enquiries WHERE id=$1',[row.id])).rows[0].email,'new@example.test');assert.equal((await call('/staff/phone-shares/email-enquiry',{method:'POST',body:{...selected,requestId:randomUUID()},user:b.dealerId,host:'b.example.test'})).status,404);
      const source={kind:'enquiry-message',enquiryId:row.id,draft:{to:'new@example.test',subject:'Your car',message:'Please find your details.',includeVehicle:false,includeAppointment:false,photoIds:[],documentIds:[],expectedRevision:0}};const pack=await call('/staff/phone-shares',{method:'POST',body:{requestId:randomUUID(),token:'65'.repeat(32),source}});assert.equal(pack.status,201,JSON.stringify(pack.json));const preparation={requestId:randomUUID(),enquiryId:row.id,email:'new@example.test',grantId:pack.json.id};assert.equal((await call('/staff/phone-shares/email-enquiry',{method:'POST',body:preparation})).status,201);await call(`/staff/phone-shares/${pack.json.id}/revoke`,{method:'POST',body:{}});assert.equal((await call('/staff/phone-shares/email-enquiry',{method:'POST',body:preparation})).status,410);
      assert.equal(Number((await pool.query('SELECT count(*) FROM enquiry_emails')).rows[0].count),0);
    });
    await t.test('staff-approved custom photo email sends frozen bytes once and keeps legacy empty-selector retries compatible',async()=>{
      const enquiryId=randomUUID();await db.insert(enquiriesTable).values({id:enquiryId,dealerId:a.dealerId,type:'general',customerName:'Fictional approved photo buyer',email:'approved@example.test',vehicleId:carA,message:'Please email my photo'});
      const uploaded=await call(`/staff/enquiries/${enquiryId}/photos`,{method:'POST',body:{requestId:randomUUID(),photos:[jpeg]}});const photoId=uploaded.json.uploaded[0];
      const draft={to:'approved@example.test',subject:'Your requested photo',message:'Here is the photo you asked for.',includeVehicle:false,includeAppointment:false,photoIds:[],documentIds:[],customPhotoIds:[photoId],vehiclePhotoIndices:[],includeVideo:false,expectedRevision:0};
      const preview=await call(`/staff/enquiries/${enquiryId}/email-preview`,{method:'POST',body:draft});assert.equal(preview.status,200,JSON.stringify(preview.json));assert.equal(sentEmails.length,0);const body={...draft,requestId:randomUUID(),previewHash:preview.json.previewHash};const sent=await call(`/staff/enquiries/${enquiryId}/email`,{method:'POST',body});assert.equal(sent.status,201,JSON.stringify(sent.json));assert.equal(sent.json.delivery.photoCount,1);assert.equal(sentEmails.length,1);assert.equal(sentEmails[0].attachments[0].filename,'enquiry-photo-1.jpg');assert.equal(Buffer.from(sentEmails[0].attachments[0].content,'base64').includes(Buffer.from('EXIF')),false);assert.equal((await call(`/staff/enquiries/${enquiryId}/email`,{method:'POST',body})).json.replayed,true);assert.equal(sentEmails.length,1);
      // An omitted new option and its explicit empty value retain one request identity.
      const plain={to:'approved@example.test',subject:'Your next question',message:'Please call if you have any questions.',includeVehicle:false,includeAppointment:false,photoIds:[],documentIds:[],expectedRevision:0};const p=await call(`/staff/enquiries/${enquiryId}/email-preview`,{method:'POST',body:plain});const first={...plain,requestId:randomUUID(),previewHash:p.json.previewHash};assert.equal((await call(`/staff/enquiries/${enquiryId}/email`,{method:'POST',body:first})).status,201);assert.equal((await call(`/staff/enquiries/${enquiryId}/email`,{method:'POST',body:{...first,customPhotoIds:[],vehiclePhotoIndices:[],includeVideo:false}})).json.replayed,true);assert.equal(sentEmails.length,2);
    });
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await engine.close();
    await rm(dir, { recursive: true, force: true });
  }
});
