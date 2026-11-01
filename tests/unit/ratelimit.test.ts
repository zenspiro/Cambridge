import { test } from "node:test";
import assert from "node:assert/strict";
import { testDb } from "./helpers/d1.ts";
import { allow, clear, limitKey } from "../../src/lib/ratelimit.ts";

test("allow counts per key and window, and clear resets", async () => {
  const db = testDb();
  const k = await limitKey("upload", "platform-admin");
  const other = await limitKey("upload", "someone-else");
  const T = 1_800_000_000_000;
  for (let i = 0; i < 3; i++) assert.equal(await allow(db, k, 3, 60_000, T + i), true);
  assert.equal(await allow(db, k, 3, 60_000, T + 10), false);
  assert.equal(await allow(db, other, 3, 60_000, T + 10), true);
  assert.equal(await allow(db, k, 3, 60_000, T + 60_001), true, "new window");
  await clear(db, k);
  assert.equal(await allow(db, k, 1, 60_000, T + 60_002), true);
  assert.notEqual(k, "upload:platform-admin", "keys are hashed");
});
