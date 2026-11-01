import assert from "node:assert/strict";
import { test } from "node:test";
import { staffMotSummary } from "@workspace/vehicle-meta";
import { createPreviewMotChecks } from "./mot-checks";

test("local MOT demonstration stays read-only until clicked and never changes stock", () => {
  let now = Date.parse("2026-11-01T12:00:00Z");
  const cars = [
    { id: "one", make: "Ford", model: "Focus", plate: "AB12CDE" },
    { id: "two", make: "Nissan", model: "Juke", plate: "CD13EFG" },
    { id: "three", make: "Honda", model: "Jazz", plate: "EF14GHI" },
    { id: "no-plate" },
    { id: "missing", plate: "GH15JKL", sourceStatus: "missing" },
    { id: "sold", plate: "JK16LMN", inventoryStatus: "sold" },
  ];
  const before = JSON.stringify(cars);
  const preview = createPreviewMotChecks(cars, () => now);
  assert.equal(preview.status().run, null);
  now += 100000;
  assert.equal(preview.status().current.checked, 0);
  const started = preview.status(true);
  assert.equal(started.preview, true);
  assert.equal(started.current.total, 4);
  assert.equal(started.run?.pending, 3);
  assert.equal(started.run?.skipped, 1);
  assert.deepEqual(preview.status(true), started);
  now += 750;
  assert.equal(preview.status().current.checked, 1);
  assert.equal(staffMotSummary(preview.history("one"), new Date(now)).tone, "red");
  now += 2000;
  assert.equal(preview.status().run?.status, "completed");
  assert.equal(preview.status().current.checked, 3);
  assert.equal(staffMotSummary(preview.history("two"), new Date(now)).tone, "amber");
  assert.equal(staffMotSummary(preview.history("three"), new Date(now)).tone, "green");
  assert.equal(preview.history("sold"), null);
  assert.equal(preview.history("missing"), null);
  assert.equal(JSON.stringify(cars), before);
});
