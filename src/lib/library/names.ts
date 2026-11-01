// Cambridge file names (e.g. 0625_s23_qp_42.pdf). One parser for uploads, the agent
// and the gap report. Pure, no imports beyond config.

export type Session = "m" | "s" | "w" | "y";
export type DocType = "qp" | "ms" | "in" | "ci" | "er" | "gt" | "sp" | "sm" | "sy";

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
// Specimens: y + first exam year of the syllabus version.
const SPEC = /^(\d{4})_y(\d{2})_(?:(sp|sm|in|ci)_([1-9])|(sy))\.pdf$/;

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
