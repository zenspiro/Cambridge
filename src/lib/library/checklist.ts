// The library checklist: every file a syllabus should have, ticked or missing, grouped
// as syllabus documents, specimens and exam sessions. One pure function used by the
// admin library, its search and filters, and the AI engine's catalog. No database here.
import { DOC_TYPE_LABELS, SESSION_LABELS } from "../config.ts";
import type { LibrarySettings } from "../settings.ts";
import { EXAM_SESSIONS, parseRules, sessionDue, type ExpectedRules } from "./expected.ts";
import { examName, parseCambridgeName, type DocType } from "./names.ts";

export type StoredDoc = {
  id: string; file_name: string; doc_type: string; session: string; year: number;
  paper: number | null; variant: number | null; size_bytes: number; origin: string; acquired_at: number;
  sha256?: string; syllabus_id?: string;
};
export type Version = { id: string; code: string; title: string; valid_from_year: number; valid_to_year: number; expected: string };

export type Cell = {
  fileName: string;
  docType: DocType;
  paper: number | null;
  variant: number | null;
  essential: boolean;
  doc: StoredDoc | null;
  /** Words for search: session, year, type, paper, variant, file name. */
  text: string;
};
export type PaperRow = { paper: number; variant: number | null; essential: boolean; cells: Partial<Record<DocType, Cell>> };
export type Status = { essentialHave: number; essentialTotal: number; extraHave: number; extraTotal: number };

export type VersionGroup = { version: Version; label: string; docs: Cell[]; specimens: PaperRow[]; status: Status };
export type SessionGroup = { year: number; session: "m" | "s" | "w"; label: string; rows: PaperRow[]; docs: Cell[]; status: Status };
export type Checklist = { code: string; versions: VersionGroup[]; sessions: SessionGroup[]; others: Cell[]; status: Status };

const yy = (y: number) => String(y % 100).padStart(2, "0");

function describe(fileName: string): string {
  const p = parseCambridgeName(fileName);
  if (!p) return fileName;
  const when = p.session === "y" ? `specimen syllabus ${p.year}` : `${SESSION_LABELS[p.session]} ${p.year}`;
  const parts = [when, DOC_TYPE_LABELS[p.docType] ?? p.docType];
  if (p.paper) parts.push(`paper ${p.paper}`);
  if (p.variant) parts.push(`variant ${p.variant}`, `paper ${p.paper}${p.variant}`);
  parts.push(fileName);
  return parts.join(" ").toLowerCase();
}

function cell(fileName: string, essential: boolean, have: Map<string, StoredDoc>, used: Set<string>): Cell {
  const p = parseCambridgeName(fileName)!;
  used.add(fileName);
  return { fileName, docType: p.docType, paper: p.paper, variant: p.variant, essential, doc: have.get(fileName) ?? null, text: describe(fileName) };
}

export function statusOf(cells: Cell[]): Status {
  const s: Status = { essentialHave: 0, essentialTotal: 0, extraHave: 0, extraTotal: 0 };
  for (const c of cells) {
    if (c.essential) {
      s.essentialTotal++;
      if (c.doc) s.essentialHave++;
    } else {
      s.extraTotal++;
      if (c.doc) s.extraHave++;
    }
  }
  return s;
}

export function addStatus(a: Status, b: Status): Status {
  return {
    essentialHave: a.essentialHave + b.essentialHave, essentialTotal: a.essentialTotal + b.essentialTotal,
    extraHave: a.extraHave + b.extraHave, extraTotal: a.extraTotal + b.extraTotal,
  };
}

export const rowCells = (rows: PaperRow[]): Cell[] => rows.flatMap((r) => Object.values(r.cells) as Cell[]);
export const groupCells = (g: { rows?: PaperRow[]; specimens?: PaperRow[]; docs: Cell[] }): Cell[] => [
  ...g.docs, ...rowCells(g.rows ?? g.specimens ?? []),
];

export function buildChecklist(code: string, versions: Version[], stored: StoredDoc[], lib: LibrarySettings): Checklist {
  const have = new Map(stored.map((d) => [d.file_name, d]));
  const used = new Set<string>();
  const rulesFor = new Map<string, ExpectedRules>();
  for (const v of versions) {
    const r = parseRules(v.expected);
    if (r) rulesFor.set(v.id, r);
  }
  const versionFor = (year: number) => versions.find((v) => v.valid_from_year <= year && v.valid_to_year >= year);

  // Syllabus documents and specimens, for versions that overlap the library years. Newest first.
  const versionGroups: VersionGroup[] = [];
  for (const v of [...versions].sort((a, b) => b.valid_from_year - a.valid_from_year)) {
    if (v.valid_to_year < lib.fromYear || v.valid_from_year > lib.toYear) continue;
    const r = rulesFor.get(v.id);
    if (!r) continue;
    const y = `${code}_y${yy(v.valid_from_year)}_`;
    const docs = [
      ...(r.versionDocs ?? []).map((t) => cell(`${y}${t}.pdf`, true, have, used)),
      ...(r.extraVersionDocs ?? []).map((t) => cell(`${y}${t}.pdf`, false, have, used)),
    ];
    const specimens: PaperRow[] = (r.specimenPapers ?? []).map((p) => {
      const cells: PaperRow["cells"] = {};
      for (const t of r.specimenTypes ?? []) cells[t] = cell(`${y}${t}_${p}.pdf`, true, have, used);
      if (r.specimenCiPapers?.includes(p)) cells.ci = cell(`${y}ci_${p}.pdf`, true, have, used);
      return { paper: p, variant: null, essential: true, cells };
    });
    const label = `${v.title} ${v.valid_from_year} to ${v.valid_to_year}`;
    versionGroups.push({ version: v, label, docs, specimens, status: statusOf([...docs, ...rowCells(specimens)]) });
  }

  // Exam sessions in the library years, up to the latest public one. Newest first.
  const sessionGroups: SessionGroup[] = [];
  for (let year = lib.toYear; year >= lib.fromYear; year--) {
    const v = versionFor(year);
    const r = v ? rulesFor.get(v.id) : undefined;
    if (!r) continue;
    for (const session of [...EXAM_SESSIONS].reverse()) {
      if (!sessionDue(year, session, lib.lastSession)) continue;
      const variants = r.variants[session] ?? [];
      if (variants.length === 0) continue;
      const essentialSet = new Set(lib.essentialVariants[session] ?? []);
      const rows: PaperRow[] = [];
      for (const p of r.papers) {
        for (const vnt of variants) {
          const essential = essentialSet.has(vnt);
          const cells: PaperRow["cells"] = {};
          for (const t of r.perPaper) cells[t] = cell(examName(code, session, year, t, p, vnt), essential, have, used);
          if (r.ciPapers?.includes(p)) cells.ci = cell(examName(code, session, year, "ci", p, vnt), essential, have, used);
          rows.push({ paper: p, variant: vnt, essential, cells });
        }
      }
      rows.sort((a, b) => Number(b.essential) - Number(a.essential) || a.paper - b.paper || (a.variant ?? 0) - (b.variant ?? 0));
      const docs = (r.perSession ?? []).map((t) => cell(examName(code, session, year, t), true, have, used));
      sessionGroups.push({
        year, session, label: `${SESSION_LABELS[session]} ${year}`, rows, docs, status: statusOf([...docs, ...rowCells(rows)]),
      });
    }
  }

  // Stored files the checklist does not ask for (inserts, later sessions): shown, never lost.
  const others = stored
    .filter((d) => !used.has(d.file_name))
    .map((d) => ({ ...cell(d.file_name, false, have, used), doc: d }))
    .sort((a, b) => a.fileName.localeCompare(b.fileName));

  const status = [...versionGroups.map((g) => g.status), ...sessionGroups.map((g) => g.status)].reduce(addStatus, statusOf([]));
  return { code, versions: versionGroups, sessions: sessionGroups, others, status };
}

export type ChecklistFilter = {
  year?: number | null;
  session?: "m" | "s" | "w" | "y" | null;
  type?: string | null;
  paper?: number | null;
  status?: "have" | "missing" | "extras" | null;
  q?: string | null;
};

/** Words of the search box; every word must match. Capped so a pasted essay costs nothing. */
export function searchWords(q: string | null | undefined): string[] {
  return (q ?? "").toLowerCase().replace(/[^a-z0-9_. ]/g, " ").split(/\s+/).filter(Boolean).slice(0, 8);
}

export function cellMatches(c: Cell, f: ChecklistFilter, words: string[]): boolean {
  const p = parseCambridgeName(c.fileName);
  if (!p) return false;
  if (f.year && p.year !== f.year) return false;
  if (f.session && p.session !== f.session) return false;
  if (f.type && c.docType !== f.type) return false;
  if (f.paper && c.paper !== f.paper) return false;
  if (f.status === "have" && !c.doc) return false;
  if (f.status === "missing" && (c.doc || !c.essential)) return false;
  if (f.status === "extras" && c.essential) return false;
  return words.every((w) => wordMatches(c.text, w));
}

/**
 * Numbers match whole words ("4" is paper 4, not every 2024); other words match the
 * start of a word ("mark" finds "mark scheme"); a file name (with _ or .) matches inside.
 */
function wordMatches(text: string, w: string): boolean {
  if (/[_.]/.test(w)) return text.includes(w);
  const tokens = text.split(/[^a-z0-9]+/);
  return /^\d+$/.test(w) ? tokens.includes(w) : tokens.some((t) => t.startsWith(w));
}

const isActive = (f: ChecklistFilter) => !!(f.year || f.session || f.type || f.paper || f.status || searchWords(f.q).length);

/** Same shape, only the matching files; empty groups and rows are dropped. Status stays the full one. */
export function filterChecklist(list: Checklist, f: ChecklistFilter): Checklist & { matches: number; filtered: boolean } {
  const words = searchWords(f.q);
  const keep = (c: Cell | undefined) => !!c && cellMatches(c, f, words);
  const keepRows = (rows: PaperRow[]) =>
    rows
      .map((r) => ({ ...r, cells: Object.fromEntries(Object.entries(r.cells).filter(([, c]) => keep(c))) as PaperRow["cells"] }))
      .filter((r) => Object.keys(r.cells).length > 0);
  const versions = list.versions
    .map((g) => ({ ...g, docs: g.docs.filter(keep), specimens: keepRows(g.specimens) }))
    .filter((g) => g.docs.length + g.specimens.length > 0);
  const sessions = list.sessions
    .map((g) => ({ ...g, docs: g.docs.filter(keep), rows: keepRows(g.rows) }))
    .filter((g) => g.docs.length + g.rows.length > 0);
  const others = list.others.filter(keep);
  const matches = [...versions.flatMap(groupCells), ...sessions.flatMap(groupCells), ...others].length;
  return { ...list, versions, sessions, others, matches, filtered: isActive(f) };
}
