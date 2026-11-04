import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyFile, driveFolderId, folderDecision, readFolder, type KnownSubject } from "../../src/lib/agent/classify.ts";

const SUBJECTS: KnownSubject[] = [{ code: "0625", name: "Physics", qualification: "IGCSE" }];
const name = (path: string[], file: string) => classifyFile(path, file, SUBJECTS).name;

test("Cambridge-named files are taken as they are, in any spelling", () => {
  for (const f of ["0625_s23_qp_42.pdf", "0625_S23_QP_42.PDF", "0625 s23 qp 42.pdf", "0625-s23-qp-42 (1).pdf"]) {
    const c = classifyFile(["anything"], f, SUBJECTS);
    assert.deepEqual([c.name, c.confidence], ["0625_s23_qp_42.pdf", "high"], f);
  }
  // Subjects not in the library are named too, so the agent can count them per subject.
  assert.equal(name([], "0620_s23_qp_42.pdf"), "0620_s23_qp_42.pdf");
});

test("descriptive names are read with help from the folders", () => {
  const p = ["IGCSE", "Physics (0625)", "2023", "May June"];
  assert.equal(name(p, "Question Paper 42.pdf"), "0625_s23_qp_42.pdf");
  assert.equal(name(p, "Mark Scheme - Paper 4 Variant 2.pdf"), "0625_s23_ms_42.pdf");
  assert.equal(name(p, "MS P4 V2.pdf"), "0625_s23_ms_42.pdf");
  assert.equal(name(p, "Examiner Report.pdf"), "0625_s23_er.pdf");
  assert.equal(name(p, "Grade Thresholds.pdf"), "0625_s23_gt.pdf");
  assert.equal(name(p, "Confidential Instructions Paper 52.pdf"), "0625_s23_ci_52.pdf");
  assert.equal(name(["Physics 0625", "2022", "Oct-Nov"], "qp_21.pdf"), "0625_w22_qp_21.pdf");
  assert.equal(name(["Physics 0625", "Feb March 2024"], "Paper 2 Variant 2 QP.pdf"), "0625_m24_qp_22.pdf");
  assert.equal(name(["IGCSE Physics"], "Physics_June_2021_QP_31.pdf"), "0625_s21_qp_31.pdf");
  assert.equal(name(["Physics"], "s24 ms 41.pdf"), "0625_s24_ms_41.pdf");
  const c = classifyFile(p, "Question Paper 42.pdf", SUBJECTS);
  assert.equal(c.confidence, "medium");
  assert.match(c.why, /syllabus from folder/);
});

test("specimens and syllabus documents", () => {
  const p = ["Physics 0625", "Specimen Papers 2023"];
  assert.equal(name(p, "Specimen Paper 4.pdf"), "0625_y23_sp_4.pdf");
  assert.equal(name(p, "Specimen Paper 4 Mark Scheme.pdf"), "0625_y23_sm_4.pdf");
  assert.equal(name(["Physics 0625"], "Syllabus 2026.pdf"), "0625_y26_sy.pdf");
  assert.equal(name(["Physics 0625"], "Syllabus Update 2023.pdf"), "0625_y23_su.pdf");
});

test("incomplete or unrelated files are left out, with the reason", () => {
  const c1 = classifyFile(["Physics 0625", "2023"], "Question Paper 42.pdf", SUBJECTS);
  assert.equal(c1.name, null);
  assert.match(c1.why, /session/);
  const c2 = classifyFile(["Physics 0625", "2023", "May June"], "Question Paper 4.pdf", SUBJECTS);
  assert.match(c2.why, /variant/);
  assert.match(classifyFile(["Chemistry", "2023", "May June"], "Question Paper 42.pdf", SUBJECTS).why, /subject/);
  assert.match(classifyFile(["Physics 0625"], "notes.docx", SUBJECTS).why, /not a PDF/);
  assert.match(classifyFile(["Physics 0625", "2023", "May June"], "Revision notes.pdf", SUBJECTS).why, /document type/);
});

test("a folder name says what it can on its own", () => {
  assert.deepEqual(readFolder("IGCSE Physics (0625)", SUBJECTS), { code: "0625", subject: "IGCSE Physics", inLibrary: true, year: null, session: null });
  assert.deepEqual(readFolder("2023 May-June", SUBJECTS), { code: null, subject: null, inLibrary: false, year: 2023, session: "s" });
  assert.deepEqual(readFolder("w22", SUBJECTS), { code: null, subject: null, inLibrary: false, year: 2022, session: "w" });
  assert.deepEqual(readFolder("Specimens", SUBJECTS), { code: null, subject: null, inLibrary: false, year: null, session: "y" });
  // Subjects not in the library yet are still read by their code; years are never taken for codes.
  assert.deepEqual(readFolder("History (0470)", SUBJECTS), { code: "0470", subject: null, inLibrary: false, year: null, session: null });
  assert.equal(readFolder("Specimen Papers (2023)", SUBJECTS).code, null);
  assert.equal(readFolder("O Level Computer Science (2210)", SUBJECTS).code, "2210");
  // A bare number outside the library is part of a document number, never a subject code.
  assert.equal(readFolder("O Level Computer Science 2210", SUBJECTS).code, null);
  assert.equal(classifyFile(["Physics (0625)", "2019"], "1524 revision guide.pdf", SUBJECTS).code, "0625");
});

test("files of subjects not in the library are understood from their folders", () => {
  assert.deepEqual(classifyFile(["Computer Science (0478)", "2016", "Specimen Papers"], "167432-specimen-paper-2-2016.pdf", SUBJECTS).name, "0478_y16_sp_2.pdf");
  assert.equal(name(["IGCSE History (0470)", "2023", "May June"], "Question Paper 21.pdf"), "0470_s23_qp_21.pdf");
});

test("Drive folder links give their id; anything else does not", () => {
  assert.equal(driveFolderId("https://drive.google.com/drive/folders/1-CQZbc8dAxai2Qw-bpddpDudpSIASiaT?usp=sharing"), "1-CQZbc8dAxai2Qw-bpddpDudpSIASiaT");
  assert.equal(driveFolderId("https://drive.google.com/drive/u/0/folders/1BEumj8GOd4x0UOVkk8Cq5o5guTgBSeo2"), "1BEumj8GOd4x0UOVkk8Cq5o5guTgBSeo2");
  assert.equal(driveFolderId("https://drive.google.com/open?id=1BEumj8GOd4x0UOVkk8Cq5o5guTgBSeo2"), "1BEumj8GOd4x0UOVkk8Cq5o5guTgBSeo2");
  assert.equal(driveFolderId("1BEumj8GOd4x0UOVkk8Cq5o5guTgBSeo2"), "1BEumj8GOd4x0UOVkk8Cq5o5guTgBSeo2");
  for (const bad of ["https://evil.example/drive/folders/1BEumj8GOd4x0UOVkk8Cq5o5guTgBSeo2", "https://docs.google.com/document/d/abc", "short", ""]) {
    assert.equal(driveFolderId(bad), null, bad);
  }
});

test("folders are opened only when they can hold what the run wants", () => {
  const run = { code: "0625", years: [2024, 2023], sessions: ["s" as const, "w" as const] };
  const open = (n: string) => folderDecision(n, run, SUBJECTS).open;
  assert.equal(open("2019"), "no");
  assert.equal(open("2024"), "yes");
  assert.equal(open("2023 May-June"), "yes");
  assert.equal(open("2023 Feb-March"), "no");
  assert.equal(open("Feb March"), "no");
  assert.equal(open("Oct Nov"), "yes");
  assert.equal(open("Chemistry (0620)"), "no");
  assert.equal(open("Specimen Papers"), "no", "specimens only when the run asks for them");
  assert.equal(folderDecision("Specimen Papers", { ...run, sessions: ["y"] }, SUBJECTS).open, "yes");
  assert.equal(open("Topical Past Papers"), "unsure", "names the rules cannot read go to the AI");
  assert.equal(open("Extended"), "unsure");
});

test("Google Drive refusals get reasons people can act on", async () => {
  const { DriveError, driveRefusal } = await import("../../scripts/agent/drive.ts");
  const { reasonText } = await import("../../src/lib/agent/labels.ts");
  assert.equal(driveRefusal(new DriveError(403, "downloadQuotaExceeded")), "drive_quota");
  assert.equal(driveRefusal(new DriveError(403, "userRateLimitExceeded")), "drive_rate");
  assert.equal(driveRefusal(new DriveError(429, "")), "drive_rate");
  assert.equal(driveRefusal(new DriveError(403, "cannotDownloadFile")), "drive_forbidden");
  assert.equal(driveRefusal(new DriveError(404, "notFound")), "drive_missing");
  assert.match(reasonText("drive_quota"), /download limit/);
  assert.match(reasonText("drive_paused"), /run the download again later/i);
});
