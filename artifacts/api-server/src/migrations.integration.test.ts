import "./test/setup";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, readdir, copyFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test, { after } from "node:test";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { is } from "drizzle-orm";
import { getTableConfig, PgTable } from "drizzle-orm/pg-core";
import * as currentSchema from "@workspace/db/schema";

const { db, pool } = await import("@workspace/db");
after(async () => { await pool.end(); });

// These hand-written migrations use PostgreSQL's generated UNIQUE-constraint
// names. Their application models label the equivalent capability indexes.
const equivalentUniqueIndexes: Record<string, { name: string; column: string }> = {
  vehicle_watch_tokens_hash_uidx: { name: "vehicle_watch_tokens_token_hash_key", column: "token_hash" },
  vehicle_watch_reply_routes_address_uidx: { name: "vehicle_watch_reply_routes_reply_address_key", column: "reply_address" },
  vehicle_watch_reply_receipts_provider_uidx: { name: "vehicle_watch_reply_receipts_provider_id_key", column: "provider_id" },
};
type ExpectedTable = { name: string; columns: string[]; indexes: string[] };
async function assertCompleteSchema(expected: ExpectedTable[]) {
  const tables = await pool.query("select tablename from pg_tables where schemaname='public'");
  assert.deepEqual(tables.rows.map(row => row.tablename).sort(), expected.map(table => table.name).sort(), "Complete public table set");
  const columns = await pool.query("select table_name,column_name from information_schema.columns where table_schema='public'");
  const indexes = await pool.query("select tablename,indexname,indexdef from pg_indexes where schemaname='public'");
  for (const table of expected) {
    assert.deepEqual(columns.rows.filter(row => row.table_name === table.name).map(row => row.column_name).sort(), [...table.columns].sort(), table.name + " complete columns");
    for (const name of table.indexes) {
      const equivalent = equivalentUniqueIndexes[name];
      const index = indexes.rows.find(row => row.tablename === table.name && (row.indexname === name || row.indexname === equivalent?.name));
      assert.ok(index, table.name + " required index " + name);
      if (equivalent) {
        assert.match(index.indexdef, /CREATE UNIQUE INDEX/, "Equivalent capability index remains unique");
        assert.ok(index.indexdef.endsWith(`(${equivalent.column})`), "Equivalent capability index covers its complete token/address/provider key");
      }
    }
  }
}

test("migrations build the current schema and preserve existing stock and enquiries", async () => {
  const tablesBefore = await pool.query("select tablename from pg_tables where schemaname = 'public'");
  assert.equal(tablesBefore.rowCount, 0, "Use a NEW, empty local test database for migration verification.");
  const migrationsFolder = path.resolve("../../lib/db/drizzle");
  const journal = JSON.parse(await readFile(path.join(migrationsFolder, "meta/_journal.json"), "utf8"));
  const entries = journal.entries as Array<{ idx: number; tag: string; when: number }>;
  assert.ok(entries.length > 0, "The migration journal must not be empty");
  assert.equal(new Set(entries.map(entry => entry.tag)).size, entries.length, "Every migration is registered once");
  entries.forEach((entry, index) => assert.equal(entry.idx, index, "Journal order remains contiguous"));
  const snapshotFiles = (await readdir(path.join(migrationsFolder, "meta"))).filter(name => /^\d+_snapshot\.json$/.test(name)).sort();
  const latestSnapshotFile = snapshotFiles.at(-1)!;
  assert.ok(latestSnapshotFile, "At least one generated schema snapshot exists");
  const snapshotPrefix = latestSnapshotFile.split("_")[0];
  const snapshotIndex = entries.findIndex(entry => entry.tag.startsWith(snapshotPrefix + "_"));
  assert.ok(snapshotIndex >= 0, "The latest generated snapshot belongs to a registered migration");
  const seedIndex = entries.findIndex(entry => entry.tag === "0010_great_nightmare");
  assert.ok(seedIndex >= 0 && seedIndex < snapshotIndex, "Seed legacy records before reconciliation and tenancy upgrades");
  const historical = await mkdtemp(path.join(tmpdir(), "luxxy-migration-history-"));
  try {
    await mkdir(path.join(historical, "meta"));
    await writeFile(path.join(historical, "meta/_journal.json"), JSON.stringify({ ...journal, entries: entries.slice(0, seedIndex + 1) }));
    for (const entry of entries.slice(0, snapshotIndex + 1)) await copyFile(path.join(migrationsFolder, `${entry.tag}.sql`), path.join(historical, `${entry.tag}.sql`));
    await migrate(db, { migrationsFolder: historical });
    const stock = await pool.query(`insert into vehicles (dealer_id, source, advert_id, title, source_price)
      values ('migration-test', 'autotrader', 'migration-preserved', 'Preserved Vehicle', 12500) returning id`);
    const enquiry = await pool.query(`insert into enquiries (dealer_id, vehicle_id, type, customer_name, email, message, appointment_at)
      values ('migration-test', $1, 'viewing', 'Preserved Customer', 'migration@example.test', 'Keep this enquiry', '2026-10-20T12:00:00Z') returning id`, [stock.rows[0].id]);

    // Validate the most recent complete generated snapshot at its actual point
    // in history before applying later hand-written migrations.
    await writeFile(path.join(historical, "meta/_journal.json"), JSON.stringify({ ...journal, entries: entries.slice(0, snapshotIndex + 1) }));
    await migrate(db, { migrationsFolder: historical });
    const snapshot = JSON.parse(await readFile(path.join(migrationsFolder, "meta", latestSnapshotFile), "utf8"));
    await assertCompleteSchema(Object.values(snapshot.tables).map((table: any) => ({ name: table.name, columns: Object.keys(table.columns), indexes: Object.keys(table.indexes) })));
    await migrate(db, { migrationsFolder });
    const preserved = await pool.query(`select e.*, v.title, v.source_price from enquiries e join vehicles v on v.id=e.vehicle_id where e.id=$1`, [enquiry.rows[0].id]);
    assert.equal(preserved.rowCount, 1);
    assert.equal(preserved.rows[0].customer_name, "Preserved Customer");
    assert.equal(preserved.rows[0].message, "Keep this enquiry");
    assert.equal(preserved.rows[0].title, "Preserved Vehicle");
    assert.equal(Number(preserved.rows[0].source_price), 12500);
    assert.match(preserved.rows[0].reference, /^[A-F0-9]{4}-[A-F0-9]{4}$/);
    assert.equal(preserved.rows[0].appointment_cancelled_at, null);
    assert.equal(preserved.rows[0].appointment_status, "confirmed");
    assert.equal(preserved.rows[0].appointment_revision, 0);
    assert.equal(preserved.rows[0].appointment_duration_minutes, 30);
    assert.equal(preserved.rows[0].appointment_buffer_minutes, 0);
    assert.equal(preserved.rows[0].follow_up_at, null);
    assert.equal(preserved.rows[0].follow_up_completed_at, null);
    assert.equal(preserved.rows[0].follow_up_revision, 0);

    const definitions = (Object.values(currentSchema) as unknown[]).filter((value): value is PgTable => is(value, PgTable)).map(getTableConfig);
    const expected: ExpectedTable[] = definitions.map(table => ({ name: table.name, columns: table.columns.map(column => column.name), indexes: table.indexes.map(index => { assert.ok(index.config.name, "Each required index has a declared name"); return index.config.name; }) }));
    // The receiving-email subsystem intentionally uses raw SQL. Assert its
    // complete migration-owned shape alongside every current Drizzle table.
    expected.push(
      { name: "enquiry_email_reply_routes", columns: ["id", "dealer_id", "enquiry_id", "send_key", "reply_address", "recipient", "in_reply_to", "created_at"], indexes: ["enquiry_email_reply_routes_pkey", "enquiry_email_reply_routes_reply_address_key", "enquiry_email_reply_routes_dealer_id_send_key_key", "enquiry_email_reply_routes_id_dealer_id_key"] },
      { name: "enquiry_email_replies", columns: ["id", "provider_id", "route_id", "dealer_id", "enquiry_id", "status", "attempts", "next_attempt_at", "lease_until", "sender", "subject", "message", "message_id", "attachment_names", "error_code", "received_at", "created_at", "resolved_at", "resolved_by"], indexes: ["enquiry_email_replies_pkey", "enquiry_email_replies_provider_id_key", "enquiry_email_replies_history", "enquiry_email_replies_due", "enquiry_email_replies_attention"] },
    );
    await assertCompleteSchema(expected);
    await pool.query(`update enquiries set appointment_cancelled_at=now() where id=$1`, [enquiry.rows[0].id]);
    const replacement = await pool.query(`insert into enquiries (dealer_id, type, customer_name, email, message, appointment_at)
      values ('migration-test', 'viewing', 'Replacement Booking', 'replacement@example.test', 'Released slot', '2026-10-20T12:00:00Z') returning id`);
    assert.equal(replacement.rowCount, 1, "a cancelled viewing releases its slot");
    const staffOverride = await pool.query(`insert into enquiries (dealer_id, type, customer_name, email, message, appointment_at, appointment_double_booked)
      values ('migration-test', 'viewing', 'Staff Override', 'staff@example.test', 'Double-booked with warning', '2026-10-20T12:00:00Z', true) returning appointment_double_booked`);
    assert.equal(staffOverride.rows[0].appointment_double_booked, true);
    const beforeReplay = await pool.query("select count(*)::int as count from drizzle.__drizzle_migrations");
    await migrate(db, { migrationsFolder });
    const afterReplay = await pool.query("select count(*)::int as count from drizzle.__drizzle_migrations");
    assert.deepEqual(afterReplay.rows, beforeReplay.rows, "replaying applied migrations is a no-op");
    assert.equal(afterReplay.rows[0].count, entries.length, "Every registered migration was applied once");
  } finally { await rm(historical, { recursive: true, force: true }); }
});
