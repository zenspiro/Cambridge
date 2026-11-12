// Read all (owner, 8 Nov 2026): which question papers and mark schemes a batch reads, and each session's reading
// status (red, amber, green) for the subject map. Pure: built from the checklist, the papers table and what is read.
import type { Checklist, PaperRow } from "../library/checklist.ts";
import type { Paper } from "../library/papers.ts";
import type { Db } from "../db.ts";
import { BRAIN } from "../config.ts";
import { cleanFlags } from "./paperRead.ts";

/** A paper's reading: not read yet, read with flags still open, or ready (no open flags, or marked ready anyway). */
export type ReadState = "unread" | "flagged" | "ready";
export type Rag = "red" | "amber" | "green";
export type ReadTier = "core" | "extended" | "any";
export type ReadFilter = { tier: ReadTier; session: "m" | "s" | "w" | null; year: number | null };
export type BatchDoc = { docId: string; fileName: string; docType: "qp" | "ms"; year: number; session: "m" | "s" | "w"; paper: number; variant: number | null; bytes: number; syllabusId: string };
export type BatchPlan = {
  /** Stored and not read yet, newest session first, each question paper before its mark scheme. */
  toRead: BatchDoc[];
  /** Read already (skipped). */
  read: number;
  /** Not in the library, so they cannot be read. */
  missing: number;
  /** More than one batch takes: the rest are left for the next one. */
  over: number;
};

const KINDS = ["qp", "ms"] as const;

/** A row's question paper and mark scheme cells that are stored. */
const storedCells = (r: PaperRow) => KINDS.flatMap((k) => (r.cells[k]?.doc ? [{ kind: k, cell: r.cells[k]! }] : []));

/** Red, amber or green for a set of stored papers; null when none is stored (nothing to read). */
export function ragOf(docIds: readonly string[], state: ReadonlyMap<string, ReadState>): Rag | null {
  if (!docIds.length) return null;
  const s = docIds.map((id) => state.get(id) ?? "unread");
  if (s.every((x) => x === "ready")) return "green";
  if (s.every((x) => x === "unread")) return "red";
  return "amber";
}

/** The stored question papers and mark schemes on one map row (its own papers only). */
export function rowDocIds(cells: Partial<Record<string, { doc: { id: string } | null } | undefined>>): string[] {
  return Object.entries(cells).flatMap(([key, c]) => (/:(qp|ms)$/.test(key) && c?.doc ? [c.doc.id] : []));
}

/** Whether a paper belongs to the tier asked for. Papers sat by both (practicals) count for Core and Extended. */
export const inTier = (tier: Paper["tier"] | null | undefined, want: ReadTier) => want === "any" || tier === want || tier === "all";

/** Whether a subject's papers are split into Core and Extended (else one "Read all" button). */
export const hasTiers = (papers: readonly Paper[]) => papers.some((p) => p.tier === "core" || p.tier === "extended");

/** What a Read all would read: essential variants only, inside the filter, skipping what is read already. */
export function planBatch(list: Checklist, papers: readonly Paper[], filter: ReadFilter, state: ReadonlyMap<string, ReadState>, max: number = BRAIN.maxBatchPapers): BatchPlan {
  const all: BatchDoc[] = [];
  let read = 0, missing = 0;
  for (const s of list.sessions) {
    if (filter.session && s.session !== filter.session) continue;
    if (filter.year && s.year !== filter.year) continue;
    const own = papers.filter((p) => p.syllabus_id === s.versionId);
    const rows = s.rows.filter((r) => r.essential && inTier(own.find((p) => p.paper === r.paper)?.tier, filter.tier));
    rows.sort((a, b) => a.paper - b.paper || (a.variant ?? 0) - (b.variant ?? 0) || (a.series ?? "").localeCompare(b.series ?? ""));
    for (const r of rows) {
      for (const k of KINDS) {
        const c = r.cells[k];
        if (!c) continue;
        if (!c.doc) {
          missing++;
          continue;
        }
        if ((state.get(c.doc.id) ?? "unread") !== "unread") {
          read++;
          continue;
        }
        all.push({ docId: c.doc.id, fileName: c.fileName, docType: k, year: s.year, session: s.session, paper: r.paper, variant: r.variant, bytes: c.doc.size_bytes, syllabusId: s.versionId });
      }
    }
  }
  return { toRead: all.slice(0, max), read, missing, over: Math.max(0, all.length - max) };
}

/** Each stored paper's reading state for one subject (rules for "It's fine" count as dismissed). */
export async function readStates(db: Db, code: string): Promise<Map<string, ReadState>> {
  const [{ results }, rules] = await Promise.all([
    db.prepare(`SELECT p.doc_id, p.flags, p.dismissed, p.read_at, p.override_at FROM paper_read p JOIN source_document d ON d.id = p.doc_id
                WHERE d.syllabus_id LIKE ?1`)
      .bind(`${code}-%`)
      .all<{ doc_id: string; flags: string; dismissed: string; read_at: number | null; override_at: number | null }>(),
    db.prepare(`SELECT fingerprint FROM paper_rule WHERE code = ?1`).bind(code).all<{ fingerprint: string }>(),
  ]);
  const ruled = new Set(rules.results.map((r) => r.fingerprint));
  const parse = (s: string): unknown => {
    try {
      return JSON.parse(s);
    } catch {
      return [];
    }
  };
  const map = new Map<string, ReadState>();
  for (const r of results) map.set(r.doc_id, stateOf(r.read_at, r.override_at, cleanFlags(parse(r.flags)).map((f) => f.fingerprint), parse(r.dismissed), ruled));
  return map;
}

/** One paper's state from its row. Pure. */
export function stateOf(readAt: number | null, overrideAt: number | null, fingerprints: readonly string[], dismissed: unknown, ruled: ReadonlySet<string>): ReadState {
  if (!readAt) return "unread";
  if (overrideAt) return "ready";
  const gone = new Set(Array.isArray(dismissed) ? dismissed.filter((x): x is string => typeof x === "string") : []);
  return fingerprints.some((f) => !gone.has(f) && !ruled.has(f)) ? "flagged" : "ready";
}

/** The batch's words for a page: "Extended papers, Nov 2025". */
export function filterWords(f: ReadFilter, sessionLabels: Readonly<Record<string, string>>): string {
  const what = f.tier === "core" ? "Core papers" : f.tier === "extended" ? "Extended papers" : "All papers";
  const when = [f.session ? sessionLabels[f.session] : "every session", f.year ? String(f.year) : f.session ? "every year" : ""].filter(Boolean).join(" ");
  return `${what}, ${f.session || f.year ? when : "every session"}`;
}

/** The Read all choice from a page's query or a form (`ra` tier, `ras` month, `ray` year); null when none is made. */
export function readFilter(get: (k: string) => string | null | undefined, years: readonly number[]): ReadFilter | null {
  const t = get("ra");
  const tier = t === "core" || t === "extended" || t === "any" ? t : null;
  if (!tier) return null;
  const s = get("ras");
  const session = s === "m" || s === "s" || s === "w" ? s : null;
  const y = Number(get("ray"));
  return { tier, session, year: years.includes(y) ? y : null };
}

/** The query that shows a Read all choice on the subject overview. */
export const filterQuery = (f: ReadFilter) => `ra=${f.tier}${f.session ? `&ras=${f.session}` : ""}${f.year ? `&ray=${f.year}` : ""}`;

/** `stored`: every benchmark paper of the subject in the library, for reading them again for the score. */
export type BenchPlan = { toRead: BatchDoc[]; read: number; missing: number; stored: BatchDoc[] };

/**
 * The subject's benchmark papers (src/lib/brain/benchmark.ts) not read yet, for "Read the benchmark papers" (owner,
 * 11 Nov 2026): a Read all of just those, so the benchmark can be scored without reading every paper of a session.
 */
export async function planBenchmark(db: Db, files: readonly string[], state: ReadonlyMap<string, ReadState>): Promise<BenchPlan> {
  if (!files.length) return { toRead: [], read: 0, missing: 0, stored: [] };
  const { results } = await db
    .prepare(`SELECT id, file_name, doc_type, year, session, paper, variant, size_bytes, syllabus_id FROM source_document
              WHERE status = 'stored' AND file_name IN (${files.map((_, i) => `?${i + 1}`).join(",")})`)
    .bind(...files)
    .all<{ id: string; file_name: string; doc_type: string; year: number; session: string; paper: number | null; variant: number | null; size_bytes: number; syllabus_id: string }>();
  const toRead: BatchDoc[] = [];
  const stored: BatchDoc[] = [];
  let read = 0;
  // In the set's own order: each question paper before its mark scheme.
  for (const f of files) {
    const r = results.find((x) => x.file_name === f);
    if (!r || (r.doc_type !== "qp" && r.doc_type !== "ms")) continue;
    const d: BatchDoc = { docId: r.id, fileName: r.file_name, docType: r.doc_type, year: r.year, session: r.session as BatchDoc["session"], paper: r.paper ?? 0, variant: r.variant, bytes: r.size_bytes, syllabusId: r.syllabus_id };
    stored.push(d);
    if ((state.get(r.id) ?? "unread") !== "unread") {
      read++;
      continue;
    }
    toRead.push(d);
  }
  return { toRead: toRead.slice(0, BRAIN.maxBatchPapers), read, missing: files.length - results.length, stored: stored.slice(0, BRAIN.maxBatchPapers) };
}
