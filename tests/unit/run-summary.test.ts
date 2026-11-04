import { test } from "node:test";
import assert from "node:assert/strict";
import { checkRewrite, ruleSummary, type SummaryFacts } from "../../src/lib/agent/runSummary.ts";

const base: SummaryFacts = {
  subject: "IGCSE Physics (0625)", mode: "dry", years: [2025, 2024, 2023, 2022], sessions: ["March", "June", "November", "Specimen"], allSessions: true,
  websitePages: 2, driveFolders: [{ name: "IGCSE Physics (0625)", yearsHeld: [2002, 2025], notOpened: 70 }], driveOtherSubjects: 15,
  found: 371, have: 57, outside: 3, stored: 0, failed: 0, notNeeded: 0, review: 0, notNamed: 0, maxFiles: 400,
};

test("the rules write the facts, and say plainly when nothing was cut short", () => {
  const s = ruleSummary(base);
  assert.match(s, /^Dry run for IGCSE Physics \(0625\), 2022 to 2025, all sessions: found 371 new files, and 57 files were already in the library\./);
  assert.match(s, /the Drive copy holds 2002 to 2025; 70 folders outside this run were not opened\./);
  assert.match(s, /Nothing was cut short\./);
  assert.match(s, /Next: press Download to fetch the 371 files\./);
  assert.doesNotMatch(s, /[\u2013\u2014]/);
});

test("real limits are named: a big Drive folder, more files than one download takes", () => {
  const s = ruleSummary({ ...base, found: 450, driveFolders: [{ name: "IGCSE Physics (0625)", truncated: true }] });
  assert.match(s, /Limits: a Drive folder was larger than one run reads, so it stopped early; one download stores at most 400 files/);
});

test("nothing found for a year no source has yet says so", () => {
  const s = ruleSummary({ ...base, years: [2026], allSessions: false, sessions: ["June"], found: 0, have: 2 });
  assert.match(s, /Next: no source has 2026 yet; try 2022 to 2025\./);
});

test("the AI's rewording is kept only when it says the same thing", () => {
  const draft = ruleSummary(base);
  // The owner's real case: the model invented a limit and a next step.
  assert.equal(checkRewrite(draft, "This run found 371 new files for IGCSE Physics (0625) from 2022 to 2025, across various sessions. " +
    "The search was limited by the number of website pages read. The most useful next step is to read more website pages."), null);
  // A number changed or dropped: rejected.
  assert.equal(checkRewrite(draft, "The dry run found 370 new Physics files for 2022 to 2025; 57 were already in the library. It read 2 website pages and the Drive folder, which holds 2002 to 2025, and skipped 70 folders. Nothing was cut short. Press Download to fetch the 371 files."), null);
  const good = "The dry run for IGCSE Physics (0625), 2022 to 2025, found 371 new files; 57 were already in the library. " +
    "It read 2 website pages and the Drive folder, which holds 2002 to 2025, and left 70 folders outside the run unopened. " +
    "Nothing was cut short. Press Download to fetch the 371 files.";
  assert.equal(checkRewrite(draft, good), good);
  assert.equal(checkRewrite(draft, good.replace("; 57", " \u2014 57")), good.replace("; 57", ", 57"));
});
