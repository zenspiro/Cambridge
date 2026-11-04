import { test } from "node:test";
import assert from "node:assert/strict";
import { applyAi, applyCover, finalise, isPdf, planFromNames } from "../../src/lib/library/folderPlan.ts";
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
  assert.equal(a.how, "its file and folder names");
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
  assert.equal(c.how, "its first page");

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
  applyCover(g, { name: null, code: "0620", why: "", cambridge: true, empty: false }, "x");
  assert.equal(g.status, "review");

  const h = plan(7, "IGCSE Physics (0625)/2024/May June/Question Paper 42.pdf"); // same file twice
  const old = plan(8, "IGCSE Physics (0625)/2019/May June/Question Paper 42.pdf");
  const have = plan(9, "0625_s24_qp_11.pdf");
  const big = planFromNames(10, "x/0625_s24_qp_12.pdf", MAX + 1, SUBJECTS, MAX);
  const items = [a, b, c, d, e, f, g, h, old, have, big];
  finalise(items, { have: new Set(["0625_s24_qp_11.pdf"]), codes: CODES, fromYear: 2022, toYear: 2026 });
  assert.deepEqual(items.map((x) => x.status), ["new", "new", "new", "new", "not_needed", "review", "review", "duplicate", "outside", "have", "too_big"]);
  assert.ok(isPdf("a.PDF", "") && isPdf("a", "application/pdf") && !isPdf("notes.docx", ""));
});
