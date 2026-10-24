import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { createServer, request } from "node:http";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import {
  db,
  engine,
  dealershipsTable,
  dealerDomainsTable,
  vehiclesTable,
  vehicleImagesTable,
  portalUsersTable,
} from "./test/tenant-test-db";
import { resolveTenant } from "./middlewares/tenant";
import inventory from "./routes/staff-inventory";
import { serviceBookJpeg } from "./lib/service-book-jpeg";
process.env.MULTI_TENANT_ENABLED = "true";
const jpeg = Buffer.from([
  255, 216, 255, 225, 0, 8, 69, 88, 73, 70, 0, 0, 255, 192, 0, 11, 8, 0, 2, 0,
  2, 1, 1, 17, 0, 255, 218, 0, 8, 1, 1, 0, 0, 63, 0, 1, 2, 3, 255, 217,
]).toString("base64");
test("private inventory: two-dealer permissions, limited QR upload, exact retries, revocation, expiry and preparation revisions", async () => {
  for (const f of (await readdir("../../lib/db/drizzle"))
    .filter((f) => /^\d+.*\.sql$/.test(f))
    .sort())
    await engine.exec(await readFile(join("../../lib/db/drizzle", f), "utf8"));
  const carA = randomUUID(),
    carB = randomUUID(),
    memberB = randomUUID();
  for (const d of ["a", "b"]) {
    await db.insert(dealershipsTable).values({
      id: d,
      name: d,
      status: "active",
      canonicalOrigin: `https://${d}.example.test`,
      stockPlatform: "autotrader",
      retailerId: d,
      sourceUrl: "https://www.autotrader.co.uk/example",
    });
    await db.insert(dealerDomainsTable).values({
      hostname: `${d}.example.test`,
      dealerId: d,
      verified: true,
      verificationToken: "fictional",
    });
    await db.insert(portalUsersTable).values({
      ...(d === "b" ? { id: memberB } : {}),
      dealerId: d,
      authUserId: `user_${d}`,
      role: "owner",
      email: `${d}@example.test`,
    });
    await db.insert(vehiclesTable).values({
      id: d === "a" ? carA : carB,
      dealerId: d,
      source: "autotrader",
      advertId: d,
      title: `Car ${d}`,
      sourcePrice: 9000,
      ...(d === "a" ? { year: 2019, mileage: 52000, fuel: "Petrol", transmission: "Manual", variant: "1.2 SE Euro 6", trim: "SE", bodyType: "Hatchback", engineSize: "1.2L", engineCC: 1197, colour: "Blue", doors: 5, seats: 5, rawSourceData: { privateSource: "PRIVATE-SOURCE-BULK".repeat(1000) } } : {}),
    });
  }
  await db
    .insert(portalUsersTable)
    .values({ dealerId: "a", authUserId: "user_accounts", role: "accounts" });
  await db.insert(vehicleImagesTable).values([
    { vehicleId: carA, sourceUrl: "https://images.example.test/front.jpg", caption: "Front", sortOrder: 1 },
    { vehicleId: carA, sourceUrl: "https://images.example.test/old.jpg", caption: "Front", isActive: false },
    { vehicleId: carB, sourceUrl: "https://images.example.test/other-dealer.jpg", caption: "Front" },
  ]);
  const app = express();
  app.use(express.json({ limit: "2200kb" }));
  app.use((req, _res, next) => {
    req.log = { warn: () => {} } as any;
    next();
  });
  app.use(resolveTenant);
  app.use("/api", inventory);
  const server = createServer(app);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as any).port;
  async function call(
    path: string,
    {
      host = "a",
      user = "user_a",
      token = "",
      method = "GET",
      body = undefined as unknown,
    } = {},
  ) {
    return new Promise<{ status: number; data: any }>((resolve) => {
      const req = request(
        {
          host: "127.0.0.1",
          port,
          path,
          method,
          headers: {
            Host: host + ".example.test",
            "Content-Type": "application/json",
            ...(user ? { "x-test-user": user } : {}),
            ...(token ? { "x-service-upload-token": token } : {}),
          },
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on("data", (c) => chunks.push(c));
          res.on("end", () => {
            const raw = Buffer.concat(chunks).toString();
            let data;
            try {
              data = JSON.parse(raw);
            } catch {
              data = raw;
            }
            resolve({ status: res.statusCode!, data });
          });
        },
      );
      req.end(body ? JSON.stringify(body) : undefined);
    });
  }
  try {
    assert.equal(
      (await call("/api/staff/inventory", { user: "" })).status,
      401,
    );
    assert.equal(
      (await call("/api/staff/inventory", { host: "b" })).status,
      403,
    );
    const listed = (await call("/api/staff/inventory")).data;
    assert.equal(listed.dealerId, "a");
    assert.equal(listed.cars.length, 1);
    const identifyingFacts = (car: Record<string, unknown>) => Object.fromEntries(['year','mileage','fuel','transmission','variant','trim','body_type','engine_size','engine_cc','colour','doors','seats'].map(key => [key, car[key]]));
    assert.deepEqual(identifyingFacts(listed.cars[0]), { year: 2019, mileage: 52000, fuel: "Petrol", transmission: "Manual", variant: "1.2 SE Euro 6", trim: "SE", body_type: "Hatchback", engine_size: "1.2L", engine_cc: 1197, colour: "Blue", doors: 5, seats: 5 });
    const ownDetail = (await call(`/api/staff/inventory/${carA}`)).data;
    assert.equal(ownDetail.dealerId, "a");
    assert.deepEqual(ownDetail.vehiclePhotos, [{ url: "https://images.example.test/front.jpg", caption: "Front" }]);
    assert.deepEqual(identifyingFacts(ownDetail.car), identifyingFacts(listed.cars[0]));
    assert.ok(!JSON.stringify({ listed, ownDetail }).includes("PRIVATE-SOURCE-BULK"));

    // Counts are open enquiries, never guessed unique people. Merged originals,
    // closed/cancelled/completed visits and another dealer's rows cannot inflate them.
    assert.equal(listed.cars[0].enquiry_count, 0);
    assert.equal(listed.cars[0].upcoming_test_drive_count, 0);
    assert.deepEqual(listed.cars[0].stock_changes, { checkedAt: null, items: [] });
    const nextVisit = new Date(Date.now() + 86400000).toISOString();
    const rootEnquiry = randomUUID();
    const enquiryRows = [
      { id: rootEnquiry, appointment: nextVisit, appointmentStatus: 'confirmed' },
      { appointment: new Date(Date.now() + 2 * 86400000).toISOString(), appointmentStatus: 'pending' },
      { appointment: new Date(Date.now() + 3 * 86400000).toISOString() },
      {},
      { status: 'closed', appointment: nextVisit },
      { appointment: nextVisit, cancelled: nextVisit },
      { appointment: nextVisit, attendance: 'completed' },
      { appointment: nextVisit, attendance: 'no_show' },
      { appointment: new Date(Date.now() - 86400000).toISOString() },
      { appointment: nextVisit, mergedIntoId: rootEnquiry },
      { dealer: 'b', appointment: nextVisit },
    ];
    for (const entry of enquiryRows as Array<Record<string, string>>) await engine.query(
      `INSERT INTO enquiries(id,dealer_id,vehicle_id,type,status,customer_name,message,appointment_at,appointment_status,appointment_cancelled_at,attendance,merged_into_id)
       VALUES($1,$2,$3,'general',$4,'PRIVATE-CONTACT','PRIVATE-MESSAGE',$5,$6,$7,$8,$9)`,
      [entry.id ?? randomUUID(),entry.dealer ?? 'a',carA,entry.status ?? 'new',entry.appointment ?? null,entry.appointmentStatus ?? null,entry.cancelled ?? null,entry.attendance ?? 'scheduled',entry.mergedIntoId ?? null]);
    const activity = (await call('/api/staff/inventory')).data.cars[0];
    assert.equal(activity.enquiry_count, 8);
    assert.equal(activity.upcoming_test_drive_count, 3);
    assert.equal(new Date(activity.next_test_drive_at).toISOString(), nextVisit);
    const activityDetail = (await call(`/api/staff/inventory/${carA}`)).data.car;
    for (const key of ['enquiry_count','upcoming_test_drive_count','next_test_drive_at','stock_changes']) assert.deepEqual(activityDetail[key], activity[key]);
    assert.ok(!JSON.stringify(activity).includes('PRIVATE-CONTACT'));
    assert.ok(!JSON.stringify(activity).includes('PRIVATE-MESSAGE'));

    // Only the car's latest completed import is summarised. Published prices use
    // effective-price history, not feed hints or manual overrides. Galleries and
    // descriptions are reduced to counts/labels inside PostgreSQL.
    const run = randomUUID(), laterRun = randomUUID(), priceChange = randomUUID(), rawChange = randomUUID(), mileageChange = randomUUID();
    const changedAt = '2026-10-23T12:00:00.000Z';
    for (const [id, at] of [[run, changedAt], [laterRun, '2026-10-24T12:00:00.000Z']]) await engine.query(
      `INSERT INTO stock_import_runs(id,run_id,dealer_id,source,retailer_id,schema_version,scraped_at,received_at,expected_count,received_count,complete,status,raw_snapshot)
       VALUES($1::uuid,$1::text,'a','autotrader','a','1',$2,$2,1,1,true,'completed','{"private":"PRIVATE-SNAPSHOT"}'::jsonb)`, [id, at]);
    await engine.query(`UPDATE vehicles SET source_price=8500,import_run_id=$1,first_seen_at='2026-10-20T12:00:00Z',last_seen_at=$2 WHERE id=$3`, [run, changedAt, carA]);
    const priceAudit = { dealerId: 'a', fromCurrency: 'GBP', toCurrency: 'GBP' };
    const rawBefore = { price: 9000, specifications: { description: 'PRIVATE-OLD-DESCRIPTION' }, sourceExtras: { sourcePlatform: 'autotrader', features: ['PRIVATE-OLD-FEATURE'] } };
    const rawAfter = { price: 8500, specifications: { description: 'PRIVATE-NEW-DESCRIPTION' }, sourceExtras: { sourcePlatform: 'autotrader', features: ['PRIVATE-OLD-FEATURE','PRIVATE-NEW-FEATURE'] } };
    for (const [field, before, after, id, audit] of [
      ['websitePublishedPrice',9000,8500,priceChange,priceAudit],
      ['sourceImages',['PRIVATE-OLD-URL'],['PRIVATE-NEW-URL','PRIVATE-NEW-URL-2'],randomUUID(),{}],
      ['mileage',53000,52000,mileageChange,{}],
      ['rawSourceData',rawBefore,rawAfter,rawChange,{}],
    ]) await engine.query(`INSERT INTO vehicle_changes(id,vehicle_id,import_run_id,field_name,old_value,new_value,changed_at,audit_metadata) VALUES($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7,$8::jsonb)`,
      [id,carA,run,field,JSON.stringify(before),JSON.stringify(after),changedAt,JSON.stringify(audit)]);
    const changes = (await call('/api/staff/inventory')).data.cars[0].stock_changes;
    assert.equal(new Date(changes.checkedAt).toISOString(), changedAt);
    assert.deepEqual(changes.items.map((item: any) => item.kind), ['price','photos','details']);
    assert.deepEqual({...changes.items[0],changedAt:new Date(changes.items[0].changedAt).toISOString()}, {kind:'price',changedAt,previousPrice:9000,currentPrice:8500});
    assert.deepEqual({...changes.items[1],changedAt:new Date(changes.items[1].changedAt).toISOString()}, {kind:'photos',changedAt,previousPhotoCount:1,currentPhotoCount:2});
    assert.deepEqual({...changes.items[2],changedAt:new Date(changes.items[2].changedAt).toISOString()}, {kind:'details',changedAt,fields:['Description','Features','Mileage']});
    assert.ok(!JSON.stringify(changes).includes('PRIVATE-'));
    assert.deepEqual((await call(`/api/staff/inventory/${carA}`)).data.car.stock_changes,changes);
    // The real importer records description/equipment inside rawSourceData,
    // not standalone description/features fields. Compare only known display
    // paths inside PostgreSQL; raw price/images/checks/private extras are not details.
    await engine.query(`UPDATE vehicle_changes SET field_name='ignored_mileage' WHERE id=$1`,[mileageChange]);
    const rawOnly = async (before:unknown,after:unknown) => {
      await engine.query(`UPDATE vehicle_changes SET old_value=$1::jsonb,new_value=$2::jsonb WHERE id=$3`,[JSON.stringify(before),JSON.stringify(after),rawChange]);
      return (await call('/api/staff/inventory')).data.cars[0].stock_changes.items.find((item:any)=>item.kind==='details');
    };
    for (const [group,key,label,value] of [
      ['specifications','description','Description','PRIVATE-DESCRIPTION'],
      ['sourceExtras','description','Description','PRIVATE-DESCRIPTION'],
      ['sourceExtras','advertDescription','Description','PRIVATE-DESCRIPTION'],
      ['specifications','features','Features',['PRIVATE-FEATURE']],
      ['sourceExtras','features','Features',['PRIVATE-FEATURE']],
      ['sourceExtras','featureList','Features',['PRIVATE-FEATURE']],
    ] as const) {
      const detailOnly=await rawOnly({[group]:{}},{[group]:{[key]:value}});
      assert.deepEqual(detailOnly.fields,[label]);
      assert.ok(!JSON.stringify(detailOnly).includes('PRIVATE-'));
    }
    assert.equal(await rawOnly(rawBefore,{...rawBefore,price:8500,images:['PRIVATE-CHANGED-IMAGE'],private:'PRIVATE-UNKNOWN',sourceExtras:{...rawBefore.sourceExtras,lastCheckedAt:'2026-10-24T15:00:00Z'}}),undefined);
    assert.equal(await rawOnly({sourceExtras:{description:null,features:null}},{sourceExtras:{description:' ',features:[]}}),undefined);
    await rawOnly(rawBefore,rawAfter);
    await engine.query(`UPDATE vehicle_changes SET field_name='mileage' WHERE id=$1`,[mileageChange]);
    await engine.query(`UPDATE vehicles SET website_price_override=8300 WHERE id=$1`,[carA]);
    assert.ok(!(await call('/api/staff/inventory')).data.cars[0].stock_changes.items.some((item:any)=>item.kind==='price'));
    await engine.query(`UPDATE vehicles SET website_price_override=NULL,currency='EUR' WHERE id=$1`,[carA]);
    assert.ok(!(await call('/api/staff/inventory')).data.cars[0].stock_changes.items.some((item:any)=>item.kind==='price'));
    await engine.query(`UPDATE vehicles SET currency='GBP' WHERE id=$1`,[carA]);
    await engine.query(`UPDATE vehicle_changes SET old_value='"malformed-price"'::jsonb WHERE id=$1`,[priceChange]);
    assert.ok(!(await call('/api/staff/inventory')).data.cars[0].stock_changes.items.some((item:any)=>item.kind==='price'));
    await engine.query(`UPDATE vehicle_changes SET old_value='9000'::jsonb WHERE id=$1`,[priceChange]);
    await engine.query(`UPDATE vehicles SET import_run_id=$1 WHERE id=$2`,[laterRun,carA]);
    assert.deepEqual((await call('/api/staff/inventory')).data.cars[0].stock_changes.items,[]);
    await engine.query(`UPDATE vehicles SET import_run_id=$1 WHERE id=$2`,[run,carA]);
    await engine.query(`UPDATE stock_import_runs SET status='processing' WHERE id=$1`,[run]);
    assert.deepEqual((await call('/api/staff/inventory')).data.cars[0].stock_changes,{checkedAt:null,items:[]});
    await engine.query(`UPDATE stock_import_runs SET status='completed' WHERE id=$1`,[run]);
    const foreignActivity = (await call('/api/staff/inventory',{host:'b',user:'user_b'})).data.cars[0];
    assert.equal(foreignActivity.enquiry_count,0);assert.deepEqual(foreignActivity.stock_changes,{checkedAt:null,items:[]});

    assert.equal((await call(`/api/staff/inventory/${carB}`)).status, 404);
    assert.equal(
      (
        await call(`/api/staff/inventory/${carA}/upload-session`, {
          user: "user_accounts",
          method: "POST",
        })
      ).status,
      403,
    );
    const grant = await call(`/api/staff/inventory/${carA}/upload-session`, {
      method: "POST",
    });
    assert.equal(grant.status, 201);
    const token = grant.data.url.split("#")[1];
    assert.equal(
      (await call("/api/service-book-upload", { host: "b", user: "", token }))
        .status,
      410,
    );
    assert.equal(
      (await call("/api/service-book-upload", { user: "", token })).data
        .remaining,
      3,
    );
    const body = { requestId: randomUUID(), photos: [jpeg, jpeg] };
    const results = await Promise.all([
      call("/api/service-book-upload", {
        user: "",
        token,
        method: "POST",
        body,
      }),
      call("/api/service-book-upload", {
        user: "",
        token,
        method: "POST",
        body,
      }),
    ]);
    assert.deepEqual(results.map((r) => r.status).sort(), [200, 201]);
    assert.deepEqual(results[0].data.uploaded, results[1].data.uploaded);
    let detail = (await call(`/api/staff/inventory/${carA}`)).data;
    assert.equal(detail.photos.length, 2);
    assert.equal(
      (
        await call(
          `/api/staff/inventory/${carA}/photos/${detail.photos[0].id}`,
          { user: "" },
        )
      ).status,
      401,
    );
    assert.equal(
      (
        await call(
          `/api/staff/inventory/${carA}/photos/${detail.photos[0].id}`,
          { host: "b", user: "user_b" },
        )
      ).status,
      404,
    );
    const next = await call(`/api/staff/inventory/${carA}/upload-session`, {
        method: "POST",
      }),
      nextToken = next.data.url.split("#")[1];
    assert.equal(
      (
        await call("/api/service-book-upload", {
          user: "",
          token: nextToken,
          method: "POST",
          body: { requestId: randomUUID(), photos: [jpeg, jpeg] },
        })
      ).status,
      409,
    );
    assert.equal(
      (
        await call("/api/service-book-upload", {
          user: "",
          token: nextToken,
          method: "POST",
          body: { requestId: randomUUID(), photos: [jpeg] },
        })
      ).status,
      201,
    );
    assert.equal(
      (
        await call(`/api/staff/inventory/${carA}/upload-session`, {
          method: "POST",
        })
      ).status,
      409,
    );
    await call(`/api/staff/inventory/${carA}/photos/${detail.photos[0].id}`, {
      method: "DELETE",
    });
    const revoked = await call(`/api/staff/inventory/${carA}/upload-session`, {
      method: "POST",
    });
    await call(
      `/api/staff/inventory/${carA}/upload-session/${revoked.data.id}`,
      { method: "DELETE" },
    );
    assert.equal(
      (
        await call("/api/service-book-upload", {
          user: "",
          token: revoked.data.url.split("#")[1],
        })
      ).status,
      410,
    );
    const expired = await call(`/api/staff/inventory/${carA}/upload-session`, {
      method: "POST",
    });
    await engine.exec(
      `UPDATE vehicle_service_upload_sessions SET expires_at=now()-interval '1 minute' WHERE id='${expired.data.id}'`,
    );
    assert.equal(
      (
        await call("/api/service-book-upload", {
          user: "",
          token: expired.data.url.split("#")[1],
        })
      ).status,
      410,
    );
    const prep = {
      revision: 0,
      tasks: {
        cleaning: "done",
        inspection: "pending",
        mot: "not_required",
        servicing: "pending",
      },
      assignedToId: null,
      dueDate: "2027-01-01",
      notes: "Private preparation",
    };
    assert.equal(
      (
        await call(`/api/staff/inventory/${carA}/preparation`, {
          method: "PUT",
          body: { ...prep, assignedToId: memberB },
        })
      ).status,
      400,
    );
    const revisions = await Promise.all([
      call(`/api/staff/inventory/${carA}/preparation`, {
        method: "PUT",
        body: prep,
      }),
      call(`/api/staff/inventory/${carA}/preparation`, {
        method: "PUT",
        body: prep,
      }),
    ]);
    assert.deepEqual(revisions.map((r) => r.status).sort(), [200, 409]);
    await engine.exec(
      `UPDATE vehicles SET source_price=9500 WHERE id='${carA}'`,
    );
    detail = (await call(`/api/staff/inventory/${carA}`)).data;
    assert.equal(detail.photos.length, 2);
    assert.equal(detail.preparation.notes, "Private preparation");
    assert.equal(detail.car.price, 9500);
    assert.equal(
      (
        await call(`/api/staff/inventory/${carA}/plate`, {
          method: "PUT",
          body: { plate: "ab12 cde", expectedPlate: null },
        })
      ).status,
      200,
    );
    assert.equal(
      (await call(`/api/staff/inventory/${carA}`)).data.car.plate,
      "AB12CDE",
    );
    assert.equal(
      (
        await call(`/api/staff/inventory/${carA}/plate`, {
          method: "PUT",
          body: { plate: "ZZ99ZZZ", expectedPlate: null },
        })
      ).status,
      409,
    );
    assert.equal(
      (
        await call(`/api/staff/inventory/${carA}/plate`, {
          host: "b",
          user: "user_b",
          method: "PUT",
          body: { plate: "ZZ99ZZZ", expectedPlate: null },
        })
      ).status,
      404,
    );
    const ag = await call(`/api/staff/inventory/${carA}/upload-session`, {
      method: "POST",
      body: { category: "pre_accident" },
    });
    assert.equal(ag.status, 201);
    const at = ag.data.url.split("#")[1];
    assert.equal(
      (await call("/api/service-book-upload", { token: at, user: "" })).data
        .category,
      "pre_accident",
    );
    assert.equal(
      (
        await call("/api/service-book-upload", {
          method: "POST",
          token: at,
          user: "",
          body: { requestId: randomUUID(), photos: [jpeg, jpeg, jpeg] },
        })
      ).status,
      201,
    );
    const photos2 = (await call(`/api/staff/inventory/${carA}`)).data.photos;
    assert.equal(
      photos2.filter((p: any) => p.category === "pre_accident").length,
      3,
    );
    assert.equal(
      photos2.filter((p: any) => p.category === "service_book").length,
      2,
    );
    await engine.exec(
      `UPDATE vehicles SET inventory_status='reserved' WHERE id='${carA}'`,
    );
    assert.equal(
      (
        await call(`/api/staff/inventory/${carA}/unreserve`, {
          host: "b",
          user: "user_b",
          method: "POST",
          body: { confirm: true },
        })
      ).status,
      404,
    );
    assert.equal(
      (
        await call(`/api/staff/inventory/${carA}/unreserve`, {
          method: "POST",
          body: { confirm: true },
        })
      ).status,
      200,
    );
    assert.equal(
      (await call(`/api/staff/inventory/${carA}`)).data.car.inventory_status,
      "available",
    );
    assert.equal(
      (
        await call(`/api/staff/inventory/${carA}/unreserve`, {
          method: "POST",
          body: { confirm: true },
        })
      ).status,
      409,
    );
    await engine.exec(
      `UPDATE vehicles SET inventory_status='reserved' WHERE id='${carA}'`,
    );
    const saleId = randomUUID();
    await engine.exec(
      `INSERT INTO sale_workspace(id,dealer_id,reference,revision,state) VALUES('${saleId}','a','SALE-TEST',1,'${JSON.stringify({ id: saleId, revision: 1, draft: { vehicleId: carA }, lifecycle: { status: "reserved" }, payments: [{ status: "confirmed", signedAmountPence: 20000 }], events: [] })}'::jsonb)`,
    );
    assert.equal(
      (
        await call(`/api/staff/inventory/${carA}/unreserve`, {
          method: "POST",
          body: { confirm: true },
        })
      ).status,
      409,
    );
    assert.equal(
      (await call(`/api/staff/inventory/${carA}`)).data.car.inventory_status,
      "reserved",
    );
    await engine.exec(
      `UPDATE sale_workspace SET state=jsonb_set(state,'{payments}','[]'::jsonb) WHERE id='${saleId}'`,
    );
    assert.equal(
      (
        await call(`/api/staff/inventory/${carA}/unreserve`, {
          method: "POST",
          body: { confirm: true },
        })
      ).status,
      200,
    );
    assert.equal(
      (
        await engine.query<any>(
          `SELECT state FROM sale_workspace WHERE id='${saleId}'`,
        )
      ).rows[0].state.lifecycle.status,
      "released",
    );
    const reservationLead = randomUUID();
    await engine.exec(
      `UPDATE vehicles SET inventory_status='reserved' WHERE id='${carA}'; INSERT INTO leads(id,dealer_id,vehicle_id,stage,source,customer_name) VALUES('${reservationLead}','a','${carA}','reserved','website_form','Fictional customer')`,
    );
    assert.equal(
      (
        await call(`/api/staff/inventory/${carA}/unreserve`, {
          method: "POST",
          body: { confirm: true },
        })
      ).status,
      200,
    );
    assert.equal(
      (
        await engine.query<any>(
          `SELECT stage FROM leads WHERE id='${reservationLead}'`,
        )
      ).rows[0].stage,
      "qualifying",
    );
    assert.equal(
      (
        await engine.query<any>(
          `SELECT payload FROM lead_events WHERE lead_id='${reservationLead}'`,
        )
      ).rows[0].payload.kind,
      "online_reservation_cancelled",
    );
    const clean = serviceBookJpeg(jpeg);
    assert.ok(!clean.bytes.includes(Buffer.from("EXIF")));
    assert.equal(clean.width, 2);
    assert.throws(() => serviceBookJpeg("not an image"));
    assert.throws(() =>
      serviceBookJpeg(Buffer.alloc(512001).toString("base64")),
    );
  } finally {
    await new Promise<void>((r, j) => server.close((e) => (e ? j(e) : r())));
    await engine.close();
  }
});
