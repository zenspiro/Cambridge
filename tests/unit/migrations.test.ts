import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";

const dir = new URL("../../migrations/", import.meta.url);
const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();

test("migrations are numbered 0001, 0002, ... with no gaps", () => {
  assert.ok(files.length > 0);
  files.forEach((f, i) => assert.match(f, new RegExp(`^${String(i + 1).padStart(4, "0")}_[a-z0-9_]+\\.sql$`)));
});

// Owner-approved one-time exceptions (each must say so in its own header).
const REBUILD_EXCEPTIONS = new Set(["0006_library_hierarchy.sql", "0014_more_doc_types.sql"]);

test("migrations are additive only (brief 15.5)", () => {
  for (const f of files) {
    const raw = readFileSync(new URL(f, dir), "utf8");
    if (REBUILD_EXCEPTIONS.has(f)) {
      assert.match(raw, /ONE-TIME EXCEPTION/, `${f}: exception must be explained in the file`);
      continue;
    }
    const sql = raw.replace(/--.*$/gm, "");
    assert.ok(!/\bDROP\b/i.test(sql), `${f}: DROP is not allowed`);
    assert.ok(!/\bRENAME\b/i.test(sql), `${f}: RENAME is not allowed`);
    assert.ok(!/\bDELETE\s+FROM\b/i.test(sql), `${f}: DELETE is not allowed in a migration`);
  }
});

for (const f of REBUILD_EXCEPTIONS) test(`the rebuild exception ${f} keeps every column and copies every row`, () => {
  const sql = readFileSync(new URL(f, dir), "utf8");
  const cols = ["id", "syllabus_id", "session", "year", "paper", "variant", "doc_type", "file_name", "r2_key", "sha256",
    "size_bytes", "source_url", "source_site_id", "origin", "job_id", "status", "acquired_by", "acquired_at"];
  const copy = sql.slice(sql.indexOf("INSERT INTO source_document_new"), sql.indexOf("FROM source_document;"));
  for (const c of cols) assert.ok(new RegExp(`\\b${c}\\b`).test(copy), `copy misses ${c}`);
  assert.ok(sql.indexOf("INSERT INTO source_document_new") < sql.indexOf("DROP TABLE source_document;"), "copy before drop");
});

test("no long UNION chains: D1 refuses them (too many terms in compound SELECT)", () => {
  for (const f of files) {
    const sql = readFileSync(new URL(f, dir), "utf8").replace(/--.*$/gm, "");
    for (const stmt of sql.split(";")) {
      const unions = (stmt.match(/\bUNION\b/gi) ?? []).length;
      assert.ok(unions <= 3, `${f}: ${unions} UNIONs in one statement; use WITH ... AS (VALUES ...) instead`);
    }
  }
});
