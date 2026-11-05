// The Sources page, per subject: which source pages and Google Drive folders belong to which
// subject, and what each Cambridge page offers (from its last scan) against the library. Pure.
import { toCambridgeName } from "../agent/links.ts";
import { summariseFiles } from "./summary.ts";

export type ScanFile = { url: string; name: string | null; have: boolean };
export type ScanSummary = { files: ScanFile[]; total: number; have: number; missing: string[]; missingText: string; unnamed: number };

/** Each PDF a Cambridge page links to, as its Cambridge name, and whether the library has it. */
export function scanSummary(linksJson: string, code: string, have: ReadonlySet<string>): ScanSummary {
  let links: string[] = [];
  try {
    const v = JSON.parse(linksJson) as unknown;
    if (Array.isArray(v)) links = v.filter((x): x is string => typeof x === "string").slice(0, 500);
  } catch {
    links = [];
  }
  const files = links.map((url) => {
    const name = toCambridgeName(url, code);
    return { url, name, have: !!name && have.has(name) };
  });
  const missing = files.filter((f) => f.name && !f.have).map((f) => f.name!);
  return {
    files, total: files.length, have: files.filter((f) => f.have).length, missing,
    missingText: summariseFiles(missing, 3), unnamed: files.filter((f) => !f.name).length,
  };
}

/** The subject a Google Drive folder belongs to, from its label ("IGCSE Physics (0625)"). */
export function folderCode(label: string, codes: readonly string[]): string | null {
  for (const m of label.matchAll(/\((\d{4})\)/g)) if (codes.includes(m[1]!)) return m[1]!;
  return null;
}

/** "Past papers page" or "Subject page" for a Cambridge start page; else the address's last part. */
export function pageKind(url: string): string {
  if (/\/past-papers\/?$/.test(url)) return "Past papers page";
  if (/\/programmes-and-qualifications\/[^/]+\/?$/.test(url)) return "Subject page";
  return "Start page";
}
