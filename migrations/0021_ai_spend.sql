-- AI usage and spend (owner request 6 Nov 2026): every Claude and Gemini question a brain run asks, with the tokens
-- the service reported, so the AI setup page can show usage and spend per model and job, and a monthly cap can
-- stop runs. Spend is worked out on the page from the prices in setting 'ai_prices' (typed by the admin), so a
-- price change needs no rewrite. job_id keeps the run; a removed run keeps its spend (SET NULL).
CREATE TABLE ai_spend (
  id            TEXT PRIMARY KEY,
  job_id        TEXT REFERENCES job (id) ON DELETE SET NULL,
  task          TEXT NOT NULL,
  provider      TEXT NOT NULL CHECK (provider IN ('claude', 'gemini')),
  model         TEXT NOT NULL,
  calls         INTEGER NOT NULL DEFAULT 1,
  pages         INTEGER NOT NULL DEFAULT 0,
  input_tokens  INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  at            INTEGER NOT NULL
);

CREATE INDEX ai_spend_at ON ai_spend (at);
CREATE INDEX ai_spend_job ON ai_spend (job_id);

-- Starting prices in US dollars per million tokens, from Anthropic's price list (October 2026). The admin can change
-- them on the AI setup page; Gemini prices are left for the admin (0 on the free tier).
INSERT INTO setting (key, value, updated_by, updated_at) VALUES
  ('ai_prices', '{"claude-sonnet-5-5":{"in":2,"out":10},"claude-opus-5-5":{"in":4,"out":20}}', 'migration', 0)
ON CONFLICT (key) DO NOTHING;
