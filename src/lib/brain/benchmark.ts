// The reading benchmark (owner, 11 Nov 2026, option A): a fixed set of real papers, each with an answer key of how it
// should read, so every change to the reading rules is measured on the whole set instead of one paper at a time.
// Chosen by measuring every variant 2 question paper from 2023 on (figures, tables, fractions, superscripts and
// subscripts, code lines, opening text, picture pages) and taking the richest per subject and paper, spread over
// sessions and years; Geography from the smallest files. About a third is locked: never tuned on, only its totals are
// shown. Design and rules: docs/benchmark.md. Keys hold structure only (part numbers, marks, where figures, tables and
// opening text sit, notation), never a paper's wording; they live in benchmark/keys/. Pure, shared with the scripts.

import { normaliseNotation } from "./notation.ts";
import type { PaperContent } from "./paper.ts";

export type BenchPaper = { file: string; locked?: boolean };

/** The set: 48 question papers and 6 mark schemes (each paired with a question paper in the set). */
export const BENCHMARK: readonly BenchPaper[] = [
  { file: "0610_s23_qp_12", locked: true },
  { file: "0610_m24_qp_22" },
  { file: "0610_w23_qp_32", locked: true },
  { file: "0610_m23_qp_42" },
  { file: "0610_s24_qp_42" },
  { file: "0610_m25_qp_42" },
  { file: "0610_m25_ms_42" },
  { file: "0610_s26_qp_52", locked: true },
  { file: "0610_s25_qp_62" },
  { file: "0610_w25_qp_62" },
  { file: "0620_m24_qp_12" },
  { file: "0620_s26_qp_22" },
  { file: "0620_w25_qp_32" },
  { file: "0620_s25_qp_42" },
  { file: "0620_s25_ms_42" },
  { file: "0620_s24_qp_42", locked: true },
  { file: "0620_m26_qp_42", locked: true },
  { file: "0620_s23_qp_52", locked: true },
  { file: "0620_w24_qp_62" },
  { file: "0620_w23_qp_62" },
  { file: "0625_m23_qp_12", locked: true },
  { file: "0625_m25_qp_22" },
  { file: "0625_w23_qp_32", locked: true },
  { file: "0625_s23_qp_32", locked: true },
  { file: "0625_m25_qp_42" },
  { file: "0625_m25_ms_42" },
  { file: "0625_w25_qp_42" },
  { file: "0625_s25_qp_42" },
  { file: "0625_m25_qp_52" },
  { file: "0625_m25_qp_62" },
  { file: "0580_m25_qp_12" },
  { file: "0580_s25_qp_22" },
  { file: "0580_w25_qp_22", locked: true },
  { file: "0580_s24_qp_32", locked: true },
  { file: "0580_s23_qp_32" },
  { file: "0580_m23_qp_42", locked: true },
  { file: "0580_w23_qp_42" },
  { file: "0580_m24_qp_42" },
  { file: "0580_w24_qp_42" },
  { file: "0580_w24_ms_42" },
  { file: "0478_m24_qp_12", locked: true },
  { file: "0478_s24_qp_12" },
  { file: "0478_m25_qp_12", locked: true },
  { file: "0478_m23_qp_12" },
  { file: "0478_w23_qp_22" },
  { file: "0478_w25_qp_22" },
  { file: "0478_w25_ms_22" },
  { file: "0478_s23_qp_22", locked: true },
  { file: "0478_s25_qp_22" },
  { file: "0478_w24_qp_22" },
  { file: "0460_s25_qp_12" },
  { file: "0460_s25_qp_22" },
  { file: "0460_s25_ms_22" },
  { file: "0460_s25_qp_42", locked: true },
];

export const benchFileName = (p: BenchPaper) => `${p.file}.pdf`;
export const benchCode = (file: string) => file.slice(0, 4);
/** The benchmark papers of one subject, as stored file names. */
export const benchFilesFor = (code: string) => BENCHMARK.filter((p) => benchCode(p.file) === code).map(benchFileName);

export type KeyPart = { n: string; marks: number | null };
export type BenchKey = {
  file: string;
  kind: "qp" | "ms";
  /** The cover's total, or null when the paper has a choice of questions (the parts add up to more). */
  total: number | null;
  /** Multiple choice: every question has four options. */
  mcq: boolean;
  /** Every part that earns marks, as printed (marks null on multiple choice: no [1] is printed per question). */
  parts: KeyPart[];
  /** Questions and parts with opening text before their first sub-part: a reading has an item of their own. */
  leads: string[];
  /** Which part holds each labelled figure and table: the first one whose words name it (or `also`, the next one). */
  figures: { label: string; part: string; also?: string[] }[];
  tables: { label: string; part: string; also?: string[] }[];
  /** Printed notation each part must keep, in our markup ("10^{−2}", "\frac{1}{4}"). */
  notation: { part: string; token: string }[];
  /** Spots the drafter or the check could not settle, for the owner to look at. */
  unsure: string[];
  /** What a person settled by hand, in words. */
  note?: string;
  /** Who settled the key: "draft" (code only), "checked" (code, then checked against the PDF). */
  status: "draft" | "checked";
};

export type BenchCheck = { id: string; ok: boolean; why?: string };
export type BenchScore = { file: string; checks: BenchCheck[]; passed: number; total: number; pct: number; right: boolean };

const num = (n: string) => n.replace(/\s+/g, "");
/** Spacing, dashes and brackets set aside: "Zn(NO_{3})_{2}" holds the key's "ZnNO_{3}" and "Zn(NO_{3}". */
const flat = (s: string) => normaliseNotation(s).replace(/[−–]/g, "-").replace(/[\s()]/g, "");
const labelRe = (label: string) => new RegExp(`^${label.replace(/\./g, "\\.").replace(/\s+/g, "\\s*")}(?![0-9])`, "i");

/** A mark scheme's marks for a part: rows of the same number add up, or the largest row stands for all. */
function msMarks(items: PaperContent["items"], n: string): { sum: number; max: number } | null {
  const rows = items.filter((i) => num(i.number) === n && typeof i.marks === "number");
  if (!rows.length) return null;
  const m = rows.map((r) => r.marks as number);
  return { sum: m.reduce((a, b) => a + b, 0), max: Math.max(...m) };
}

/**
 * One reading against its key. Each check is one fact of the key: the part is there, its marks, an opening text with
 * an item of its own, a figure or table on the right part, a piece of notation kept, four options; and every part the
 * reading has that the key does not is a check that fails. Pure.
 */
export function scoreReading(key: BenchKey, content: PaperContent | null): BenchScore {
  const checks: BenchCheck[] = [];
  const items = content?.items ?? [];
  const byNum = new Map<string, PaperContent["items"]>();
  for (const i of items) byNum.set(num(i.number), [...(byNum.get(num(i.number)) ?? []), i]);
  const first = (n: string) => byNum.get(n)?.[0] ?? null;
  for (const p of key.parts) {
    const got = first(p.n);
    checks.push({ id: `part:${p.n}`, ok: !!got, ...(got ? {} : { why: "missing" }) });
    if (key.mcq && key.kind === "qp") {
      const okOpt = (got?.options?.length ?? 0) === 4;
      checks.push({ id: `options:${p.n}`, ok: okOpt, ...(okOpt ? {} : { why: `${got?.options?.length ?? 0} options` }) });
    }
    if (p.marks == null) continue;
    if (key.kind === "ms") {
      const m = msMarks(items, p.n);
      const ok = !!m && (m.sum === p.marks || m.max === p.marks);
      checks.push({ id: `marks:${p.n}`, ok, ...(ok ? {} : { why: m ? `${m.sum} not ${p.marks}` : "missing" }) });
    } else {
      const ok = got?.marks === p.marks;
      checks.push({ id: `marks:${p.n}`, ok, ...(ok ? {} : { why: got ? `${got.marks ?? "none"} not ${p.marks}` : "missing" }) });
    }
  }
  if (key.kind === "qp") {
    for (const n of key.leads) {
      const got = first(n);
      const ok = !!got && !got.marks && got.text.trim().length > 0;
      checks.push({ id: `lead:${n}`, ok, ...(ok ? {} : { why: got ? "joined or empty" : "missing" }) });
    }
    const figs = content?.figures ?? [];
    for (const f of key.figures) {
      const fig = figs.find((x) => labelRe(f.label).test(x.caption.trim()));
      const holder = fig ? items.find((i) => i.figures.includes(fig.id)) : null;
      const ok = !!holder && [f.part, ...(f.also ?? [])].includes(num(holder.number));
      checks.push({ id: `figure:${f.label}`, ok, ...(ok ? {} : { why: !fig ? "not found" : holder ? `on ${holder.number}` : "on no part" }) });
    }
    for (const t of key.tables) {
      const holder = items.find((i) => (i.tables ?? []).some((x) => labelRe(t.label).test(x.label.trim())));
      const ok = !!holder && [t.part, ...(t.also ?? [])].includes(num(holder.number));
      checks.push({ id: `table:${t.label}`, ok, ...(ok ? {} : { why: holder ? `on ${holder.number}` : "not found" }) });
    }
    for (const x of key.notation) {
      const got = byNum.get(x.part) ?? [];
      // Anywhere the part prints it: its wording, its options, its tables.
      const ok = got.some((i) => flat([i.text, ...i.options.map((o) => o.text), ...(i.tables ?? []).flatMap((t) => t.rows.flat())].join(" ")).includes(flat(x.token)));
      checks.push({ id: `notation:${x.part}:${x.token}`, ok, ...(ok ? {} : { why: "not kept" }) });
    }
  }
  // Parts the key does not have: an invented or misnumbered part.
  const known = new Set([...key.parts.map((p) => p.n), ...key.leads]);
  for (const n of byNum.keys()) {
    if (known.has(n)) continue;
    if (key.kind === "qp" && !byNum.get(n)!.some((i) => i.marks)) continue; // an opening text the key did not ask for
    checks.push({ id: `extra:${n}`, ok: false, why: "not on the paper" });
  }
  const passed = checks.filter((c) => c.ok).length;
  const total = checks.length;
  return { file: key.file, checks, passed, total, pct: total ? Math.round((passed / total) * 1000) / 10 : 0, right: total > 0 && passed === total };
}

export type BenchRun = Record<string, BenchScore>;

/** Checks that passed before and fail now: a change may not ship with any on the tuning set. */
export function regressions(before: BenchRun, now: BenchRun): { file: string; id: string }[] {
  const out: { file: string; id: string }[] = [];
  for (const [file, b] of Object.entries(before)) {
    const n = now[file];
    if (!n) continue;
    const okNow = new Set(n.checks.filter((c) => c.ok).map((c) => c.id));
    for (const c of b.checks) if (c.ok && !okNow.has(c.id)) out.push({ file, id: c.id });
  }
  return out;
}

export type BenchTotals = { papers: number; read: number; right: number; passed: number; total: number; pct: number };

/** Totals over some papers (a subject, the tuning set, the locked set); unread papers count as not read. */
export function totals(run: BenchRun, files: readonly string[]): BenchTotals {
  const scored = files.map((f) => run[f]).filter((s): s is BenchScore => !!s);
  const passed = scored.reduce((a, s) => a + s.passed, 0);
  const total = scored.reduce((a, s) => a + s.total, 0);
  return { papers: files.length, read: scored.length, right: scored.filter((s) => s.right).length, passed, total, pct: total ? Math.round((passed / total) * 1000) / 10 : 0 };
}
