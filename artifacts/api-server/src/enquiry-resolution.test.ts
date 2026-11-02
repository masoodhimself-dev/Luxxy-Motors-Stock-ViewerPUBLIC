import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import pino from "pino";
import { randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { engine, pool } from "./test/tenant-test-db";
import {
  EnquiryResolutionStore,
  enquiryResolutionRouter,
} from "./routes/enquiry-resolution";
import { runWithTenant } from "./lib/tenant-context";

process.env.MULTI_TENANT_ENABLED = "true";
const dealer = "resolution-fixture-a",
  other = "resolution-fixture-b";
const now = new Date("2026-11-02T12:00:00Z"),
  staff = { id: "fixture-staff", name: "Fixture Staff" };
const store = new EnquiryResolutionStore(pool, { clock: () => now });
test("enquiry resolution uses isolated PostgreSQL and keeps linked work intact", async (t) => {
  for (const file of (await readdir("../../lib/db/drizzle"))
    .filter((name) => /^\d+.*\.sql$/.test(name))
    .sort())
    await engine.exec(
      await readFile(join("../../lib/db/drizzle", file), "utf8"),
    );
  for (const id of [dealer, other])
    await pool.query(
      "INSERT INTO dealerships(id,name,status,canonical_origin,stock_platform,retailer_id,source_url) VALUES($1,$1,'active',$2,'autotrader','fixture','https://example.test/fixture')",
      [id, `https://${id}.example.test`],
    );
  const create = async (changes: Record<string, unknown> = {}) => {
    const row = {
      id: randomUUID(),
      dealer_id: dealer,
      customer_name: "Fixture buyer",
      message: "Fixture enquiry",
      email: "fixture@example.test",
      phone: "07700900123",
      type: "general",
      ...changes,
    };
    const columns = Object.keys(row);
    await pool.query(
      `INSERT INTO enquiries(${columns.join(",")}) VALUES(${columns.map((_, i) => `$${i + 1}`).join(",")})`,
      Object.values(row),
    );
    return String(row.id);
  };
  const snapshot = async (id: string) =>
    (await pool.query("SELECT * FROM enquiries WHERE id=$1", [id])).rows[0];
  const blocked = async (id: string, pattern: RegExp) => {
    const before = await snapshot(id);
    await assert.rejects(
      store.update(
        dealer,
        id,
        { expectedRevision: before.workspace_revision, status: "closed" },
        staff,
      ),
      pattern,
    );
    assert.deepEqual(await snapshot(id), before);
  };
  await t.test(
    "closure preserves messages, notes and a linked original; same-status writes are no-ops",
    async () => {
      const id = await create({
        staff_note: "Keep this note",
        call_outcome: "information_given",
      });
      const child = await create({
        merged_into_id: id,
        type: "viewing",
        appointment_at: new Date("2099-01-01T10:00:00Z"),
        appointment_status: "pending",
      });
      const childBefore = await snapshot(child);
      const closed = await store.update(
        dealer,
        id,
        { expectedRevision: 0, status: "closed" },
        staff,
      );
      assert.equal(closed.status, "closed");
      assert.equal(closed.workspaceRevision, 1);
      const noop = await store.update(
        dealer,
        id,
        { expectedRevision: 1, status: "closed" },
        staff,
      );
      assert.equal(noop.changed, false);
      assert.equal(noop.workspaceRevision, 1);
      const current = await snapshot(id);
      assert.equal(current.message, "Fixture enquiry");
      assert.equal(current.staff_note, "Keep this note");
      assert.equal(current.call_outcome, "information_given");
      assert.deepEqual(await snapshot(child), childBefore);
      const events = (
        await pool.query(
          "SELECT summary,detail FROM enquiry_events WHERE enquiry_id=$1 ORDER BY summary",
          [id],
        )
      ).rows;
      assert.deepEqual(
        events.map((row) => row.summary),
        ["Enquiry marked done"],
      );
      assert.ok(
        events.every(
          (row) =>
            row.detail.staffId === staff.id &&
            row.detail.action === "enquiry_resolution",
        ),
      );
    },
  );
  await t.test(
    "stale revisions, wrong dealership, invalid status and unknown fields cannot change status",
    async () => {
      const id = await create({ workspace_revision: 3 });
      const before = await snapshot(id);
      await assert.rejects(
        store.update(
          other,
          id,
          { expectedRevision: 3, status: "closed" },
          staff,
        ),
        /not found/,
      );
      await assert.rejects(
        store.update(
          dealer,
          id,
          { expectedRevision: 2, status: "closed" },
          staff,
        ),
        /changed/,
      );
      await assert.rejects(
        store.update(
          dealer,
          id,
          { expectedRevision: 3, status: "new" as "closed" },
          staff,
        ),
        /Check/,
      );
      await assert.rejects(
        store.update(
          dealer,
          id,
          { expectedRevision: 3, status: "closed", override: true } as never,
          staff,
        ),
        /Check/,
      );
      assert.deepEqual(await snapshot(id), before);
    },
  );
  await t.test(
    "active requested, booked and overdue visits block closure without cancelling them",
    async () => {
      for (const fields of [
        {
          appointment_status: "pending",
          appointment_at: new Date("2099-01-01T10:00:00Z"),
        },
        {
          appointment_status: "confirmed",
          appointment_at: new Date("2099-01-01T10:00:00Z"),
        },
        {
          appointment_status: "confirmed",
          appointment_at: new Date("2026-01-01T10:00:00Z"),
        },
        {
          appointment_status: "confirmed",
          attendance: "arrived",
          appointment_at: new Date("2026-01-01T10:00:00Z"),
        },
      ])
        await blocked(
          await create({ type: "viewing", ...fields }),
          /test-drive outcome/,
        );
      for (const fields of [
        { attendance: "completed" },
        { attendance: "no_show" },
        { appointment_cancelled_at: now },
      ]) {
        const id = await create({
          type: "viewing",
          appointment_at: now,
          ...fields,
        });
        assert.equal(
          (
            await store.update(
              dealer,
              id,
              { expectedRevision: 0, status: "closed" },
              staff,
            )
          ).status,
          "closed",
        );
      }
    },
  );
  await t.test(
    "outstanding follow-ups and pending, received or review mail must be handled explicitly",
    async () => {
      await blocked(
        await create({ follow_up_at: new Date("2099-01-01T10:00:00Z") }),
        /follow-up/,
      );
      for (const status of ["pending", "processing", "received", "review"]) {
        const id = await create(),
          route = randomUUID();
        await pool.query(
          "INSERT INTO enquiry_email_reply_routes(id,dealer_id,enquiry_id,send_key,reply_address,recipient) VALUES($1,$2,$3,$4,$5,'fixture@example.test')",
          [route, dealer, id, randomUUID(), `${route}@example.test`],
        );
        await pool.query(
          "INSERT INTO enquiry_email_replies(provider_id,route_id,dealer_id,enquiry_id,status,message) VALUES($1,$2,$3,$4,$5,'Fixture incoming')",
          [randomUUID(), route, dealer, id, status],
        );
        await blocked(id, /incoming email/);
        await pool.query(
          "UPDATE enquiry_email_replies SET resolved_at=$2 WHERE enquiry_id=$1",
          [id, now],
        );
        assert.equal(
          (
            await store.update(
              dealer,
              id,
              { expectedRevision: 0, status: "closed" },
              staff,
            )
          ).status,
          "closed",
        );
      }
    },
  );
  await t.test(
    "queued and uncertain email work blocks closure and audit failure rolls back the entire update",
    async () => {
      const id = await create();
      await pool.query(
        "INSERT INTO email_outbox(dealer_id,enquiry_id,kind,send_key,payload_hash,validation_hash,validation,account_hash,retry_deadline)VALUES($1,$2,'staff',$3,'hash','hash','{}','fixture',now()+interval '1 day')",
        [dealer, id, randomUUID()],
      );
      await blocked(id, /queued/);
      const rollback = await create();
      const failing = new EnquiryResolutionStore({
        connect: async () => {
          const client = await pool.connect();
          return {
            release: client.release,
            query: async (sql: string, values?: any[]) => {
              if (sql.startsWith("INSERT INTO enquiry_events"))
                throw new Error("Injected audit failure");
              return client.query(sql, values);
            },
          };
        },
      });
      await assert.rejects(
        failing.update(
          dealer,
          rollback,
          { expectedRevision: 0, status: "closed" },
          staff,
        ),
        /audit failure/,
      );
      assert.equal((await snapshot(rollback)).status, "new");
      assert.equal((await snapshot(rollback)).workspace_revision, 0);
    },
  );
  await t.test(
    "HTTP route enforces staff permission, same-origin writes, validation, revision and no-store",
    async () => {
      const app = express();
      app.use(express.json());
      app.use((req, _res, next) => {
        req.log = pino({ level: "silent" });
        const role = req.get("x-test-role");
        if (role)
          req.staff = {
            authUserId: staff.id,
            name: staff.name,
            email: null,
            role: role as "owner" | "accounts" | "salesperson",
          };
        else
          Object.assign(req, {
            auth: Object.assign(() => ({ userId: null }), {
              [Symbol.for("@clerk/express.auth")]: true,
            }),
          });
        runWithTenant(
          {
            dealerId: dealer,
            canonicalOrigin: `https://${dealer}.example.test`,
            platform: "autotrader",
            retailerId: "fixture",
            sourceUrl: "https://example.test",
            kind: "website",
          },
          next,
        );
      });
      app.use("/api", enquiryResolutionRouter(store));
      const server = app.listen(0, "127.0.0.1");
      await new Promise<void>((resolve) => server.once("listening", resolve));
      const id = await create(),
        url = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/staff/enquiries/${id}/resolution`;
      const send = (
        role?: string,
        body: unknown = { expectedRevision: 0, status: "closed" },
        origin?: string,
      ) =>
        fetch(url, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            ...(role ? { "x-test-role": role } : {}),
            ...(origin ? { origin } : {}),
          },
          body: JSON.stringify(body),
        });
      try {
        assert.equal((await send()).status, 401);
        assert.equal((await send("accounts")).status, 403);
        assert.equal(
          (
            await send("owner", {
              expectedRevision: 0,
              status: "closed",
              dealerId: other,
            })
          ).status,
          400,
        );
        assert.equal(
          (await send("owner", { expectedRevision: 1, status: "closed" }))
            .status,
          409,
        );
        assert.equal(
          (await send("owner", undefined, "https://different.example.test"))
            .status,
          403,
        );
        const result = await send("salesperson");
        assert.equal(result.status, 200);
        assert.equal(result.headers.get("cache-control"), "no-store");
        assert.equal(
          ((await result.json()) as { status: string }).status,
          "closed",
        );
        assert.equal((await send("owner")).status, 409);
      } finally {
        server.closeAllConnections();
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }
    },
  );
  await engine.close();
});
