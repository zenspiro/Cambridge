// Which files should exist for a session, from the syllabus row's `expected` rules.
// Drives the gap report now and the agent's checklist later. Pure.
import { examName, type DocType } from "./names.ts";

export type ExpectedRules = {
  papers: number[];
  variants: Partial<Record<"m" | "s" | "w", number[]>>;
  perPaper: DocType[];
  ciPapers?: number[];
  perSession?: DocType[];
};

const ORDER = { m: 0, s: 1, w: 2 } as const;
export const EXAM_SESSIONS = ["m", "s", "w"] as const;

export function parseRules(json: string): ExpectedRules | null {
  try {
    const r = JSON.parse(json) as ExpectedRules;
    if (!Array.isArray(r.papers) || !Array.isArray(r.perPaper) || typeof r.variants !== "object") return null;
    return r;
  } catch {
    return null;
  }
}

/** True when papers for this session can be public yet (not after lastSession). */
export function sessionDue(year: number, session: "m" | "s" | "w", last: { year: number; session: "m" | "s" | "w" }): boolean {
  return year < last.year || (year === last.year && ORDER[session] <= ORDER[last.session]);
}

export function expectedFiles(code: string, rules: ExpectedRules, year: number, session: "m" | "s" | "w"): string[] {
  const out: string[] = [];
  for (const v of rules.variants[session] ?? []) {
    for (const p of rules.papers) {
      for (const t of rules.perPaper) out.push(examName(code, session, year, t, p, v));
      if (rules.ciPapers?.includes(p)) out.push(examName(code, session, year, "ci", p, v));
    }
  }
  if ((rules.variants[session] ?? []).length > 0) {
    for (const t of rules.perSession ?? []) out.push(examName(code, session, year, t));
  }
  return out.sort();
}

export type GapCell = { year: number; session: "m" | "s" | "w"; expected: number; have: number; missing: string[] };

export function gapReport(
  code: string,
  rulesForYear: (year: number) => ExpectedRules | null,
  have: ReadonlySet<string>,
  range: { fromYear: number; toYear: number; last: { year: number; session: "m" | "s" | "w" } },
): GapCell[] {
  const cells: GapCell[] = [];
  for (let year = range.toYear; year >= range.fromYear; year--) {
    const rules = rulesForYear(year);
    if (!rules) continue;
    for (const session of EXAM_SESSIONS) {
      if (!sessionDue(year, session, range.last)) continue;
      const files = expectedFiles(code, rules, year, session);
      if (files.length === 0) continue;
      const missing = files.filter((f) => !have.has(f));
      cells.push({ year, session, expected: files.length, have: files.length - missing.length, missing });
    }
  }
  return cells;
}
