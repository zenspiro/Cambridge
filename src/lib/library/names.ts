// Cambridge file names (e.g. 0625_s23_qp_42.pdf). One parser for uploads, the agent
// and the gap report. Pure, no imports beyond config.

export type Session = "m" | "s" | "w" | "y";
export type DocType = "qp" | "ms" | "in" | "ci" | "er" | "gt" | "sp" | "sm" | "sy" | "su" | "gd";

export type ParsedName = {
  fileName: string;
  code: string;
  session: Session;
  year: number;
  docType: DocType;
  paper: number | null;
  variant: number | null;
};

// Exam sessions: per-paper files with an optional variant digit, or per-session files.
const EXAM = /^(\d{4})_([msw])(\d{2})_(?:(qp|ms|in|ci)_([1-9])([1-9])?|(er|gt))\.pdf$/;
// Specimens and version documents: y + first exam year of the syllabus version.
// sy syllabus, su syllabus update, gd grade descriptions.
const SPEC = /^(\d{4})_y(\d{2})_(?:(sp|sm|in|ci)_([1-9])|(sy|su|gd))\.pdf$/;

export function parseCambridgeName(raw: string): ParsedName | null {
  if (typeof raw !== "string" || raw.length > 40) return null;
  const fileName = raw.trim().toLowerCase();
  let m = EXAM.exec(fileName);
  if (m) {
    const docType = (m[4] ?? m[7]) as DocType;
    return {
      fileName,
      code: m[1]!,
      session: m[2] as Session,
      year: 2000 + Number(m[3]),
      docType,
      paper: m[5] ? Number(m[5]) : null,
      variant: m[6] ? Number(m[6]) : null,
    };
  }
  m = SPEC.exec(fileName);
  if (m) {
    return {
      fileName,
      code: m[1]!,
      session: "y",
      year: 2000 + Number(m[2]),
      docType: (m[3] ?? m[5]) as DocType,
      paper: m[4] ? Number(m[4]) : null,
      variant: null,
    };
  }
  return null;
}

/** Storage key in the cambridge-source bucket: code/year/session/file. */
export function storageKey(p: ParsedName): string {
  return `${p.code}/${p.year}/${p.session}/${p.fileName}`;
}

export function examName(code: string, session: "m" | "s" | "w", year: number, docType: DocType, paper?: number, variant?: number): string {
  const yy = String(year % 100).padStart(2, "0");
  const tail = paper === undefined ? "" : `_${paper}${variant ?? ""}`;
  return `${code}_${session}${yy}_${docType}${tail}.pdf`;
}

const DOC_TYPES: DocType[] = ["qp", "ms", "in", "ci", "er", "gt", "sp", "sm", "sy", "su", "gd"];

/**
 * A Cambridge name from its parts (year, session, type, paper, variant), as the AI or the front
 * page reader give them; null when the parts do not make a valid name.
 */
export function nameFromParts(code: string, d: Record<string, unknown>): string | null {
  const year = Number(d.year);
  const session = d.session as "m" | "s" | "w" | "y";
  const type = d.type as DocType;
  const paper = d.paper === undefined || d.paper === null ? null : Number(d.paper);
  const variant = d.variant === undefined || d.variant === null ? null : Number(d.variant);
  if (!Number.isInteger(year) || year < 2000 || year > 2099 || !["m", "s", "w", "y"].includes(session) || !DOC_TYPES.includes(type)) return null;
  const yy = String(year % 100).padStart(2, "0");
  let name: string;
  if (session === "y") {
    if (type === "sy" || type === "su" || type === "gd") name = `${code}_y${yy}_${type}.pdf`;
    else if (paper && Number.isInteger(paper)) name = `${code}_y${yy}_${type === "qp" ? "sp" : type === "ms" ? "sm" : type}_${paper}.pdf`;
    else return null;
  } else if (type === "er" || type === "gt") name = examName(code, session, year, type);
  else if (paper && variant && Number.isInteger(paper) && Number.isInteger(variant)) name = examName(code, session, year, type, paper, variant);
  else return null;
  return parseCambridgeName(name) ? name : null;
}
