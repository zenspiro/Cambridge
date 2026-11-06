// The topic tree (Phase 2 step 1): reading every page of a PDF, the word check, numbering, missing headings,
// comparing two AIs, the verdict, and runs and saving on a SQLite copy of the schema. The syllabus text here is
// written for the test (not Cambridge's wording).
import { test } from "node:test";
import assert from "node:assert/strict";
import { inflateSync, constants } from "node:zlib";
import { allPagesText, firstPageText } from "../../src/lib/pdf/firstPage.ts";
import {
  buildTree, checkNumbers, checkWords, cleanDraft, compareDrafts, coverage, flaggedGoals, goalLabels, isReady,
  missingHeadings, retryNotes, similarity, textIndex, type Draft,
} from "../../src/lib/brain/topics.ts";
import { TOPIC_SCHEMA, TOPIC_SCHEMA_GEMINI, retryPrompt, topicPrompt } from "../../src/lib/brain/prompts.ts";
import {
  activeBrainRun, brainStep, claimBrainRun, cleanReport, closeStaleBrainRuns, failBrainRun, loadTree, saveTree,
  startTreeRun, treesForCode,
} from "../../src/lib/brain/runs.ts";
import { BRAIN } from "../../src/lib/config.ts";
import { testDb } from "./helpers/d1.ts";

const inflate = async (d: Uint8Array) => new Uint8Array(inflateSync(d, { finishFlush: constants.Z_SYNC_FLUSH }));
const NOW = Date.UTC(2026, 10, 5);

/** A small uncompressed PDF with one page per list of lines (a page tree with two levels). */
function pagesPdf(pages: string[][]): Uint8Array {
  const enc = (s: string) => new TextEncoder().encode(s);
  const esc = (s: string) => s.replace(/[\\()]/g, (c) => `\\${c}`);
  const bodies: string[] = [];
  const add = (b: string) => (bodies.push(b), bodies.length);
  const font = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  const contents = pages.map((lines) => {
    const ops = ["BT", "/F1 11 Tf", ...lines.map((l, i) => `1 0 0 1 50 ${780 - i * 16} Tm (${esc(l)}) Tj`), "ET"].join("\n");
    return add(`<< /Length ${enc(ops).length} >>\nstream\n${ops}\nendstream`);
  });
  const root = bodies.length + pages.length + 2; // pages, then an inner Pages node, then the root Pages
  const inner = root - 1;
  const pageIds = contents.map((c, i) => add(`<< /Type /Page /Parent ${i === 0 ? root : inner} 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 ${font} 0 R >> >> /Contents ${c} 0 R >>`));
  add(`<< /Type /Pages /Parent ${root} 0 R /Kids [${pageIds.slice(1).map((p) => `${p} 0 R`).join(" ")}] /Count ${pageIds.length - 1} >>`);
  add(`<< /Type /Pages /Kids [${pageIds[0]} 0 R ${inner} 0 R] /Count ${pageIds.length} >>`);
  add(`<< /Type /Catalog /Pages ${root} 0 R >>`);
  return enc(`%PDF-1.7\n${bodies.map((b, i) => `${i + 1} 0 obj\n${b}\nendobj`).join("\n")}\ntrailer\n<< >>\n%%EOF\n`);
}

// A made-up syllabus in the usual shape: two sections, numbered topics, Core and Supplement goals.
const LINES = [
  ["Syllabus", "Contents", "3 Subject content .......... 9", "1.1 Moving objects 9"],
  [
    "3 Subject content",
    "1 Moving things",
    "1.1 Moving objects",
    "Core",
    "1 Describe how a trolley rolls down a ramp and",
    "explain why it speeds up",
    "2 Measure the time a pendulum takes for ten swings",
    "Supplement",
    "3 Calculate the average speed of a cyclist from a",
    "distance and a time",
  ],
  [
    "1.2 Pushing and pulling",
    "Core",
    "1 State that a push or a pull is called a force",
    "2 Pushing and pulling continued",
    "2 Warm things",
    "2.1 Heating water",
    "1 Describe what happens to water heated in a kettle",
  ],
];

const PAGES = LINES.map((l) => l.join("\n"));

const GOOD: Draft = {
  topics: [
    { number: "1", title: "Moving things", parent: "" },
    { number: "1.1", title: "Moving objects", parent: "1" },
    { number: "1.2", title: "Pushing and pulling", parent: "1" },
    { number: "2", title: "Warm things", parent: "" },
    { number: "2.1", title: "Heating water", parent: "2" },
  ],
  goals: [
    { topic: "1.1", number: "1", text: "Describe how a trolley rolls down a ramp and explain why it speeds up", tier: "core", notes: "" },
    { topic: "1.1", number: "2", text: "Measure the time a pendulum takes for ten swings", tier: "core", notes: "" },
    { topic: "1.1", number: "3", text: "Calculate the average speed of a cyclist from a distance and a time", tier: "supplement", notes: "" },
    { topic: "1.2", number: "1", text: "State that a push or a pull is called a force", tier: "core", notes: "" },
    { topic: "2.1", number: "1", text: "Describe what happens to water heated in a kettle", tier: "core", notes: "" },
  ],
};

const copy = (d: Draft): Draft => JSON.parse(JSON.stringify(d)) as Draft;

test("every page of a PDF is read, in page tree order; the first page reader still reads only page 1", async () => {
  const pdf = pagesPdf(LINES);
  const pages = await allPagesText(pdf, inflate);
  assert.equal(pages.length, 3);
  assert.match(pages[1]!, /1\.1 Moving objects/);
  assert.match(pages[2]!, /2\.1 Heating water/);
  assert.match(await firstPageText(pdf, inflate), /^Syllabus/);
  assert.doesNotMatch(await firstPageText(pdf, inflate), /Heating/);
  assert.deepEqual(await allPagesText(new TextEncoder().encode("not a pdf"), inflate), []);
  assert.equal((await allPagesText(pdf, inflate, 2)).length, 2, "page limit");
});

test("word check: the syllabus's own words pass across line breaks; invented or altered wording does not", () => {
  const idx = textIndex(PAGES);
  assert.equal(coverage(idx, "Describe how a trolley rolls down a ramp and explain why it speeds up"), 1);
  assert.equal(coverage(idx, "Calculate the average speed of a cyclist from a distance and a time."), 1, "punctuation and line breaks do not matter");
  assert.ok(coverage(idx, "Explain how a rocket engine works in space using Newton's laws") < 0.5);
  assert.ok(coverage(idx, "Describe how a trolley rolls down a ramp and explain how friction slows it") < BRAIN.minWordCover, "a real start with an invented end fails");
  assert.equal(coverage(idx, "kettle"), 1, "short wording must appear whole");
  assert.equal(coverage(idx, "toaster"), 0);
  assert.deepEqual(checkWords(GOOD, idx), []);
  const bad = copy(GOOD);
  bad.goals[1]!.text = "Measure the time a pendulum takes and work out gravity from it";
  bad.goals[0]!.notes = "Students may use a data logger with light gates";
  const problems = checkWords(bad, idx);
  assert.deepEqual(problems.map((p) => p.where), ["1.1 goal 1", "1.1 goal 2"]);
  assert.ok(problems.every((p) => p.kind === "words"));
});

test("numbering: parents, gaps, repeats, empty topics and goals under unknown topics are caught", () => {
  assert.deepEqual(checkNumbers(GOOD), []);
  const d = copy(GOOD);
  d.topics.push({ number: "1.4", title: "Gap", parent: "1" });
  d.goals.push({ topic: "1.4", number: "1", text: "x", tier: "core", notes: "" });
  d.goals.push({ topic: "1.1", number: "2", text: "y", tier: "core", notes: "" });
  d.goals.push({ topic: "9.9", number: "1", text: "z", tier: "core", notes: "" });
  d.topics.push({ number: "3", title: "Empty", parent: "" });
  d.topics.push({ number: "2.2", title: "Wrong parent", parent: "1" });
  const details = checkNumbers(d).map((p) => `${p.where}: ${p.detail}`).join("\n");
  assert.match(details, /gap or a repeat \(1, 2, 4\)/);
  assert.match(details, /1\.1 goal 2: goal number used twice/);
  assert.match(details, /9\.9 goal 1: its topic is not in the tree/);
  assert.match(details, /3 Empty: topic with no goals and no subtopics/);
  assert.match(details, /2\.2: sits under 1, but its number says 2/);
  // Core and Extended lists numbered C1.1 and E1.1 are siblings in their own runs.
  const m: Draft = {
    topics: [{ number: "C1", title: "a", parent: "" }, { number: "C1.1", title: "b", parent: "C1" }, { number: "E1", title: "c", parent: "" }, { number: "E1.1", title: "d", parent: "E1" }],
    goals: [{ topic: "C1.1", number: "", text: "e", tier: "core", notes: "" }, { topic: "E1.1", number: "", text: "f", tier: "supplement", notes: "" }],
  };
  assert.deepEqual(checkNumbers(m), []);
});

test("missing headings: numbered topics printed in the syllabus but not in the tree (contents lines ignored)", () => {
  assert.deepEqual(missingHeadings(GOOD, PAGES), []);
  const d = copy(GOOD);
  d.topics = d.topics.filter((t) => t.number !== "1.2");
  const miss = missingHeadings(d, PAGES);
  assert.deepEqual(miss.map((p) => p.where), ["1.2 Pushing and pulling"]);
  // Section 3 ("3 Subject content") is a chapter, not a tree section: never asked for.
  assert.ok(!miss.some((p) => p.where.startsWith("3.")));
});

test("cleaning an AI answer: bad shapes dropped and named, numbers tidied, \"continued\" removed, limits kept", () => {
  const { draft, problems } = cleanDraft({
    topics: [{ number: "1.", title: "Moving things continued", parent: "" }, { number: "x", title: "y", parent: "" }, { number: "2", title: "", parent: "" }],
    goals: [{ topic: "1", number: "1.", text: "  a   b \n c ", tier: "core", notes: 5 }, { topic: "1", number: "1", text: "t", tier: "extended" }],
  });
  assert.deepEqual(draft.topics, [{ number: "1", title: "Moving things", parent: "" }]);
  assert.deepEqual(draft.goals, [{ topic: "1", number: "1", text: "a b\nc", tier: "core", notes: "" }]);
  assert.equal(problems.length, 3);
  assert.equal(cleanDraft(null).draft.topics.length, 0);
  assert.equal(cleanDraft({ topics: Array.from({ length: BRAIN.maxTopics + 5 }, (_, i) => ({ number: String(i + 1), title: "t", parent: "" })) }).draft.topics.length, BRAIN.maxTopics);
});

test("comparing two readers: agreement, real differences, and differences the syllabus text settles", () => {
  const idx = textIndex(PAGES);
  assert.equal(compareDrafts(GOOD, copy(GOOD), idx).agreement, 1);
  const g = copy(GOOD);
  g.goals[1]!.text = "Time ten swings of a pendulum"; // Gemini paraphrased: the text settles it for Claude
  g.goals[2]!.tier = "core"; // a tier difference: the text cannot settle it
  g.goals.push({ topic: "2.1", number: "2", text: "Describe what happens to water heated in a kettle", tier: "core", notes: "" }); // extra, but a real wording
  const c = compareDrafts(GOOD, g, idx);
  assert.equal(c.settled, 1);
  assert.deepEqual(c.disagreements.map((d) => d.where), ["1.1 goal 3", "2.1 goal 2"]);
  assert.ok(c.agreement < 1 && c.agreement > 0.7);
  // Without readable text nothing is settled.
  assert.equal(compareDrafts(GOOD, g, null).settled, 0);
  assert.ok(similarity("v = s / t", "v=s/t") === 1);
  assert.ok(similarity("Moving objects", "Moving things") < BRAIN.sameText);
});

test("verdict: ready only with the word check on, no problems and close agreement", () => {
  assert.equal(isReady({ textChecked: true, problems: [], agreement: 1 }), true);
  assert.equal(isReady({ textChecked: false, problems: [], agreement: 1 }), false);
  assert.equal(isReady({ textChecked: true, problems: [{ kind: "numbers", where: "1", detail: "x" }], agreement: 1 }), false);
  assert.equal(isReady({ textChecked: true, problems: [], agreement: BRAIN.minAgreement - 0.01 }), false);
  const notes = retryNotes([{ kind: "words", where: "1.1 goal 2", detail: "wording 40% found" }], [{ where: "1.1 goal 3", claude: "a", gemini: "b" }]);
  assert.match(notes, /1\.1 goal 2: wording 40% found/);
  assert.match(notes, /independent reader wrote "b"/);
  const many = retryNotes(Array.from({ length: 100 }, (_, i) => ({ kind: "words" as const, where: String(i), detail: "d" })), [], 10);
  assert.match(many, /and 90 more/);
});

test("the tree for display: nested by parent, ordered by number, open checks flagged", () => {
  const d = copy(GOOD);
  d.topics.reverse();
  const flagged = flaggedGoals({ problems: [{ kind: "words", where: "1.1 goal 2", detail: "" }], disagreements: [] });
  const tree = buildTree(d, flagged);
  assert.deepEqual(tree.map((n) => n.number), ["1", "2"]);
  assert.deepEqual(tree[0]!.children.map((n) => n.number), ["1.1", "1.2"]);
  assert.deepEqual(tree[0]!.children[0]!.goals.map((g) => g.flag), [false, true, false]);
  assert.deepEqual(goalLabels({ topics: [], goals: [{ topic: "3", number: "", text: "a", tier: "all", notes: "" }, { topic: "3", number: "", text: "b", tier: "all", notes: "" }] }), ["3 goal #1", "3 goal #2"]);
});

test("prompts and schemas: one prompt for both readers, flat lists, the same fields in both schema dialects", () => {
  assert.match(topicPrompt("IGCSE Physics (0625)"), /IGCSE Physics \(0625\)/);
  assert.match(retryPrompt("X", "- 1.1 goal 2: wording"), /1\.1 goal 2: wording/);
  assert.deepEqual(Object.keys(TOPIC_SCHEMA.properties.goals.items.properties), Object.keys(TOPIC_SCHEMA_GEMINI.properties.goals.items.properties));
  assert.deepEqual(Object.keys(TOPIC_SCHEMA.properties.topics.items.properties), Object.keys(TOPIC_SCHEMA_GEMINI.properties.topics.items.properties));
  assert.ok(!JSON.stringify(TOPIC_SCHEMA).includes("$ref"), "no recursive schema");
  assert.ok(!/\u2014/.test(topicPrompt("x")));
});

function storeSyllabusPdf(db: ReturnType<typeof testDb>, syllabusId = "0625-2023") {
  db.raw
    .prepare(`INSERT INTO source_document (id, syllabus_id, session, year, doc_type, file_name, r2_key, sha256, size_bytes, origin, status, acquired_at)
              VALUES ('d-sy', ?, 'y', 2023, 'sy', '0625_y23_sy.pdf', '0625/2023/y/0625_y23_sy.pdf', 'h', 1000, 'upload', 'stored', ?)`)
    .run(syllabusId, NOW);
}

test("runs: one at a time, claimed, steps, failure, stale runs closed", async () => {
  const db = testDb();
  storeSyllabusPdf(db);
  const id = await startTreeRun(db, "0625-2023", "platform-admin", NOW);
  assert.ok(id);
  assert.equal(await startTreeRun(db, "0625-2026", "platform-admin", NOW + 1), null, "one brain run at a time");
  assert.deepEqual(await claimBrainRun(db, id, "https://github.com/x/y/actions/runs/1", NOW + 2), { task: "topics", syllabusId: "0625-2023" });
  assert.ok(await activeBrainRun(db, id));
  assert.equal(await brainStep(db, id, "Claude is reading", NOW + 3), true);
  let rows = await treesForCode(db, "0625", NOW + 3);
  const r23 = rows.find((r) => r.fromYear === 2023)!;
  assert.equal(r23.run?.status, "running");
  assert.equal(r23.run?.step, "Claude is reading");
  assert.equal(r23.pdf, "0625_y23_sy.pdf");
  assert.equal(r23.status, "none");
  assert.equal(await failBrainRun(db, id, "gemini_key", NOW + 4), true);
  assert.equal(await brainStep(db, id, "late", NOW + 5), false, "a closed run takes no more steps");
  rows = await treesForCode(db, "0625", NOW + 5);
  assert.equal(rows.find((r) => r.fromYear === 2023)!.run?.errorRef, "gemini_key");
  // A run GitHub never starts is closed after the stale time, and another may start.
  const id2 = await startTreeRun(db, "0625-2023", "platform-admin", NOW + 10);
  assert.ok(id2);
  await closeStaleBrainRuns(db, NOW + 10 + BRAIN.staleAfterMs + 1);
  const job = db.raw.prepare(`SELECT status, error_ref FROM job WHERE id = ?`).get(id2) as { status: string; error_ref: string };
  assert.deepEqual({ ...job }, { status: "failed", error_ref: "never_started" });
});

test("saving: cleaned and re-checked, ready only when the report and the numbering agree, kept whole", async () => {
  const db = testDb();
  storeSyllabusPdf(db);
  const report = { attempts: 1, textChecked: true, problems: [], agreement: 1, disagreements: [], settled: 0, models: { claude: "c", gemini: "g" }, usage: { claudeIn: 1, claudeOut: 2, geminiIn: 3, geminiOut: 4 } };
  const id = (await startTreeRun(db, "0625-2023", "platform-admin", NOW))!;
  assert.equal(await saveTree(db, id, GOOD, report, NOW + 1), "no_run", "a queued run cannot save");
  await claimBrainRun(db, id, null, NOW + 1);
  assert.equal(await saveTree(db, id, { topics: [] }, report, NOW + 2), "empty");
  assert.equal(await saveTree(db, id, GOOD, report, NOW + 2), "ok_ready");
  const t = await loadTree(db, "0625-2023");
  assert.equal(t?.status, "ready");
  assert.deepEqual(t?.draft, GOOD);
  assert.equal(t?.report.usage.geminiOut, 4);
  const row = (await treesForCode(db, "0625", NOW + 30)).find((r) => r.fromYear === 2023)!;
  assert.deepEqual([row.status, row.topics, row.goals, row.run?.status], ["ready", 5, 5, "succeeded"]);
  assert.equal(await saveTree(db, id, GOOD, report, NOW + 3), "no_run", "a finished run cannot save again");

  // A numbering problem the script did not report is found here: stored, but not ready.
  const id2 = (await startTreeRun(db, "0625-2023", "platform-admin", NOW + 10))!;
  await claimBrainRun(db, id2, null, NOW + 10);
  const gap = copy(GOOD);
  gap.topics.push({ number: "1.4", title: "Gap", parent: "1" });
  gap.goals.push({ topic: "1.4", number: "1", text: "x", tier: "core", notes: "" });
  assert.equal(await saveTree(db, id2, gap, report, NOW + 11), "ok_not_ready");
  const t2 = await loadTree(db, "0625-2023");
  assert.equal(t2?.status, "not_ready");
  assert.ok(t2?.report.problems.some((p) => p.kind === "numbers"));
  // A report without the word check is never ready.
  const id3 = (await startTreeRun(db, "0625-2023", "platform-admin", NOW + 20))!;
  await claimBrainRun(db, id3, null, NOW + 20);
  assert.equal(await saveTree(db, id3, GOOD, { ...report, textChecked: false }, NOW + 21), "ok_not_ready");
  // Deleting the syllabus version takes its tree with it.
  db.raw.exec(`DELETE FROM source_document; DELETE FROM syllabus_paper WHERE syllabus_id = '0625-2023'; DELETE FROM syllabus_route WHERE syllabus_id = '0625-2023'; DELETE FROM syllabus WHERE id = '0625-2023'`);
  assert.equal(await loadTree(db, "0625-2023"), null);
});

test("reports from the script are cleaned: unknown fields dropped, numbers bounded, lists capped", () => {
  const r = cleanReport({ attempts: 99, agreement: 7, textChecked: "yes", problems: Array.from({ length: 500 }, () => ({ kind: "evil", where: "w", detail: "d" })), extra: 1 });
  assert.equal(r.attempts, BRAIN.attempts);
  assert.equal(r.agreement, 1);
  assert.equal(r.textChecked, false);
  assert.equal(r.problems.length, BRAIN.maxReportItems);
  assert.equal(r.problems[0]!.kind, "shape");
  assert.ok(!("extra" in r));
});
