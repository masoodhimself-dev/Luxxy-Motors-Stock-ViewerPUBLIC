import "./test/setup";
import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  readFile,
  copyFile,
  writeFile,
  rm,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test, { after } from "node:test";
import { migrate } from "drizzle-orm/node-postgres/migrator";

const { db, pool } = await import("@workspace/db");
after(async () => {
  await pool.end();
});

test("migrations build the current schema and preserve existing stock and enquiries", async () => {
  const tablesBefore = await pool.query(
    "select tablename from pg_tables where schemaname = 'public'",
  );
  assert.equal(
    tablesBefore.rowCount,
    0,
    "Use a NEW, empty local test database for migration verification.",
  );
  const migrationsFolder = path.resolve("../../lib/db/drizzle");
  const journal = JSON.parse(
    await readFile(path.join(migrationsFolder, "meta/_journal.json"), "utf8"),
  );
  assert.equal(
    journal.entries.at(-1).tag,
    "0011_reconcile_portal_and_enquiry_events",
  );
  const historical = await mkdtemp(
    path.join(tmpdir(), "luxxy-migration-history-"),
  );
  try {
    await mkdir(path.join(historical, "meta"));
    const earlier = journal.entries.slice(0, -1) as Array<{ tag: string }>;
    await writeFile(
      path.join(historical, "meta/_journal.json"),
      JSON.stringify({ ...journal, entries: earlier }),
    );
    for (const entry of earlier)
      await copyFile(
        path.join(migrationsFolder, `${entry.tag}.sql`),
        path.join(historical, `${entry.tag}.sql`),
      );
    await migrate(db, { migrationsFolder: historical });
    const stock =
      await pool.query(`insert into vehicles (dealer_id, source, advert_id, title, source_price)
      values ('migration-test', 'autotrader', 'migration-preserved', 'Preserved Vehicle', 12500) returning id`);
    const enquiry = await pool.query(
      `insert into enquiries (dealer_id, vehicle_id, type, customer_name, email, message, appointment_at)
      values ('migration-test', $1, 'viewing', 'Preserved Customer', 'migration@example.test', 'Keep this enquiry', '2026-10-20T12:00:00Z') returning id`,
      [stock.rows[0].id],
    );
    await migrate(db, { migrationsFolder });
    const preserved = await pool.query(
      `select e.*, v.title, v.source_price from enquiries e join vehicles v on v.id=e.vehicle_id where e.id=$1`,
      [enquiry.rows[0].id],
    );
    assert.equal(preserved.rowCount, 1);
    assert.equal(preserved.rows[0].customer_name, "Preserved Customer");
    assert.equal(preserved.rows[0].message, "Keep this enquiry");
    assert.equal(preserved.rows[0].title, "Preserved Vehicle");
    assert.equal(Number(preserved.rows[0].source_price), 12500);
    assert.match(preserved.rows[0].reference, /^[A-F0-9]{4}-[A-F0-9]{4}$/);
    assert.equal(preserved.rows[0].appointment_cancelled_at, null);

    const snapshot = JSON.parse(
      await readFile(
        path.join(migrationsFolder, "meta/0011_snapshot.json"),
        "utf8",
      ),
    );
    const tables = await pool.query(
      "select tablename from pg_tables where schemaname='public'",
    );
    assert.deepEqual(
      tables.rows.map((row) => row.tablename).sort(),
      Object.values(snapshot.tables)
        .map((table: any) => table.name)
        .sort(),
    );
    const columns = await pool.query(
      "select table_name, column_name from information_schema.columns where table_schema='public'",
    );
    for (const table of Object.values(snapshot.tables) as Array<{
      name: string;
      columns: Record<string, unknown>;
      indexes: Record<string, unknown>;
    }>) {
      assert.deepEqual(
        columns.rows
          .filter((row) => row.table_name === table.name)
          .map((row) => row.column_name)
          .sort(),
        Object.keys(table.columns).sort(),
        table.name,
      );
      const indexes = await pool.query(
        "select indexname from pg_indexes where schemaname='public' and tablename=$1",
        [table.name],
      );
      for (const name of Object.keys(table.indexes))
        assert.ok(
          indexes.rows.some((row) => row.indexname === name),
          name,
        );
    }
    assert.equal(tables.rowCount, 27);
    await pool.query(
      `update enquiries set appointment_cancelled_at=now() where id=$1`,
      [enquiry.rows[0].id],
    );
    const replacement =
      await pool.query(`insert into enquiries (dealer_id, type, customer_name, email, message, appointment_at)
      values ('migration-test', 'viewing', 'Replacement Booking', 'replacement@example.test', 'Released slot', '2026-10-20T12:00:00Z') returning id`);
    assert.equal(
      replacement.rowCount,
      1,
      "a cancelled viewing releases its slot",
    );
    await assert.rejects(
      pool.query(`insert into enquiries (dealer_id, type, customer_name, email, message, appointment_at)
      values ('migration-test', 'viewing', 'Duplicate Booking', 'duplicate@example.test', 'Must fail', '2026-10-20T12:00:00Z')`),
      (error: any) => error.code === "23505",
    );
    const beforeReplay = await pool.query(
      "select count(*)::int as count from drizzle.__drizzle_migrations",
    );
    await migrate(db, { migrationsFolder });
    const afterReplay = await pool.query(
      "select count(*)::int as count from drizzle.__drizzle_migrations",
    );
    assert.deepEqual(
      afterReplay.rows,
      beforeReplay.rows,
      "replaying applied migrations is a no-op",
    );
    assert.equal(afterReplay.rows[0].count, 12);
  } finally {
    await rm(historical, { recursive: true, force: true });
  }
});
