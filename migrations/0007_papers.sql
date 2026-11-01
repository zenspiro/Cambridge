-- Papers (components) and assessment routes per syllabus version, and essential variants per syllabus.
-- 0625 2023 to 2025 and 2026 to 2028: checked against Cambridge's syllabus PDFs (1 Nov 2026,
-- "Assessment overview"). 2020 to 2022: same structure assumed, not checked (noted on the rows).

CREATE TABLE syllabus_paper (
  id             TEXT PRIMARY KEY,
  syllabus_id    TEXT NOT NULL REFERENCES syllabus (id) ON DELETE CASCADE,
  paper          INTEGER NOT NULL CHECK (paper BETWEEN 1 AND 9),
  name           TEXT NOT NULL,
  format         TEXT NOT NULL CHECK (format IN ('mcq', 'structured', 'practical', 'written')),
  tier           TEXT NOT NULL CHECK (tier IN ('core', 'extended', 'all')),
  duration_min   INTEGER,
  marks          INTEGER,
  weighting_pct  INTEGER,
  note           TEXT NOT NULL DEFAULT '',
  UNIQUE (syllabus_id, paper)
);

-- A route is the set of papers a candidate takes. papers: JSON list of groups; a group with
-- more than one paper means "one of these" (e.g. [[1],[3],[5,6]] = 1 and 3 and either 5 or 6).
CREATE TABLE syllabus_route (
  id           TEXT PRIMARY KEY,
  syllabus_id  TEXT NOT NULL REFERENCES syllabus (id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  papers       TEXT NOT NULL CHECK (json_valid(papers)),
  grades       TEXT NOT NULL DEFAULT '',
  sort_order   INTEGER NOT NULL DEFAULT 0,
  UNIQUE (syllabus_id, name)
);

-- Essential variants for this syllabus (overrides the library-wide default). JSON like {"m":[2],"s":[2],"w":[2]}.
ALTER TABLE syllabus ADD COLUMN essential_variants TEXT CHECK (essential_variants IS NULL OR json_valid(essential_variants));

-- A WITH ... VALUES list (D1 limits UNION ALL chains, so no compound SELECT here).
INSERT INTO syllabus_paper (id, syllabus_id, paper, name, format, tier, duration_min, marks, weighting_pct, note)
WITH p (paper, name, format, tier, duration_min, marks, weighting_pct) AS (VALUES
  (1, 'Multiple Choice (Core)', 'mcq', 'core', 45, 40, 30),
  (2, 'Multiple Choice (Extended)', 'mcq', 'extended', 45, 40, 30),
  (3, 'Theory (Core)', 'structured', 'core', 75, 80, 50),
  (4, 'Theory (Extended)', 'structured', 'extended', 75, 80, 50),
  (5, 'Practical Test', 'practical', 'all', 75, 40, 20),
  (6, 'Alternative to Practical', 'written', 'all', 60, 40, 20))
SELECT y.id || '-p' || p.paper, y.id, p.paper, p.name, p.format, p.tier, p.duration_min, p.marks, p.weighting_pct,
       CASE y.id WHEN '0625-2020' THEN 'Not checked against the 2020 to 2022 syllabus.' ELSE '' END
FROM syllabus y, p
WHERE y.code = '0625';

INSERT INTO syllabus_route (id, syllabus_id, name, papers, grades, sort_order)
SELECT y.id || '-core', y.id, 'Core', '[[1],[3],[5,6]]', 'C to G', 1 FROM syllabus y WHERE y.code = '0625';
INSERT INTO syllabus_route (id, syllabus_id, name, papers, grades, sort_order)
SELECT y.id || '-extended', y.id, 'Extended', '[[2],[4],[5,6]]', 'A* to G', 2 FROM syllabus y WHERE y.code = '0625';

-- Owner decision (1 Nov 2026): Pakistan sits variant 2, so variant 2 is essential.
UPDATE syllabus SET essential_variants = '{"m":[2],"s":[2],"w":[2]}' WHERE code = '0625';
UPDATE setting SET value = json_set(value, '$.essentialVariants', json('{"m":[2],"s":[2],"w":[2]}')) WHERE key = 'library';
