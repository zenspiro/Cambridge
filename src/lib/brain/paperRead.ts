// Stored paper readings and the fixes on the review screen (Phase 2, step 2b; owner 6 and 7 Nov 2026). The reading
// (items, figures), the PDF's page text and Gemini's reading are JSON in R2 FILES at papers/<doc id>/; the flags,
// what the admin settled and the override are the `paper_read` row; every fix is a `paper_fix` row that Undo reverses;
// "It's fine" adds a `paper_rule` for the subject. A paper is ready when no flag is open, or when the admin marked it
// ready anyway (override). Takes the database and bucket as parameters. No Next imports.
import type { Bucket, Db } from "../db.ts";
import { randomId } from "../auth/crypto.ts";
import { audit } from "../auth/session.ts";
import { BRAIN } from "../config.ts";
import { cleanArt, cleanBox, cropSvg, pageSvg, wholePage, type PageArt } from "./figures.ts";
import { cleanPaper, editItem, paperScore, storedScore, type PaperScore, marksAgainstPaper, openFlags, recheckItem, type Flag, type FlagKind, type PaperContent, type PaperKind } from "./paper.ts";

export const PAPER_KINDS: readonly PaperKind[] = ["qp", "ms"];
const KINDS: readonly FlagKind[] = ["words", "numbers", "marks", "numbering", "figure", "agree", "missing", "text"];
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
    return [{ key: str(o.key, 80), item: str(o.item, 24), kind, colour, reason: str(o.reason, 300), pdfText: str(o.pdfText, BRAIN.maxItemText), fingerprint: fp }];
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
  /** Read accuracy from the first full reading (estimated from the saved flags for papers read before it was kept). */
  score: PaperScore | null;
};

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
    .prepare(`SELECT doc_id, job_id, items, figures, flags, dismissed, revision, read_at, override_at, override_by, first_items, first_clean, first_red FROM paper_read WHERE doc_id = ?1`)
    .bind(docId)
    .first<{ doc_id: string; job_id: string | null; items: number; figures: number; flags: string; dismissed: string; revision: number; read_at: number | null; override_at: number | null; override_by: string | null; first_items: number | null; first_clean: number | null; first_red: number | null }>();
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
    score: rowScore(r),
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
  fixes: { id: string; action: string; item: string | null; at: number; undone: boolean }[];
};

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
    .prepare(`SELECT id, action, item, at, undone_at FROM paper_fix WHERE doc_id = ?1 ORDER BY at DESC LIMIT 30`)
    .bind(doc.id)
    .all<{ id: string; action: string; item: string | null; at: number; undone_at: number | null }>();
  return {
    row, content, flags, open,
    ready: !!content && (open.length === 0 || !!row?.overrideAt),
    fixes: results.map((r) => ({ id: r.id, action: r.action, item: r.item, at: r.at, undone: r.undone_at !== null })),
  };
}

export type SaveResult = "ok" | "no_run" | "bad" | "too_big";

/**
 * Saves a reading from the brain script (already merged with what was there, flags worked out). `final` closes the
 * run; a first save after Claude's reading keeps the run open for the drawings, so a failed drawing never loses it.
 */
export async function savePaperReading(db: Db, bucket: Bucket, jobId: string, docId: string, raw: Record<string, unknown>, final: boolean, now = Date.now()): Promise<SaveResult> {
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
  // The first full reading is kept as the paper's read accuracy (never a figures-only run, never overwritten).
  if (final && raw.read !== false) {
    const sc = paperScore(content.items.length, flags);
    if (sc) await db.prepare(`UPDATE paper_read SET first_items = ?2, first_clean = ?3, first_red = ?4, first_at = ?5 WHERE doc_id = ?1 AND first_items IS NULL`).bind(docId, sc.items, sc.clean, sc.red, now).run();
  }
  if (final) {
    await db.prepare(`UPDATE job SET status = 'succeeded', progress = 100, finished_at = ?2, step = NULL WHERE id = ?1 AND type = 'brain' AND status = 'running'`).bind(jobId, now).run();
    await audit(db, { actorId: "brain", action: "brain.paper_saved", entity: "source_document", entityId: docId, detail: { items: content.items.length, figures: content.figures.length, flags: flags.length } }, now);
  }
  return "ok";
}

/** What the script needs to merge a new reading: the stored one, Gemini's, and the items with open flags. */
export async function readingForRun(db: Db, bucket: Bucket, doc: DocInfo): Promise<{ content: PaperContent | null; gemini: PaperContent | null; open: string[] }> {
  const v = await paperView(db, bucket, doc);
  const g = v.content ? await getJson(bucket, key(doc.id, "gemini")) : null;
  return { content: v.content, gemini: g ? cleanPaper(g, doc.docType as PaperKind) : null, open: [...new Set(v.open.map((f) => f.item))] };
}

// ---------- Fixes ----------

export type FixAction = "pdf" | "edit" | "fine" | "looks_right" | "box" | "override" | "unoverride" | "undo";
export type FixResult = "ok_fixed" | "ok_undone" | "ok_ready" | "still_flagged" | "bad" | "not_read";

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
 * override / unoverride: mark ready with flags left, or take that back. undo: reverses one earlier fix.
 */
export async function applyFix(db: Db, bucket: Bucket, doc: DocInfo, action: FixAction, args: { key?: string; item?: string; text?: string; marks?: string; fix?: string; box?: string }, actorId: string, now = Date.now()): Promise<FixResult> {
  const kind = doc.docType as PaperKind;
  const view = await paperView(db, bucket, doc);
  const row = view.row;
  if (!row || !view.content) return "not_read";
  const flag = args.key ? view.flags.find((f) => f.key === args.key) : undefined;
  switch (action) {
    case "pdf":
    case "edit": {
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
    case "override": {
      if (!view.open.length) return "bad";
      await db.prepare(`UPDATE paper_read SET override_at = ?2, override_by = ?3, updated_at = ?2 WHERE doc_id = ?1`).bind(doc.id, now, actorId).run();
      await recordFix(db, doc.id, "override", null, null, { open: view.open.length }, undefined, actorId, now);
      return "ok_ready";
    }
    case "unoverride":
    case "undo": {
      const fix = action === "unoverride"
        ? await db.prepare(`SELECT id, action, before FROM paper_fix WHERE doc_id = ?1 AND action = 'override' AND undone_at IS NULL ORDER BY at DESC LIMIT 1`).bind(doc.id).first<{ id: string; action: string; before: string | null }>()
        : await db.prepare(`SELECT id, action, before FROM paper_fix WHERE id = ?1 AND doc_id = ?2 AND undone_at IS NULL`).bind(args.fix ?? "", doc.id).first<{ id: string; action: string; before: string | null }>();
      if (!fix) return "bad";
      const before = fix.before ? (JSON.parse(fix.before) as Record<string, unknown>) : {};
      if (fix.action === "edit" && before.figure) {
        const old = cleanPaper({ items: [], figures: [before.figure] }, kind).figures[0];
        if (!old) return "bad";
        const content = { ...view.content, figures: view.content.figures.map((x) => (x.id === old.id ? old : x)) };
        await putJson(bucket, key(doc.id, "content"), content);
        await writeRow(db, doc.id, cleanFlags(before.flags), row.dismissed, now);
      } else if (fix.action === "pdf" || fix.action === "edit") {
        const old = cleanPaper({ items: [before.item] }, kind).items[0];
        if (!old) return "bad";
        const content = { ...view.content, items: view.content.items.map((x) => (x.number === old.number ? old : x)) };
        await putJson(bucket, key(doc.id, "content"), content);
        await writeRow(db, doc.id, cleanFlags(before.flags), row.dismissed, now);
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
