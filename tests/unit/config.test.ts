import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const raw = readFileSync(new URL("../../wrangler.jsonc", import.meta.url), "utf8");
const cfg = JSON.parse(raw.replace(/^\s*\/\/.*$/gm, ""));

test("Worker, D1 and both R2 buckets are bound", () => {
  assert.equal(cfg.name, "cambridge");
  assert.deepEqual(cfg.d1_databases.map((d: { binding: string; database_name: string }) => [d.binding, d.database_name]), [["DB", "cambridge"]]);
  const buckets = Object.fromEntries(cfg.r2_buckets.map((b: { binding: string; bucket_name: string }) => [b.binding, b.bucket_name]));
  assert.deepEqual(buckets, { FILES: "cambridge", SOURCE: "cambridge-source" });
});

test("no routes and no secrets in the config", () => {
  assert.equal(cfg.routes, undefined);
  assert.equal(cfg.route, undefined);
  assert.ok(!/token|secret|password|api[_-]?key/i.test(JSON.stringify(cfg.vars ?? {})));
});
