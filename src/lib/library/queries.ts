// Every SQL statement for the source library, in one place. Bound parameters only.

export const SYLLABUS_FOR_YEAR = `
SELECT id, code, title, valid_from_year, valid_to_year, expected FROM syllabus
WHERE code = ?1 AND valid_from_year <= ?2 AND valid_to_year >= ?2`;

export const SYLLABI_BY_CODE = `
SELECT id, code, title, valid_from_year, valid_to_year, expected, essential_variants FROM syllabus
WHERE code = ?1 ORDER BY valid_from_year`;

export const SYLLABUS_CODES = `SELECT DISTINCT code, title FROM syllabus ORDER BY code`;

/** Reserves name and fingerprint. Returns no row when either already exists. */
export const RESERVE_DOCUMENT = `
INSERT INTO source_document
  (id, syllabus_id, session, year, paper, variant, doc_type, file_name, r2_key, sha256, size_bytes,
   source_url, source_site_id, origin, job_id, status, acquired_by, acquired_at)
VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, 'pending', ?16, ?17)
ON CONFLICT DO NOTHING
RETURNING id`;

export const MARK_STORED = `UPDATE source_document SET status = 'stored' WHERE id = ?1 AND status = 'pending'`;
export const DROP_PENDING = `DELETE FROM source_document WHERE id = ?1 AND status = 'pending'`;

/** Rows left pending by a crash, cleaned up a few at a time. */
export const DROP_STALE_PENDING = `
DELETE FROM source_document WHERE id IN (
  SELECT id FROM source_document WHERE status = 'pending' AND acquired_at < ?1 LIMIT 100)`;

export const FIND_CLASH = `
SELECT file_name, sha256 FROM source_document WHERE file_name = ?1 OR sha256 = ?2 LIMIT 1`;

export const LIST_DOCUMENTS = `
SELECT d.id, d.file_name, d.session, d.year, d.paper, d.variant, d.doc_type, d.size_bytes,
       d.origin, d.acquired_at, s.code
FROM source_document d JOIN syllabus s ON s.id = d.syllabus_id
WHERE d.status = 'stored'
  AND s.code = ?1
  AND (?2 IS NULL OR d.year = ?2)
  AND (?3 IS NULL OR d.session = ?3)
  AND (?4 IS NULL OR d.doc_type = ?4)
  AND (?5 IS NULL OR d.paper = ?5)
ORDER BY d.year DESC, CASE d.session WHEN 'w' THEN 0 WHEN 's' THEN 1 WHEN 'm' THEN 2 ELSE 3 END,
         d.paper, d.variant, d.doc_type
LIMIT ?6`;

export const COUNT_DOCUMENTS = `
SELECT COUNT(*) AS n FROM source_document d JOIN syllabus s ON s.id = d.syllabus_id
WHERE d.status = 'stored' AND s.code = ?1`;

export const STORED_NAMES = `
SELECT d.file_name FROM source_document d JOIN syllabus s ON s.id = d.syllabus_id
WHERE d.status = 'stored' AND s.code = ?1`;

export const GET_DOCUMENT = `
SELECT id, file_name, r2_key, size_bytes FROM source_document WHERE id = ?1 AND status = 'stored'`;

export const LIST_SITES = `SELECT id, name, base_url, enabled, notes, created_at FROM source_site ORDER BY created_at`;
export const GET_SITE = `SELECT id, name, base_url, enabled FROM source_site WHERE id = ?1`;
export const INSERT_SITE = `
INSERT INTO source_site (id, name, base_url, enabled, notes, created_by, created_at)
VALUES (?1, ?2, ?3, 1, ?4, ?5, ?6) ON CONFLICT DO NOTHING RETURNING id`;
export const SET_SITE_ENABLED = `UPDATE source_site SET enabled = ?2 WHERE id = ?1`;
export const DELETE_SITE = `DELETE FROM source_site WHERE id = ?1`;

// Hierarchy: qualification > subject > syllabus code > version > documents.
export const LIST_QUALIFICATIONS = `SELECT id, name, short_name FROM qualification ORDER BY sort_order`;

export const LIST_SYLLABUS_CODES = `
SELECT q.id AS qualification_id, s.id AS subject_id, s.name AS subject_name, y.code, MIN(y.title) AS title
FROM syllabus y JOIN subject s ON s.id = y.subject_id JOIN qualification q ON q.id = s.qualification_id
GROUP BY q.id, s.id, s.name, y.code ORDER BY q.sort_order, s.name, y.code`;

export const SYLLABUS_HEADER = `
SELECT q.id AS qualification_id, q.name AS qualification_name, q.short_name, s.id AS subject_id, s.name AS subject_name,
       MIN(y.title) AS title
FROM syllabus y JOIN subject s ON s.id = y.subject_id JOIN qualification q ON q.id = s.qualification_id
WHERE y.code = ?1 GROUP BY q.id, q.name, q.short_name, s.id, s.name`;

export const STORED_FOR_CODE = `
SELECT d.id, d.file_name, d.doc_type, d.session, d.year, d.paper, d.variant, d.size_bytes, d.origin, d.acquired_at,
       d.sha256, d.syllabus_id
FROM source_document d JOIN syllabus y ON y.id = d.syllabus_id
WHERE d.status = 'stored' AND y.code = ?1`;
