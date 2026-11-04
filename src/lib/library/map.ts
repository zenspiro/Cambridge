// The subject map: one view of a whole syllabus code, for people (the library page) and for
// the AI (the same structure as JSON). Hierarchy: syllabus version > its documents and specimens
// > its exam sessions (newest first) > each paper's files (question paper, insert, mark scheme,
// confidential instructions) for the essential variants, then the session's examiner report and
// grade thresholds. Pure: built from the checklist and the papers table.
import type { Cell, Checklist, PaperRow, Status } from "./checklist.ts";
import type { DocType } from "./names.ts";
import { describeFile, paperLookup, type Paper } from "./papers.ts";

/** Paper files in the order a teacher reads them. */
export const PAPER_TYPES: DocType[] = ["qp", "in", "ms", "ci"];
export const SPECIMEN_TYPES: DocType[] = ["sp", "in", "sm", "ci"];

export type MapColumn = { paper: number; name: string; tier: Paper["tier"] | null; types: DocType[] };
export type MapRow = {
  year: number; session: "m" | "s" | "w"; label: string; variant: number | null; essential: boolean;
  /** First row of its session: carries the session's status and whole-session files. */
  first: boolean; sessionStatus: Status; cells: Partial<Record<string, Cell>>; er?: Cell; gt?: Cell;
};
export type MapVersion = {
  id: string; label: string; from: number; to: number; status: Status;
  docs: Cell[]; specimens: { columns: MapColumn[]; cells: Partial<Record<string, Cell>> };
  columns: MapColumn[]; rows: MapRow[];
  /** Coursework, speaking: shown by name, never asked for. */
  schoolAssessed: { paper: number; name: string }[];
};

export const cellKey = (paper: number, type: DocType) => `${paper}:${type}`;

function columnsFor(rows: PaperRow[], papers: Paper[], types: DocType[]): MapColumn[] {
  const byPaper = new Map<number, Set<DocType>>();
  for (const r of rows) {
    const set = byPaper.get(r.paper) ?? new Set<DocType>();
    for (const t of Object.keys(r.cells) as DocType[]) set.add(t);
    byPaper.set(r.paper, set);
  }
  return [...byPaper.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([paper, set]) => {
      const p = papers.find((x) => x.paper === paper) ?? null;
      return { paper, name: p?.name ?? `Paper ${paper}`, tier: p?.tier ?? null, types: types.filter((t) => set.has(t)) };
    });
}

export function buildSubjectMap(list: Checklist, allPapers: Paper[], opts: { allVariants?: boolean } = {}): MapVersion[] {
  return list.versions.map((g) => {
    const papers = allPapers.filter((p) => p.syllabus_id === g.version.id);
    const sessions = list.sessions.filter((s) => s.versionId === g.version.id);
    const rows: MapRow[] = [];
    for (const s of sessions) {
      const chosen = s.rows.filter((r) => opts.allVariants || r.essential);
      const variants = [...new Set(chosen.map((r) => r.variant))].sort((a, b) => {
        const ea = chosen.some((r) => r.variant === a && r.essential);
        const eb = chosen.some((r) => r.variant === b && r.essential);
        return Number(eb) - Number(ea) || (a ?? 0) - (b ?? 0);
      });
      const er = s.docs.find((c) => c.docType === "er");
      const gt = s.docs.find((c) => c.docType === "gt");
      const many = variants.length > 1;
      variants.forEach((v, i) => {
        const cells: Partial<Record<string, Cell>> = {};
        let essential = false;
        for (const r of chosen.filter((x) => x.variant === v)) {
          essential ||= r.essential;
          for (const [t, c] of Object.entries(r.cells)) if (c) cells[cellKey(r.paper, t as DocType)] = c;
        }
        rows.push({
          year: s.year, session: s.session, label: many || opts.allVariants ? `${s.label}, variant ${v}` : s.label,
          variant: v, essential, first: i === 0, sessionStatus: s.status, cells, ...(i === 0 ? { er, gt } : {}),
        });
      });
      if (variants.length === 0 && (er || gt)) {
        rows.push({ year: s.year, session: s.session, label: s.label, variant: null, essential: true, first: true, sessionStatus: s.status, cells: {}, er, gt });
      }
    }
    const specCells: Partial<Record<string, Cell>> = {};
    for (const r of g.specimens) for (const [t, c] of Object.entries(r.cells)) if (c) specCells[cellKey(r.paper, t as DocType)] = c;
    return {
      id: g.version.id,
      label: `${g.version.valid_from_year} to ${g.version.valid_to_year} syllabus`,
      from: g.version.valid_from_year,
      to: g.version.valid_to_year,
      status: g.status,
      docs: g.docs,
      specimens: { columns: columnsFor(g.specimens, papers, SPECIMEN_TYPES), cells: specCells },
      columns: columnsFor(sessions.flatMap((s) => s.rows), papers, PAPER_TYPES),
      rows,
      schoolAssessed: papers.filter((p) => p.school_assessed).map((p) => ({ paper: p.paper, name: p.name })),
    };
  });
}

/** One file for the AI: its place in the hierarchy, what it is in words, and whether it is in. */
const fileJson = (c: Cell, versionId: string, look: ReturnType<typeof paperLookup>) => ({
  fileName: c.fileName, description: describeFile(c.fileName, versionId, look), docType: c.docType, paper: c.paper,
  variant: c.variant, essential: c.essential, stored: !!c.doc, documentId: c.doc?.id ?? null, sha256: c.doc?.sha256 ?? null,
  sizeBytes: c.doc?.size_bytes ?? null,
});

/**
 * The same hierarchy as the page, as JSON for the AI engine and the "Download map" button:
 * versions > documents, specimens, papers, routes, sessions > files. Metadata only.
 */
export function subjectMapJson(
  subject: { code: string; label: string; qualification: string },
  list: Checklist,
  papers: Paper[],
  routes: { syllabus_id: string; name: string; papers: string; grades: string }[],
) {
  const look = paperLookup(papers);
  return {
    ...subject,
    status: list.status,
    versions: list.versions.map((g) => ({
      id: g.version.id, from: g.version.valid_from_year, to: g.version.valid_to_year, status: g.status,
      papers: papers.filter((p) => p.syllabus_id === g.version.id).map((p) => ({
        paper: p.paper, name: p.name, format: p.format, tier: p.tier, durationMin: p.duration_min, marks: p.marks,
        weightingPct: p.weighting_pct, schoolAssessed: !!p.school_assessed, note: p.note || undefined,
      })),
      routes: routes.filter((r) => r.syllabus_id === g.version.id).map((r) => ({ name: r.name, papers: JSON.parse(r.papers) as number[][], grades: r.grades })),
      documents: g.docs.map((c) => fileJson(c, g.version.id, look)),
      specimens: g.specimens.flatMap((r) => Object.values(r.cells).map((c) => fileJson(c as Cell, g.version.id, look))),
      sessions: list.sessions.filter((s) => s.versionId === g.version.id).map((s) => ({
        year: s.year, session: s.session, label: s.label, status: s.status,
        files: [...s.docs, ...s.rows.flatMap((r) => Object.values(r.cells) as Cell[])].map((c) => fileJson(c, g.version.id, look)),
      })),
    })),
    otherFiles: list.others.map((c) => fileJson(c, c.doc?.syllabus_id ?? "", look)),
  };
}
