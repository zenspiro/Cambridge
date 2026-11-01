import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";

const dir = new URL("../../migrations/", import.meta.url);
const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();

test("migrations are numbered 0001, 0002, ... with no gaps", () => {
  assert.ok(files.length > 0);
  files.forEach((f, i) => assert.match(f, new RegExp(`^${String(i + 1).padStart(4, "0")}_[a-z0-9_]+\\.sql$`)));
});

test("migrations are additive only (brief 15.5)", () => {
  for (const f of files) {
    const sql = readFileSync(new URL(f, dir), "utf8").replace(/--.*$/gm, "");
    assert.ok(!/\bDROP\b/i.test(sql), `${f}: DROP is not allowed`);
    assert.ok(!/\bRENAME\b/i.test(sql), `${f}: RENAME is not allowed`);
    assert.ok(!/\bDELETE\s+FROM\b/i.test(sql), `${f}: DELETE is not allowed in a migration`);
  }
});
