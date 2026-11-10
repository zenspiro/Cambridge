-- Mark as reviewed (owner, 10 Nov 2026): a paper with no flags left that a person has checked can say so, even when
-- nothing needed changing. Who and when; a new full reading after it means the new reading has not been looked at.
ALTER TABLE paper_read ADD COLUMN reviewed_at INTEGER;
ALTER TABLE paper_read ADD COLUMN reviewed_by TEXT;
