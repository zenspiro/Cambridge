-- Library hierarchy and checklist (owner request, 1 Nov 2026).
-- Qualification (IGCSE, O Level, AS & A Level) > subject > syllabus code > syllabus version > documents.
--
-- ONE-TIME EXCEPTION to "additive only" (owner approved 1 Nov 2026, test data only):
-- source_document is rebuilt to allow two new document types, 'su' (syllabus update)
-- and 'gd' (grade descriptions), and a new origin, 'link' (admin pasted a link).
-- SQLite cannot change a CHECK constraint in place. Nothing references source_document yet.
-- tests/unit/migrations.test.ts allows DROP and RENAME in this file only.

PRAGMA defer_foreign_keys = true;

CREATE TABLE qualification (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL UNIQUE,
  short_name  TEXT NOT NULL,
  sort_order  INTEGER NOT NULL
);
INSERT INTO qualification (id, name, short_name, sort_order) VALUES
  ('igcse', 'Cambridge IGCSE', 'IGCSE', 1),
  ('o-level', 'Cambridge O Level', 'O Level', 2),
  ('as-a-level', 'Cambridge International AS & A Level', 'AS & A Level', 3);

ALTER TABLE subject ADD COLUMN qualification_id TEXT REFERENCES qualification (id);
UPDATE subject SET qualification_id = CASE level
  WHEN 'IGCSE' THEN 'igcse' WHEN 'O Level' THEN 'o-level' WHEN 'AS & A Level' THEN 'as-a-level' END;

CREATE TABLE source_document_new (
  id              TEXT PRIMARY KEY,
  syllabus_id     TEXT NOT NULL REFERENCES syllabus (id),
  session         TEXT NOT NULL CHECK (session IN ('m', 's', 'w', 'y')),
  year            INTEGER NOT NULL,
  paper           INTEGER,
  variant         INTEGER,
  doc_type        TEXT NOT NULL CHECK (doc_type IN ('qp', 'ms', 'in', 'ci', 'er', 'gt', 'sp', 'sm', 'sy', 'su', 'gd')),
  file_name       TEXT NOT NULL UNIQUE,
  r2_key          TEXT NOT NULL UNIQUE,
  sha256          TEXT NOT NULL UNIQUE,
  size_bytes      INTEGER NOT NULL,
  source_url      TEXT,
  source_site_id  TEXT REFERENCES source_site (id) ON DELETE SET NULL,
  origin          TEXT NOT NULL CHECK (origin IN ('upload', 'agent', 'link')),
  job_id          TEXT REFERENCES job (id) ON DELETE SET NULL,
  status          TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'stored')),
  acquired_by     TEXT,
  acquired_at     INTEGER NOT NULL
);
INSERT INTO source_document_new
  (id, syllabus_id, session, year, paper, variant, doc_type, file_name, r2_key, sha256, size_bytes,
   source_url, source_site_id, origin, job_id, status, acquired_by, acquired_at)
SELECT id, syllabus_id, session, year, paper, variant, doc_type, file_name, r2_key, sha256, size_bytes,
       source_url, source_site_id, origin, job_id, status, acquired_by, acquired_at
FROM source_document;
DROP TABLE source_document;
ALTER TABLE source_document_new RENAME TO source_document;
CREATE INDEX source_document_browse ON source_document (syllabus_id, year, session, doc_type, paper, variant);

-- Checklist rules per syllabus version: version documents and specimens join the exam-session rules.
-- 2020 to 2022: only 2022 is in the library, so its specimens are not asked for.
UPDATE syllabus SET expected = json_set(expected,
  '$.versionDocs', json('["sy"]'),
  '$.extraVersionDocs', json('["su","gd"]'),
  '$.specimenPapers', json(CASE id WHEN '0625-2020' THEN '[]' ELSE '[1,2,3,4,5,6]' END),
  '$.specimenTypes', json('["sp","sm"]'),
  '$.specimenCiPapers', json(CASE id WHEN '0625-2020' THEN '[]' ELSE '[5]' END))
WHERE code = '0625';
UPDATE syllabus SET expected = json_set(expected, '$.versionDocs', json('[]')) WHERE id = '0625-2020';

-- Which variants count as essential, per exam session (owner: variant 1; March only has 2).
UPDATE setting SET value = json_set(value, '$.essentialVariants', json('{"m":[2],"s":[1],"w":[1]}')) WHERE key = 'library';
