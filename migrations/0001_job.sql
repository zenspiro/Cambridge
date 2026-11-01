-- Background jobs (acquisition, extraction, generation). Brief 6 and 15.5:
-- jobs log progress and failures here and never fail silently.
-- Conventions: ids are TEXT (random), times are INTEGER milliseconds since epoch,
-- JSON columns are TEXT checked with json_valid.
-- The link to the user who started a job is added in Step 1, with the user table.
CREATE TABLE job (
  id          TEXT PRIMARY KEY,
  type        TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'queued'
              CHECK (status IN ('queued', 'running', 'succeeded', 'failed', 'cancelled')),
  params      TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(params)),
  progress    INTEGER NOT NULL DEFAULT 0 CHECK (progress BETWEEN 0 AND 100),
  error_ref   TEXT,
  created_at  INTEGER NOT NULL,
  started_at  INTEGER,
  finished_at INTEGER
);

CREATE INDEX job_status_created ON job (status, created_at);
