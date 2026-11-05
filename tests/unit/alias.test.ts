// Other codes for a library syllabus: 1524 was IGCSE Physics (0625) in Cambridge's Pakistan-only
// 2021 series (owner report, 4 Nov 2026: five 1524_j21_* files went to Needs your eye).
import { test } from "node:test";
import assert from "node:assert/strict";
import { testBucket, testDb } from "./helpers/d1.ts";
import { classifyFile, folderDecision, mainOf } from "../../src/lib/agent/classify.ts";
import { readCover } from "../../src/lib/library/cover.ts";
import { applyCover, finalise, noteFor, planFromNames } from "../../src/lib/library/folderPlan.ts";
import { knownSubjects, loadSyllabus } from "../../src/lib/library/catalog.ts";
import { learnAlias } from "../../src/lib/library/alias.ts";
import { storeDocument } from "../../src/lib/library/store.ts";
import { buildSubjectMap } from "../../src/lib/library/map.ts";
import type { Paper } from "../../src/lib/library/papers.ts";

const pdf = (t: string) => new TextEncoder().encode(`%PDF-1.4\n% ${t}\n%%EOF`);
const COVER = "This document has 16 pages.\nIB21 06_1524_12/RP\n© UCLES 2021\n[Turn over\nCambridge IGCSE\nPHYSICS 1524/12\nPaper 1 Multiple Choice (Core) May/June 2021\n45 minutes\nYou must answer on the multiple choice answer sheet.";
const setYears = (db: ReturnType<typeof testDb>) =>
  db.raw.prepare(`UPDATE setting SET value = json_set(value, '$.fromYear', 2020) WHERE key = 'library'`).run();

test("1524 is Physics 0625's Pakistan series: names, folders and first pages", async () => {
  const db = testDb();
  const subjects = await knownSubjects(db);
  const pk = subjects.find((s) => s.code === "1524")!;
  assert.deepEqual([pk.name, pk.main], ["Physics", "0625"]);
  assert.equal(mainOf(subjects, "1524"), "0625");
  assert.equal(classifyFile(["Physics (0625)", "2021", "2021 July (Pakistan only)"], "1524_j21_qp_12.pdf", subjects).name, "1524_s21_qp_12.pdf");
  assert.equal(classifyFile(["Physics (0625)", "2021"], "1524_j21_gt.pdf", subjects).name, "1524_s21_gt.pdf");
  assert.equal(readCover(COVER, subjects.map((s) => s.code)).name, "1524_s21_qp_12.pdf");
  assert.equal(folderDecision("Physics 1524", { code: "0625", years: [2021], sessions: ["s"] }, subjects).open, "yes");
});

test("the owner's five files: all uploaded under their own names, none to Needs your eye", async () => {
  const db = testDb();
  const subjects = await knownSubjects(db);
  const codes = subjects.map((s) => s.code);
  const years = { fromYear: 2020, toYear: 2026 };
  const files = ["1524_j21_gt.pdf", "1524_j21_ms_12.pdf", "1524_j21_ms_22.pdf", "1524_j21_qp_12.pdf", "1524_j21_qp_22.pdf"];
  const plan = files.map((f, i) => planFromNames(i, `Physics (0625)/2021/2021 July (Pakistan only)/${f}`, 1000 + i, subjects, 1e8, years));
  applyCover(plan[3]!, readCover(COVER, codes), COVER, years);
  finalise(plan, { have: new Set(), codes, ...years });
  assert.deepEqual(plan.map((p) => [p.status, p.name]), [
    ["new", "1524_s21_gt.pdf"], ["new", "1524_s21_ms_12.pdf"], ["new", "1524_s21_ms_22.pdf"], ["new", "1524_s21_qp_12.pdf"], ["new", "1524_s21_qp_22.pdf"],
  ]);
});

test("stored 1524 files sit in Physics June 2021 as their own series, variant 2 essential", async () => {
  const db = testDb();
  setYears(db);
  const bucket = testBucket();
  const out = await storeDocument(db, bucket, { fileName: "1524_s21_qp_12.pdf", bytes: pdf("pk"), origin: "upload", actorId: "t" });
  assert.equal(out.ok, true);
  const list = (await loadSyllabus(db, "0625"))!;
  const june = list.sessions.find((g) => g.label === "June 2021")!;
  assert.deepEqual(june.series, [{ code: "1524", label: "Pakistan series (1524)" }]);
  const pk = june.rows.filter((r) => r.series === "1524");
  const p1 = pk.find((r) => r.paper === 1 && r.variant === 2)!;
  assert.equal(p1.essential, true);
  assert.equal(p1.cells.qp?.fileName, "1524_s21_qp_12.pdf");
  assert.ok(p1.cells.qp?.doc, "the stored file is ticked");
  assert.ok(june.docs.some((c) => c.fileName === "1524_s21_gt.pdf"));
  assert.ok(!list.others.some((c) => c.fileName.startsWith("1524")), "not under other stored files");
  assert.ok(!list.sessions.find((g) => g.label === "November 2021")!.series.length, "only the June series");

  const papers = db.raw.prepare("SELECT p.* FROM syllabus_paper p JOIN syllabus s ON s.id = p.syllabus_id WHERE s.code = '0625'").all() as Paper[];
  const map = buildSubjectMap(list, papers).find((v) => v.id === "0625-2020")!;
  const row = map.rows.find((r) => r.series === "1524")!;
  assert.equal(row.label, "June 2021, Pakistan series (1524)");
  assert.equal(row.docs?.gt?.fileName, "1524_s21_gt.pdf");
  assert.ok(map.rows.find((r) => r.label === "June 2021")?.docs?.gt?.fileName.startsWith("0625_"), "the main row keeps its own files");

  // Outside the series (another year) a 1524 file has no syllabus.
  assert.equal((await storeDocument(db, bucket, { fileName: "1524_s22_qp_12.pdf", bytes: pdf("x"), origin: "upload", actorId: "t" })).ok, false);
});

test("a cover with an unknown code next to a library subject links the code by itself", async () => {
  const db = testDb();
  const cover = readCover("Cambridge IGCSE\nCHEMISTRY 1525/22\nPaper 2 Multiple Choice (Extended) May/June 2021\nYou must answer", ["0620"]);
  assert.deepEqual(cover.unknownCode, { code: "1525", subjectWord: "CHEMISTRY", session: "s", year: 2021 });
  const r = await learnAlias(db, cover.unknownCode!);
  assert.ok(r.ok && r.alias.main_code === "0620");
  assert.equal(readCover("Cambridge IGCSE\nCHEMISTRY 1525/22\nPaper 2 May/June 2021\nYou must answer on the question paper.", ["0620", "1525"]).name, "1525_s21_qp_22.pdf");
  // A later year widens it; a library code, an unknown subject or junk are refused.
  const again = await learnAlias(db, { code: "1525", subjectWord: "Chemistry", year: 2022, session: "w" });
  assert.ok(again.ok && again.alias.to_year === 2022 && again.alias.sessions === "sw");
  assert.deepEqual(await learnAlias(db, { code: "0625", subjectWord: "Chemistry", year: 2021, session: "s" }), { ok: false, reason: "known" });
  assert.deepEqual(await learnAlias(db, { code: "1999", subjectWord: "Astrology", year: 2021, session: "s" }), { ok: false, reason: "no_subject" });
  assert.deepEqual(await learnAlias(db, { code: "12a4", subjectWord: "Physics", year: 2021, session: "s" }), { ok: false, reason: "bad" });
  assert.equal(readCover("Physics notes\nPHYSICS 1524/12 May/June 2021", ["0625"]).unknownCode, undefined, "no Cambridge mark, no learning");
});

test("owner's Maths folder: 1521 files are linked to 0580 from their folder, then all uploaded", async () => {
  const db = testDb();
  let subjects = await knownSubjects(db);
  const years = { fromYear: 2020, toYear: 2026 };
  const dir = "Maths 0580/2021/2021 July (Pakistan only)";
  const files = ["1521_j21_er_32.pdf", "1521_j21_er_42.pdf", "1521_j21_gt.pdf", "1521_j21_ms_32.pdf", "1521_j21_qp_42.pdf"];
  const first = planFromNames(0, `${dir}/${files[0]}`, 1000, subjects, 1e8, years);
  assert.deepEqual([first.name, first.aliasOf], ["1521_s21_er_32.pdf", "0580"]);
  // The page links the code (as the folder says Pakistan), then plans with it.
  const r = await learnAlias(db, { code: "1521", mainCode: "0580", label: "Pakistan series", year: 2021, session: "s" });
  assert.ok(r.ok && r.alias.main_code === "0580" && r.alias.label === "Pakistan series");
  subjects = await knownSubjects(db);
  assert.equal(subjects.find((s) => s.code === "1521")?.series, "Pakistan series");
  const plan = files.map((f, i) => planFromNames(i, `${dir}/${f}`, 1000 + i, subjects, 1e8, years));
  finalise(plan, { have: new Set(["0580_s21_er.pdf"]), codes: subjects.map((s) => s.code), ...years });
  assert.deepEqual(plan.map((p) => p.status), ["new", "new", "new", "new", "new"]);
  assert.match(noteFor(plan[3]!, { ...years, describe: (n) => n, seriesOf: (c) => (c === "1521" ? "Pakistan series (1521)" : null) }), /Part of the Pakistan series \(1521\), stored with its subject/);
  // A folder code is never used to link a library code, and a bad main code is refused.
  assert.deepEqual(await learnAlias(db, { code: "0620", mainCode: "0580", year: 2021, session: "s" }), { ok: false, reason: "known" });
  assert.deepEqual(await learnAlias(db, { code: "1777", mainCode: "9999", year: 2021, session: "s" }), { ok: false, reason: "no_subject" });
});

test("owner's ms_33 trio: a first page misread as ms_31 does not beat the file names; the copy is a copy", async () => {
  const db = testDb();
  const subjects = await knownSubjects(db);
  const years = { fromYear: 2020, toYear: 2026 };
  const dir = "Maths 0580/2021/2021 June";
  const a = planFromNames(0, `${dir}/0580_s21_ms_31.pdf`, 5000, subjects, 1e8, years);
  const b = planFromNames(1, `${dir}/0580_s21_ms_33(1).pdf`, 7000, subjects, 1e8, years);
  const c = planFromNames(2, `${dir}/0580_s21_ms_33.pdf`, 7000, subjects, 1e8, years);
  const misread = readCover("Cambridge IGCSE\nMATHEMATICS 0580/31\nPaper 3 (Core) May/June 2021\nMARK SCHEME", ["0580"]);
  applyCover(b, misread, "x", years);
  applyCover(c, misread, "x", years);
  assert.equal(c.name, "0580_s21_ms_31.pdf", "the cover renames first");
  finalise([a, b, c], { have: new Set(), codes: ["0580"], ...years });
  assert.deepEqual([a.status, a.name], ["new", "0580_s21_ms_31.pdf"]);
  assert.deepEqual([b.status, b.name], ["new", "0580_s21_ms_33.pdf"]);
  assert.deepEqual([c.status, c.name, c.dupOf], ["duplicate", "0580_s21_ms_33.pdf", "Maths 0580 / 2021 / 2021 June / 0580_s21_ms_33(1).pdf"]);
  const words = { ...years, describe: (n: string) => n };
  assert.match(noteFor(b, words), /Kept its file name/);
  assert.match(noteFor(c, words), /^A copy of .*Only one is uploaded\.$/);
});
