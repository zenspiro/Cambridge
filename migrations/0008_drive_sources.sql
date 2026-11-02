-- Google Drive folders as sources (owner decision, 2 Nov 2026). The agent reads shared folders
-- through Google's official Drive API with an API key (GitHub secret GOOGLE_DRIVE_API), works out
-- what each folder and file is, and stores matching files through the usual checks.

-- 'web': the agent reads start pages and follows PDF links. 'gdrive': the agent walks Drive folders.
ALTER TABLE source_site ADD COLUMN kind TEXT NOT NULL DEFAULT 'web' CHECK (kind IN ('web', 'gdrive'));

CREATE TABLE source_drive_folder (
  id          TEXT PRIMARY KEY,
  site_id     TEXT NOT NULL REFERENCES source_site (id) ON DELETE CASCADE,
  folder_id   TEXT NOT NULL UNIQUE,
  label       TEXT NOT NULL DEFAULT '',
  -- What the agent last found here, for the Sources page (JSON summary, set after each run).
  last_seen   TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(last_seen)),
  last_seen_at INTEGER,
  created_by  TEXT,
  created_at  INTEGER NOT NULL
);
CREATE INDEX source_drive_folder_site ON source_drive_folder (site_id);
