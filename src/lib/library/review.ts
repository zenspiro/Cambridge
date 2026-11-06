// The review screen (owner, 6 Nov 2026): one stored file, its PDF beside what the database holds about it, and the
// files that belong with it (the same paper's question paper, mark scheme, insert; the session's examiner report and
// grade thresholds). Step 2b adds the paper rebuilt from the database. Takes the database as a parameter.
import type { Db } from "../db.ts";

export type ReviewDoc = {
  id: string;
  fileName: string;
  docType: string;
  session: string;
  year: number;
  paper: number | null;
  variant: number | null;
  bytes: number;
  origin: "upload" | "agent" | "link";
  sourceUrl: string | null;
  siteName: string | null;
  acquiredAt: number;
  syllabusId: string;
  code: string;
  fromYear: number;
  toYear: number;
};

export type Related = { id: string; fileName: string; docType: string };

type Row = {
  id: string; file_name: string; doc_type: string; session: string; year: number; paper: number | null; variant: number | null;
  size_bytes: number; origin: ReviewDoc["origin"]; source_url: string | null; site_name: string | null; acquired_at: number;
  syllabus_id: string; code: string; valid_from_year: number; valid_to_year: number;
};

export async function loadReviewDoc(db: Db, id: string): Promise<ReviewDoc | null> {
  const r = await db
    .prepare(
      `SELECT d.id, d.file_name, d.doc_type, d.session, d.year, d.paper, d.variant, d.size_bytes, d.origin, d.source_url, d.acquired_at,
              d.syllabus_id, s.name AS site_name, y.code, y.valid_from_year, y.valid_to_year
       FROM source_document d JOIN syllabus y ON y.id = d.syllabus_id LEFT JOIN source_site s ON s.id = d.source_site_id
       WHERE d.id = ?1 AND d.status = 'stored'`,
    )
    .bind(id)
    .first<Row>();
  if (!r) return null;
  return {
    id: r.id, fileName: r.file_name, docType: r.doc_type, session: r.session, year: r.year, paper: r.paper, variant: r.variant,
    bytes: r.size_bytes, origin: r.origin, sourceUrl: r.source_url, siteName: r.site_name, acquiredAt: r.acquired_at,
    syllabusId: r.syllabus_id, code: r.code, fromYear: r.valid_from_year, toYear: r.valid_to_year,
  };
}

/** Order the same paper's files are offered in (question paper first). */
const PAPER_TYPES = ["qp", "ms", "in", "ci", "pm", "qr", "tn", "sp", "sm"];
const SESSION_TYPES = ["er", "gt"];

/**
 * Files that belong with this one, under the same code prefix (a Pakistan series file stays with its series):
 * `paper`: the same paper and variant (or the specimen of the same paper), `session`: the examiner report and grade
 * thresholds of the same session (or, for those, the session's question papers).
 */
export async function relatedDocs(db: Db, d: ReviewDoc): Promise<{ paper: Related[]; session: Related[] }> {
  const prefix = d.fileName.slice(0, 4);
  const { results } = await db
    .prepare(
      `SELECT id, file_name, doc_type, paper, variant FROM source_document
       WHERE status = 'stored' AND syllabus_id = ?1 AND year = ?2 AND session = ?3 AND substr(file_name, 1, 4) = ?4 AND id <> ?5
       ORDER BY file_name LIMIT 200`,
    )
    .bind(d.syllabusId, d.year, d.session, prefix, d.id)
    .all<{ id: string; file_name: string; doc_type: string; paper: number | null; variant: number | null }>();
  const rank = (t: string) => {
    const i = PAPER_TYPES.indexOf(t);
    return i < 0 ? 99 : i;
  };
  const toRel = (r: { id: string; file_name: string; doc_type: string }) => ({ id: r.id, fileName: r.file_name, docType: r.doc_type });
  const paper = d.paper === null ? [] : results
    .filter((r) => r.paper === d.paper && (r.variant === d.variant || r.variant === null || d.variant === null) && !SESSION_TYPES.includes(r.doc_type))
    .sort((a, b) => rank(a.doc_type) - rank(b.doc_type))
    .map(toRel);
  const session = SESSION_TYPES.includes(d.docType)
    ? results.filter((r) => r.doc_type === "qp").map(toRel)
    : results.filter((r) => SESSION_TYPES.includes(r.doc_type)).map(toRel);
  return { paper, session };
}
