import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import test from "node:test";

function runSetup(target?: string) {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    DATABASE_URL: "postgresql://unused@production.invalid/production",
  };
  delete env.LUXXY_TEST_DATABASE_URL;
  if (target !== undefined) env.LUXXY_TEST_DATABASE_URL = target;
  return spawnSync(process.execPath, [path.resolve("src/test/setup.ts")], {
    env,
    encoding: "utf8",
  });
}

test("test setup rejects inherited production URLs and unsafe explicit targets before importing the app", () => {
  for (const target of [
    undefined,
    "postgresql://unused@production.invalid/luxxy_test_demo",
    "postgresql://unused@127.0.0.1/production",
    "postgresql://unused@127.0.0.1/luxxy_test_demo?host=production.invalid",
    "https://127.0.0.1/luxxy_test_demo",
  ]) {
    const result = runSetup(target);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /disposable local|loopback PostgreSQL/);
  }
});

test("test setup accepts an explicitly named loopback test database without connecting", () => {
  const result = runSetup("postgresql://unused@127.0.0.1:1/luxxy_test_demo");
  assert.equal(result.status, 0, result.stderr);
});
