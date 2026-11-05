// The Sources page per subject: Cambridge's scan against the library, folders by subject.
import { test } from "node:test";
import assert from "node:assert/strict";
import { folderCode, pageKind, scanSummary } from "../../src/lib/library/sourcesView.ts";
import { testDb } from "./helpers/d1.ts";

test("a Cambridge page's scan is read as Cambridge names, against the library", () => {
  const links = JSON.stringify([
    "https://www.cambridgeinternational.org/Images/570010-june-2024-question-paper-11.pdf",
    "https://www.cambridgeinternational.org/Images/570004-june-2024-mark-scheme-paper-11.pdf",
    "https://www.cambridgeinternational.org/Images/123-teacher-guide.pdf",
  ]);
  const s = scanSummary(links, "0625", new Set(["0625_s24_qp_11.pdf"]));
  assert.deepEqual([s.total, s.have, s.missing, s.unnamed], [3, 1, ["0625_s24_ms_11.pdf"], 1]);
  assert.equal(s.missingText, "June 2024: 1 mark scheme");
  assert.equal(scanSummary("not json", "0625", new Set()).total, 0);
});

test("folders belong to the subject their label names; page kinds in words", () => {
  assert.equal(folderCode("IGCSE Physics (0625)", ["0625", "0620"]), "0625");
  assert.equal(folderCode("Revision (2021)", ["0625"]), null);
  assert.equal(pageKind("https://www.cambridgeinternational.org/programmes-and-qualifications/cambridge-igcse-physics-0625/past-papers/"), "Past papers page");
  assert.equal(pageKind("https://www.cambridgeinternational.org/programmes-and-qualifications/cambridge-igcse-physics-0625/"), "Subject page");
});

test("the scan is seeded for all 16 subjects, two pages each", () => {
  const db = testDb();
  const rows = db.raw.prepare("SELECT syllabus_code, json_array_length(last_scan) AS n FROM source_page WHERE last_scan_at IS NOT NULL").all() as { syllabus_code: string; n: number }[];
  assert.equal(new Set(rows.map((r) => r.syllabus_code)).size, 16);
  assert.equal(rows.length, 32);
  assert.ok(rows.every((r) => r.n > 0), "every page lists files");
});
