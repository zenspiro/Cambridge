-- "Needs you" on Home can be cleared (owner, 9 Nov 2026: anything sorted should not show). Clearing only hides an
-- item from Home: a run's page and a paper's flags are unchanged. A stopped run stays hidden; a paper comes back when
-- it is read again after the clear (its read_at moves past cleared_at).
ALTER TABLE job ADD COLUMN cleared_at INTEGER;
ALTER TABLE paper_read ADD COLUMN cleared_at INTEGER;
