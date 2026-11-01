-- Acquisition agent (build 3b) and library settings in the database.

-- Settings the admin can change in the panel. value is JSON.
CREATE TABLE setting (
  key         TEXT PRIMARY KEY,
  value       TEXT NOT NULL CHECK (json_valid(value)),
  updated_by  TEXT,
  updated_at  INTEGER NOT NULL
);

INSERT INTO setting (key, value, updated_by, updated_at) VALUES
  ('library', '{"fromYear":2022,"toYear":2026,"lastSession":{"year":2026,"session":"s"}}', 'platform-admin', 1793491200000);

-- Start pages per source and syllabus: the agent only reads these pages and
-- follows PDF links on them that stay inside the source's address.
CREATE TABLE source_page (
  id             TEXT PRIMARY KEY,
  site_id        TEXT NOT NULL REFERENCES source_site (id) ON DELETE CASCADE,
  syllabus_code  TEXT NOT NULL CHECK (length(syllabus_code) = 4),
  url            TEXT NOT NULL UNIQUE,
  created_by     TEXT,
  created_at     INTEGER NOT NULL
);
CREATE INDEX source_page_site ON source_page (site_id, syllabus_code);

INSERT INTO source_page (id, site_id, syllabus_code, url, created_by, created_at) VALUES
  ('cie-0625-past-papers', 'cambridge-official', '0625',
   'https://www.cambridgeinternational.org/programmes-and-qualifications/cambridge-igcse-physics-0625/past-papers/',
   'platform-admin', 1793491200000),
  ('cie-0625-overview', 'cambridge-official', '0625',
   'https://www.cambridgeinternational.org/programmes-and-qualifications/cambridge-igcse-physics-0625/',
   'platform-admin', 1793491200000);

-- Signed agent requests: each nonce is accepted once (replay guard, brief 15.2).
CREATE TABLE request_nonce (
  nonce  TEXT PRIMARY KEY,
  at     INTEGER NOT NULL
);
CREATE INDEX request_nonce_at ON request_nonce (at);
