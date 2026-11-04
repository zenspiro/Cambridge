-- Other Cambridge codes for a library syllabus (owner decision 4 Nov 2026, option A). Cambridge
-- ran a Pakistan-only 2021 series under its own codes: IGCSE Physics was 1524 ("PHYSICS 1524/12,
-- May/June 2021" on the cover). Those files keep their real names (1524_s21_qp_12.pdf) and sit
-- with the main syllabus (0625) in the library, as their own series in that session.
-- Rows come from this seed or are learned from covers during a folder upload (source 'cover').

CREATE TABLE syllabus_alias (
  code        TEXT PRIMARY KEY CHECK (length(code) = 4 AND code GLOB '[0-9][0-9][0-9][0-9]'),
  main_code   TEXT NOT NULL CHECK (length(main_code) = 4),
  label       TEXT NOT NULL,
  from_year   INTEGER NOT NULL,
  to_year     INTEGER NOT NULL,
  sessions    TEXT NOT NULL DEFAULT 's',
  source      TEXT NOT NULL DEFAULT 'seed' CHECK (source IN ('seed', 'cover')),
  created_at  INTEGER NOT NULL
);

INSERT INTO syllabus_alias (code, main_code, label, from_year, to_year, sessions, source, created_at)
VALUES ('1524', '0625', 'Pakistan series', 2021, 2021, 's', 'seed', 1793836800000);
