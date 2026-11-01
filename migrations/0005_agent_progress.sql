-- Live feedback for agent runs: last sign of life, a short event log, and the GitHub log link.
ALTER TABLE job ADD COLUMN heartbeat_at INTEGER;
ALTER TABLE job ADD COLUMN step TEXT;
ALTER TABLE job ADD COLUMN events TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(events));
ALTER TABLE job ADD COLUMN run_url TEXT;
