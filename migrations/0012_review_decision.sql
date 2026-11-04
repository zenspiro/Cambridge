-- "Needs your eye" decisions (owner request 4 Nov 2026). On a run page the owner accepts a file
-- the agent could not place (choosing which checklist file it is) or rejects it. Later runs read
-- these: an accepted file is fetched under the chosen name, a rejected one is skipped quietly.
-- One row per source file (a Google Drive file id within its source). Undo removes the row.
CREATE TABLE review_decision (
  id          TEXT PRIMARY KEY,
  site_id     TEXT NOT NULL REFERENCES source_site (id) ON DELETE CASCADE,
  item_key    TEXT NOT NULL,
  decision    TEXT NOT NULL CHECK (decision IN ('accept', 'reject')),
  -- The Cambridge name chosen on accept; empty for reject.
  file_name   TEXT CHECK ((decision = 'accept') = (file_name IS NOT NULL)),
  -- Folder path and file name as the agent saw them, for people.
  label       TEXT NOT NULL DEFAULT '',
  run_id      TEXT,
  decided_by  TEXT,
  decided_at  INTEGER NOT NULL,
  UNIQUE (site_id, item_key)
);
-- One source file per accepted name.
CREATE UNIQUE INDEX review_decision_name ON review_decision (file_name) WHERE file_name IS NOT NULL;
