import { test } from "node:test";
import assert from "node:assert/strict";
import { testDb } from "./helpers/d1.ts";
import { buildChecklist, filterChecklist, groupCells, searchWords, type StoredDoc, type Version } from "../../src/lib/library/checklist.ts";
import { loadCatalog, loadSyllabus, tone } from "../../src/lib/library/catalog.ts";
import { LIBRARY_DEFAULTS } from "../../src/lib/settings.ts";
import { storeDocument } from "../../src/lib/library/store.ts";
import { testBucket } from "./helpers/d1.ts";

const pdf = (t: string) => new TextEncoder().encode(`%PDF-1.4\n% ${t}\n%%EOF`);

function versions(): Version[] {
  const db = testDb();
  return db.raw.prepare("SELECT id, code, title, valid_from_year, valid_to_year, expected FROM syllabus WHERE code = '0625' ORDER BY valid_from_year").all() as Version[];
}
const doc = (file_name: string, extra: Partial<StoredDoc> = {}): StoredDoc => ({
  id: `id-${file_name}`, file_name, doc_type: "qp", session: "s", year: 2024, paper: 1, variant: 1, size_bytes: 10, origin: "agent", acquired_at: 1, ...extra,
});

test("the checklist has the syllabus documents, specimens and every public session", () => {
  const c = buildChecklist("0625", versions(), [], LIBRARY_DEFAULTS);
  assert.deepEqual(c.versions.map((g) => g.version.id), ["0625-2026", "0625-2023", "0625-2020"]);
  const v23 = c.versions.find((g) => g.version.id === "0625-2023")!;
  assert.deepEqual(v23.docs.map((d) => [d.fileName, d.essential]), [["0625_y23_sy.pdf", true], ["0625_y23_su.pdf", false], ["0625_y23_gd.pdf", false]]);
  assert.equal(v23.specimens.length, 6);
  assert.deepEqual(Object.keys(v23.specimens[4]!.cells).sort(), ["ci", "sm", "sp"]);
  assert.equal(v23.status.essentialTotal, 1 + 6 * 2 + 1);
  const v20 = c.versions.find((g) => g.version.id === "0625-2020")!;
  assert.equal(v20.status.essentialTotal, 0, "old version asks for no specimens");

  assert.deepEqual(c.sessions.slice(0, 3).map((g) => g.label), ["June 2026", "March 2026", "November 2025"]);
  assert.ok(!c.sessions.some((g) => g.label === "November 2026"), "not public yet");
  const june = c.sessions.find((g) => g.label === "June 2024")!;
  assert.equal(june.rows.length, 6 * 3);
  assert.deepEqual(june.rows.slice(0, 6).map((r) => [r.paper, r.variant, r.essential]), [[1, 1, true], [2, 1, true], [3, 1, true], [4, 1, true], [5, 1, true], [6, 1, true]]);
  assert.equal(june.status.essentialTotal, 6 * 2 + 1 + 2, "variant 1: qp+ms each, ci for paper 5, er and gt");
  const march = c.sessions.find((g) => g.label === "March 2024")!;
  assert.ok(march.rows.every((r) => r.variant === 2 && r.essential), "March counts variant 2");
});

test("stored files tick their cells; others are kept; status adds up", () => {
  const stored = [doc("0625_s24_qp_11.pdf"), doc("0625_s24_er.pdf", { doc_type: "er", paper: null, variant: null }),
    doc("0625_s24_qp_12.pdf", { variant: 2 }), doc("0625_s24_in_41.pdf", { doc_type: "in", paper: 4 })];
  const c = buildChecklist("0625", versions(), stored, LIBRARY_DEFAULTS);
  const june = c.sessions.find((g) => g.label === "June 2024")!;
  assert.equal(june.rows[0]!.cells.qp!.doc?.id, "id-0625_s24_qp_11.pdf");
  assert.equal(june.status.essentialHave, 2);
  assert.equal(june.status.extraHave, 1, "variant 2 counts as an extra");
  assert.deepEqual(c.others.map((o) => o.fileName), ["0625_s24_in_41.pdf"], "inserts are not on the checklist but still shown");
  const sum = c.sessions.reduce((n, g) => n + g.status.essentialTotal, 0) + c.versions.reduce((n, g) => n + g.status.essentialTotal, 0);
  assert.equal(c.status.essentialTotal, sum);
  assert.equal(tone(june.status), "part");
});

test("essential variants follow the setting", () => {
  const lib = { ...LIBRARY_DEFAULTS, essentialVariants: { m: [2], s: [1, 2, 3], w: [1] } };
  const june = buildChecklist("0625", versions(), [], lib).sessions.find((g) => g.label === "June 2024")!;
  assert.ok(june.rows.every((r) => r.essential));
  assert.equal(june.status.extraTotal, 0);
});

test("filters and search narrow the checklist; status stays whole", () => {
  const stored = [doc("0625_s24_qp_11.pdf"), doc("0625_s24_ms_41.pdf", { doc_type: "ms", paper: 4 })];
  const c = buildChecklist("0625", versions(), stored, LIBRARY_DEFAULTS);
  const f1 = filterChecklist(c, { q: "mark scheme 2024 paper 4" });
  const names1 = [...f1.versions.flatMap(groupCells), ...f1.sessions.flatMap(groupCells)].map((x) => x.fileName);
  assert.ok(names1.includes("0625_s24_ms_41.pdf"));
  assert.ok(names1.every((n) => n.includes("_ms_4") && n.includes("24")), names1.join(","));
  assert.equal(f1.status.essentialTotal, c.status.essentialTotal);

  const have = filterChecklist(c, { status: "have" });
  assert.equal(have.matches, 2);
  const missing = filterChecklist(c, { status: "missing", year: 2024, session: "s" });
  assert.ok(missing.sessions.flatMap(groupCells).every((x) => !x.doc && x.essential));
  assert.equal(missing.versions.length, 0);
  const spec = filterChecklist(c, { session: "y", type: "sy" });
  assert.deepEqual(spec.versions.flatMap(groupCells).map((x) => x.fileName), ["0625_y26_sy.pdf", "0625_y23_sy.pdf"]);
  assert.equal(filterChecklist(c, {}).filtered, false);
  assert.equal(filterChecklist(c, { q: "zzz" }).matches, 0);
  assert.deepEqual(searchWords("  Paper 4; <script> "), ["paper", "4", "script"]);
  assert.equal(searchWords("a ".repeat(50)).length, 8);
});

test("hierarchy: qualifications hold subjects, subjects hold syllabuses", async () => {
  const db = testDb();
  const b = testBucket();
  await storeDocument(db, b, { fileName: "0625_y23_su.pdf", bytes: pdf("su"), actorId: "a", origin: "link" });
  const { qualifications } = await loadCatalog(db);
  assert.deepEqual(qualifications.map((q) => [q.shortName, q.subjects.length]), [["IGCSE", 1], ["O Level", 0], ["AS & A Level", 0]]);
  const y = qualifications[0]!.subjects[0]!.syllabuses[0]!;
  assert.equal(y.code, "0625");
  assert.equal(y.checklist.versions.find((g) => g.version.id === "0625-2023")!.docs[1]!.doc?.origin, "link");
  assert.equal(await loadSyllabus(db, "9999"), null);
  assert.equal(await loadSyllabus(db, "' OR 1=1"), null);
});

test("the rebuilt table keeps old rows and accepts the new types", () => {
  const db = testDb();
  const cols = (db.raw.prepare("PRAGMA table_info(source_document)").all() as { name: string }[]).map((c) => c.name);
  assert.equal(cols.length, 18);
  const ins = (type: string, origin = "upload") =>
    db.raw.prepare(`INSERT INTO source_document (id, syllabus_id, session, year, doc_type, file_name, r2_key, sha256, size_bytes, origin, acquired_at)
      VALUES (?, '0625-2023', 'y', 2023, ?, ?, ?, ?, 1, ?, 1)`).run(type + origin, type, `f-${type}${origin}`, `k-${type}${origin}`, `h-${type}${origin}`, origin);
  ins("su");
  ins("gd", "link");
  assert.throws(() => ins("zz"));
  assert.throws(() => ins("sy", "elsewhere"));
});
