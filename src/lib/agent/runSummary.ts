// The run summary, written by rules from the run's own counts (owner decision 4 Nov 2026,
// option A). The AI may only reword this draft; `checkRewrite()` throws its version away if it
// adds a number, drops one, or claims a limit the draft does not mention. Pure, Node and Worker.

export type SummaryFacts = {
  subject: string;
  mode: "dry" | "download";
  years: number[];
  sessions: string[];
  allSessions: boolean;
  websitePages: number;
  driveFolders: { name: string; error?: string; yearsHeld?: [number, number] | null; notOpened?: number; truncated?: boolean }[];
  driveOtherSubjects: number;
  found: number;
  have: number;
  outside: number;
  stored: number;
  failed: number;
  notNeeded: number;
  review: number;
  notNamed: number;
  maxFiles: number;
};

const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString("en-GB")} ${n === 1 ? one : many}`;

function yearsText(years: number[]): string {
  const ys = [...years].sort((a, b) => a - b);
  const run = ys.every((y, i) => i === 0 || y === ys[i - 1]! + 1);
  return ys.length > 2 && run ? `${ys[0]} to ${ys[ys.length - 1]}` : ys.join(", ");
}

export function ruleSummary(f: SummaryFacts): string {
  const out: string[] = [];
  const scope = `${f.subject}, ${yearsText(f.years)}, ${f.allSessions ? "all sessions" : f.sessions.join(", ")}`;
  out.push(`${f.mode === "dry" ? "Dry run" : "Download"} for ${scope}: found ${plural(f.found, "new file")}, and ${plural(f.have, "file")} ${f.have === 1 ? "was" : "were"} already in the library.`);

  const read: string[] = [];
  if (f.websitePages) read.push(plural(f.websitePages, "website page"));
  const ok = f.driveFolders.filter((d) => !d.error);
  if (ok.length) read.push(`the Google Drive folder${ok.length === 1 ? "" : "s"} ${ok.map((d) => d.name).join(", ")}`);
  if (read.length) {
    const held = ok.find((d) => d.yearsHeld)?.yearsHeld;
    const notOpened = ok.reduce((n, d) => n + (d.notOpened ?? 0), 0);
    out.push(`Read ${read.join(" and ")}${held ? `; the Drive copy holds ${held[0]} to ${held[1]}` : ""}${notOpened ? `; ${plural(notOpened, "folder")} outside this run ${notOpened === 1 ? "was" : "were"} not opened` : ""}.`);
  }
  for (const d of f.driveFolders.filter((x) => x.error)) out.push(`${d.name} could not be read.`);

  // Only real limits are named; otherwise the summary says plainly that nothing was cut short.
  const limits: string[] = [];
  if (f.driveFolders.some((d) => d.truncated)) limits.push("a Drive folder was larger than one run reads, so it stopped early");
  if (f.found > f.maxFiles) limits.push(`one download stores at most ${f.maxFiles} files, so run it again for the rest`);
  out.push(limits.length ? `Limits: ${limits.join("; ")}.` : "Nothing was cut short.");

  const leftovers = [
    f.review ? `${plural(f.review, "file")} need${f.review === 1 ? "s" : ""} your eye` : "",
    f.notNeeded ? `${plural(f.notNeeded, "file")} judged not needed` : "",
    f.notNamed ? `${plural(f.notNamed, "file")} could not be named` : "",
  ].filter(Boolean);
  if (leftovers.length) out.push(`${leftovers.join(", ")}.`.replace(/^./, (c) => c.toUpperCase()));

  if (f.mode === "dry") {
    out.push(f.found ? `Next: press Download to fetch the ${plural(f.found, "file")}.` : nothingNext(f));
  } else {
    out.push(`Stored ${plural(f.stored, "file")}${f.failed ? `; ${plural(f.failed, "file")} could not be stored, see the list below` : ""}.`);
    if (!f.found) out.push(nothingNext(f));
  }
  return out.join(" ");
}

function nothingNext(f: SummaryFacts): string {
  const held = f.driveFolders.find((d) => d.yearsHeld)?.yearsHeld;
  const beyond = held ? f.years.filter((y) => y > held[1]) : [];
  if (beyond.length) return `Next: no source has ${beyond.join(", ")} yet; try ${held![0] > 2022 ? held![0] : 2022} to ${held![1]}.`;
  return "Next: nothing to fetch for these years and sessions.";
}

/** The numbers in a text, as written ("1,638" and "1638" both read as 1638). */
const numbers = (s: string) => new Set([...s.matchAll(/\d[\d,]*/g)].map((m) => m[0].replace(/,/g, "")));

/**
 * Keeps the AI's rewording only when it says the same thing: every number of the draft and no
 * other, no talk of limits the draft does not have, plain text, no dashes, a sane length.
 */
export function checkRewrite(draft: string, text: unknown): string | null {
  if (typeof text !== "string") return null;
  const t = text.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s*[\u2013\u2014]\s*/g, ", ").replace(/\s+/g, " ").trim();
  if (t.length < 20 || t.length > Math.max(900, draft.length * 1.5)) return null;
  const a = numbers(draft);
  const b = numbers(t);
  if (a.size !== b.size || [...a].some((n) => !b.has(n))) return null;
  const limitWords = /\b(limit|limited|cut short|stopped early|more pages|read more)\b/i;
  if (limitWords.test(t) && !/Limits:/.test(draft)) {
    // The draft says "Nothing was cut short"; the rewrite may repeat that, never claim the opposite.
    if (!/nothing (was|got) cut short|no limits?/i.test(t) || /\blimited\b|more pages|read more/i.test(t)) return null;
  }
  return t;
}
