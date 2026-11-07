-- Reading the papers (Phase 2, step 2b; owner 6 and 7 Nov 2026). One row per question paper or mark scheme read by
-- the brain: its flags, what the admin settled ("It's fine", "Looks right": fingerprints in `dismissed`), and the
-- override when the admin marks it ready with flags left. The reading itself (items, figures as SVG), the PDF's page
-- text and Gemini's reading live in R2 FILES at papers/<doc id>/ (too large for a D1 row).
CREATE TABLE paper_read (
  doc_id       TEXT PRIMARY KEY REFERENCES source_document (id) ON DELETE CASCADE,
  job_id       TEXT REFERENCES job (id) ON DELETE SET NULL,
  items        INTEGER NOT NULL DEFAULT 0,
  figures      INTEGER NOT NULL DEFAULT 0,
  flags        TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(flags)),
  dismissed    TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(dismissed)),
  revision     INTEGER NOT NULL DEFAULT 0,
  read_at      INTEGER,
  override_at  INTEGER,
  override_by  TEXT,
  updated_at   INTEGER NOT NULL
);

-- Every fix on the review screen, with what it changed, so it can be undone (audited too).
CREATE TABLE paper_fix (
  id          TEXT PRIMARY KEY,
  doc_id      TEXT NOT NULL REFERENCES source_document (id) ON DELETE CASCADE,
  action      TEXT NOT NULL CHECK (action IN ('pdf', 'edit', 'fine', 'looks_right', 'override')),
  item        TEXT,
  flag_key    TEXT,
  before      TEXT CHECK (before IS NULL OR json_valid(before)),
  after       TEXT CHECK (after IS NULL OR json_valid(after)),
  actor       TEXT NOT NULL,
  at          INTEGER NOT NULL,
  undone_at   INTEGER
);

CREATE INDEX paper_fix_doc ON paper_fix (doc_id, at);

-- "It's fine" becomes a rule for the subject: the same flag (by fingerprint) is not raised again for this code.
CREATE TABLE paper_rule (
  code        TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  reason      TEXT NOT NULL,
  created_by  TEXT NOT NULL,
  created_at  INTEGER NOT NULL,
  PRIMARY KEY (code, fingerprint)
);
