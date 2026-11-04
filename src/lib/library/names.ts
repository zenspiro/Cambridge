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
const EXAM = /^(\d{4})_([msw])(\d{2})_(?:(qp|ms|in|ci|pm|qr)_([1-9])([1-9])?|(tn)_0([1-9])|(er|gt))\.pdf$/;
// Specimens and version documents: y + first exam year of the syllabus version.
// sy syllabus, su syllabus update, gd grade descriptions.
const SPEC = /^(\d{4})_y(\d{2})_(?:(sp|sm|in|ci)_([1-9])|(sy|su|gd))\.pdf$/;

export function parseCambridgeName(raw: string): ParsedName | null {
  if (typeof raw !== "string" || raw.length > 40) return null;
  const fileName = raw.trim().toLowerCase();
  let m = EXAM.exec(fileName);
  if (m) {
    const docType = (m[4] ?? m[7] ?? m[9]) as DocType;
    const paper = m[5] ?? m[8];
    return {
      fileName,
      code: m[1]!,
      session: m[2] as Session,
      year: 2000 + Number(m[3]),
      docType,
      paper: paper ? Number(paper) : null,
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

export function examName(code: string, session: "m" | "s" | "w", year: number, docType: DocType, paper?: number, variant?: number | null): string {
  const yy = String(year % 100).padStart(2, "0");
  // No variant: Cambridge writes the paper as two digits ("tn_03").
  const tail = paper === undefined ? "" : variant === undefined || variant === null ? `_0${paper}` : `_${paper}${variant}`;
  return `${code}_${session}${yy}_${docType}${tail}.pdf`;
}

export const DOC_TYPES: DocType[] = ["qp", "ms", "in", "ci", "pm", "qr", "tn", "er", "gt", "sp", "sm", "sy", "su", "gd"];

/** Types written once per paper without variants ("tn_03"). */
export const NO_VARIANT_TYPES: readonly DocType[] = ["tn"];

/**
 * Cambridge codes the library does not keep, in words. A file named like a Cambridge file with
 * one of these (or any other unknown code) keeps that type: it is never read as another type.
 */
export const NOT_KEPT_TYPES: Readonly<Record<string, string>> = {
  sf: "source files for a practical paper",
  ir: "instructions",
  ab: "answer booklet",
};

/**
 * A name shaped like a Cambridge file name ("0478_w20_xx_21.pdf") whose type code the library
 * does not know. Null for real library names and for anything else.
 */
export function unknownCambridgeType(raw: string): { code: string; type: string; words: string } | null {
  const f = String(raw ?? "").trim().toLowerCase();
  if (parseCambridgeName(f)) return null;
  const m = /^(\d{4})_([msjwy])(\d{2})_([a-z]{2})(?:_\d{1,2})?\.pdf$/.exec(f);
  if (!m || DOC_TYPES.includes(m[4] as DocType)) return null;
  return { code: m[1]!, type: m[4]!, words: NOT_KEPT_TYPES[m[4]!] ?? `Cambridge code "${m[4]}"` };
}

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
