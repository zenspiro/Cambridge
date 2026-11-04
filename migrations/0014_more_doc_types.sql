-- More Cambridge document types (owner request, 4 Nov 2026): pm pre-release material
-- (Computer Science 0478 Paper 2 up to 2022), qr listening transcript and tn teachers' notes
-- for the speaking test (French 0520).
--
-- ONE-TIME EXCEPTION to "additive only" (owner approved storing these types, 4 Nov 2026):
-- source_document is rebuilt because SQLite cannot change a CHECK constraint in place. The new
-- check accepts any two lowercase letters, so a later type needs no rebuild; the code
-- (names.ts) decides which types exist. Every column and every row is copied; nothing
-- references source_document. tests/unit/migrations.test.ts allows DROP and RENAME here only.

PRAGMA defer_foreign_keys = true;

CREATE TABLE source_document_new (
  id              TEXT PRIMARY KEY,
  syllabus_id     TEXT NOT NULL REFERENCES syllabus (id),
  session         TEXT NOT NULL CHECK (session IN ('m', 's', 'w', 'y')),
  year            INTEGER NOT NULL,
  paper           INTEGER,
  variant         INTEGER,
  doc_type        TEXT NOT NULL CHECK (length(doc_type) = 2 AND doc_type GLOB '[a-z][a-z]'),
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

-- Checklist rules: pre-release material with 0478 Paper 2 (2020 to 2022 syllabus, essential like
-- the paper); listening transcripts for 0520 Paper 1 and teachers' notes for Paper 3 (extras).
UPDATE syllabus SET expected = json_set(expected, '$.pmPapers', json('[2]')) WHERE id = '0478-2020';
UPDATE syllabus SET expected = json_set(expected,
  '$.qrPapers', json('[1]'),
  '$.extraSessionDocs', json('[{"type":"tn","paper":3}]'))
WHERE code = '0520';

-- 0478 papers for the 2020 to 2022 syllabus were copied from 2023. Names from the papers' own
-- covers (owner, 4 Nov 2026); time, marks and weighting still not checked.
UPDATE syllabus_paper SET name = 'Theory', note = 'Name from the papers'' covers; time, marks and weighting not checked against the 2020 to 2022 syllabus.' WHERE id = '0478-2020-p1';
UPDATE syllabus_paper SET name = 'Problem-solving and Programming', note = 'Name from the papers'' covers. Comes with pre-release material. Time, marks and weighting not checked against the 2020 to 2022 syllabus.' WHERE id = '0478-2020-p2';
