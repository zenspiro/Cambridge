import { test } from "node:test";
import assert from "node:assert/strict";
import { testBucket, testDb } from "./helpers/d1.ts";
import { loadSyllabus } from "../../src/lib/library/catalog.ts";
import { loadPapers } from "../../src/lib/library/papers.ts";
import { buildSubjectMap, cellKey, subjectMapJson } from "../../src/lib/library/map.ts";
import { storeDocument } from "../../src/lib/library/store.ts";

const pdf = (s: string) => new TextEncoder().encode(`%PDF-1.4\n${s}`);

test("subject map: versions hold their documents, specimens and sessions; papers are columns", async () => {
  const db = testDb();
  await storeDocument(db, testBucket(), { fileName: "0625_s24_qp_22.pdf", bytes: pdf("a"), actorId: "a", origin: "upload" });
  const list = (await loadSyllabus(db, "0625"))!;
  const { papers, routes } = await loadPapers(db, "0625");
  const map = buildSubjectMap(list, papers);
  const v23 = map.find((v) => v.id === "0625-2023")!;
  assert.equal(v23.label, "2023 to 2025 syllabus");
  assert.deepEqual(v23.columns.map((c) => [c.paper, c.types.join(",")]), [[1, "qp,ms"], [2, "qp,ms"], [3, "qp,ms"], [4, "qp,ms"], [5, "qp,ms,ci"], [6, "qp,ms"]]);
  assert.equal(v23.columns[1]!.name, "Multiple Choice (Extended)");
  // Newest session first; one row per session for the essential variant 2.
  assert.equal(v23.rows[0]!.label, "November 2025");
  const june24 = v23.rows.find((r) => r.label === "June 2024")!;
  assert.equal(june24.variant, 2);
  assert.equal(june24.cells[cellKey(2, "qp")]?.doc?.file_name, "0625_s24_qp_22.pdf");
  assert.ok(june24.er && june24.gt, "whole-session files sit on the session's first row");
  assert.ok(v23.docs.some((c) => c.docType === "sy") && v23.specimens.columns.length === 6);
  // All variants: three rows for June, essential first.
  const all = buildSubjectMap(list, papers, { allVariants: true }).find((v) => v.id === "0625-2023")!;
  assert.deepEqual(all.rows.filter((r) => r.year === 2024 && r.session === "s").map((r) => r.label),
    ["June 2024, variant 2", "June 2024, variant 1", "June 2024, variant 3"]);
  // The same hierarchy for the AI, with files described in words.
  const json = subjectMapJson({ code: "0625", label: "IGCSE Physics (0625)", qualification: "IGCSE" }, list, papers, routes);
  const f = json.versions.find((v) => v.id === "0625-2023")!.sessions.find((s) => s.label === "June 2024")!.files.find((x) => x.fileName === "0625_s24_qp_22.pdf")!;
  assert.deepEqual([f.stored, f.essential, f.description], [true, true, "June 2024, Paper 2 Multiple Choice (Extended), variant 2, question paper"]);
});

test("subject map: inserts get their own column, school-assessed parts are named, not asked for", async () => {
  const db = testDb();
  const list = (await loadSyllabus(db, "0460"))!;
  const { papers } = await loadPapers(db, "0460");
  const v = buildSubjectMap(list, papers).find((x) => x.id === "0460-2020")!;
  assert.deepEqual(v.columns.map((c) => [c.paper, c.types.join(",")]), [[1, "qp,in,ms"], [2, "qp,in,ms"], [4, "qp,in,ms"]]);
  assert.deepEqual(v.schoolAssessed, [{ paper: 3, name: "Coursework" }]);
});
