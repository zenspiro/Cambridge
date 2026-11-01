// Papers (components) and routes per syllabus version, and plain-words descriptions of
// files that use them ("June 2024, Paper 2 Multiple Choice (Extended), variant 2, mark scheme").
import { DOC_TYPE_LABELS, SESSION_LABELS } from "../config.ts";
import type { Db } from "../db.ts";
import { parseCambridgeName } from "./names.ts";

export type Paper = {
  syllabus_id: string; paper: number; name: string; format: "mcq" | "structured" | "practical" | "written";
  tier: "core" | "extended" | "all"; duration_min: number | null; marks: number | null; weighting_pct: number | null; note: string;
};
export type Route = { syllabus_id: string; name: string; papers: string; grades: string };

export const FORMAT_LABELS: Record<Paper["format"], string> = {
  mcq: "Multiple choice",
  structured: "Structured, written",
  practical: "Practical",
  written: "Written",
};
export const TIER_LABELS: Record<Paper["tier"], string> = { core: "Core", extended: "Extended", all: "Core and Extended" };

export async function loadPapers(db: Db, code: string): Promise<{ papers: Paper[]; routes: Route[] }> {
  const [{ results: papers }, { results: routes }] = await Promise.all([
    db
      .prepare(`SELECT p.syllabus_id, p.paper, p.name, p.format, p.tier, p.duration_min, p.marks, p.weighting_pct, p.note
                FROM syllabus_paper p JOIN syllabus y ON y.id = p.syllabus_id WHERE y.code = ?1 ORDER BY p.syllabus_id, p.paper`)
      .bind(code)
      .all<Paper>(),
    db
      .prepare(`SELECT r.syllabus_id, r.name, r.papers, r.grades FROM syllabus_route r JOIN syllabus y ON y.id = r.syllabus_id
                WHERE y.code = ?1 ORDER BY r.syllabus_id, r.sort_order`)
      .bind(code)
      .all<Route>(),
  ]);
  return { papers, routes };
}

/** "1 + 3 + (5 or 6)" from [[1],[3],[5,6]]. */
export function routeText(papersJson: string): string {
  try {
    const groups = JSON.parse(papersJson) as number[][];
    return groups.map((g) => (g.length === 1 ? `Paper ${g[0]}` : `(${g.map((p) => `Paper ${p}`).join(" or ")})`)).join(" + ");
  } catch {
    return "";
  }
}

export function duration(min: number | null): string {
  if (!min) return "";
  const h = Math.floor(min / 60);
  const m = min % 60;
  return h ? `${h} h${m ? ` ${m} min` : ""}` : `${m} min`;
}

/** Finds the paper for a file: by version id, falling back to any version with that number. */
export type PaperLookup = (syllabusId: string | null, paper: number | null) => Paper | null;

export function paperLookup(papers: Paper[]): PaperLookup {
  return (syllabusId, paper) => {
    if (!paper) return null;
    return papers.find((p) => p.syllabus_id === syllabusId && p.paper === paper) ?? null;
  };
}

/** "Paper 2 Multiple Choice (Extended)" or "Paper 2". */
export function paperTitle(paper: number, p: Paper | null): string {
  return p ? `Paper ${paper} ${p.name}` : `Paper ${paper}`;
}

/**
 * Plain words for one file, for the agent's activity log, search results and the add page.
 * versionId is the syllabus version the file belongs to (for its paper names).
 */
export function describeFile(fileName: string, versionId: string | null, lookup: PaperLookup): string {
  const f = parseCambridgeName(fileName);
  if (!f) return fileName;
  const type = (DOC_TYPE_LABELS[f.docType] ?? f.docType).toLowerCase();
  const when = f.session === "y" ? `Syllabus ${f.year} version` : `${SESSION_LABELS[f.session]} ${f.year}`;
  if (!f.paper) return `${when}, ${type}`;
  const paper = paperTitle(f.paper, lookup(versionId, f.paper));
  return `${when}, ${paper}${f.variant ? `, variant ${f.variant}` : ""}, ${type}`;
}
