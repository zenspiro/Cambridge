// Plain-word summaries of a set of Cambridge files, grouped by session or syllabus version:
// "June 2024: 6 question papers, 6 mark schemes, 1 confidential instructions, examiner report".
// Pure; used by the agent (Node) for its activity lines and by the run page.
import { SESSION_LABELS } from "../config.ts";
import { parseCambridgeName, type ParsedName } from "./names.ts";

const PLURALS: Record<string, [string, string]> = {
  qp: ["question paper", "question papers"],
  ms: ["mark scheme", "mark schemes"],
  ci: ["confidential instructions", "confidential instructions"],
  in: ["insert", "inserts"],
  er: ["examiner report", "examiner reports"],
  gt: ["grade thresholds", "grade thresholds"],
  sp: ["specimen paper", "specimen papers"],
  sm: ["specimen mark scheme", "specimen mark schemes"],
  sy: ["syllabus", "syllabuses"],
  su: ["syllabus update", "syllabus updates"],
  gd: ["grade descriptions", "grade descriptions"],
};
const ORDER = ["qp", "ms", "ci", "in", "er", "gt", "sp", "sm", "sy", "su", "gd"];
const SESSION_ORDER: Record<string, number> = { w: 0, s: 1, m: 2, y: 3 };

export type FileGroup = { key: string; label: string; year: number; session: ParsedName["session"]; files: ParsedName[] };

export function groupLabel(p: { session: string; year: number }): string {
  return p.session === "y" ? `Syllabus ${p.year} version` : `${SESSION_LABELS[p.session]} ${p.year}`;
}

/** Files grouped by session (newest first), then syllabus versions. Unknown names are left out. */
export function groupFiles(names: string[]): FileGroup[] {
  const groups = new Map<string, FileGroup>();
  for (const n of names) {
    const p = parseCambridgeName(n);
    if (!p) continue;
    const key = `${p.year}${p.session}`;
    const g = groups.get(key) ?? { key, label: groupLabel(p), year: p.year, session: p.session, files: [] };
    g.files.push(p);
    groups.set(key, g);
  }
  return [...groups.values()].sort(
    (a, b) => Number(a.session === "y") - Number(b.session === "y") || b.year - a.year || SESSION_ORDER[a.session]! - SESSION_ORDER[b.session]!,
  );
}

/** "6 question papers, 6 mark schemes, examiner report" for one group. */
export function countTypes(files: ParsedName[]): string {
  const counts = new Map<string, number>();
  for (const f of files) counts.set(f.docType, (counts.get(f.docType) ?? 0) + 1);
  return ORDER.filter((t) => counts.has(t))
    .map((t) => {
      const n = counts.get(t)!;
      const [one, many] = PLURALS[t] ?? [t, t];
      return n === 1 && (t === "er" || t === "gt" || t === "sy" || t === "su" || t === "gd") ? one : `${n} ${n === 1 ? one : many}`;
    })
    .join(", ");
}

/** One line for many files: "June 2024: 6 question papers, 6 mark schemes; Syllabus 2023 version: 6 specimen papers". */
export function summariseFiles(names: string[], maxGroups = 4): string {
  const groups = groupFiles(names);
  if (groups.length === 0) return "";
  const shown = groups.slice(0, maxGroups).map((g) => `${g.label}: ${countTypes(g.files)}`);
  if (groups.length > maxGroups) shown.push(`and ${groups.length - maxGroups} more`);
  return shown.join("; ");
}

/** The page's own title, tidied, for "Read page ..." lines. */
export function pageTitle(html: string): string | null {
  const m = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html.slice(0, 200_000));
  if (!m) return null;
  const t = m[1]!
    .replace(/&amp;/g, "&").replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
    .replace(/\s+/g, " ")
    .trim();
  return t ? t.slice(0, 120) : null;
}
