-- Profiles, exam plans and parent approval (Phase 1 step 3, owner decisions 5 Nov 2026: a parent approves every
-- student under the age limit set per country in admin; one-tap approval; a decline deletes the student's account).
-- Everything belongs to the account and goes when it is deleted (cascade).

CREATE TABLE profile (
  user_id         TEXT PRIMARY KEY REFERENCES "auth_user" ("id") ON DELETE CASCADE,
  birth_year      INTEGER,
  country         TEXT CHECK (country IS NULL OR (length(country) = 2 AND country GLOB '[A-Z][A-Z]')),
  theme           TEXT CHECK (theme IS NULL OR theme IN ('a', 'b', 'c')),
  -- When a parent approved this student (NULL: not approved, or not needed).
  approved_at     INTEGER,
  -- "Skip for now" on the exam sessions question.
  exam_skipped_at INTEGER,
  updated_at      INTEGER NOT NULL
);

-- One exam session per subject per student (for the countdown).
CREATE TABLE exam_plan (
  user_id       TEXT NOT NULL REFERENCES "auth_user" ("id") ON DELETE CASCADE,
  syllabus_code TEXT NOT NULL,
  session       TEXT NOT NULL CHECK (session IN ('m', 's', 'w')),
  year          INTEGER NOT NULL,
  created_at    INTEGER NOT NULL,
  PRIMARY KEY (user_id, syllabus_code)
);

-- Approval requests sent to a parent. The link token is stored only as its SHA-256. The row is the record of who
-- approved and when (kept with the account).
CREATE TABLE parent_consent (
  id           TEXT PRIMARY KEY,
  child_id     TEXT NOT NULL REFERENCES "auth_user" ("id") ON DELETE CASCADE,
  parent_email TEXT NOT NULL,
  token_hash   TEXT NOT NULL UNIQUE,
  status       TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'declined', 'replaced')),
  created_at   INTEGER NOT NULL,
  expires_at   INTEGER NOT NULL,
  decided_at   INTEGER
);
CREATE INDEX parent_consent_child ON parent_consent (child_id, created_at);

-- Age limits: the default and any country that differs (admin > Settings > Parent approval).
INSERT INTO setting (key, value, updated_by, updated_at) VALUES ('consent', '{"defaultAge":18,"byCountry":{}}', 'migration', 0)
ON CONFLICT (key) DO NOTHING;
