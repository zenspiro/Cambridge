-- Source library (build 3a). Cambridge material is internal only (brief 3):
-- admin roles only, every file access audited, files live in the private
-- cambridge-source bucket and are never served by URL to anyone else.

CREATE TABLE subject (
  id     TEXT PRIMARY KEY,
  name   TEXT NOT NULL,
  level  TEXT NOT NULL CHECK (level IN ('IGCSE', 'O Level', 'AS & A Level')),
  UNIQUE (name, level)
);

-- One row per syllabus version (the code stays, the content changes every few years).
-- expected: JSON rules for the gap report, see src/lib/library/expected.ts.
CREATE TABLE syllabus (
  id              TEXT PRIMARY KEY,
  subject_id      TEXT NOT NULL REFERENCES subject (id),
  code            TEXT NOT NULL CHECK (length(code) = 4),
  title           TEXT NOT NULL,
  valid_from_year INTEGER NOT NULL,
  valid_to_year   INTEGER NOT NULL CHECK (valid_to_year >= valid_from_year),
  expected        TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(expected)),
  UNIQUE (code, valid_from_year)
);

-- Approved source websites (brief 3.8). The agent only visits enabled rows.
CREATE TABLE source_site (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  base_url    TEXT NOT NULL UNIQUE,
  enabled     INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  notes       TEXT NOT NULL DEFAULT '',
  created_by  TEXT,
  created_at  INTEGER NOT NULL
);

-- One row per file. status 'pending' reserves the name and fingerprint before the
-- file is written to storage, so two uploads of the same file cannot race.
CREATE TABLE source_document (
  id              TEXT PRIMARY KEY,
  syllabus_id     TEXT NOT NULL REFERENCES syllabus (id),
  session         TEXT NOT NULL CHECK (session IN ('m', 's', 'w', 'y')),
  year            INTEGER NOT NULL,
  paper           INTEGER,
  variant         INTEGER,
  doc_type        TEXT NOT NULL CHECK (doc_type IN ('qp', 'ms', 'in', 'ci', 'er', 'gt', 'sp', 'sm', 'sy')),
  file_name       TEXT NOT NULL UNIQUE,
  r2_key          TEXT NOT NULL UNIQUE,
  sha256          TEXT NOT NULL UNIQUE,
  size_bytes      INTEGER NOT NULL,
  source_url      TEXT,
  source_site_id  TEXT REFERENCES source_site (id) ON DELETE SET NULL,
  origin          TEXT NOT NULL CHECK (origin IN ('upload', 'agent')),
  job_id          TEXT REFERENCES job (id) ON DELETE SET NULL,
  status          TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'stored')),
  acquired_by     TEXT,
  acquired_at     INTEGER NOT NULL
);
CREATE INDEX source_document_browse ON source_document (syllabus_id, year, session, doc_type, paper, variant);

-- Jobs: who started them and what came out (per-file results of an upload or agent run).
ALTER TABLE job ADD COLUMN created_by TEXT;
ALTER TABLE job ADD COLUMN result TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(result));

-- Seed: IGCSE Physics 0625, the three syllabus versions that cover 2022 to 2026.
-- Version years to be confirmed against Cambridge's site on the first agent dry run.
INSERT INTO subject (id, name, level) VALUES ('physics-igcse', 'Physics', 'IGCSE');

INSERT INTO syllabus (id, subject_id, code, title, valid_from_year, valid_to_year, expected) VALUES
  ('0625-2020', 'physics-igcse', '0625', 'Cambridge IGCSE Physics', 2020, 2022,
   '{"papers":[1,2,3,4,5,6],"variants":{"m":[2],"s":[1,2,3],"w":[1,2,3]},"perPaper":["qp","ms"],"ciPapers":[5],"perSession":["er","gt"]}'),
  ('0625-2023', 'physics-igcse', '0625', 'Cambridge IGCSE Physics', 2023, 2025,
   '{"papers":[1,2,3,4,5,6],"variants":{"m":[2],"s":[1,2,3],"w":[1,2,3]},"perPaper":["qp","ms"],"ciPapers":[5],"perSession":["er","gt"]}'),
  ('0625-2026', 'physics-igcse', '0625', 'Cambridge IGCSE Physics', 2026, 2028,
   '{"papers":[1,2,3,4,5,6],"variants":{"m":[2],"s":[1,2,3],"w":[1,2,3]},"perPaper":["qp","ms"],"ciPapers":[5],"perSession":["er","gt"]}');

INSERT INTO source_site (id, name, base_url, enabled, notes, created_by, created_at) VALUES
  ('cambridge-official', 'Cambridge International (official)', 'https://www.cambridgeinternational.org/', 1,
   'Public pages only. No logins (brief 3.8).', 'platform-admin', 1793491200000);
