-- The Google Drive collection linked from revisiontown.com's IGCSE past papers page (owner request,
-- 2 Nov 2026): 16 shared folders, read from that page once. The agent works out what each folder
-- holds on its first run; revisiontown.com itself is never crawled (its robots.txt blocks AI agents).

INSERT INTO source_site (id, name, base_url, enabled, notes, created_by, created_at, kind) VALUES
  ('revisiontown-drive', 'Revisiontown collection (Google Drive)', 'https://drive.google.com/', 1,
   'Shared folders linked from revisiontown.com/igcse-past-papers. Third-party copies of Cambridge papers; owner decision 2 Nov 2026.',
   'platform-admin', 1793577600000, 'gdrive')
ON CONFLICT DO NOTHING;

-- Attached to whichever source has the Drive address (the owner may have added one already).
INSERT INTO source_drive_folder (id, site_id, folder_id, created_by, created_at)
WITH f (id, folder_id) AS (VALUES
  ('rt-01', '1-CQZbc8dAxai2Qw-bpddpDudpSIASiaT'),
  ('rt-02', '187ppeu_FyUskOb8--2KOqVrGnkcIVHe5'),
  ('rt-03', '18Hpg4LjOnw7KgRmXqtAq6MTbM5bpwBFx'),
  ('rt-04', '1A1OHb2CW5cmCSyQf_cqZGemNQtskhgL_'),
  ('rt-05', '1BEumj8GOd4x0UOVkk8Cq5o5guTgBSeo2'),
  ('rt-06', '1Baa4OKIzjjtHzwcy1-xwjBuCDMLh2FlW'),
  ('rt-07', '1CnorPO8wNZNkjvQ6LwzkINZXRo24T6-1'),
  ('rt-08', '1EWccBxwaoV4sjCSHG4DadcpIXUVqtdap'),
  ('rt-09', '1GZUs34yS5dMmhO8Pm8rWokkS7VBQ5bqF'),
  ('rt-10', '1Ji-VoRovspqnZtvxhJW1CCdeMilxQBCX'),
  ('rt-11', '1YHvXgahzgsFwkcg3vzpHSrVdj_GnCq7E'),
  ('rt-12', '1aNqqrZ6Orl1qyBNsLr8BPhuezofGgXGi'),
  ('rt-13', '1lTj44aH3tLLEbfK0Tnb5WFG1cwKV3tEJ'),
  ('rt-14', '1lU4WqKULYiCJzCKPVJYDwsvFVudRB-as'),
  ('rt-15', '1tCMnYUtHJ1jQAqmagUw1h5pWrtHxNwYE'),
  ('rt-16', '1xofPQTwhu7pUS0KqO7ielXj0fvmRBTuH'))
SELECT f.id, s.id, f.folder_id, 'platform-admin', 1793577600000
FROM f, source_site s WHERE s.base_url = 'https://drive.google.com/'
ON CONFLICT DO NOTHING;
