// Finding PDF links on a start page and turning Cambridge's website names into
// Cambridge's standard file names. Pure; used by the agent and by unit tests.
import { parseCambridgeName } from "../library/names.ts";

/** PDF links on the page that stay inside the source's address (same origin, under its path). */
export function extractPdfLinks(html: string, pageUrl: string, baseUrl: string): string[] {
  const base = new URL(baseUrl);
  const out = new Set<string>();
  const re = /href\s*=\s*(?:"([^"]*)"|'([^']*)')/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const raw = (m[1] ?? m[2] ?? "").replace(/&amp;/g, "&").trim();
    if (!raw || raw.length > 500) continue;
    let u: URL;
    try {
      u = new URL(raw, pageUrl);
    } catch {
      continue;
    }
    if (u.origin !== base.origin || !u.pathname.startsWith(base.pathname)) continue;
    if (!/\.pdf$/i.test(u.pathname)) continue;
    u.hash = "";
    out.add(u.toString());
  }
  return [...out];
}

const SESSIONS: Record<string, "m" | "s" | "w"> = {
  "february-march": "m",
  march: "m",
  "may-june": "s",
  june: "s",
  "october-november": "w",
  november: "w",
};
const EXAM_TYPES: Record<string, string> = {
  "question-paper": "qp",
  "mark-scheme": "ms",
  "confidential-instructions": "ci",
  insert: "in",
  "examiner-report": "er",
  "grade-threshold": "gt",
  "grade-thresholds": "gt",
};
const SPEC_TYPES: Record<string, string> = { "": "sp", "mark-scheme": "sm", "confidential-instructions": "ci", insert: "in" };

const yy = (year: string) => year.slice(2);

/**
 * Cambridge's website name (e.g. 570010-june-2024-question-paper-11.pdf) to the
 * standard name (0625_s24_qp_11.pdf). The syllabus code comes from the start page.
 * Returns null when the name does not fit a known pattern (shown in the run report).
 */
export function toCambridgeName(url: string, code: string): string | null {
  let file: string;
  try {
    file = decodeURIComponent(new URL(url).pathname.split("/").pop() ?? "").toLowerCase();
  } catch {
    return null;
  }
  const direct = parseCambridgeName(file);
  if (direct) return direct.code === code ? direct.fileName : null;

  const slug = file.replace(/\.pdf$/, "").replace(/^\d+-/, "");
  let name: string | null = null;

  // "question-paper-11" and "mark-scheme-paper-11" both occur on Cambridge's site.
  const exam =
    /^(february-march|march|may-june|june|october-november|november)-(\d{4})-(question-paper|mark-scheme|confidential-instructions|insert|examiner-report|grade-thresholds?)(?:(?:-paper)?-([1-9])([1-9])?)?$/.exec(
      slug,
    );
  if (exam) {
    const type = EXAM_TYPES[exam[3]!];
    const perSession = type === "er" || type === "gt";
    if (type && perSession === !exam[4]) {
      name = `${code}_${SESSIONS[exam[1]!]}${yy(exam[2]!)}_${type}${exam[4] ? `_${exam[4]}${exam[5] ?? ""}` : ""}.pdf`;
    }
  }
  const spec = /^(\d{4})-specimen-paper-([1-9])(?:-([a-z-]+))?$/.exec(slug);
  if (spec) {
    const type = SPEC_TYPES[spec[3] ?? ""];
    if (type) name = `${code}_y${yy(spec[1]!)}_${type}_${spec[2]}.pdf`;
  }
  const syl = /^(\d{4})(?:-\d{4})?-(syllabus|syllabus-update|grade-descriptions)$/.exec(slug);
  if (syl) name = `${code}_y${yy(syl[1]!)}_${{ syllabus: "sy", "syllabus-update": "su", "grade-descriptions": "gd" }[syl[2]!]}.pdf`;

  return name && parseCambridgeName(name) ? name : null;
}
