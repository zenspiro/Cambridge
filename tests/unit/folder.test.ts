import { test } from "node:test";
import assert from "node:assert/strict";
import { applyAi, applyCover, finalise, isPdf, planFromNames, yearHint } from "../../src/lib/library/folderPlan.ts";
import { readCover } from "../../src/lib/library/cover.ts";

const SUBJECTS = [
  { code: "0625", name: "Physics", qualification: "IGCSE" },
  { code: "0620", name: "Chemistry", qualification: "IGCSE" },
];
const CODES = SUBJECTS.map((s) => s.code);
const MAX = 25 * 1024 * 1024;
const plan = (i: number, path: string) => planFromNames(i, path, 1000, SUBJECTS, MAX);

test("folder plan: names, then first page, then AI, then the library", () => {
  const a = plan(0, "IGCSE Physics (0625)/2024/May June/Question Paper 42.pdf");
  assert.equal(a.name, "0625_s24_qp_42.pdf");
  assert.equal(a.how, "Worked out from its folder names");
  assert.deepEqual(a.path, ["IGCSE Physics (0625)", "2024", "May June"]);

  // The first page wins over names that disagree with it.
  const b = plan(1, "IGCSE Physics (0625)/2024/May June/Question Paper 21.pdf");
  applyCover(b, readCover("PHYSICS 0625/21\nMay/June 2024\nMARK SCHEME", CODES), "x");
  assert.equal(b.name, "0625_s24_ms_21.pdf");
  assert.equal(b.renamedFrom, "0625_s24_qp_21.pdf");

  // An unclear file named by its first page.
  const c = plan(2, "Physics/Scan 3.pdf");
  assert.equal(c.name, null);
  applyCover(c, readCover("PHYSICS 0625/43\nOctober/November 2024\nYou must answer on the question paper.", CODES), "x");
  assert.equal(c.name, "0625_w24_qp_43.pdf");
  assert.equal(c.how, "Worked out from its first page");

  // First page with text but unsure: kept for the AI, which names it.
  const d = plan(3, "Physics/odd.pdf");
  applyCover(d, readCover("PHYSICS\nsome cover", CODES), "PHYSICS\nsome cover");
  assert.equal(d.text, "PHYSICS\nsome cover");
  applyAi(d, { outcome: "named", name: "0625_m24_ms_22.pdf", why: "cover" }, "first page");
  assert.equal(d.name, "0625_m24_ms_22.pdf");
  assert.equal(d.text, undefined);

  // The AI says not needed; or is unsure with a suggestion.
  const e = plan(4, "Physics/Revision notes.pdf");
  applyAi(e, { outcome: "not_needed", why: "notes" }, "names");
  const f = plan(5, "Physics/thing.pdf");
  applyAi(f, { outcome: "review", name: "0625_s19_qp_11.pdf", why: "older" }, "names");
  assert.equal(f.suggest, "0625_s19_qp_11.pdf");

  // A name the first page says is another subject goes to review.
  const g = plan(6, "IGCSE Physics (0625)/2024/May June/Mark Scheme Paper 3 Variant 2.pdf");
  applyCover(g, { name: null, code: "0620", year: null, why: "", cambridge: true, empty: false }, "x");
  assert.equal(g.status, "review");

  const h = plan(7, "IGCSE Physics (0625)/2024/May June/Question Paper 42.pdf"); // same file twice
  const old = plan(8, "IGCSE Physics (0625)/2019/May June/Question Paper 42.pdf");
  const have = plan(9, "0625_s24_qp_11.pdf");
  const big = planFromNames(10, "x/0625_s24_qp_12.pdf", MAX + 1, SUBJECTS, MAX);
  const items = [a, b, c, d, e, f, g, h, old, have, big];
  finalise(items, { have: new Set(["0625_s24_qp_11.pdf"]), codes: CODES, fromYear: 2022, toYear: 2026 });
  assert.deepEqual(items.map((x) => x.status), ["new", "new", "new", "new", "not_needed", "outside", "review", "duplicate", "outside", "have", "too_big"]);
  assert.ok(isPdf("a.PDF", "") && isPdf("a", "application/pdf") && !isPdf("notes.docx", ""));
});

test("folder plan: files from years outside the library are left out by their names, never read or sent to the AI", () => {
  const years = { fromYear: 2020, toYear: 2026 };
  assert.equal(yearHint(["Physics (0625)", "2002"], "0625_w02_ab_5.pdf"), 2002);
  assert.equal(yearHint(["Physics (0625)", "2003", "2003 May_June"], "0625_s03_ms_1+2+3+5+6 (1).pdf"), 2003);
  assert.equal(yearHint(["Physics (0625)", "2021", "2021 July (Pakistan only)"], "1524_j21_qp_12.pdf"), 2021);
  assert.equal(yearHint(["Physics (0625)", "2018", "2018 Feb March"], "0625_m18_1_2_qp.pdf"), 2018);
  assert.equal(yearHint(["Physics"], "Scan 3.pdf"), null);
  const old = planFromNames(0, "Physics (0625)/2002/0625_w02_ab_5.pdf", 1000, SUBJECTS, MAX, years);
  assert.equal(old.status, "outside");
  assert.match(old.why, /from 2002, outside the library years \(2020 to 2026\)/);
  const named = planFromNames(1, "IGCSE Physics (0625)/2019/May June/Question Paper 42.pdf", 1000, SUBJECTS, MAX, years);
  assert.equal(named.status, "outside");
  // The cover reader and the AI leave such files alone.
  applyCover(old, readCover("PHYSICS 0625/05\nOctober/November 2002\nANSWER BOOKLET", CODES), "x", years);
  applyAi(old, { outcome: "named", name: "0625_s24_qp_11.pdf" }, "names");
  assert.equal(old.name, "0625_w02_ab_5.pdf", "its own name stands; the AI answer is ignored");
  // A cover that gives only an old year; and the AI recognising an old file.
  const scan = planFromNames(2, "Physics/Scan.pdf", 1000, SUBJECTS, MAX, years);
  applyCover(scan, readCover("PHYSICS\nANSWER BOOKLET\nOCTOBER/NOVEMBER SESSION 2002", CODES), "x", years);
  assert.equal(scan.status, "outside");
  const odd = planFromNames(3, "Physics/thing.pdf", 1000, SUBJECTS, MAX, years);
  applyAi(odd, { outcome: "review", name: "0625_w19_ms_31.pdf", why: "old mark scheme" }, "first page");
  finalise([odd], { have: new Set(), codes: CODES, fromYear: 2020, toYear: 2026 });
  assert.equal(odd.status, "outside");
  assert.match(odd.why, /the AI read it as 0625_w19_ms_31.pdf, from 2019, outside the library years/);
});

test("folder plan: the same name twice keeps the best evidenced file and never drops a different file quietly", () => {
  const years = { fromYear: 2020, toYear: 2026 };
  const mk = (i: number, path: string, size: number) => planFromNames(i, path, size, SUBJECTS, MAX, years);
  const lib = { have: new Set<string>(), codes: CODES, fromYear: 2020, toYear: 2026 };
  // A copy: same size, the file with its own Cambridge name wins even when it comes second.
  const byFolder = mk(0, "IGCSE Physics (0625)/2024/May June/Question Paper 21.pdf", 500);
  const own = mk(1, "elsewhere/0625_s24_qp_21.pdf", 500);
  finalise([byFolder, own], lib);
  assert.equal(own.status, "new");
  assert.equal(own.how, "Already has its Cambridge name");
  assert.equal(byFolder.status, "duplicate");
  assert.equal(byFolder.dupOf, "elsewhere / 0625_s24_qp_21.pdf");
  // A different file read as the same name from its first page: to the owner, not dropped.
  const real = mk(2, "x/0625_s24_qp_22.pdf", 500);
  const misread = mk(3, "x/Scan 4.pdf", 900);
  applyCover(misread, readCover("PHYSICS 0625/22\nMay/June 2024\nYou must answer on the question paper.", CODES), "t", years);
  finalise([misread, real], lib);
  assert.equal(real.status, "new");
  assert.equal(misread.status, "review");
  assert.match(misread.why, /read as 0625_s24_qp_22.pdf, but x \/ 0625_s24_qp_22.pdf is that file by its own name, and the two files differ/);
  // Two different files with equally good names: both to the owner.
  const p = mk(4, "a/0625_s24_ms_22.pdf", 100);
  const q = mk(5, "b/0625_s24_ms_22.pdf", 200);
  finalise([p, q], lib);
  assert.deepEqual([p.status, q.status], ["review", "review"]);
  assert.equal(p.suggest, "0625_s24_ms_22.pdf");
});
