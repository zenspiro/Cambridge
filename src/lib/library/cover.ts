// The front page reader's rules: from the text of a PDF's first page (firstPage.ts) to its
// Cambridge name. Cambridge prints every cover the same way, e.g.
//   "PHYSICS 0625/42 / Paper 4 Theory (Extended) May/June 2024 / MARK SCHEME"
//   "0625 Physics June 2024 / Principal Examiner Report for Teachers"
//   "PHYSICS 0625/02 / ... For examination from 2023 / SPECIMEN PAPER"
// Each part found is reported with where it came from; a name is given only when every part the
// name needs was read. Unsure covers go to the AI (agent `cover` task). Pure, Node and browser.
import { nameFromParts, NO_VARIANT_TYPES, type DocType } from "./names.ts";

export type CoverReading = {
  /** The Cambridge name, when the cover gives every part. */
  name: string | null;
  code: string | null;
  /** The year the cover gives, even when the rest is missing (old layouts, old types). */
  year: number | null;
  /** What was read, in words, or what is missing. */
  why: string;
  /** False when the text has no sign of Cambridge (UCLES, Cambridge): likely not an original file. */
  cambridge: boolean;
  /** No text at all (scanned or unreadable file). */
  empty: boolean;
  /** The paper's title as the cover prints it ("Paper 2 Problem-solving and Programming"). */
  paperTitle?: { paper: number; name: string };
};

const SESSIONS: [RegExp, "m" | "s" | "w"][] = [
  [/February\s*\/\s*March/i, "m"],
  [/May\s*\/\s*June/i, "s"],
  [/October\s*\/\s*November/i, "w"],
];
const SESSION_WORD = /\b(March|June|November)\s+(20\d\d)\b/i;
const WORD_SESSION: Record<string, "m" | "s" | "w"> = { march: "m", june: "s", november: "w" };
const SESSION_NAMES = { m: "February/March", s: "May/June", w: "October/November", y: "specimen" } as const;

// Headings for each type. Capitals are matched exactly, as Cambridge prints them, so small print
// such as "listed in the confidential instructions" on a question paper does not count.
// Headings that name the document outright win wherever they sit on the page: a pre-release
// booklet also carries "INSTRUCTIONS", a transcript the paper's own heading.
const STRONG_HEADINGS: [DocType, RegExp][] = [
  ["pm", /PRE-RELEASE\s+MATERIAL/],
  ["tn", /TEACHERS?[\u2019']\s*NOTES|Teachers?[\u2019']\s*Notes/],
  ["qr", /\bTRANSCRIPT\b|^Transcript\b|Listening\s+Transcript/m],
];
const TYPE_HEADINGS: [DocType, RegExp][] = [
  ["er", /Principal\s+Examiner\s+Report|Examiner\s+Report\s+for\s+Teachers/i],
  ["gt", /Grade\s+threshold\s+table|Grade\s+thresholds?\b(?!\s+(?:and|or))/i],
  ["gd", /Grade\s+Descriptions\s+for/i],
  ["su", /Syllabus\s+update/i],
  ["sy", /^Syllabus$|Use this syllabus for exams? in/im],
  ["ci", /CONFIDENTIAL\s+INSTRUCTIONS/],
  ["ms", /MARK\s+SCHEME/],
  ["in", /^INSERT\b/m],
  ["qp", /You must answer on|Answer all questions|INSTRUCTIONS|SPECIMEN PAPER/],
];

/** The document type: the heading that appears first on the page wins. */
function typeOf(t: string): DocType | null {
  for (const [type, re] of STRONG_HEADINGS) if (re.test(t)) return type;
  let best: { type: DocType; at: number } | null = null;
  for (const [type, re] of TYPE_HEADINGS) {
    const m = re.exec(t);
    if (m && (!best || m.index < best.at)) best = { type, at: m.index };
  }
  return best?.type ?? null;
}

const TYPE_WORDS: Record<DocType, string> = {
  qp: "question paper", ms: "mark scheme", in: "insert", ci: "confidential instructions", er: "examiner report",
  pm: "pre-release material", qr: "listening transcript", tn: "teachers' notes",
  gt: "grade thresholds", sp: "specimen paper", sm: "specimen mark scheme", sy: "syllabus", su: "syllabus update", gd: "grade descriptions",
};

/**
 * Reads a cover. `codes` are the library's syllabus codes (a bare four-digit number counts as a
 * code only when it is one, so years never pass as codes).
 */
export function readCover(text: string, codes: readonly string[]): CoverReading {
  const t = (text ?? "").slice(0, 6000);
  if (!t.trim()) return { name: null, code: null, year: null, why: "the first page has no text (perhaps a scan)", cambridge: false, empty: true };
  const head = t.split("\n").slice(0, 40).join("\n");
  const cambridge = /Cambridge|UCLES/i.test(t);
  const found: string[] = [];
  const missing: string[] = [];

  // Code and component: "0625/42", "0625 /11", "PHYSICS0625/02".
  const comp = /(?<!\d)(\d{4})\s?\/\s?(\d)(\d)(?!\d)/.exec(head);
  let code = comp && codes.includes(comp[1]!) ? comp[1]! : null;
  if (!code) {
    for (const m of head.matchAll(/(?<!\d)(\d{4})(?!\d)/g)) {
      if (codes.includes(m[1]!)) { code = m[1]!; break; }
    }
  }
  if (code) found.push(`syllabus ${code}`);
  else missing.push("syllabus code");

  let type = typeOf(head);
  const specimen = /\bSPECIMEN\b/.test(head);
  const from = /For examination from\s+(20\d\d)/i.exec(head);
  const versionYear = /Use this syllabus for exams? in\s+(20\d\d)/i.exec(t) ?? /for examination\s+(?:from\s+|in\s+)?(20\d\d)/i.exec(t);

  let session: "m" | "s" | "w" | "y" | null = null;
  let year: number | null = null;
  if (type === "sy" || type === "su" || type === "gd" || specimen || from) {
    session = "y";
    year = Number((from ?? versionYear)?.[1] ?? NaN) || null;
  } else {
    for (const [re, s] of SESSIONS) {
      const m = new RegExp(`${re.source}\\s+(20\\d\\d)`, "i").exec(head);
      if (m) { session = s; year = Number(m[1]); break; }
    }
    if (!session) {
      const m = SESSION_WORD.exec(head);
      if (m) { session = WORD_SESSION[m[1]!.toLowerCase()]!; year = Number(m[2]); }
    }
  }
  if (session && year) found.push(session === "y" ? `syllabus version from ${year}` : `${SESSION_NAMES[session]} ${year}`);
  else missing.push("session and year");

  if (type) {
    if (session === "y" && type === "qp") type = "sp";
    if (session === "y" && type === "ms") type = "sm";
    found.push(TYPE_WORDS[type]);
  } else missing.push("document type");

  let paper: number | null = null;
  let variant: number | null = null;
  const perPaper = type && !["er", "gt", "sy", "su", "gd"].includes(type);
  if (perPaper) {
    if (comp && comp[1] === code) {
      if (session === "y") paper = Number(comp[2]! + comp[3]!) || null; // specimen "0625/02" is paper 2
      else if (comp[2] === "0") paper = Number(comp[3]) || null; // "0520/03": paper 3, no variants
      else {
        paper = Number(comp[2]);
        variant = Number(comp[3]) || null;
      }
    }
    if (paper) found.push(session === "y" ? `paper ${paper}` : `paper ${paper}${variant ? ` variant ${variant}` : ""}`);
    else missing.push("paper number");
    if (session !== "y" && paper && !variant && !NO_VARIANT_TYPES.includes(type!)) missing.push("variant");
  }

  const name = code && session && year && type && !missing.length
    ? nameFromParts(code, { year, session, type, paper, variant })
    : null;
  const why = missing.length
    ? `first page: ${found.length ? `read ${found.join(", ")}; ` : ""}no ${missing.join(", ")}`
    : `first page says ${found.join(", ")}`;
  if (!year) year = Number(/\b(?:February\s*\/\s*March|May\s*\/\s*June|October\s*\/\s*November|March|June|November)\s+(?:SESSION\s+)?(20\d\d|19\d\d)\b/i.exec(head)?.[1] ?? 0) || null;
  const title = coverPaperTitle(head);
  return { name, code, year, why, cambridge, empty: false, ...(title ? { paperTitle: title } : {}) };
}

const TITLE_STOP = /\s*(?:\b(?:February|March|May|June|October|November|For examination|SPECIMEN|MARK SCHEME|PRE-RELEASE|INSERT|Paper\s+\d)\b.*)$/;

/**
 * The paper's title from the cover's head: "Paper 2 Problem-solving and Programming" on its own
 * line (or followed by the session). Null when the cover has none (examiner reports).
 */
export function coverPaperTitle(head: string): { paper: number; name: string } | null {
  for (const line of head.split("\n")) {
    const m = /^\s*Paper\s+(\d)\s+(.+)$/.exec(line);
    if (!m) continue;
    const name = m[2]!.replace(TITLE_STOP, "").replace(/\s+/g, " ").replace(/[\s,.;:]+$/, "").trim();
    if (name.length >= 3 && name.length <= 80 && /[A-Za-z]{3}/.test(name) && !/^\d/.test(name)) return { paper: Number(m[1]), name };
  }
  return null;
}
