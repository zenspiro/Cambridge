// Cambridge file names (e.g. 0625_s23_qp_42.pdf). One parser for uploads, the agent
// and the gap report. Pure, no imports beyond config.

export type Session = "m" | "s" | "w" | "y";
export type DocType = "qp" | "ms" | "in" | "ci" | "pm" | "qr" | "tn" | "er" | "gt" | "sp" | "sm" | "sy" | "su" | "gd";

export type ParsedName = {
  fileName: string;
  code: string;
  session: Session;
  year: number;
  docType: DocType;
  paper: number | null;
  variant: number | null;
};

// Exam sessions: per-paper files with an optional variant digit ("qp_42"; teachers' notes are
// written "tn_03": paper 3, which has no variants), or per-session files. pm pre-release material, qr listening
// transcript, tn teachers' notes (speaking tests).
const EXAM = /^(\d{4})_([msw])(\d{2})_(?:(qp|ms|in|ci|pm|qr)_([1-9])([1-9])?|(tn)_0([1-9])|(er|gt)(?:_([1-9])([1-9])?)?)\.pdf$/;
// (Some series, like Pakistan's 2021 one, have an examiner report per paper: "1521_s21_er_32.pdf".)
// Specimens and version documents: y + first exam year of the syllabus version.
// sy syllabus, su syllabus update, gd grade descriptions; pm specimen pre-release material.
const SPEC = /^(\d{4})_y(\d{2})_(?:(sp|sm|in|ci|pm)_([1-9])|(sy|su|gd))\.pdf$/;

const GEN_EXAM = /^(\d{4})_([msw])(\d{2})_([a-z]{2})(?:_(?:0([1-9])|([1-9])([1-9])?))?\.pdf$/;
const GEN_SPEC = /^(\d{4})_y(\d{2})_([a-z]{2})(?:_([1-9]))?\.pdf$/;

export function parseCambridgeName(raw: string): ParsedName | null {
  if (typeof raw !== "string" || raw.length > 40) return null;
  const fileName = raw.trim().toLowerCase();
  let m = EXAM.exec(fileName);
  if (m) {
    const docType = (m[4] ?? m[7] ?? m[9]) as DocType;
    const paper = m[5] ?? m[8] ?? m[10];
    return {
      fileName,
      code: m[1]!,
      session: m[2] as Session,
      year: 2000 + Number(m[3]),
      docType,
      paper: paper ? Number(paper) : null,
      variant: m[6] ?? m[11] ? Number(m[6] ?? m[11]) : null,
    };
  }
  // Any other Cambridge code ("0417_w24_sf_02.pdf", source files): a real file of a kind the
  // library has no name for yet. Stored as it is, so a new code never needs a code change.
  m = GEN_EXAM.exec(fileName);
  if (m && !isKnownType(m[4]!)) {
    const paper = m[5] ?? m[6];
    return {
      fileName, code: m[1]!, session: m[2] as Session, year: 2000 + Number(m[3]), docType: m[4] as DocType,
      paper: paper ? Number(paper) : null, variant: m[7] ? Number(m[7]) : null,
    };
  }
  m = GEN_SPEC.exec(fileName);
  if (m && !isKnownType(m[3]!)) {
    return { fileName, code: m[1]!, session: "y", year: 2000 + Number(m[2]), docType: m[3] as DocType, paper: m[4] ? Number(m[4]) : null, variant: null };
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

export function examName(code: string, session: "m" | "s" | "w", year: number, docType: DocType, paper?: number, variant?: number | null): string {
  const yy = String(year % 100).padStart(2, "0");
  // No variant: Cambridge writes the paper as two digits ("tn_03").
  const tail = paper === undefined ? "" : variant === undefined || variant === null ? `_0${paper}` : `_${paper}${variant}`;
  return `${code}_${session}${yy}_${docType}${tail}.pdf`;
}

export const DOC_TYPES: DocType[] = ["qp", "ms", "in", "ci", "pm", "qr", "tn", "er", "gt", "sp", "sm", "sy", "su", "gd"];

/** Types written once per paper without variants ("tn_03"). */
export const NO_VARIANT_TYPES: readonly DocType[] = ["tn"];

/** True for the types the library knows by name; other Cambridge codes are stored as they are. */
export const isKnownType = (t: string): t is DocType => (DOC_TYPES as string[]).includes(t);

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
  else if (NO_VARIANT_TYPES.includes(type) && paper && Number.isInteger(paper)) name = examName(code, session, year, type, paper, null);
  else if (paper && variant && Number.isInteger(paper) && Number.isInteger(variant)) name = examName(code, session, year, type, paper, variant);
  else return null;
  return parseCambridgeName(name) ? name : null;
}
