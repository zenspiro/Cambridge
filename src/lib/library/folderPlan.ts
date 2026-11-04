// Folder upload: what each file in a picked folder is, before anything is uploaded. The same
// order as the agent: file and folder names (classifyFile), then the first page (readCover),
// then the AI for what is left; last, each name is checked against the library. Pure, so the
// browser runs it and unit tests check it.
import { classifyFile, type KnownSubject } from "../agent/classify.ts";
import type { CoverReading } from "./cover.ts";
import { parseCambridgeName } from "./names.ts";

export type PlanStatus = "new" | "have" | "outside" | "unknown_subject" | "review" | "not_needed" | "duplicate" | "too_big";

export type PlanItem = {
  i: number;
  /** Folder names from the picked folder down, and the file's own name. */
  path: string[];
  fileName: string;
  size: number;
  name: string | null;
  /** How the name was found, in words. */
  how: string;
  /** How strong that is: 0 its own Cambridge name, 1 folder names, 2 first page, 3 the AI, 9 nothing. */
  evidence: number;
  /** For a repeat: the folder path of the file that is uploaded instead. */
  dupOf?: string;
  why: string;
  status: PlanStatus;
  /** The name the file and folder names gave, when the first page said otherwise. */
  renamedFrom?: string;
  /** A name the AI thought of that the library does not ask for. */
  suggest?: string;
  /** The first page's text, kept only while the AI may still be asked. */
  text?: string;
  /** The paper's title as its first page prints it, to check the library's paper names. */
  coverTitle?: { paper: number; name: string };
};

export const isPdf = (fileName: string, type: string) => /\.pdf$/i.test(fileName) || type === "application/pdf";

/**
 * The year a file is from, as far as its names tell: a session code in the file name ("w02",
 * "j21", "m18") or a year in the folder names ("2003 May_June"), deepest first. Null if none.
 */
export function yearHint(path: string[], fileName: string): number | null {
  const code = /(?:^|[_\s-])[msjwy](\d{2})(?=[_\s.-])/i.exec(fileName);
  if (code) return 2000 + Number(code[1]);
  for (const part of [...path].reverse()) {
    const m = /(?<!\d)(19\d\d|20\d\d)(?!\d)/.exec(part);
    if (m) return Number(m[1]);
  }
  return null;
}

export type Years = { fromYear: number; toYear: number };
const outsideYears = (y: number | null | undefined, r: Years) => typeof y === "number" && (y < r.fromYear || y > r.toYear);

/** Step 1: names from the file and folder names; files from years outside the library stop here. */
export function planFromNames(i: number, relPath: string, size: number, subjects: KnownSubject[], maxBytes: number, years?: Years): PlanItem {
  const parts = relPath.split("/").filter(Boolean);
  const fileName = parts.pop() ?? relPath;
  const item: PlanItem = { i, path: parts, fileName, size, name: null, how: "", why: "", status: "review", evidence: 9 };
  if (size > maxBytes || size === 0) {
    item.status = "too_big";
    item.why = size === 0 ? "the file is empty" : "the file is larger than the library allows";
    return item;
  }
  const c = classifyFile(parts, fileName, subjects);
  const year = c.name ? parseCambridgeName(c.name)!.year : yearHint(parts, fileName);
  if (years && outsideYears(year, years)) {
    // Not read and not sent to the AI: the library does not keep this year.
    item.status = "outside";
    item.name = c.name;
    item.why = `from ${year}, outside the library years (${years.fromYear} to ${years.toYear})`;
    return item;
  }
  if (c.notKept) {
    // Its own Cambridge name gives a type the library does not keep: never read as another type.
    item.status = "not_needed";
    item.why = c.why;
    item.how = "Its Cambridge name";
    item.evidence = 0;
    return item;
  }
  item.name = c.name;
  if (c.name && c.why === "Cambridge file name") {
    item.how = "Already has its Cambridge name";
    item.evidence = 0;
  } else if (c.name) {
    item.how = "Worked out from its folder names";
    item.why = c.why;
    item.evidence = 1;
  } else item.why = c.why;
  return item;
}

/** Step 2: the first page. It names unclear files and wins over names that disagree with it. */
export function applyCover(item: PlanItem, cover: CoverReading, text: string, years?: Years): void {
  if (item.status === "too_big" || item.status === "outside" || item.status === "not_needed") return;
  if (cover.paperTitle) item.coverTitle = cover.paperTitle;
  if (!cover.name && years && outsideYears(cover.year, years)) {
    item.status = "outside";
    item.why = `its first page says ${cover.year}, outside the library years (${years.fromYear} to ${years.toYear})`;
    return;
  }
  if (cover.name) {
    if (!item.name) {
      item.name = cover.name;
      item.how = "Worked out from its first page";
      item.why = cover.why;
      item.evidence = 2;
    } else if (cover.name !== item.name) {
      item.renamedFrom = item.name;
      item.name = cover.name;
      item.how = "Worked out from its first page";
      item.why = cover.why;
      item.evidence = 2;
    }
    return;
  }
  const own = item.name ? parseCambridgeName(item.name) : null;
  if (own && cover.code && cover.code !== own.code) {
    item.name = null;
    item.status = "review";
    item.why = `the names say ${own.code} but the first page is for syllabus ${cover.code}`;
    return;
  }
  if (!item.name) {
    item.why = cover.empty ? `${item.why}; ${cover.why}` : cover.why;
    item.text = text ? text.slice(0, 3000) : undefined;
  }
}

/** Step 3: the AI's answer (its name is already checked against the subject's checklist). */
export function applyAi(item: PlanItem, v: { outcome?: string; name?: string; why?: string } | undefined, from: "first page" | "names"): void {
  if (!v || item.name || item.status === "outside") return;
  const why = String(v.why ?? "").slice(0, 160);
  if (v.outcome === "named" && v.name && parseCambridgeName(v.name)) {
    item.name = v.name;
    item.how = `Worked out by the AI from its ${from}`;
    item.why = why;
    item.evidence = 3;
  } else if (v.outcome === "not_needed") {
    item.status = "not_needed";
    item.why = `the AI read its ${from}: ${why}`;
  } else {
    item.why = `the AI read its ${from} and was not sure: ${why || "no reason given"}`;
    if (v.name && parseCambridgeName(v.name)) item.suggest = v.name;
  }
  delete item.text;
}

/** Step 4: each name against the library: new, already stored, outside the years, or a repeat. */
export function finalise(items: PlanItem[], o: { have: ReadonlySet<string>; codes: readonly string[]; fromYear: number; toYear: number }): void {
  for (const it of items) {
    delete it.text;
    if (it.status === "too_big" || it.status === "not_needed" || (it.status === "outside" && !it.name)) continue;
    const p = it.name ? parseCambridgeName(it.name) : null;
    // The AI recognised a Cambridge file the library does not keep: say what it is, plainly.
    const s = !p && it.suggest ? parseCambridgeName(it.suggest) : null;
    if (s && (s.year < o.fromYear || s.year > o.toYear)) {
      it.status = "outside";
      it.why = `the AI read it as ${it.suggest}, from ${s.year}, outside the library years (${o.fromYear} to ${o.toYear})`;
      continue;
    }
    if (!p) {
      it.status = "review";
      if (!it.why) it.why = "nothing in its names or first page says what it is";
      continue;
    }
    if (!o.codes.includes(p.code)) it.status = "unknown_subject";
    else if (p.year < o.fromYear || p.year > o.toYear) it.status = "outside";
    else if (o.have.has(p.fileName)) it.status = "have";
    else it.status = "new";
  }
  // The same name more than once: the best evidenced file is uploaded (its own name beats folder
  // names, the first page and the AI; then the first one met). An identical copy is a repeat;
  // a different file read as the same name goes to the owner instead of being dropped.
  const groups = new Map<string, PlanItem[]>();
  for (const it of items) if (it.status === "new") groups.set(it.name!, [...(groups.get(it.name!) ?? []), it]);
  for (const [name, list] of groups) {
    if (list.length < 2) continue;
    list.sort((a, b) => a.evidence - b.evidence || a.i - b.i);
    const keep = list[0]!;
    const where = (x: PlanItem) => [...x.path, x.fileName].join(" / ");
    for (const other of list.slice(1)) {
      if (other.size === keep.size) {
        other.status = "duplicate";
        other.dupOf = where(keep);
      } else if (other.evidence > keep.evidence) {
        other.status = "review";
        other.why = `read as ${name}, but ${where(keep)} is that file by ${keep.evidence === 0 ? "its own name" : "stronger evidence"}, and the two files differ`;
        other.name = null;
        other.suggest = name;
      } else {
        // Two different files with equally good reasons: the owner decides for both.
        for (const x of [keep, other]) {
          x.status = "review";
          x.why = `two different files are both read as ${name}: ${where(keep)} and ${where(other)}`;
          x.suggest = name;
        }
        keep.name = null;
        other.name = null;
      }
    }
  }
}

export const STATUS_WORDS: Record<PlanStatus, string> = {
  new: "To upload",
  have: "Already in the library",
  outside: "Outside the library years",
  unknown_subject: "Subject not in the library",
  review: "Needs your eye",
  not_needed: "Not needed",
  duplicate: "Same file twice in the folder",
  too_big: "Empty or too large",
};

/** Words compared loosely: case, punctuation and "and"/"&" do not matter. */
const looseName = (s: string) => s.toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, " ").trim();

export type TitleCheck = { versionId: string; paper: number; library: string; cover: string; example: string };

/**
 * Paper names the library has that the files' own covers contradict, one per version and
 * paper (older syllabus versions were seeded from the next one and may be wrong).
 */
export function paperTitleChecks(
  items: PlanItem[],
  papers: { syllabus_id: string; paper: number; name: string }[],
  versionOf: (fileName: string) => string | null,
): TitleCheck[] {
  const out = new Map<string, TitleCheck>();
  for (const it of items) {
    if (!it.name || !it.coverTitle) continue;
    const p = parseCambridgeName(it.name);
    if (!p || p.paper !== it.coverTitle.paper) continue;
    const versionId = versionOf(it.name);
    const lib = versionId ? papers.find((x) => x.syllabus_id === versionId && x.paper === p.paper) : undefined;
    if (!versionId || !lib) continue;
    const a = looseName(lib.name);
    const b = looseName(it.coverTitle.name);
    if (b.startsWith(a) || a.startsWith(b)) continue;
    const key = `${versionId}:${p.paper}`;
    if (!out.has(key)) out.set(key, { versionId, paper: p.paper, library: lib.name, cover: it.coverTitle.name, example: it.name });
  }
  return [...out.values()];
}
