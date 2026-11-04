-- AI usage meter (owner request 4 Nov 2026): every Workers AI question, counted per day (UTC,
-- when Cloudflare's free allowance resets), with its tokens and an estimate of the neurons used.
-- Shown at the top of every admin page.
CREATE TABLE ai_usage (
  day            TEXT PRIMARY KEY,
  calls          INTEGER NOT NULL DEFAULT 0,
  input_tokens   INTEGER NOT NULL DEFAULT 0,
  output_tokens  INTEGER NOT NULL DEFAULT 0,
  neurons        REAL NOT NULL DEFAULT 0,
  updated_at     INTEGER NOT NULL
);
