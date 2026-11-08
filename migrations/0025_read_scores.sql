-- Read accuracy per reading (owner, 8 Nov 2026: compare a cheaper Claude model with the one in use on the same
-- paper). Each full reading adds { at, claude, gemini, items, clean, red } for the AIs' own reading before any merge
-- with what was kept, a mark scheme's marks checked against its question paper included. The first reading's score
-- (first_* columns) is unchanged. Newest last, the last 20 kept.
ALTER TABLE paper_read ADD COLUMN scores TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(scores));
