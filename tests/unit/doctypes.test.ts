// Pre-release material (pm), listening transcripts (qr), teachers' notes (tn), and Cambridge
// codes the library does not keep (owner report, 4 Nov 2026: "0478_w20_pm_21.pdf" was read as a
// second copy of the Paper 2 question paper).
import { test } from "node:test";
import assert from "node:assert/strict";
import { testDb } from "./helpers/d1.ts";
import { examName, nameFromParts, parseCambridgeName, unknownCambridgeType } from "../../src/lib/library/names.ts";
import { classifyFile } from "../../src/lib/agent/classify.ts";
import { coverPaperTitle, readCover } from "../../src/lib/library/cover.ts";
import { applyCover, finalise, paperTitleChecks, planFromNames } from "../../src/lib/library/folderPlan.ts";
import { buildChecklist, type Version } from "../../src/lib/library/checklist.ts";
import { buildSubjectMap } from "../../src/lib/library/map.ts";
import { toCambridgeName } from "../../src/lib/agent/links.ts";
import { describeFile, paperLookup, type Paper } from "../../src/lib/library/papers.ts";
import { LIBRARY_DEFAULTS } from "../../src/lib/settings.ts";

const SUBJECTS = [
  { code: "0478", name: "Computer Science", qualification: "IGCSE" },
  { code: "0520", name: "French", qualification: "IGCSE" },
  { code: "0417", name: "ICT", qualification: "IGCSE" },
];
const CODES = SUBJECTS.map((s) => s.code);
const YEARS = { fromYear: 2020, toYear: 2026 };

test("pm, qr and tn names parse; tn is written per paper without variants", () => {
  assert.deepEqual(parseCambridgeName("0478_w20_pm_21.pdf"), {
    fileName: "0478_w20_pm_21.pdf", code: "0478", session: "w", year: 2020, docType: "pm", paper: 2, variant: 1,
  });
  assert.equal(parseCambridgeName("0520_s23_qr_11.pdf")?.docType, "qr");
  const tn = parseCambridgeName("0520_s24_tn_03.pdf")!;
  assert.deepEqual([tn.docType, tn.paper, tn.variant], ["tn", 3, null]);
  assert.equal(parseCambridgeName("0625_s23_qp_04.pdf"), null, "only teachers' notes use the 03 form");
  assert.equal(examName("0520", "s", 2024, "tn", 3, null), "0520_s24_tn_03.pdf");
  assert.equal(nameFromParts("0520", { year: 2024, session: "s", type: "tn", paper: 3 }), "0520_s24_tn_03.pdf");
  assert.equal(nameFromParts("0478", { year: 2020, session: "w", type: "pm", paper: 2, variant: 1 }), "0478_w20_pm_21.pdf");
});

test("a Cambridge name with a code the library does not keep is never read as another type", () => {
  assert.deepEqual(unknownCambridgeType("0417_w24_sf_02.pdf"), { code: "0417", type: "sf", words: "source files for a practical paper" });
  assert.equal(unknownCambridgeType("0478_w20_pm_21.pdf"), null);
  assert.equal(unknownCambridgeType("Scan 4.pdf"), null);
  assert.match(unknownCambridgeType("0478_w20_zz_21.pdf")!.words, /zz/);

  const c = classifyFile(["Computer Science 0478", "2020"], "0478_w20_zz_21.pdf", SUBJECTS);
  assert.equal(c.name, null);
  assert.equal(c.notKept, "zz");

  const it = planFromNames(0, "ICT 0417/2024/0417_w24_sf_02.pdf", 1000, SUBJECTS, 1e8, YEARS);
  assert.equal(it.status, "not_needed");
  assert.match(it.why, /source files/);
  applyCover(it, readCover("ICT 0417/02\nPaper 2\nOctober/November 2024\nINSTRUCTIONS", CODES), "x", YEARS);
  assert.equal(it.status, "not_needed", "the first page cannot turn it into a question paper");
  assert.equal(it.name, null);
});

test("folder and file words name pre-release material, transcripts and teachers' notes", () => {
  assert.equal(classifyFile(["Computer Science (0478)", "2021", "Oct Nov"], "Pre-release Material 22.pdf", SUBJECTS).name, "0478_w21_pm_22.pdf");
  assert.equal(classifyFile(["French (0520)", "2023", "May June"], "Listening Transcript 12.pdf", SUBJECTS).name, "0520_s23_qr_12.pdf");
  assert.equal(classifyFile(["French (0520)", "2024", "May June"], "Teachers Notes 03.pdf", SUBJECTS).name, "0520_s24_tn_03.pdf");
  assert.equal(toCambridgeName("https://x.org/a/123-november-2020-pre-release-material-21.pdf", "0478"), "0478_w20_pm_21.pdf");
  assert.equal(toCambridgeName("https://x.org/a/123-june-2024-teachers-notes-03.pdf", "0520"), "0520_s24_tn_03.pdf");
  assert.equal(toCambridgeName("https://x.org/a/123-june-2023-transcript-11.pdf", "0520"), "0520_s23_qr_11.pdf");
});

const PM_COVER = "This document has 4 pages.\n© UCLES 2020 [Turn over\nCambridge IGCSE\nCOMPUTER SCIENCE 0478/21\nPaper 2 Problem-solving and Programming October/November 2020\nPRE-RELEASE MATERIAL\nINSTRUCTIONS\n● This material should be given to candidates on receipt.";
const QP_COVER = "This document has 16 pages.\n© UCLES 2020 [Turn over\nCambridge IGCSE\nCOMPUTER SCIENCE 0478/21\nPaper 2 Problem-solving and Programming October/November 2020\n1 hour 45 minutes\nYou must answer on the question paper.\nINSTRUCTIONS\n● Answer all questions.";

test("the front page reader knows pre-release material, transcripts and teachers' notes", () => {
  const pm = readCover(PM_COVER, CODES);
  assert.equal(pm.name, "0478_w20_pm_21.pdf");
  assert.deepEqual(pm.paperTitle, { paper: 2, name: "Problem-solving and Programming" });
  assert.equal(readCover(QP_COVER, CODES).name, "0478_w20_qp_21.pdf");
  assert.equal(readCover("FRENCH 0520/03\nPaper 3 Speaking May/June 2024\nTEACHERS’ NOTES", CODES).name, "0520_s24_tn_03.pdf");
  assert.equal(readCover("FRENCH 0520/12\nPaper 1 Listening May/June 2023\nTRANSCRIPT", CODES).name, "0520_s23_qr_12.pdf");
  assert.deepEqual(coverPaperTitle("PHYSICS 0625/11\nPaper 1 Multiple Choice (Core) May/June 2024"), { paper: 1, name: "Multiple Choice (Core)" });
  assert.equal(coverPaperTitle("Principal Examiner Report for Teachers\nPaper 0625 /11"), null);
});

test("owner's pair: the pre-release material and the question paper are two files, both uploaded", () => {
  const pm = planFromNames(0, "computers science 0478/2020/2020 November/0478_w20_pm_21.pdf", 120_000, SUBJECTS, 1e8, YEARS);
  const qp = planFromNames(1, "computers science 0478/2020/2020 November/0478_w20_qp_21.pdf", 900_000, SUBJECTS, 1e8, YEARS);
  applyCover(pm, readCover(PM_COVER, CODES), PM_COVER, YEARS);
  applyCover(qp, readCover(QP_COVER, CODES), QP_COVER, YEARS);
  finalise([pm, qp], { have: new Set(), codes: CODES, fromYear: 2020, toYear: 2026 });
  assert.deepEqual([pm.status, pm.name], ["new", "0478_w20_pm_21.pdf"]);
  assert.deepEqual([qp.status, qp.name], ["new", "0478_w20_qp_21.pdf"]);
});

function versions(code: string): Version[] {
  const db = testDb();
  return db.raw.prepare("SELECT id, code, title, valid_from_year, valid_to_year, expected, essential_variants FROM syllabus WHERE code = ? ORDER BY valid_from_year").all(code) as Version[];
}
const papersOf = (code: string) => testDb().raw.prepare("SELECT p.* FROM syllabus_paper p JOIN syllabus s ON s.id = p.syllabus_id WHERE s.code = ?").all(code) as Paper[];

test("checklist: 0478 Paper 2 asks for its pre-release material to 2022; French has transcripts and teachers' notes", () => {
  const lib = { ...LIBRARY_DEFAULTS, fromYear: 2020 };
  const cs = buildChecklist("0478", versions("0478"), [], lib);
  const w20 = cs.sessions.find((g) => g.label === "November 2020")!;
  const row = w20.rows.find((r) => r.paper === 2 && r.variant === 2)!;
  assert.equal(row.cells.pm?.fileName, "0478_w20_pm_22.pdf");
  assert.equal(row.cells.pm?.essential, true);
  assert.ok(!w20.rows.find((r) => r.paper === 1)!.cells.pm, "Paper 1 has none");
  const w23 = cs.sessions.find((g) => g.label === "November 2023")!;
  assert.ok(w23.rows.every((r) => !r.cells.pm), "the 2023 syllabus has no pre-release material");

  const fr = buildChecklist("0520", versions("0520"), [], lib);
  const s24 = fr.sessions.find((g) => g.label === "June 2024")!;
  const p1 = s24.rows.find((r) => r.paper === 1 && r.variant === 2)!;
  assert.deepEqual([p1.cells.qr?.fileName, p1.cells.qr?.essential], ["0520_s24_qr_12.pdf", false]);
  const tn = s24.docs.find((c) => c.docType === "tn")!;
  assert.deepEqual([tn.fileName, tn.essential], ["0520_s24_tn_03.pdf", false]);
  const map = buildSubjectMap(fr, papersOf("0520"));
  const first = map.find((v) => v.id === "0520-2021")!.rows.find((r) => r.label.startsWith("June 2024"))!;
  assert.equal(first.docs?.tn?.fileName, "0520_s24_tn_03.pdf", "teachers' notes sit with the whole-session files");
});

test("0478 2020 paper names come from the covers, and covers that disagree with the library are listed", () => {
  const papers = papersOf("0478");
  const look = paperLookup(papers);
  assert.equal(describeFile("0478_w20_pm_21.pdf", "0478-2020", look), "November 2020, Paper 2 Problem-solving and Programming, variant 1, pre-release material");
  assert.equal(describeFile("0478_w20_qp_11.pdf", "0478-2020", look), "November 2020, Paper 1 Theory, variant 1, question paper");

  const qp = planFromNames(0, "cs/0478_w20_qp_21.pdf", 900_000, SUBJECTS, 1e8, YEARS);
  applyCover(qp, readCover(QP_COVER, CODES), QP_COVER, YEARS);
  const versionOf = () => "0478-2020";
  assert.deepEqual(paperTitleChecks([qp], papers, versionOf), [], "matches after the fix");
  const wrong = papers.map((p) => (p.syllabus_id === "0478-2020" && p.paper === 2 ? { ...p, name: "Algorithms, Programming and Logic" } : p));
  assert.deepEqual(paperTitleChecks([qp], wrong, versionOf), [
    { versionId: "0478-2020", paper: 2, library: "Algorithms, Programming and Logic", cover: "Problem-solving and Programming", example: "0478_w20_qp_21.pdf" },
  ]);
});
