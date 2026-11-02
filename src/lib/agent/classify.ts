// Works out what a file in a shared folder is, from its name and the names of the folders
// above it: "Physics (0625) / 2023 / May June / Question Paper 42.pdf" becomes 0625_s23_qp_42.pdf.
// Pure (no network), used by the agent and by unit tests. Never guesses past what it can read:
// anything incomplete is "not recognised", with the reason.
import { examName, parseCambridgeName, type DocType } from "../library/names.ts";

export type KnownSubject = { code: string; name: string; qualification: string };
export type Classified = {
  name: string | null;
  code: string | null;
  confidence: "high" | "medium" | "none";
  /** Where each part came from, or what is missing: shown in the run report. */
  why: string;
};
export type FolderReading = {
  code: string | null;
  /** The subject's name when the library has it ("IGCSE Physics"), else null. */
  subject: string | null;
  /** True when the code (or name) matches a subject in the library. */
  inLibrary: boolean;
  year: number | null;
  session: "m" | "s" | "w" | "y" | null;
};

const words = (s: string) =>
  ` ${s.toLowerCase().replace(/\.pdf$/i, "").replace(/[_\-\u2013\u2014.,()[\]{}+/\\]+/g, " ").replace(/\s+/g, " ").trim()} `;

const SESSION_WORDS: [RegExp, "m" | "s" | "w" | "y"][] = [
  [/ (feb(ruary)? (and )?mar(ch)?|march|fm|feb mar) /, "m"],
  [/ (may (and )?june?|june|summer|mj) /, "s"],
  [/ (oct(ober)? (and )?nov(ember)?|november|winter) /, "w"],
  [/ (specimens?|sample papers?) /, "y"],
];

function sessionOf(w: string): "m" | "s" | "w" | "y" | null {
  for (const [re, s] of SESSION_WORDS) if (re.test(w)) return s;
  return null;
}

/** A Cambridge-style "s23" / "w22" / "m24" token gives session and year together. */
function compactSession(w: string): { session: "m" | "s" | "w"; year: number } | null {
  const m = / ([msw])(\d{2}) /.exec(w);
  return m ? { session: m[1] as "m" | "s" | "w", year: 2000 + Number(m[2]) } : null;
}

function yearOf(w: string): number | null {
  const m = / (20[0-3]\d) /.exec(w);
  return m ? Number(m[1]) : null;
}

/**
 * The syllabus code in a name: a code in brackets, "(0478)", first, then a code of a subject in
 * the library, then any other four-digit number that does not read as a year (1990 to 2039).
 * So "Computer Science (0478)" is read even before 0478 is added to the library.
 */
function codeOf(raw: string, subjects: KnownSubject[]): string | null {
  const isYear = (c: string) => /^(199\d|20[0-3]\d)$/.test(c);
  const bracket = [...raw.matchAll(/\((\d{4})\)/g)].map((m) => m[1]!).find((c) => !isYear(c));
  if (bracket) return bracket;
  const all = [...words(raw).matchAll(/ (\d{4}) /g)].map((m) => m[1]!);
  return all.find((c) => subjects.some((s) => s.code === c)) ?? all.find((c) => !isYear(c)) ?? null;
}

/** "physics" (and "igcse" if two qualifications share the name) picks a known subject. */
function subjectByName(w: string, subjects: KnownSubject[]): KnownSubject | null {
  const named = subjects.filter((s) => w.includes(` ${s.name.toLowerCase()} `));
  if (named.length === 1) return named[0]!;
  const withQual = named.filter((s) => w.includes(` ${s.qualification.toLowerCase().split(" ")[0]} `));
  return withQual.length === 1 ? withQual[0]! : null;
}

function typeOf(w: string): DocType | null {
  const specimen = / specimens? /.test(w);
  if (/ (question papers?|qp) /.test(w)) return specimen ? "sp" : "qp";
  if (/ (mark ?schemes?|markschemes?|ms) /.test(w)) return specimen ? "sm" : "ms";
  if (/ (examiners?'? reports?|er) /.test(w)) return "er";
  if (/ (grade thresholds?|gt) /.test(w)) return "gt";
  if (/ (confidential instructions?|ci) /.test(w)) return "ci";
  if (/ (inserts?) /.test(w) || / in [1-9][1-9]? /.test(w)) return "in";
  if (/ syllabus update /.test(w)) return "su";
  if (/ grade descriptions? /.test(w)) return "gd";
  if (/ syllabus /.test(w)) return "sy";
  if (specimen && / (paper|p) ?[1-9] /.test(w)) return "sp";
  return null;
}

/** Paper and variant: "paper 4 variant 2", "paper 42", "p42", "p4 v2", or "qp 42". */
function paperOf(w: string): { paper: number; variant: number | null } | null {
  let m = / (?:paper|p) ?([1-9])([1-9]) /.exec(w) ?? / (?:paper|p) ?([1-9])(?: ?(?:variant|var|v) ?([1-9]))? /.exec(w);
  if (m) return { paper: Number(m[1]), variant: m[2] ? Number(m[2]) : null };
  m = / (?:qp|ms|ci|in|sp|sm) ([1-9])([1-9])? /.exec(w);
  if (m) return { paper: Number(m[1]), variant: m[2] ? Number(m[2]) : null };
  return null;
}

/** What one folder name says on its own (for the folder summary in the run report). */
export function readFolder(name: string, subjects: KnownSubject[]): FolderReading {
  const w = words(name);
  const c = compactSession(w);
  const code = codeOf(name, subjects);
  const subj = subjects.find((s) => s.code === code) ?? (code ? null : subjectByName(w, subjects));
  return {
    code: code ?? subj?.code ?? null,
    subject: subj ? `${subj.qualification} ${subj.name}` : null,
    inLibrary: subj !== null,
    year: c?.year ?? yearOf(w),
    session: c?.session ?? sessionOf(w),
  };
}

export function classifyFile(path: string[], fileName: string, subjects: KnownSubject[]): Classified {
  if (!/\.pdf$/i.test(fileName)) return { name: null, code: null, confidence: "none", why: "not a PDF" };

  // 1. Already a Cambridge name (allowing spaces, dashes, capitals and "(1)" copies).
  const tidy = fileName.toLowerCase().replace(/\s*\(\d+\)(?=\.pdf$)/, "").replace(/[\s-]+/g, "_");
  const direct = parseCambridgeName(tidy);
  // Files of subjects not in the library are named too: the agent counts them per subject.
  if (direct) return { name: direct.fileName, code: direct.code, confidence: "high", why: "Cambridge file name" };

  // 2. Read the parts from the file name, then fill gaps from the folders (nearest first).
  const fw = words(fileName);
  const rawFolders = [...path].reverse();
  const folders = rawFolders.map(words);
  const from: string[] = [];
  const pick = <T,>(label: string, own: T | null, read: (w: string) => T | null): T | null => {
    if (own !== null) {
      from.push(`${label} from file name`);
      return own;
    }
    for (const w of folders) {
      const v = read(w);
      if (v !== null) {
        from.push(`${label} from folder`);
        return v;
      }
    }
    return null;
  };

  const own = compactSession(fw);
  // The subject: a code in the file name, else the nearest folder with a code or a subject name.
  let code = codeOf(fileName, subjects) ?? subjectByName(fw, subjects)?.code ?? null;
  if (code) from.push("syllabus from file name");
  else {
    for (let i = 0; i < rawFolders.length && !code; i++) code = codeOf(rawFolders[i]!, subjects) ?? subjectByName(folders[i]!, subjects)?.code ?? null;
    if (code) from.push("syllabus from folder");
  }
  const type = typeOf(fw);
  const session = pick("session", own?.session ?? sessionOf(fw), (w) => compactSession(w)?.session ?? sessionOf(w));
  const year = pick("year", own?.year ?? yearOf(fw), (w) => compactSession(w)?.year ?? yearOf(w));
  const pv = paperOf(fw);

  const perSession = type === "er" || type === "gt";
  const versionDoc = type === "sy" || type === "su" || type === "gd";
  const specimen = type === "sp" || type === "sm" || session === "y";
  const missing: string[] = [];
  if (!code) missing.push("subject");
  if (!type) missing.push("document type");
  if (!session && !versionDoc && !specimen) missing.push("session");
  if (!year) missing.push("year");
  if (type && !perSession && !versionDoc && !pv) missing.push("paper number");
  if (missing.length > 0) return { name: null, code, confidence: "none", why: `could not tell the ${missing.join(", ")}` };

  let name: string;
  const yy = String(year! % 100).padStart(2, "0");
  if (versionDoc) name = `${code}_y${yy}_${type}.pdf`;
  else if (specimen) {
    if (!pv) return { name: null, code, confidence: "none", why: "could not tell the paper number" };
    const t = type === "qp" ? "sp" : type === "ms" ? "sm" : type!;
    name = `${code}_y${yy}_${t}_${pv.paper}.pdf`;
  } else if (perSession) name = examName(code!, session as "m" | "s" | "w", year!, type!);
  else {
    if (!pv!.variant) return { name: null, code, confidence: "none", why: "could not tell the variant" };
    name = examName(code!, session as "m" | "s" | "w", year!, type!, pv!.paper, pv!.variant);
  }
  if (!parseCambridgeName(name)) return { name: null, code, confidence: "none", why: "parts do not form a valid Cambridge name" };
  const confidence = from.every((f) => f.endsWith("file name")) ? "high" : "medium";
  return { name, code, confidence, why: from.length ? from.join(", ") : "file name" };
}

/** Folder id from a Drive link (folders/ID, ?id=ID) or a bare id. */
export function driveFolderId(link: string): string | null {
  const s = link.trim();
  const m = /drive\.google\.com\/(?:drive\/(?:u\/\d+\/)?folders\/|open\?id=)([A-Za-z0-9_-]{10,100})/.exec(s) ?? /^([A-Za-z0-9_-]{25,100})$/.exec(s);
  return m ? m[1]! : null;
}
