// The review screen (Phase 2 step 2a): the file and the files that belong with it; framing allowed only there.
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadReviewDoc, relatedDocs } from "../../src/lib/library/review.ts";
import { buildCsp, PDF_VIEW_CSP, PDF_VIEW_RE, REVIEW_PAGE_RE } from "../../src/lib/security/headers.ts";
import { testDb } from "./helpers/d1.ts";

const NOW = Date.UTC(2026, 10, 6);

function store(db: ReturnType<typeof testDb>, id: string, file: string, type: string, session: string, year: number, paper: number | null, variant: number | null) {
  db.raw
    .prepare(`INSERT INTO source_document (id, syllabus_id, session, year, paper, variant, doc_type, file_name, r2_key, sha256, size_bytes, origin, status, acquired_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1000, 'upload', 'stored', ?)`)
    .run(id, "0625-2023", session, year, paper, variant, type, file, `k/${file}`, `h-${file}`, NOW);
}

test("review: the same paper's files (question paper first) and the session's report and thresholds", async () => {
  const db = testDb();
  store(db, "qp42xxxxxxxx", "0625_s24_qp_42.pdf", "qp", "s", 2024, 4, 2);
  store(db, "ms42xxxxxxxx", "0625_s24_ms_42.pdf", "ms", "s", 2024, 4, 2);
  store(db, "qp41xxxxxxxx", "0625_s24_qp_41.pdf", "qp", "s", 2024, 4, 1);
  store(db, "erxxxxxxxxxx", "0625_s24_er.pdf", "er", "s", 2024, null, null);
  store(db, "gtxxxxxxxxxx", "0625_s24_gt.pdf", "gt", "s", 2024, null, null);
  store(db, "ms42w2xxxxxx", "0625_w24_ms_42.pdf", "ms", "w", 2024, 4, 2);
  const ms = (await loadReviewDoc(db, "ms42xxxxxxxx"))!;
  assert.equal(ms.code, "0625");
  const r = await relatedDocs(db, ms);
  assert.deepEqual(r.paper.map((x) => x.fileName), ["0625_s24_qp_42.pdf"], "same paper and variant, same session only");
  assert.deepEqual(r.session.map((x) => x.fileName), ["0625_s24_er.pdf", "0625_s24_gt.pdf"]);
  const er = (await loadReviewDoc(db, "erxxxxxxxxxx"))!;
  assert.deepEqual((await relatedDocs(db, er)).session.map((x) => x.fileName), ["0625_s24_qp_41.pdf", "0625_s24_qp_42.pdf"]);
  assert.equal(await loadReviewDoc(db, "missingxxxxx"), null);
});

test("framing: only the review page may frame, only our own PDF view may be framed, and only by our pages", () => {
  const n = "AAAAAAAAAAAAAAAAAAAAAA==";
  assert.match(buildCsp(n), /frame-src 'none'/);
  assert.match(buildCsp(n, { framesSelf: true }), /frame-src 'self'/);
  assert.match(buildCsp(n, { framesSelf: true }), /frame-ancestors 'none'/, "the review page itself cannot be framed");
  assert.ok(REVIEW_PAGE_RE.test("/admin/library/review/abcdefghij12"));
  assert.ok(!REVIEW_PAGE_RE.test("/admin/library/review/abc/../x"));
  assert.ok(PDF_VIEW_RE.test("/admin/library/file/abcdefghij12/view"));
  assert.ok(!PDF_VIEW_RE.test("/admin/library/file/abcdefghij12"), "downloads stay unframeable");
  assert.equal(PDF_VIEW_CSP, "default-src 'none'; frame-ancestors 'self'");
});

test("links to the review screen are plain <a> (a full load, so its own policy lets it frame the PDF)", async () => {
  const { readdirSync, readFileSync, statSync } = await import("node:fs");
  const { join } = await import("node:path");
  const walk = (d: string): string[] => readdirSync(d).flatMap((f) => (statSync(join(d, f)).isDirectory() ? walk(join(d, f)) : [join(d, f)]));
  for (const f of walk(new URL("../../src/", import.meta.url).pathname).filter((x) => x.endsWith(".tsx"))) {
    assert.ok(!/<Link[^>]*library\/review\//.test(readFileSync(f, "utf8")), `${f}: use <a>, not <Link>, for the review screen`);
  }
});
