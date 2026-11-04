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
  why: string;
  status: PlanStatus;
  /** The name the file and folder names gave, when the first page said otherwise. */
  renamedFrom?: string;
  /** A name the AI thought of that the library does not ask for. */
  suggest?: string;
  /** The first page's text, kept only while the AI may still be asked. */
  text?: string;
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
  const item: PlanItem = { i, path: parts, fileName, size, name: null, how: "", why: "", status: "review" };
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
  item.name = c.name;
  item.why = c.why;
  item.how = c.name ? (c.why === "Cambridge file name" ? "its file name" : "its file and folder names") : "";
  return item;
}

/** Step 2: the first page. It names unclear files and wins over names that disagree with it. */
export function applyCover(item: PlanItem, cover: CoverReading, text: string, years?: Years): void {
  if (item.status === "too_big" || item.status === "outside") return;
  if (!cover.name && years && outsideYears(cover.year, years)) {
    item.status = "outside";
    item.why = `its first page says ${cover.year}, outside the library years (${years.fromYear} to ${years.toYear})`;
    return;
  }
  if (cover.name) {
    if (!item.name) {
      item.name = cover.name;
      item.how = "its first page";
      item.why = cover.why;
    } else if (cover.name !== item.name) {
      item.renamedFrom = item.name;
      item.name = cover.name;
      item.how = "its first page (the names said otherwise)";
      item.why = cover.why;
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
    item.how = `the AI, from its ${from}`;
    item.why = why;
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
  const seen = new Set<string>();
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
    else if (seen.has(p.fileName)) it.status = "duplicate";
    else it.status = "new";
    seen.add(p.fileName);
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
