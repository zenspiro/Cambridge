import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { testBucket, testDb } from "./helpers/d1.ts";
import { storeDocument } from "../../src/lib/library/store.ts";
import { planBenchmark } from "../../src/lib/brain/readAll.ts";
import { BENCHMARK, benchFilesFor, regressions, scoreReading, totals, type BenchKey } from "../../src/lib/brain/benchmark.ts";
import { cleanPaper, type PaperContent } from "../../src/lib/brain/paper.ts";
import { pdfOutline, bboxWords } from "../../src/lib/brain/notation.ts";

const KEYS = new URL("../../benchmark/keys/", import.meta.url).pathname;

test("the benchmark set: 54 papers, a third locked, every mark scheme with its question paper, every paper keyed", () => {
  const files = BENCHMARK.map((p) => p.file);
  assert.equal(files.length, 54);
  assert.equal(new Set(files).size, files.length, "no paper twice");
  assert.equal(BENCHMARK.filter((p) => p.locked).length, 16);
  for (const f of files.filter((x) => x.includes("_ms_"))) {
    assert.ok(files.includes(f.replace("_ms_", "_qp_")), `${f} has its question paper`);
    assert.ok(!BENCHMARK.find((p) => p.file === f.replace("_ms_", "_qp_"))!.locked, `${f}'s question paper is on the tuning set`);
  }
  for (const code of ["0610", "0620", "0625", "0580", "0478", "0460"]) assert.ok(benchFilesFor(code).length >= 4, code);
  for (const f of files) {
    const at = `${KEYS}${f}.json`;
    assert.ok(existsSync(at), `${f} has a key`);
    const k = JSON.parse(readFileSync(at, "utf8")) as BenchKey;
    assert.equal(k.file, f);
    assert.equal(k.kind, f.includes("_ms_") ? "ms" : "qp");
    assert.ok(k.parts.length > 0);
    // Structure only, never the paper's wording (copyright): every string in a key is short.
    const strings = JSON.stringify({ ...k, note: "" }).match(/"(?:[^"\\]|\\.)*"/g) ?? [];
    assert.ok(strings.every((s) => s.length <= 60), `${f} holds no wording`);
  }
});

const key = (over: Partial<BenchKey> = {}): BenchKey => ({
  file: "0625_w25_qp_42", kind: "qp", total: 6, mcq: false,
  parts: [{ n: "1(a)", marks: 2 }, { n: "1(b)", marks: 4 }],
  leads: ["1"], figures: [{ label: "Fig. 1.1", part: "1" }], tables: [{ label: "Table 1.1", part: "1(b)", also: ["1(a)"] }],
  notation: [{ part: "1(b)", token: "10^{−2}" }], unsure: [], status: "checked", ...over,
});
const item = (number: string, text: string, marks: number | null, extra: Partial<PaperContent["items"][number]> = {}) =>
  ({ number, page: 2, text, marks, options: [], answerLines: 0, figures: [], guidance: "", tables: [], ...extra });
const reading = (items: PaperContent["items"]): PaperContent => ({
  kind: "qp", totalMarks: 6, items,
  figures: [{ id: "F1", page: 2, caption: "Fig. 1.1 a trolley", description: "", svg: "", box: null, cut: "caption" }],
});

test("a reading scored against its key: parts, marks, opening text, figures, tables and notation", () => {
  const right = reading([
    item("1", "A trolley moves.", null, { figures: ["F1"] }),
    item("1(a)", "State the speed.", 2, { tables: [{ label: "Table 1.1", rows: [["t / s", "v"]] }] }),
    item("1(b)", "The mass is 5.8 × 10^{−2} kg. Calculate.", 4),
  ]);
  const s = scoreReading(key(), right);
  assert.equal(s.right, true, JSON.stringify(s.checks.filter((c) => !c.ok)));
  assert.equal(s.pct, 100);
  // Unicode superscripts count as the markup; a table on the other allowed part counts.
  assert.equal(scoreReading(key(), reading([item("1", "A trolley moves.", null, { figures: ["F1"] }), item("1(a)", "State.", 2, { tables: [{ label: "Table 1.1", rows: [] }] }), item("1(b)", "5.8 × 10⁻² kg", 4)])).right, true);

  const wrong = reading([
    item("1(a)", "A trolley moves. State the speed.", 3, { figures: ["F1"] }),
    item("1(b)", "The mass is 5.8 × 10-2 kg.", 4),
    item("1(c)", "Invented.", 1),
  ]);
  const w = scoreReading(key(), wrong);
  const bad = Object.fromEntries(w.checks.filter((c) => !c.ok).map((c) => [c.id, c.why]));
  assert.deepEqual(Object.keys(bad).sort(), ["extra:1(c)", "figure:Fig. 1.1", "lead:1", "marks:1(a)", "notation:1(b):10^{−2}", "table:Table 1.1"].sort());
  assert.equal(bad["marks:1(a)"], "3 not 2");
  assert.equal(bad["figure:Fig. 1.1"], "on 1(a)");
  assert.equal(w.right, false);
  // No reading at all: every check fails.
  assert.equal(scoreReading(key(), null).passed, 0);
});

test("multiple choice wants four options per question; a mark scheme's part marks add up or take the largest row", () => {
  const mcq = key({ mcq: true, parts: [{ n: "1", marks: null }, { n: "2", marks: null }], leads: [], figures: [], tables: [], notation: [] });
  const four = [{ letter: "A", text: "a" }, { letter: "B", text: "b" }, { letter: "C", text: "c" }, { letter: "D", text: "d" }];
  const s = scoreReading(mcq, reading([item("1", "Which?", null, { options: four }), item("2", "Which?", null, { options: four.slice(0, 3) })]));
  assert.deepEqual(s.checks.filter((c) => !c.ok).map((c) => c.id), ["options:2"]);
  const ms = key({ kind: "ms", parts: [{ n: "1(a)", marks: 2 }, { n: "1(b)", marks: 3 }], leads: [], figures: [], tables: [], notation: [] });
  const msRead: PaperContent = { kind: "ms", totalMarks: null, figures: [], items: [item("1(a)", "B1", 1), item("1(a)", "B1", 1), item("1(b)", "M1 A1", 3), item("1(b)", "or", 2)] };
  assert.equal(scoreReading(ms, msRead).right, true);
});

test("regressions: a check that passed before and fails now; totals over a set of papers", () => {
  const a = scoreReading(key(), reading([item("1", "A trolley moves.", null, { figures: ["F1"] }), item("1(a)", "x", 2, { tables: [{ label: "Table 1.1", rows: [] }] }), item("1(b)", "10^{−2}", 4)]));
  const b = scoreReading(key(), reading([item("1", "A trolley moves.", null, { figures: ["F1"] }), item("1(a)", "x", 3, { tables: [{ label: "Table 1.1", rows: [] }] }), item("1(b)", "10^{−2}", 4)]));
  assert.deepEqual(regressions({ p: a }, { p: b }), [{ file: "p", id: "marks:1(a)" }]);
  assert.deepEqual(regressions({ p: b }, { p: a }), []);
  const t = totals({ p: a, q: b }, ["p", "q", "r"]);
  assert.deepEqual({ papers: t.papers, read: t.read, right: t.right }, { papers: 3, read: 2, right: 1 });
  // A real reading goes through cleanPaper first, as the score script does.
  assert.equal(scoreReading(key(), cleanPaper({ items: [{ number: "1(b)", text: "10^-2", marks: 4 }] }, "qp")).checks.find((c) => c.id === "part:1(b)")!.ok, true);
});

test("the outline adds up each part's printed marks: at the right margin, beside the footer, joined to answer dots", () => {
  type W = [number, number, number, number, string];
  const xml = (pages: W[][][]) =>
    `<doc>${pages.map((lines) => `<page width="595" height="842"><flow><block>${lines.map((l) => `<line xMin="0" yMin="0" xMax="0" yMax="0">${l.map(([a, b, c, d, t]) => `<word xMin="${a}" yMin="${b}" xMax="${c}" yMax="${d}">${t}</word>`).join("")}</line>`).join("")}</block></flow></page>`).join("")}</doc>`;
  const p2: W[][] = [
    [[49.6, 62, 55.4, 76, "1"], [72.3, 62, 85.7, 76, "(a)"], [95, 62, 150, 76, "State"], [153, 62, 190, 76, "this."]],
    [[300, 90, 330, 104, "[1]"], [340, 90, 360, 104, "[2]"], [533, 90, 545.7, 104, "[3]"]],
    [[72.3, 120, 85.7, 134, "(b)"], [95, 120, 150, 134, "Explain."]],
    [[80, 160, 545.7, 174, "..........[2]"]],
    [[72.3, 200, 85.7, 214, "(c)"], [95, 200, 150, 214, "Show."]],
    // A table's row number further in is not a question.
    [[60.7, 300, 66.8, 314, "2"], [95, 300, 150, 314, "row"]],
    [[533.4, 782, 545.7, 796.4, "[4]"]],
  ];
  const o = pdfOutline(bboxWords(xml([[], p2])));
  assert.deepEqual(o.map((p) => [p.number, p.marks ?? 0]), [["1", 0], ["1(a)", 3], ["1(b)", 2], ["1(c)", 4]]);
});

test("read the benchmark papers: the subject's set not read yet, in the set's order, question paper first", async () => {
  const db = testDb();
  const bucket = testBucket();
  const pdf = (s: string) => new TextEncoder().encode(`%PDF-1.4\n${s}`);
  for (const f of ["0625_m25_ms_42.pdf", "0625_m25_qp_42.pdf", "0625_w25_qp_42.pdf", "0625_w25_qp_41.pdf"]) {
    await storeDocument(db, bucket, { fileName: f, bytes: pdf(f), actorId: "a", origin: "upload" });
  }
  const id = async (f: string) => (await db.prepare(`SELECT id FROM source_document WHERE file_name = ?1`).bind(f).first<{ id: string }>())!.id;
  const files = benchFilesFor("0625");
  const plan = await planBenchmark(db, files, new Map([[await id("0625_w25_qp_42.pdf"), "flagged" as const]]));
  assert.deepEqual(plan.toRead.map((d) => d.fileName), ["0625_m25_qp_42.pdf", "0625_m25_ms_42.pdf"]);
  assert.equal(plan.read, 1);
  assert.equal(plan.missing, files.length - 3, "the variant 1 paper is not in the set");
  assert.deepEqual(plan.stored.map((d) => d.fileName), ["0625_m25_qp_42.pdf", "0625_m25_ms_42.pdf", "0625_w25_qp_42.pdf"], "every stored benchmark paper, for reading again for the score");
  assert.deepEqual(await planBenchmark(db, [], new Map()), { toRead: [], read: 0, missing: 0, stored: [] });
});
