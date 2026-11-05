-- Phase 2 step 1: the topic tree per syllabus version (owner decision 5 Nov 2026: drafted by AI from the syllabus
-- PDF, checked by code and a second AI, no human review). One row per version: the tree is stored as JSON (topics
-- and goals, flat), because one write must save it whole (D1 limits the queries a request may make).
-- status: none (never drafted), ready (every check passed), not_ready (stored, but a check failed: later steps
-- do not use it). job_id points at the latest run (job type 'brain').
CREATE TABLE topic_tree (
  syllabus_id TEXT PRIMARY KEY REFERENCES syllabus (id) ON DELETE CASCADE,
  status      TEXT NOT NULL DEFAULT 'none' CHECK (status IN ('none', 'ready', 'not_ready')),
  job_id      TEXT REFERENCES job (id) ON DELETE SET NULL,
  tree        TEXT CHECK (tree IS NULL OR json_valid(tree)),
  report      TEXT CHECK (report IS NULL OR json_valid(report)),
  topics      INTEGER NOT NULL DEFAULT 0,
  goals       INTEGER NOT NULL DEFAULT 0,
  drafted_at  INTEGER,
  updated_at  INTEGER NOT NULL
);
