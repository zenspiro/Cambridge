// Documents (owner, 10 Nov 2026): every stored file of a subject, or of every subject, in one table with its own
// filter per column: year, month, type, paper, format, tier, variant, the AI's read accuracy and the review by a
// person. Examiner reports, grade thresholds and the rest are listed too ("Not readable yet" until they are read).
// Pure helpers plus one loader; no Next imports.
import type { Db } from "../db.ts";
import { docTypeLabel, SESSION_LABELS } from "../config.ts";
import { cleanFlags, cleanScores, lastFullReading, rowScore } from "../brain/paperRead.ts";
import { openFlags, type PaperScore } from "../brain/paper.ts";
import { modelName } from "../brain/labels.ts";
import { listSubjects } from "./catalog.ts";
import { FORMAT_LABELS, TIER_LABELS, type Paper } from "./papers.ts";

/** A person's review of a read paper, in its own column beside the AI's score. */
export type ReviewStatus = "needs" | "reviewed" | "ready" | "override" | "unread" | "unreadable";
export const REVIEW_WORDS: Record<ReviewStatus, string> = {
  needs: "Needs review",
  reviewed: "Reviewed",
  ready: "Ready, not checked by a person",
  override: "Marked ready anyway",
  unread: "Not read yet",
  unreadable: "Not readable yet",
};
export type ScoreBand = "green" | "amber" | "red" | "none";
export const SCORE_WORDS: Record<ScoreBand, string> = { green: "Green", amber: "Amber", red: "Red", none: "Not read" };

export type DocRow = {
  id: string; code: string; subject: string; fileName: string;
  year: number; session: string; type: string; typeLabel: string;
  paper: number | null; paperName: string; format: string; tier: string; variant: number | null;
  score: PaperScore | null; models: string; status: ReviewStatus; open: number;
  reviewer: string; reviewerName: string; reviewedAt: number | null; readAt: number | null;
  /** Order on the paper's own terms: year, session, paper, variant, type. */
  order: string;
};

/** Read and reviewed on the review screen: question papers and mark schemes (examiner reports come with step 2c). */
const READABLE = new Set(["qp", "ms"]);
const SESSION_ORDER: Record<string, number> = { y: 0, m: 1, s: 2, w: 3 };
/** A paper's files in the order they are used: question paper, insert, mark scheme, then the rest. */
const TYPE_ORDER = ["qp", "in", "ms", "ci", "pm", "qr", "tn", "er", "gt", "sy", "su", "gd", "sp", "sm"];

export type RawDoc = {
  id: string; syllabus_id: string; session: string; year: number; paper: number | null; variant: number | null; doc_type: string; file_name: string;
  items: number | null; flags: string | null; dismissed: string | null; read_at: number | null; override_at: number | null;
  first_items: number | null; first_clean: number | null; first_red: number | null; first_at: number | null; scores: string | null;
  /** Mark as reviewed (owner, 10 Nov 2026), with the team member's name when it was one. */
  reviewed_at?: number | null; reviewed_by?: string | null; reviewed_name?: string | null;
};
export type PersonFix = { doc_id: string; actor: string; at: number; name: string };

const json = (s: string | null): unknown => {
  try {
    return JSON.parse(s ?? "null");
  } catch {
    return null;
  }
};

/**
 * One row from the database's own facts. Review status: open flags left (needs review, or marked ready anyway), no
 * flags left with a person's change or Mark as reviewed since the last full reading (reviewed) or without one (ready, not checked by a
 * person); automatic fixes are not a review. Pure.
 */
export function docRow(d: RawDoc, subjects: readonly { code: string; label: string }[], papers: readonly Pick<Paper, "syllabus_id" | "paper" | "name" | "format" | "tier">[],
  rules: ReadonlySet<string>, lastFix: PersonFix | undefined, lastPersonAt: number | null): DocRow {
  const code = d.syllabus_id.split("-")[0] ?? d.syllabus_id;
  const p = d.paper ? papers.find((x) => x.syllabus_id === d.syllabus_id && x.paper === d.paper) : undefined;
  const readable = READABLE.has(d.doc_type);
  const read = readable && d.read_at !== null;
  const flags = read ? cleanFlags(json(d.flags)) : [];
  const dismissed = new Set(Array.isArray(json(d.dismissed)) ? (json(d.dismissed) as unknown[]).filter((x): x is string => typeof x === "string") : []);
  const open = read ? openFlags(flags, dismissed, rules).length : 0;
  const scores = cleanScores(json(d.scores));
  // The last full reading (a check run or a figure cut is not one): a person's change after it is a review of it.
  const lastFull = lastFullReading(scores, d.first_at, d.read_at);
  // Mark as reviewed counts like a change by that person; the later of the two is the last review.
  const mark: PersonFix | undefined = d.reviewed_at != null && d.reviewed_by
    ? { doc_id: d.id, actor: d.reviewed_by, at: d.reviewed_at, name: personName(d.reviewed_by, d.reviewed_name ?? null) } : undefined;
  if (mark && (lastFix === undefined || mark.at >= lastFix.at)) {
    lastFix = mark;
    lastPersonAt = mark.at;
  }
  const status: ReviewStatus = !readable ? "unreadable" : !read ? "unread"
    : open > 0 ? (d.override_at ? "override" : "needs")
    : lastPersonAt !== null && lastPersonAt >= lastFull ? "reviewed" : "ready";
  const first = scores[0];
  const models = first ? [first.claude ? modelName(first.claude) : "", first.gemini ? modelName(first.gemini) : ""].filter(Boolean).join(" with ") : "";
  return {
    id: d.id, code, subject: subjects.find((s) => s.code === code)?.label ?? code, fileName: d.file_name,
    year: d.year, session: d.session, type: d.doc_type, typeLabel: docTypeLabel(d.doc_type),
    paper: d.paper, paperName: d.paper ? (p ? `${d.paper} ${p.name}` : String(d.paper)) : "",
    format: p ? FORMAT_LABELS[p.format] : "", tier: p ? TIER_LABELS[p.tier] : "", variant: d.variant,
    score: read ? rowScore({ items: d.items ?? 0, flags: flags, read_at: d.read_at, first_items: d.first_items, first_clean: d.first_clean, first_red: d.first_red }) : null,
    models, status, open,
    reviewer: lastFix?.actor ?? "", reviewerName: lastFix?.name ?? "", reviewedAt: lastFix?.at ?? null, readAt: read ? d.read_at : null,
    order: `${String(9999 - d.year).padStart(4, "0")}${SESSION_ORDER[d.session] ?? 9}${String(d.paper ?? 0).padStart(2, "0")}${d.variant ?? 0}${String(TYPE_ORDER.indexOf(d.doc_type) + 1 || 99).padStart(2, "0")}${d.doc_type}`,
  };
}

/** Every stored file of these subjects (null: all), with its reading and review. */
export async function loadDocRows(db: Db, codes: readonly string[] | null): Promise<DocRow[]> {
  const like = codes && codes.length === 1 ? `${codes[0]}-%` : "%";
  const [docs, paperRows, ruleRows, fixRows, subjects] = await Promise.all([
    db.prepare(`SELECT d.id, d.syllabus_id, d.session, d.year, d.paper, d.variant, d.doc_type, d.file_name,
                       p.items, p.flags, p.dismissed, p.read_at, p.override_at, p.first_items, p.first_clean, p.first_red, p.first_at, p.scores,
                       p.reviewed_at, p.reviewed_by, r.name AS reviewed_name
                FROM source_document d LEFT JOIN paper_read p ON p.doc_id = d.id
                LEFT JOIN "auth_user" r ON p.reviewed_by LIKE 'team:%' AND r.id = substr(p.reviewed_by, 6)
                WHERE d.status = 'stored' AND d.syllabus_id LIKE ?1`).bind(like).all<RawDoc>(),
    db.prepare(`SELECT syllabus_id, paper, name, format, tier FROM syllabus_paper`).bind().all<Pick<Paper, "syllabus_id" | "paper" | "name" | "format" | "tier">>(),
    db.prepare(`SELECT code, fingerprint FROM paper_rule`).bind().all<{ code: string; fingerprint: string }>(),
    // A person's changes on the review screen (automatic fixes are not a review), with the team member's name.
    db.prepare(`SELECT f.doc_id, f.actor, f.at, u.name AS member FROM paper_fix f
                LEFT JOIN "auth_user" u ON f.actor LIKE 'team:%' AND u.id = substr(f.actor, 6)
                WHERE f.actor <> 'auto' ORDER BY f.at`).bind().all<{ doc_id: string; actor: string; at: number; member: string | null }>(),
    listSubjects(db),
  ]);
  const rules = new Map<string, Set<string>>();
  for (const r of ruleRows.results) rules.set(r.code, (rules.get(r.code) ?? new Set()).add(r.fingerprint));
  const last = new Map<string, PersonFix>();
  for (const f of fixRows.results) last.set(f.doc_id, { doc_id: f.doc_id, actor: f.actor, at: f.at, name: personName(f.actor, f.member) });
  const keep = codes ? new Set(codes) : null;
  return docs.results
    .filter((d) => !keep || keep.has(d.syllabus_id.split("-")[0] ?? ""))
    .map((d) => docRow(d, subjects, paperRows.results, rules.get(d.syllabus_id.split("-")[0] ?? "") ?? new Set(), last.get(d.id), last.get(d.id)?.at ?? null));
}

export const personName = (actor: string, member: string | null) => actor === "platform-admin" ? "Owner" : member ?? (actor.startsWith("team:") ? "A team member" : actor);

// ---------- Filters, sorting and pages ----------

export type DocFilter = {
  subject: string[]; year: string[]; month: string[]; type: string[]; paper: string[]; format: string[]; tier: string[];
  variant: string[]; ai: string[]; status: string[]; flags: string; by: string[]; from: string; to: string; q: string;
  sort: DocSort; dir: "asc" | "desc"; page: number;
};
export type DocSort = "score" | "paper" | "year" | "type" | "status" | "flags" | "read" | "reviewed" | "subject";
const SORTS: readonly DocSort[] = ["score", "paper", "year", "type", "status", "flags", "read", "reviewed", "subject"];
export const PAGE_SIZE = 50;

/** The filter from the address (`?year=2025&year=2024&type=qp`): every value checked, multi-value columns as lists. */
export function readDocFilter(get: (k: string) => string[]): DocFilter {
  const list = (k: string, re: RegExp) => [...new Set(get(k).filter((v) => re.test(v)))].slice(0, 40);
  const one = (k: string, re: RegExp) => get(k).find((v) => re.test(v)) ?? "";
  const sort = (SORTS as readonly string[]).includes(one("sort", /^[a-z]+$/)) ? (one("sort", /^[a-z]+$/) as DocSort) : "score";
  return {
    subject: list("subject", /^\d{4}$/), year: list("year", /^\d{4}$/), month: list("month", /^[msyw]$/), type: list("type", /^[a-z]{2}$/),
    paper: list("paper", /^\d{1,2}$/), format: list("format", /^[A-Za-z ]{1,30}$/), tier: list("tier", /^[A-Za-z ]{1,30}$/),
    variant: list("variant", /^(\d|none)$/), ai: list("ai", /^(green|amber|red|none)$/), status: list("status", /^(needs|reviewed|ready|override|unread|unreadable)$/),
    flags: one("flags", /^(0|1)$/), by: list("by", /^(platform-admin|team:[A-Za-z0-9_-]{1,64}|nobody)$/),
    from: one("from", /^\d{4}-\d{2}-\d{2}$/), to: one("to", /^\d{4}-\d{2}-\d{2}$/), q: (get("q")[0] ?? "").slice(0, 100).trim(),
    sort, dir: one("dir", /^(asc|desc)$/) === "desc" ? "desc" : one("dir", /^(asc|desc)$/) === "asc" ? "asc" : sort === "score" || sort === "paper" || sort === "type" || sort === "subject" ? "asc" : "desc",
    page: Math.max(1, Math.min(10_000, Number(one("page", /^\d{1,5}$/)) || 1)),
  };
}

const day = (s: string, end: boolean) => Date.parse(`${s}T${end ? "23:59:59.999" : "00:00:00"}Z`);

/** The rows the filter keeps: every column's own choice, and the search across all the row's words. Pure. */
export function filterDocs(rows: readonly DocRow[], f: DocFilter): DocRow[] {
  const has = (vals: string[], v: string) => !vals.length || vals.includes(v);
  const words = f.q.toLowerCase().split(/\s+/).filter(Boolean);
  const from = f.from ? day(f.from, false) : null;
  const to = f.to ? day(f.to, true) : null;
  return rows.filter((r) =>
    has(f.subject, r.code) && has(f.year, String(r.year)) && has(f.month, r.session) && has(f.type, r.type)
    && has(f.paper, r.paper ? String(r.paper) : "") && has(f.format, r.format) && has(f.tier, r.tier)
    && has(f.variant, r.variant === null ? "none" : String(r.variant)) && has(f.ai, r.score?.colour ?? "none")
    && has(f.status, r.status) && (!f.flags || (f.flags === "0" ? r.open === 0 : r.open > 0))
    && has(f.by, r.reviewer || "nobody")
    && (from === null || (r.readAt !== null && r.readAt >= from)) && (to === null || (r.readAt !== null && r.readAt <= to))
    && (!words.length || words.every((w) => rowWords(r).includes(w))));
}

const rowWords = (r: DocRow) => [r.subject, r.fileName, r.year, SESSION_LABELS[r.session] ?? "", r.typeLabel, r.paperName ? `paper ${r.paperName}` : "", r.format, r.tier,
  r.variant ? `variant ${r.variant}` : "", REVIEW_WORDS[r.status], r.reviewerName, r.models].join(" ").toLowerCase();

const STATUS_RANK: Record<ReviewStatus, number> = { needs: 0, override: 1, ready: 2, reviewed: 3, unread: 4, unreadable: 5 };

/** Sorted by a column; ties in the paper's own order. Not read sorts last on the AI score either way. Pure. */
export function sortDocs(rows: readonly DocRow[], sort: DocSort, dir: "asc" | "desc"): DocRow[] {
  const s = dir === "asc" ? 1 : -1;
  const by = (a: DocRow, b: DocRow): number => {
    switch (sort) {
      case "score": {
        if (!a.score || !b.score) return a.score ? -1 : b.score ? 1 : 0;
        return s * (a.score.pct - b.score.pct);
      }
      case "year": return s * (a.year - b.year || (SESSION_ORDER[a.session] ?? 9) - (SESSION_ORDER[b.session] ?? 9));
      case "type": return s * a.typeLabel.localeCompare(b.typeLabel);
      case "status": return s * (STATUS_RANK[a.status] - STATUS_RANK[b.status]);
      case "flags": return s * (a.open - b.open);
      case "read": return s * ((a.readAt ?? 0) - (b.readAt ?? 0));
      case "reviewed": return s * ((a.reviewedAt ?? 0) - (b.reviewedAt ?? 0));
      case "subject": return s * a.subject.localeCompare(b.subject);
      default: return s * ((a.paper ?? 99) - (b.paper ?? 99));
    }
  };
  return [...rows].sort((a, b) => by(a, b) || a.order.localeCompare(b.order) || a.id.localeCompare(b.id));
}

/** The values a column's filter offers, from the rows themselves, with how many rows have each. Pure. */
export function facet(rows: readonly DocRow[], value: (r: DocRow) => string, label: (v: string, r: DocRow) => string): { value: string; label: string; n: number }[] {
  const m = new Map<string, { value: string; label: string; n: number }>();
  for (const r of rows) {
    const v = value(r);
    const e = m.get(v);
    if (e) e.n++;
    else m.set(v, { value: v, label: label(v, r), n: 1 });
  }
  return [...m.values()];
}

/** How a subject's papers stand, for its overview's one-line summary. Pure. */
export function reviewSummary(rows: readonly DocRow[]): { read: number; needs: number; reviewed: number; ready: number; override: number; unread: number } {
  const n = (s: ReviewStatus) => rows.filter((r) => r.status === s).length;
  return { read: rows.filter((r) => r.readAt !== null).length, needs: n("needs"), reviewed: n("reviewed"), ready: n("ready"), override: n("override"), unread: n("unread") };
}

/** A page's address value as a list (Next gives one string or several). */
export const listParam = (v: string | string[] | undefined): string[] => (Array.isArray(v) ? v : typeof v === "string" ? [v] : []);
