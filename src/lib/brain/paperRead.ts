// Stored paper readings and the fixes on the review screen (Phase 2, step 2b; owner 6 and 7 Nov 2026). The reading
// (items, figures), the PDF's page text and Gemini's reading are JSON in R2 FILES at papers/<doc id>/; the flags,
// what the admin settled and the override are the `paper_read` row; every fix is a `paper_fix` row that Undo reverses;
// "It's fine" adds a `paper_rule` for the subject. A paper is ready when no flag is open, or when the admin marked it
// ready anyway (override). Takes the database and bucket as parameters. No Next imports.
import type { Bucket, Db } from "../db.ts";
import { randomId } from "../auth/crypto.ts";
import { audit } from "../auth/session.ts";
import { BRAIN } from "../config.ts";
import { CLAUDE_MODEL_RE, GEMINI_MODEL_RE } from "./aiSetup.ts";
import { cleanArt, cleanBox, cropSvg, pageSvg, wholePage, type PageArt } from "./figures.ts";
import { stripLead } from "./notation.ts";
import { cleanPaper, editItem, holdsTable, isSplitFlag, type AutoHold, isStale, splitLeadIn, paperScore, storedScore, type PaperScore, marksAgainstPaper, openFlags, recheckItem, type Flag, type FlagKind, type PaperContent, type PaperItem, type PaperKind } from "./paper.ts";

export const PAPER_KINDS: readonly PaperKind[] = ["qp", "ms"];
const KINDS: readonly FlagKind[] = ["words", "numbers", "marks", "numbering", "figure", "agree", "missing", "text", "notation", "structure"];
const enc = new TextEncoder();

const key = (docId: string, part: "content" | "pages" | "gemini" | `art-${number}`) => `papers/${encodeURIComponent(docId)}/${part}.json`;

async function getJson(bucket: Bucket, k: string): Promise<unknown> {
  const obj = await bucket.get(k);
  if (!obj) return null;
  try {
    return JSON.parse(await new Response(obj.body).text());
  } catch {
    return null;
  }
}

async function putJson(bucket: Bucket, k: string, v: unknown): Promise<void> {
  await bucket.put(k, enc.encode(JSON.stringify(v)), { httpMetadata: { contentType: "application/json" } });
}

export async function loadContent(bucket: Bucket, docId: string, kind: PaperKind): Promise<PaperContent | null> {
  const v = await getJson(bucket, key(docId, "content"));
  return v ? cleanPaper(v, kind) : null;
}

export async function loadPages(bucket: Bucket, docId: string): Promise<string[]> {
  const v = await getJson(bucket, key(docId, "pages"));
  return Array.isArray(v) ? v.filter((p): p is string => typeof p === "string") : [];
}

const str = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/[\u0000-\u001f\u007f]/g, " ").slice(0, max) : "");

/** Flags from the script (or our own row) made safe. */
export function cleanFlags(v: unknown): Flag[] {
  return (Array.isArray(v) ? v : []).slice(0, BRAIN.maxPaperItems * 3).flatMap((x): Flag[] => {
    const o = x && typeof x === "object" ? (x as Record<string, unknown>) : {};
    const kind = KINDS.find((k) => k === o.kind);
    const fp = str(o.fingerprint, 16);
    if (!kind || !/^[0-9a-f]{8}$/.test(fp)) return [];
    const colour = o.colour === "red" || o.colour === "amber" || o.colour === "blue" ? o.colour : "amber";
    return [{ key: str(o.key, 80), item: str(o.item, 24), kind, colour, reason: str(o.reason, 300), pdfText: str(o.pdfText, BRAIN.maxItemText), fingerprint: fp, ...(typeof o.v === "number" && Number.isInteger(o.v) && o.v > 0 && o.v < 1000 ? { v: o.v } : {}) }];
  });
}

const list = (s: string | null) => {
  try {
    const v = JSON.parse(s ?? "[]") as unknown;
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
};

export type PaperRow = {
  docId: string; jobId: string | null; items: number; figures: number; flags: Flag[]; dismissed: string[]; revision: number;
  readAt: number | null; overrideAt: number | null; overrideBy: string | null;
  /** Marked as reviewed by a person (owner, 10 Nov 2026); counts only when after the last full reading. */
  reviewedAt: number | null; reviewedBy: string | null; firstAt: number | null;
  /** Read accuracy from the first full reading (estimated from the saved flags for papers read before it was kept). */
  score: PaperScore | null;
  /** One score per full reading with the models that read it, oldest first (owner, 8 Nov 2026: compare models). */
  scores: ReadScore[];
};

/** One full reading's accuracy: the AIs' own reading before it was merged with what was kept. */
export type ReadScore = { at: number; claude: string; gemini: string; score: PaperScore };

/** Stored per-reading scores made safe. Pure. */
export function cleanScores(v: unknown): ReadScore[] {
  const n = (x: unknown) => (typeof x === "number" && Number.isInteger(x) && x >= 0 ? x : null);
  return (Array.isArray(v) ? v : []).slice(-BRAIN.maxReadScores).flatMap((x): ReadScore[] => {
    const r = x && typeof x === "object" ? (x as Record<string, unknown>) : {};
    const at = n(r.at);
    const items = n(r.items), clean = n(r.clean), red = n(r.red);
    const score = items !== null && clean !== null && red !== null && clean <= items && red <= items ? storedScore(items, clean, red) : null;
    const claude = typeof r.claude === "string" && CLAUDE_MODEL_RE.test(r.claude) ? r.claude : "";
    const gemini = typeof r.gemini === "string" && GEMINI_MODEL_RE.test(r.gemini) ? r.gemini : "";
    return at !== null && score ? [{ at, claude, gemini, score }] : [];
  });
}

/**
 * When the last full reading was saved (a check run or a figure cut is not one): a person's change or "Mark as
 * reviewed" at or after it is a review of that reading. Pure.
 */
export function lastFullReading(scores: readonly { at: number }[], firstAt: number | null, readAt: number | null): number {
  return scores.at(-1)?.at ?? firstAt ?? readAt ?? 0;
}

/** Marked as reviewed and still standing: after the last full reading. Pure. */
export function markedReviewed(r: { reviewedAt: number | null; scores: readonly { at: number }[]; firstAt: number | null; readAt: number | null }): boolean {
  return r.reviewedAt !== null && r.reviewedAt >= lastFullReading(r.scores, r.firstAt, r.readAt);
}

/**
 * The script's own reading for the score (full readings only): each part's number and marks, and the flags it raised
 * by itself. Null when absent or not usable. Pure.
 */
function freshReading(v: unknown): { items: { number: string; marks: number | null }[]; flags: Flag[] } | null {
  const r = v && typeof v === "object" ? (v as Record<string, unknown>) : null;
  if (!r || !Array.isArray(r.items)) return null;
  const items = r.items.slice(0, BRAIN.maxPaperItems).flatMap((x) => {
    const o = x && typeof x === "object" ? (x as Record<string, unknown>) : {};
    const number = typeof o.number === "string" ? o.number.slice(0, 40) : "";
    const marks = typeof o.marks === "number" && Number.isInteger(o.marks) && o.marks >= 0 && o.marks <= 999 ? o.marks : null;
    return number ? [{ number, marks }] : [];
  });
  return items.length ? { items, flags: cleanFlags(r.flags) } : null;
}

/** A paper_read row's read accuracy: the stored first reading, else estimated from its saved flags. */
export function rowScore(r: { items: number; flags: string | Flag[]; read_at: number | null; first_items: number | null; first_clean: number | null; first_red: number | null }): PaperScore | null {
  if (!r.read_at) return null;
  return storedScore(r.first_items, r.first_clean, r.first_red) ?? paperScore(r.items, typeof r.flags === "string" ? cleanFlags(safeJson(r.flags)) : r.flags, true);
}

const safeJson = (s: string): unknown => {
  try {
    return JSON.parse(s);
  } catch {
    return [];
  }
};

export async function loadPaperRow(db: Db, docId: string): Promise<PaperRow | null> {
  const r = await db
    .prepare(`SELECT doc_id, job_id, items, figures, flags, dismissed, revision, read_at, override_at, override_by, first_items, first_clean, first_red, first_at, scores, reviewed_at, reviewed_by FROM paper_read WHERE doc_id = ?1`)
    .bind(docId)
    .first<{ doc_id: string; job_id: string | null; items: number; figures: number; flags: string; dismissed: string; revision: number; read_at: number | null; override_at: number | null; override_by: string | null; first_items: number | null; first_clean: number | null; first_red: number | null; first_at: number | null; scores: string; reviewed_at: number | null; reviewed_by: string | null }>();
  if (!r) return null;
  let flags: Flag[] = [];
  try {
    flags = cleanFlags(JSON.parse(r.flags));
  } catch {
    flags = [];
  }
  return {
    docId: r.doc_id, jobId: r.job_id, items: r.items, figures: r.figures, flags, dismissed: list(r.dismissed), revision: r.revision,
    readAt: r.read_at, overrideAt: r.override_at, overrideBy: r.override_by,
    reviewedAt: r.reviewed_at, reviewedBy: r.reviewed_by, firstAt: r.first_at,
    score: rowScore(r), scores: cleanScores(safeJson(r.scores)),
  };
}

export async function paperRules(db: Db, code: string): Promise<Set<string>> {
  const { results } = await db.prepare(`SELECT fingerprint FROM paper_rule WHERE code = ?1`).bind(code).all<{ fingerprint: string }>();
  return new Set(results.map((r) => r.fingerprint));
}

type DocInfo = { id: string; code: string; docType: string; fileName: string; syllabusId: string; year: number; session: string; paper: number | null; variant: number | null };

export async function paperDoc(db: Db, docId: string): Promise<DocInfo | null> {
  const r = await db
    .prepare(`SELECT d.id, d.doc_type, d.file_name, d.syllabus_id, d.year, d.session, d.paper, d.variant, y.code FROM source_document d JOIN syllabus y ON y.id = d.syllabus_id
              WHERE d.id = ?1 AND d.status = 'stored'`)
    .bind(docId)
    .first<{ id: string; doc_type: string; file_name: string; syllabus_id: string; year: number; session: string; paper: number | null; variant: number | null; code: string }>();
  return r ? { id: r.id, code: r.code, docType: r.doc_type, fileName: r.file_name, syllabusId: r.syllabus_id, year: r.year, session: r.session, paper: r.paper, variant: r.variant } : null;
}

/** The question paper a mark scheme belongs to (same name with qp), when it is stored. */
export async function pairedQp(db: Db, ms: DocInfo): Promise<string | null> {
  const name = ms.fileName.replace("_ms_", "_qp_");
  const r = await db.prepare(`SELECT id FROM source_document WHERE file_name = ?1 AND status = 'stored'`).bind(name).first<{ id: string }>();
  return r?.id ?? null;
}

export type PaperView = {
  row: PaperRow | null;
  content: PaperContent | null;
  /** All flags, with the mark scheme's marks checked against its question paper. */
  flags: Flag[];
  open: Flag[];
  ready: boolean;
  fixes: FixView[];
};

/**
 * One change on the paper, for the review screen's Changes list (owner, 9 Nov 2026: every change can be opened where
 * it was made): what was done in words, the part or figure, who, when, and the words before and after.
 */
export type FixView = {
  id: string; action: string; item: string | null; at: number; undone: boolean;
  what: string; who: string; before: string; after: string;
};

const FIX_WHAT: Record<string, string> = {
  pdf: "Used the PDF's version", edit: "Edited", fine: "Marked a flag as fine", looks_right: "Figure looks right", override: "Marked ready anyway",
};
const FLAG_KIND_WORDS: Record<string, string> = {
  words: "wording", numbers: "number", marks: "marks", numbering: "numbering", figure: "figure", agree: "Claude and Gemini differ",
  missing: "missing part", text: "unreadable text", notation: "notation", structure: "lead-in or table",
};

/** A stored fix in words, with its before and after text. Pure. */
export function fixView(r: { id: string; action: string; item: string | null; flag_key: string | null; before: string | null; after: string | null; at: number; undone_at: number | null }, who: string): FixView {
  const b = (safeJson(r.before ?? "{}") ?? {}) as Record<string, unknown>;
  const a = (safeJson(r.after ?? "{}") ?? {}) as Record<string, unknown>;
  const item = b.item && typeof b.item === "object" ? (b.item as Record<string, unknown>) : null;
  const text = (v: unknown) => (typeof v === "string" ? v.slice(0, 600) : "");
  let what = FIX_WHAT[r.action] ?? r.action;
  let before = "", after = "";
  if (b.figure && b.deleted === true) {
    const f = b.figure as Record<string, unknown>;
    what = `Deleted ${text(f.caption) || `figure ${text(f.id)}`}`;
  } else if (typeof b.unfigure === "string") {
    what = `Took figure ${b.unfigure} off this part`;
  } else if (b.figure) {
    what = "Moved the figure's box";
  } else if (r.action === "pdf" && typeof b.lead === "string") {
    what = `Gave question ${b.lead}'s lead-in its own part`;
    before = text(item?.text);
  } else if (r.action === "pdf" || r.action === "edit") {
    before = text(item?.text);
    after = text(a.text);
    if (r.action === "edit" && typeof a.marks === "number" && item && a.marks !== item.marks) what = `Edited (marks ${String(item.marks ?? "none")} to ${a.marks})`;
  } else if (r.action === "fine" && r.flag_key) {
    what = `Marked a ${FLAG_KIND_WORDS[r.flag_key.split(":")[0] ?? ""] ?? ""} flag as fine`.replace("a  flag", "a flag");
  } else if (r.action === "override" && typeof b.open === "number") {
    what = `Marked ready anyway with ${b.open} flag${b.open === 1 ? "" : "s"} open`;
  }
  return { id: r.id, action: r.action, item: r.item, at: r.at, undone: r.undone_at !== null, what, who, before, after };
}

/** Everything the review screen shows for one paper. */
export async function paperView(db: Db, bucket: Bucket, doc: DocInfo): Promise<PaperView> {
  const kind = doc.docType as PaperKind;
  const [row, rules] = await Promise.all([loadPaperRow(db, doc.id), paperRules(db, doc.code)]);
  const content = row?.readAt ? await loadContent(bucket, doc.id, kind) : null;
  let flags = row?.flags ?? [];
  if (content && kind === "ms") {
    const qpId = await pairedQp(db, doc);
    const qp = qpId ? await loadContent(bucket, qpId, "qp") : null;
    if (qp) flags = [...flags, ...marksAgainstPaper(content, qp)];
  }
  const open = openFlags(flags, new Set(row?.dismissed ?? []), rules);
  const { results } = await db
    .prepare(`SELECT f.id, f.action, f.item, f.flag_key, f.before, f.after, f.actor, f.at, f.undone_at, u.name AS member
              FROM paper_fix f LEFT JOIN "auth_user" u ON f.actor LIKE 'team:%' AND u.id = substr(f.actor, 6)
              WHERE f.doc_id = ?1 ORDER BY f.at DESC LIMIT 100`)
    .bind(doc.id)
    .all<{ id: string; action: string; item: string | null; flag_key: string | null; before: string | null; after: string | null; actor: string; at: number; undone_at: number | null; member: string | null }>();
  return {
    row, content, flags, open,
    ready: !!content && (open.length === 0 || !!row?.overrideAt),
    fixes: results.map((r) => fixView(r, r.actor === "platform-admin" ? "Owner" : r.actor === AUTO_ACTOR ? "Automatic fix" : r.member ?? (r.actor.startsWith("team:") ? "A team member" : r.actor))),
  };
}

export type SaveResult = "ok" | "no_run" | "bad" | "too_big";

/**
 * Saves a reading from the brain script (already merged with what was there, flags worked out). `final` closes the
 * run; a first save after Claude's reading keeps the run open for the drawings, so a failed drawing never loses it.
 */
export async function savePaperReading(db: Db, bucket: Bucket, jobId: string, docId: string, raw: Record<string, unknown>, final: boolean, now = Date.now(), closeRun = true): Promise<SaveResult> {
  const doc = await paperDoc(db, docId);
  if (!doc || !PAPER_KINDS.includes(doc.docType as PaperKind)) return "bad";
  const content = cleanPaper(raw.content, doc.docType as PaperKind);
  if (!content.items.length) return "bad";
  const body = JSON.stringify(content);
  if (body.length > BRAIN.maxPaperBytes) return "too_big";
  const flags = cleanFlags(raw.flags);
  const pages = Array.isArray(raw.pages) ? raw.pages.filter((p): p is string => typeof p === "string").slice(0, 500) : null;
  const row = await db
    .prepare(`UPDATE paper_read SET items = ?3, figures = ?4, flags = ?5, revision = revision + 1, read_at = ?6, updated_at = ?6
              WHERE doc_id = ?1 AND job_id = ?2 RETURNING doc_id`)
    .bind(docId, jobId, content.items.length, content.figures.length, JSON.stringify(flags), now)
    .first();
  if (!row) return "no_run";
  await putJson(bucket, key(docId, "content"), content);
  if (pages && pages.join("").length <= BRAIN.maxPaperBytes) await putJson(bucket, key(docId, "pages"), pages);
  if (raw.gemini) await putJson(bucket, key(docId, "gemini"), cleanPaper(raw.gemini, doc.docType as PaperKind));
  // The first full reading is kept as the paper's read accuracy (never a figures-only run, never overwritten). Each
  // full reading also adds its own score with the models that read it (owner, 8 Nov 2026: compare models), from the
  // AIs' reading before it was merged with what was kept. A mark scheme's marks against its question paper count.
  if (final && raw.read !== false) {
    const fresh = freshReading(raw.fresh);
    const parts = fresh ? fresh.items : content.items;
    let scoreFlags = fresh ? fresh.flags : flags;
    if (doc.docType === "ms") {
      const qpId = await pairedQp(db, doc);
      const qp = qpId ? await loadContent(bucket, qpId, "qp") : null;
      if (qp) scoreFlags = [...scoreFlags, ...marksAgainstPaper({ items: parts }, qp)];
    }
    const sc = paperScore(parts.length, scoreFlags);
    if (sc) await db.prepare(`UPDATE paper_read SET first_items = ?2, first_clean = ?3, first_red = ?4, first_at = ?5 WHERE doc_id = ?1 AND first_items IS NULL`).bind(docId, sc.items, sc.clean, sc.red, now).run();
    if (sc && fresh) {
      const m = raw.models && typeof raw.models === "object" ? (raw.models as Record<string, unknown>) : {};
      const stored = await db.prepare(`SELECT scores FROM paper_read WHERE doc_id = ?1`).bind(docId).first<{ scores: string }>();
      const list = (Array.isArray(safeJson(stored?.scores ?? "[]")) ? (safeJson(stored?.scores ?? "[]") as unknown[]) : []).slice(-(BRAIN.maxReadScores - 1));
      list.push({
        at: now, items: sc.items, clean: sc.clean, red: sc.red,
        claude: typeof m.claude === "string" && CLAUDE_MODEL_RE.test(m.claude) ? m.claude : "",
        gemini: typeof m.gemini === "string" && GEMINI_MODEL_RE.test(m.gemini) ? m.gemini : "",
      });
      await db.prepare(`UPDATE paper_read SET scores = ?2 WHERE doc_id = ?1`).bind(docId, JSON.stringify(list)).run();
    }
  }
  // Opening text the checks put right themselves, each recorded like a person's fix so Changes lists it with Undo.
  if (final && Array.isArray(raw.auto)) {
    for (const a of raw.auto.slice(0, BRAIN.maxPaperItems)) {
      const f = a && typeof a === "object" ? (a as Record<string, unknown>) : {};
      const flagKey = str(f.key, 80);
      const item = str(f.item, 24);
      const before = cleanPaper({ items: [f.before] }, doc.docType as PaperKind).items[0];
      if (!/^structure:/.test(flagKey) || !before || before.number !== item || !content.items.some((i) => i.number === item)) continue;
      const lead = typeof f.lead === "string" && content.items.some((i) => i.number === f.lead) ? f.lead : undefined;
      const gem = f.gemini ? cleanPaper({ items: [f.gemini] }, doc.docType as PaperKind).items[0] : undefined;
      const now2 = now + raw.auto.indexOf(a);
      await recordFix(db, docId, "pdf", item, flagKey, { item: before, ...(lead ? { lead } : {}), flags: cleanFlags(f.flags), merge: true, ...(gem ? { gemini: gem } : {}) },
        lead ? { lead } : { text: str(f.text, BRAIN.maxItemText), marks: before.marks }, AUTO_ACTOR, now2);
    }
  }
  if (final) {
    // A batch (Read all) stays open for its next paper; the script asks for it and the last one closes the run.
    if (closeRun) await db.prepare(`UPDATE job SET status = 'succeeded', progress = 100, finished_at = ?2, step = NULL WHERE id = ?1 AND type = 'brain' AND status = 'running'`).bind(jobId, now).run();
    await audit(db, { actorId: "brain", action: "brain.paper_saved", entity: "source_document", entityId: docId, detail: { items: content.items.length, figures: content.figures.length, flags: flags.length } }, now);
  }
  return "ok";
}

/** What the script needs to merge a new reading: the stored one, Gemini's, and the items with open flags. */
export async function readingForRun(db: Db, bucket: Bucket, doc: DocInfo): Promise<{ content: PaperContent | null; gemini: PaperContent | null; open: string[]; hold: AutoHold }> {
  const v = await paperView(db, bucket, doc);
  const g = v.content ? await getJson(bucket, key(doc.id, "gemini")) : null;
  return { content: v.content, gemini: g ? cleanPaper(g, doc.docType as PaperKind) : null, open: [...new Set(v.open.map((f) => f.item))], hold: await autoHold(db, doc) };
}

/**
 * What automatic fixes leave alone (owner, 10 Nov 2026): flags settled with "It's fine" (this paper or the subject),
 * automatic fixes a person undid, and parts a person edited or gave the PDF's words by hand.
 */
export async function autoHold(db: Db, doc: Pick<DocInfo, "id" | "code">): Promise<AutoHold> {
  const [row, rules, { results }] = await Promise.all([
    loadPaperRow(db, doc.id), paperRules(db, doc.code),
    db.prepare(`SELECT action, item, flag_key, before, actor, undone_at FROM paper_fix WHERE doc_id = ?1`).bind(doc.id)
      .all<{ action: string; item: string | null; flag_key: string | null; before: string | null; actor: string; undone_at: number | null }>(),
  ]);
  const byHand = (r: (typeof results)[number]) => {
    if (r.actor === AUTO_ACTOR || r.undone_at !== null || !r.item || (r.action !== "edit" && r.action !== "pdf")) return false;
    const b = (safeJson(r.before ?? "{}") ?? {}) as Record<string, unknown>;
    return !b.figure && typeof b.lead !== "string";
  };
  return {
    fingerprints: [...new Set([...(row?.dismissed ?? []), ...rules])],
    keys: results.filter((r) => r.actor === AUTO_ACTOR && r.undone_at !== null && r.flag_key).map((r) => r.flag_key!),
    items: [...new Set(results.filter(byHand).map((r) => r.item!))],
  };
}

// ---------- Fixes ----------

export type FixAction = "pdf" | "edit" | "fine" | "looks_right" | "box" | "unfigure" | "delfigure" | "override" | "unoverride" | "review" | "unreview" | "undo";
export type FixResult = "ok_fixed" | "ok_undone" | "ok_ready" | "ok_reviewed" | "ok_unreviewed" | "still_flagged" | "stale" | "has_table" | "bad" | "not_read";

/**
 * The flags after an Undo: as they were before the fix, or for an automatic fix (one of many in a run, `merge`) the
 * flags open now with the one it settled brought back.
 */
function undoFlags(now: readonly Flag[], before: Record<string, unknown>): Flag[] {
  const back = cleanFlags(before.flags);
  if (before.merge !== true) return back;
  const keys = new Set(back.map((f) => f.key));
  return [...now.filter((f) => !keys.has(f.key)), ...back];
}

/** An automatic fix also made in Gemini's reading (so the two compared like for like): Undo puts Gemini's part back. */
async function restoreGemini(bucket: Bucket, docId: string, kind: PaperKind, before: Record<string, unknown>, lead?: string) {
  if (!before.gemini) return;
  const old = cleanPaper({ items: [before.gemini] }, kind).items[0];
  const g = await getJson(bucket, key(docId, "gemini"));
  if (!old || !g) return;
  const gem = cleanPaper(g, kind);
  await putJson(bucket, key(docId, "gemini"), { ...gem, items: gem.items.filter((x) => !lead || x.number !== lead).map((x) => (x.number === old.number ? old : x)) });
}

/**
 * A lead-in split by hand made in Gemini's reading too, when Gemini has the part with that opening text joined on
 * (an exact cut, else nothing). Gives Gemini's part as it was, for Undo; null when nothing changed.
 */
async function splitGemini(bucket: Bucket, docId: string, kind: PaperKind, item: string, lead: string, leadText: string): Promise<PaperItem | null> {
  const g = await getJson(bucket, key(docId, "gemini"));
  if (!g) return null;
  const gem = cleanPaper(g, kind);
  const before = gem.items.find((x) => x.number === item);
  if (!before || gem.items.some((x) => x.number === lead)) return null;
  const rest = stripLead(before.text, leadText, item.match(/\([a-z]+\)/g) ?? []);
  const out = rest ? splitLeadIn(gem, item, lead, leadText) : null;
  if (!out) return null;
  await putJson(bucket, key(docId, "gemini"), { ...gem, items: out.items.map((x) => (x.number === item ? { ...x, text: rest! } : x)) });
  return before;
}

/** The actor of fixes the checks made themselves (owner, 10 Nov 2026), shown as "Automatic fix" with Undo. */
export const AUTO_ACTOR = "auto";

async function recordFix(db: Db, docId: string, action: string, item: string | null, flagKey: string | null, before: unknown, after: unknown, actorId: string, now: number) {
  const id = randomId();
  await db
    .prepare(`INSERT INTO paper_fix (id, doc_id, action, item, flag_key, before, after, actor, at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)`)
    .bind(id, docId, action, item, flagKey, before === undefined ? null : JSON.stringify(before), after === undefined ? null : JSON.stringify(after), actorId, now)
    .run();
  await audit(db, { actorId, action: `paper.${action}`, entity: "source_document", entityId: docId, detail: { item: item ?? "", fix: id } }, now);
}

async function writeRow(db: Db, docId: string, flags: Flag[], dismissed: string[], now: number) {
  await db.prepare(`UPDATE paper_read SET flags = ?2, dismissed = ?3, revision = revision + 1, updated_at = ?4 WHERE doc_id = ?1`)
    .bind(docId, JSON.stringify(flags), JSON.stringify(dismissed), now).run();
}

/**
 * One fix from the review screen. pdf: the item takes the PDF's own words for the flag (code copies them, no AI).
 * edit: the admin's wording and marks. Both are checked again against the PDF at once. fine: the flag is a false
 * alarm, remembered for this paper and as a rule for the subject. looks_right: a figure drawing is accepted.
 * override / unoverride: mark ready with flags left, or take that back. review / unreview: mark a paper with no flags
 * left as checked by a person, or take that back. unfigure: a figure taken off one part; delfigure: a figure that is
 * not in the paper deleted from the reading (owner, 11 Nov 2026: clean-up by hand on any part, flagged or not).
 * undo: reverses one earlier fix.
 */
export async function applyFix(db: Db, bucket: Bucket, doc: DocInfo, action: FixAction, args: { key?: string; item?: string; text?: string; marks?: string; fix?: string; box?: string; figure?: string }, actorId: string, now = Date.now()): Promise<FixResult> {
  const kind = doc.docType as PaperKind;
  const view = await paperView(db, bucket, doc);
  const row = view.row;
  if (!row || !view.content) return "not_read";
  const flag = args.key ? view.flags.find((f) => f.key === args.key) : undefined;
  switch (action) {
    case "pdf":
    case "edit": {
      // A flag from older checks keeps the text those checks found: run the checks again first (owner, 9 Nov 2026).
      if (action === "pdf" && flag && isStale(flag)) return "stale";
      // A lead-in joined to its first part (or left out): it becomes its own item before that part, in the paper's words.
      if (action === "pdf" && flag && isSplitFlag(flag)) {
        const parent = flag.key.split(":").at(-1) ?? "";
        const joined = view.content.items.find((x) => x.number === flag.item);
        if (joined && holdsTable(joined)) return "has_table";
        const content = splitLeadIn(view.content, flag.item, parent, flag.pdfText);
        if (!content || !flag.pdfText) return "bad";
        const pages = await loadPages(bucket, doc.id);
        const flags = recheckItem(content, row.flags, flag.item, pages);
        await putJson(bucket, key(doc.id, "content"), content);
        await writeRow(db, doc.id, flags, row.dismissed, now);
        const child = view.content.items.find((x) => x.number === flag.item);
        // The same split in Gemini's reading (as the automatic fix does), so the two are compared like for like.
        const gemini = await splitGemini(bucket, doc.id, kind, flag.item, parent, flag.pdfText);
        await recordFix(db, doc.id, "pdf", flag.item, flag.key, { item: child, lead: parent, flags: row.flags, ...(gemini ? { gemini } : {}) }, { lead: parent }, actorId, now);
        return "ok_fixed";
      }
      const number = action === "pdf" ? flag?.item : args.item;
      const it = view.content.items.find((x) => x.number === number);
      if (!it || !number) return "bad";
      const text = action === "pdf" ? flag?.pdfText ?? "" : (args.text ?? "").trim();
      if (!text || text.length > BRAIN.maxItemText) return "bad";
      let marks = it.marks;
      if (action === "edit" && args.marks !== undefined && args.marks.trim() !== "") {
        if (!/^\d{1,3}$/.test(args.marks.trim())) return "bad";
        marks = Number(args.marks.trim());
      }
      const content = editItem(view.content, number, text, marks);
      const pages = await loadPages(bucket, doc.id);
      const flags = recheckItem(content, row.flags, number, pages);
      await putJson(bucket, key(doc.id, "content"), content);
      await writeRow(db, doc.id, flags, row.dismissed, now);
      await recordFix(db, doc.id, action, number, args.key ?? null, { item: it, flags: row.flags }, { text, marks }, actorId, now);
      return flags.some((f) => f.item === number && (f.kind === "words" || f.kind === "numbers")) ? "still_flagged" : "ok_fixed";
    }
    case "fine":
    case "looks_right": {
      if (!flag || (action === "looks_right") !== (flag.kind === "figure")) return "bad";
      const dismissed = [...new Set([...row.dismissed, flag.fingerprint])];
      await writeRow(db, doc.id, row.flags, dismissed, now);
      if (action === "fine") {
        await db.prepare(`INSERT INTO paper_rule (code, fingerprint, reason, created_by, created_at) VALUES (?1, ?2, ?3, ?4, ?5) ON CONFLICT (code, fingerprint) DO NOTHING`)
          .bind(doc.code, flag.fingerprint, flag.reason, actorId, now).run();
      }
      await recordFix(db, doc.id, action, flag.item, flag.key, { fingerprint: flag.fingerprint }, undefined, actorId, now);
      return "ok_fixed";
    }
    case "box": {
      // A figure's box drawn by hand on its page (or "whole" for the printed page). Recorded as an edit of the figure
      // (paper_fix.action allows the 0022 values only), so Undo puts the old box and flags back.
      const fig = view.content.figures.find((f) => f.id === args.item);
      const art = fig ? await loadArt(bucket, doc.id, fig.page) : null;
      if (!fig || !art) return "bad";
      const b = args.box === "whole" ? wholePage(art) : cleanBox((args.box ?? "").split(",").map(Number), art);
      if (!b) return "bad";
      const moved = { ...fig, box: b, cut: args.box === "whole" ? ("page" as const) : ("manual" as const), svg: "" };
      const content = { ...view.content, figures: view.content.figures.map((f) => (f.id === fig.id ? moved : f)) };
      const flags = row.flags.filter((f) => !(f.kind === "figure" && f.item === fig.id));
      await putJson(bucket, key(doc.id, "content"), content);
      await writeRow(db, doc.id, flags, row.dismissed, now);
      await recordFix(db, doc.id, "edit", fig.id, args.key ?? null, { figure: fig, flags: row.flags }, { box: b }, actorId, now);
      return "ok_fixed";
    }
    case "unfigure": {
      // Recorded as an edit of the part (paper_fix.action allows the 0022 values only): Undo puts the part back.
      const it = view.content.items.find((x) => x.number === args.item);
      if (!it || !args.figure || !it.figures.includes(args.figure)) return "bad";
      const content = { ...view.content, items: view.content.items.map((x) => (x.number === it.number ? { ...x, figures: x.figures.filter((f) => f !== args.figure) } : x)) };
      await putJson(bucket, key(doc.id, "content"), content);
      await writeRow(db, doc.id, row.flags, row.dismissed, now);
      await recordFix(db, doc.id, "edit", it.number, null, { item: it, flags: row.flags, unfigure: args.figure }, { text: it.text, marks: it.marks }, actorId, now);
      return "ok_fixed";
    }
    case "delfigure": {
      const at = view.content.figures.findIndex((f) => f.id === args.figure);
      const fig = view.content.figures[at];
      if (!fig) return "bad";
      const parts = view.content.items.filter((x) => x.figures.includes(fig.id));
      const content = {
        ...view.content,
        figures: view.content.figures.filter((f) => f.id !== fig.id),
        items: view.content.items.map((x) => (x.figures.includes(fig.id) ? { ...x, figures: x.figures.filter((f) => f !== fig.id) } : x)),
      };
      const flags = row.flags.filter((f) => f.item !== fig.id);
      await putJson(bucket, key(doc.id, "content"), content);
      await writeRow(db, doc.id, flags, row.dismissed, now);
      await recordFix(db, doc.id, "edit", args.item && parts.some((x) => x.number === args.item) ? args.item : fig.id, null, { figure: fig, deleted: true, at, items: parts, flags: row.flags }, undefined, actorId, now);
      return "ok_fixed";
    }
    case "override": {
      if (!view.open.length) return "bad";
      await db.prepare(`UPDATE paper_read SET override_at = ?2, override_by = ?3, updated_at = ?2 WHERE doc_id = ?1`).bind(doc.id, now, actorId).run();
      await recordFix(db, doc.id, "override", null, null, { open: view.open.length }, undefined, actorId, now);
      return "ok_ready";
    }
    case "review": {
      // Mark as reviewed (owner, 10 Nov 2026): only with no flags left; kept on the row, not as a change to undo
      // (paper_fix.action allows the 0022 values only), and taken back with unreview.
      if (view.open.length) return "bad";
      await db.prepare(`UPDATE paper_read SET reviewed_at = ?2, reviewed_by = ?3, updated_at = ?2 WHERE doc_id = ?1`).bind(doc.id, now, actorId).run();
      await audit(db, { actorId, action: "paper.review", entity: "source_document", entityId: doc.id, detail: {} }, now);
      return "ok_reviewed";
    }
    case "unreview": {
      if (row.reviewedAt === null) return "bad";
      await db.prepare(`UPDATE paper_read SET reviewed_at = NULL, reviewed_by = NULL, updated_at = ?2 WHERE doc_id = ?1`).bind(doc.id, now).run();
      await audit(db, { actorId, action: "paper.unreview", entity: "source_document", entityId: doc.id, detail: {} }, now);
      return "ok_unreviewed";
    }
    case "unoverride":
    case "undo": {
      const fix = action === "unoverride"
        ? await db.prepare(`SELECT id, action, before FROM paper_fix WHERE doc_id = ?1 AND action = 'override' AND undone_at IS NULL ORDER BY at DESC LIMIT 1`).bind(doc.id).first<{ id: string; action: string; before: string | null }>()
        : await db.prepare(`SELECT id, action, before FROM paper_fix WHERE id = ?1 AND doc_id = ?2 AND undone_at IS NULL`).bind(args.fix ?? "", doc.id).first<{ id: string; action: string; before: string | null }>();
      if (!fix) return "bad";
      const before = fix.before ? (JSON.parse(fix.before) as Record<string, unknown>) : {};
      if (fix.action === "edit" && before.figure && before.deleted === true) {
        // A deleted figure comes back where it was, on the parts that had it.
        const old = cleanPaper({ items: Array.isArray(before.items) ? before.items : [], figures: [before.figure] }, kind);
        const fig = old.figures[0];
        if (!fig || view.content.figures.some((f) => f.id === fig.id)) return "bad";
        const figures = [...view.content.figures];
        figures.splice(Math.min(typeof before.at === "number" ? before.at : figures.length, figures.length), 0, fig);
        const parts = new Map(old.items.map((x) => [x.number, x]));
        const items = view.content.items.map((x) => (parts.has(x.number) && !x.figures.includes(fig.id) ? { ...x, figures: [...x.figures, fig.id] } : x));
        await putJson(bucket, key(doc.id, "content"), { ...view.content, figures, items });
        await writeRow(db, doc.id, undoFlags(row.flags, before), row.dismissed, now);
      } else if (fix.action === "edit" && before.figure) {
        const old = cleanPaper({ items: [], figures: [before.figure] }, kind).figures[0];
        if (!old) return "bad";
        const content = { ...view.content, figures: view.content.figures.map((x) => (x.id === old.id ? old : x)) };
        await putJson(bucket, key(doc.id, "content"), content);
        await writeRow(db, doc.id, undoFlags(row.flags, before), row.dismissed, now);
      } else if (fix.action === "pdf" && typeof before.lead === "string") {
        // A lead-in split: its item goes and the first part gets its old text back.
        const old = cleanPaper({ items: [before.item] }, kind).items[0];
        if (!old) return "bad";
        const content = { ...view.content, items: view.content.items.filter((x) => x.number !== before.lead).map((x) => (x.number === old.number ? old : x)) };
        await putJson(bucket, key(doc.id, "content"), content);
        await restoreGemini(bucket, doc.id, kind, before, before.lead);
        await writeRow(db, doc.id, undoFlags(row.flags, before), row.dismissed, now);
      } else if (fix.action === "pdf" || fix.action === "edit") {
        const old = cleanPaper({ items: [before.item] }, kind).items[0];
        if (!old) return "bad";
        const content = { ...view.content, items: view.content.items.map((x) => (x.number === old.number ? old : x)) };
        await putJson(bucket, key(doc.id, "content"), content);
        await restoreGemini(bucket, doc.id, kind, before);
        await writeRow(db, doc.id, undoFlags(row.flags, before), row.dismissed, now);
      } else if (fix.action === "fine" || fix.action === "looks_right") {
        const fp = typeof before.fingerprint === "string" ? before.fingerprint : "";
        await writeRow(db, doc.id, row.flags, row.dismissed.filter((d) => d !== fp), now);
        if (fix.action === "fine") await db.prepare(`DELETE FROM paper_rule WHERE code = ?1 AND fingerprint = ?2`).bind(doc.code, fp).run();
      } else if (fix.action === "override") {
        await db.prepare(`UPDATE paper_read SET override_at = NULL, override_by = NULL, updated_at = ?2 WHERE doc_id = ?1`).bind(doc.id, now).run();
      }
      await db.prepare(`UPDATE paper_fix SET undone_at = ?2 WHERE id = ?1`).bind(fix.id, now).run();
      await audit(db, { actorId, action: "paper.undo", entity: "source_document", entityId: doc.id, detail: { fix: fix.id, was: fix.action } }, now);
      return "ok_undone";
    }
  }
  return "bad";
}

// ---------- Figures cut from the PDF (figures.ts) ----------

export type ArtResult = "ok" | "no_run" | "bad" | "too_big";

/** One figure page's drawing from the brain script (a running paper run), kept for cutting and moving boxes. */
export async function saveArt(bucket: Bucket, docId: string, raw: unknown): Promise<ArtResult> {
  const art = cleanArt(raw);
  if (!art) return "bad";
  const body = JSON.stringify(art);
  if (body.length > BRAIN.maxArtBytes) return "too_big";
  await bucket.put(key(docId, `art-${art.page}`), enc.encode(body), { httpMetadata: { contentType: "application/json" } });
  return "ok";
}

export async function loadArt(bucket: Bucket, docId: string, page: number): Promise<PageArt | null> {
  if (!Number.isInteger(page) || page < 1 || page > 500) return null;
  return cleanArt(await getJson(bucket, key(docId, `art-${page}`)));
}

/** One figure for the review screen (served as an image): cut from its page by its box, else an older AI drawing. */
export async function figureSvg(bucket: Bucket, docId: string, kind: PaperKind, figureId: string): Promise<string | null> {
  const c = await loadContent(bucket, docId, kind);
  const f = c?.figures.find((x) => x.id === figureId);
  if (!f) return null;
  if (f.box) {
    const art = await loadArt(bucket, docId, f.page);
    if (art) return cropSvg(art, f.box);
  }
  return f.svg || null;
}

/** A figure's whole page with its current box framed, for drawing the box by hand. */
export async function figurePageSvg(bucket: Bucket, docId: string, kind: PaperKind, figureId: string): Promise<string | null> {
  const c = await loadContent(bucket, docId, kind);
  const f = c?.figures.find((x) => x.id === figureId);
  const art = f ? await loadArt(bucket, docId, f.page) : null;
  return art && f ? pageSvg(art, f.box) : null;
}
