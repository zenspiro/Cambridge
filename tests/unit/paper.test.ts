// Reading the papers (Phase 2, step 2b): readings made safe, our own SVG drawings, flags, merging, the fixes.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  cleanPaper, cleanSvg, editItem, marksAgainstPaper, mergeReading, openFlags, paperFlags, pdfVersion, placeOnPages, recheckItem, type PaperContent,
} from "../../src/lib/brain/paper.ts";
import { applyFix, loadContent, paperDoc, paperView, savePaperReading } from "../../src/lib/brain/paperRead.ts";
import { brainStep, claimBrainRun, cleanEvent, runState, startPaperRun } from "../../src/lib/brain/runs.ts";
import { BRAIN } from "../../src/lib/config.ts";
import { testBucket, testDb } from "./helpers/d1.ts";

const NOW = Date.UTC(2026, 10, 7);
const PAGES = [
  "Cambridge IGCSE PHYSICS 0625/42 Paper 4 Theory (Extended) The total mark for this paper is 80. INSTRUCTIONS Answer all questions. Use a black or dark blue pen. You may use an HB pencil for any diagrams or graphs. Write your name, centre number and candidate number in the boxes at the top of the page. Write your answer to each question in the space provided. Do not use an erasable pen or correction fluid. Do not write on any bar codes. You may use a calculator. You should show all your working and use appropriate units. Take the weight of 1.0 kg to be 9.8 N (acceleration of free fall = 9.8 m/s2). INFORMATION The number of marks for each question or part question is shown in brackets.",
  "1 A student rolls a trolley down a ramp and measures the time it takes to travel 1.5 m. (a) State the instrument used to measure the time. [1] (b) The trolley takes 2.5 s. Calculate its average speed. [2] Fig. 1.1 shows the ramp.",
  "2 (a) Define the term density and state its unit for a solid block of steel. [2]",
];
const READING = {
  totalMarks: 80,
  items: [
    { number: "1(a)", page: 2, text: "A student rolls a trolley down a ramp and measures the time it takes to travel 1.5 m. State the instrument used to measure the time.", marks: 1, options: [], answerLines: 1, figures: ["F1"], guidance: "" },
    { number: "1 (b)", page: 2, text: "The trolley takes 2.5 s. Calculate its average speed.", marks: 2, options: [], answerLines: 3, figures: [], guidance: "" },
    { number: "2(a)", page: 3, text: "Define the term density and state its unit for a solid block of steel.", marks: 2, options: [], answerLines: 2, figures: [], guidance: "" },
  ],
  figures: [{ id: "F1", page: 2, caption: "Fig. 1.1 the ramp", svg: "<svg viewBox='0 0 10 10'><line x1='0' y1='0' x2='10' y2='10' stroke='black'/></svg>" }],
};

test("a reading is made safe: printed numbers only, capped, figures named by items kept", () => {
  const c = cleanPaper({ ...READING, items: [...READING.items, { number: "drop table", page: 1, text: "x" }, { number: "3", page: 9, text: "y", figures: ["F9"] }] }, "qp");
  assert.deepEqual(c.items.map((i) => i.number), ["1(a)", "1(b)", "2(a)", "3"], "spaces joined, junk numbers dropped");
  assert.ok(c.figures.some((f) => f.id === "F9" && f.svg === ""), "a figure named but not drawn still gets an entry");
  assert.equal(c.totalMarks, 80);
});

test("our SVG drawings are rebuilt from an allowlist", () => {
  const bad = `<svg onload="alert(1)" viewBox="0 0 10 10"><script>alert(1)</script><a href="javascript:x"><circle r="2"/></a><foreignObject><div>x</div></foreignObject><image href="https://evil/x.png"/><rect width="4" height="4" fill="url(https://evil)" stroke="black" style="x"/><text x="1" y="2">5 N &lt;b&gt;</text><use href="#a"/></svg>`;
  const out = cleanSvg(bad);
  assert.ok(out.startsWith('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10">'));
  for (const x of ["onload", "script", "javascript", "foreignObject", "image", "https://evil", "style", "<use", "<a"]) assert.ok(!out.includes(x), `removed ${x}`);
  assert.ok(out.includes('<rect width="4" height="4" stroke="black"/>'), "safe attributes kept, the outside reference dropped");
  assert.ok(out.includes("5 N &lt;b&gt;"), "text stays text");
  assert.equal(cleanSvg("<div>not svg</div>"), "");
  assert.equal(cleanSvg("x".repeat(BRAIN.maxSvgBytes * 2 + 1)), "");
});

test("flags: wording, numbers, marks, figures and Gemini's reading", () => {
  const good = cleanPaper(READING, "qp");
  const sumWrong = paperFlags({ content: good, pages: PAGES, gemini: null });
  assert.deepEqual(sumWrong.map((f) => f.key).sort(), ["figure:F1", "marks:paper"].sort(), "a good reading: the figure to compare by eye, and parts that do not add up to 80");
  assert.equal(sumWrong.find((f) => f.kind === "figure")?.colour, "blue");

  const wrong = cleanPaper({ ...READING, totalMarks: 5, items: [
    { ...READING.items[0], text: "A student pushes a box along the floor and times it with a clock." },
    { ...READING.items[1], text: "The trolley takes 3.5 s. Calculate its average speed.", marks: 3 },
    READING.items[2],
  ] }, "qp");
  const f = paperFlags({ content: wrong, pages: PAGES, gemini: null });
  const kinds = f.map((x) => x.key);
  assert.ok(kinds.includes("words:1(a)"), "invented wording is red");
  assert.equal(f.find((x) => x.key === "words:1(a)")?.colour, "red");
  assert.ok(kinds.includes("numbers:1(b):3.5"), "a number the PDF does not print is amber");
  assert.ok(kinds.includes("marks:1(b)"), "[3] is not printed");
  assert.ok(kinds.includes("marks:paper"), "parts do not add up to the total");
  assert.ok(kinds.includes("numbers:paper"), "a total the PDF does not print");

  const gem = cleanPaper({ ...READING, items: [
    { ...READING.items[0], text: "A student times a falling ball with a stopwatch from a window." },
    { ...READING.items[1], marks: 4 },
    READING.items[2],
    { number: "2(b)", page: 3, text: "Something only Gemini read.", marks: 1 },
  ] }, "qp");
  const g = paperFlags({ content: good, pages: PAGES, gemini: gem });
  assert.ok(!g.some((x) => x.key === "agree:1(a)"), "a difference the PDF settles (ours is printed, Gemini's is not) is not flagged");
  assert.ok(g.some((x) => x.key === "marks:1(b):gemini"), "Gemini's different marks are amber");
  assert.ok(g.some((x) => x.key === "missing:2(b)" && x.colour === "red"), "a question only Gemini found is red");

  const unread = paperFlags({ content: good, pages: ["", ""], gemini: null });
  assert.ok(unread.some((x) => x.kind === "text"), "an unreadable PDF says the checks could not run");
  assert.ok(!unread.some((x) => x.kind === "words"));
});

test("the PDF's version is found on the item's page", () => {
  const it = cleanPaper(READING, "qp").items[1]!;
  const v = pdfVersion({ ...it, text: "The trolley takes 3.5 s. Calculate its average speed." }, PAGES);
  assert.ok(v.startsWith("The trolley takes 2.5 s"), v);
});

test("a mark scheme's marks per question must match its question paper", () => {
  const qp = cleanPaper(READING, "qp");
  const ms = cleanPaper({ items: [{ number: "1(a)", page: 2, text: "stopwatch B1", marks: 1 }, { number: "1(b)", page: 2, text: "0.6 m/s", marks: 1 }, { number: "2(a)", page: 3, text: "mass per unit volume", marks: 2 }] }, "ms");
  const f = marksAgainstPaper(ms, qp);
  assert.deepEqual(f.map((x) => x.key), ["marks:1:qp"]);
  assert.match(f[0]!.reason, /2 marks in the mark scheme, 3 in the question paper/);
});

test("merging: confirmed items stay, flagged ones are read again; a scope replaces only its items", () => {
  const old = cleanPaper(READING, "qp");
  const fresh = cleanPaper({ ...READING, items: READING.items.map((i) => ({ ...i, text: `${i.text} (new)` })) }, "qp");
  const m = mergeReading(old, fresh, new Set(["1(b)"]));
  assert.ok(m.items[0]!.text.endsWith("time."), "1(a) had no open flag: kept");
  assert.ok(m.items[1]!.text.endsWith("(new)"), "1(b) was flagged: read again");
  const only = mergeReading(old, cleanPaper({ items: [{ ...READING.items[2], text: "redone" }] }, "qp"), new Set(), { items: ["2(a)"], figures: [] });
  assert.deepEqual(only.items.map((i) => i.text.slice(0, 6)), ["A stud", "The tr", "redone"]);
  const redraw = mergeReading(old, { ...old, figures: [{ id: "F1", page: 2, caption: "", svg: "<svg></svg>" }] }, new Set(), { items: [], figures: ["F1"] });
  assert.equal(redraw.figures[0]!.svg, "<svg></svg>");
});

test("one item rechecked after a fix; open flags leave out settled ones and the subject's rules", () => {
  const c = cleanPaper({ ...READING, items: [{ ...READING.items[0], text: "Made up words about a box." }, READING.items[1], READING.items[2]] }, "qp");
  const flags = paperFlags({ content: c, pages: PAGES, gemini: null });
  assert.ok(flags.some((f) => f.key === "words:1(a)"));
  const fixed = editItem(c, "1(a)", READING.items[0]!.text, 1);
  const after = recheckItem(fixed, flags, "1(a)", PAGES);
  assert.ok(!after.some((f) => f.key === "words:1(a)"), "the PDF's words pass");
  const still = recheckItem(editItem(c, "1(a)", "Still made up.", 1), flags, "1(a)", PAGES);
  assert.ok(still.some((f) => f.key === "words:1(a)" && /not found in the PDF either/.test(f.reason)));
  const fig = flags.find((f) => f.kind === "figure")!;
  assert.equal(openFlags(flags, new Set([fig.fingerprint]), new Set()).some((f) => f.kind === "figure"), false);
  const words = flags.find((f) => f.kind === "words")!;
  assert.equal(openFlags(flags, new Set(), new Set([words.fingerprint])).some((f) => f.kind === "words"), false);
});

function seedDoc(db: ReturnType<typeof testDb>, id = "doc-qp-1", name = "0625_s24_qp_42.pdf") {
  db.raw.exec(`INSERT INTO source_document (id, syllabus_id, session, year, paper, variant, doc_type, file_name, r2_key, sha256, size_bytes, origin, status, acquired_at)
               VALUES ('${id}', '0625-2023', 's', 2024, 4, 2, '${name.includes("_ms_") ? "ms" : "qp"}', '${name}', 'k-${id}', 'sha-${id}', 100000, 'upload', 'stored', ${NOW})`);
}

test("paper runs: started with a scope, progress events kept in order, a reading saved then fixed and undone", async () => {
  const db = testDb();
  const bucket = testBucket();
  seedDoc(db);
  const id = (await startPaperRun(db, "doc-qp-1", { items: [], figures: [] }, "platform-admin", NOW))!;
  assert.ok(id);
  assert.deepEqual(await claimBrainRun(db, id, null, NOW + 1), { task: "paper", docId: "doc-qp-1", scope: { items: [], figures: [] } });
  for (let i = 0; i < BRAIN.maxRunEvents + 5; i++) await brainStep(db, id, `step ${i}`, NOW + 2 + i, cleanEvent({ stage: "claude", state: "start", text: `step ${i}` }, NOW + 2 + i));
  const st = (await runState(db, id, NOW + 100))!;
  assert.equal(st.events.length, BRAIN.maxRunEvents, "kept to the limit");
  assert.equal(st.events.at(-1)!.text, `step ${BRAIN.maxRunEvents + 4}`, "newest last");
  assert.equal(st.events[0]!.text, "step 5", "oldest dropped first");
  assert.equal(cleanEvent({ stage: "nope", state: "start" }, NOW), null);

  const content = cleanPaper(READING, "qp");
  const flags = paperFlags({ content: { ...content, items: [{ ...content.items[0]!, text: "A student pushes a trolley down a ramp and measures the time it takes to travel 1.5 m. State the device used to measure the time." }, ...content.items.slice(1)] }, pages: PAGES, gemini: null });
  const bad = { ...content, items: [{ ...content.items[0]!, text: "A student pushes a trolley down a ramp and measures the time it takes to travel 1.5 m. State the device used to measure the time." }, ...content.items.slice(1)] };
  assert.equal(await savePaperReading(db, bucket, "other-job", "doc-qp-1", { content: bad, flags, pages: PAGES }, false, NOW), "no_run", "only the paper's own run may save");
  assert.equal(await savePaperReading(db, bucket, id, "doc-qp-1", { content: bad, flags, pages: PAGES }, true, NOW + 200), "ok");
  const doc = (await paperDoc(db, "doc-qp-1"))!;
  let view = await paperView(db, bucket, doc);
  assert.equal(view.content?.items.length, 3);
  assert.ok(view.open.some((f) => f.key === "words:1(a)"));
  assert.equal(view.ready, false);

  const words = view.open.find((f) => f.key === "words:1(a)")!;
  assert.ok(words.pdfText, "the PDF's words were found for this item");
  assert.equal(await applyFix(db, bucket, doc, "pdf", { key: words.key }, "platform-admin", NOW + 300), "ok_fixed");
  view = await paperView(db, bucket, doc);
  assert.ok(!view.open.some((f) => f.key === "words:1(a)"), "the PDF's version clears the wording flag");
  assert.equal((await loadContent(bucket, "doc-qp-1", "qp"))?.items[0]?.text, words.pdfText);

  const fig = view.open.find((f) => f.kind === "figure")!;
  assert.equal(await applyFix(db, bucket, doc, "fine", { key: fig.key }, "platform-admin", NOW + 400), "bad", "a figure is accepted with Looks right, not It's fine");
  assert.equal(await applyFix(db, bucket, doc, "looks_right", { key: fig.key }, "platform-admin", NOW + 400), "ok_fixed");
  const sum = (await paperView(db, bucket, doc)).open.find((f) => f.key === "marks:paper")!;
  assert.equal(await applyFix(db, bucket, doc, "fine", { key: sum.key }, "platform-admin", NOW + 500), "ok_fixed");
  assert.equal(db.raw.prepare(`SELECT COUNT(*) AS n FROM paper_rule WHERE code = '0625'`).get()!.n, 1, "It's fine became a rule for the subject");
  view = await paperView(db, bucket, doc);
  assert.equal(view.open.length, 0);
  assert.equal(view.ready, true, "no open flags: ready");

  const undo = view.fixes.find((f) => f.action === "fine")!;
  assert.equal(await applyFix(db, bucket, doc, "undo", { fix: undo.id }, "platform-admin", NOW + 600), "ok_undone");
  view = await paperView(db, bucket, doc);
  assert.equal(view.open.length, 1, "Undo brings the flag back");
  assert.equal(db.raw.prepare(`SELECT COUNT(*) AS n FROM paper_rule`).get()!.n, 0, "and removes the rule");
  assert.equal(await applyFix(db, bucket, doc, "override", {}, "platform-admin", NOW + 700), "ok_ready");
  assert.equal((await paperView(db, bucket, doc)).ready, true, "marked ready with a flag left");
  assert.equal(await applyFix(db, bucket, doc, "unoverride", {}, "platform-admin", NOW + 800), "ok_undone");
  assert.equal((await paperView(db, bucket, doc)).ready, false);

  const pdfFix = (await paperView(db, bucket, doc)).fixes.find((f) => f.action === "pdf")!;
  assert.equal(await applyFix(db, bucket, doc, "undo", { fix: pdfFix.id }, "platform-admin", NOW + 900), "ok_undone");
  assert.equal((await loadContent(bucket, "doc-qp-1", "qp"))?.items[0]?.text, "A student pushes a trolley down a ramp and measures the time it takes to travel 1.5 m. State the device used to measure the time.", "Undo puts the old wording back");
  assert.equal(await applyFix(db, bucket, doc, "edit", { item: "1(a)", text: "Still not printed.", marks: "x" }, "platform-admin", NOW + 950), "bad", "marks must be a number");
  assert.equal(await applyFix(db, bucket, doc, "edit", { item: "1(a)", text: "Still not printed.", marks: "1" }, "platform-admin", NOW + 1000), "still_flagged");
});

test("a mark scheme shows its marks checked against the stored question paper", async () => {
  const db = testDb();
  const bucket = testBucket();
  seedDoc(db);
  seedDoc(db, "doc-ms-1", "0625_s24_ms_42.pdf");
  const qpRun = (await startPaperRun(db, "doc-qp-1", { items: [], figures: [] }, "platform-admin", NOW))!;
  await claimBrainRun(db, qpRun, null, NOW);
  await savePaperReading(db, bucket, qpRun, "doc-qp-1", { content: READING, flags: [], pages: PAGES }, true, NOW + 1);
  const msRun = (await startPaperRun(db, "doc-ms-1", { items: [], figures: [] }, "platform-admin", NOW + 2))!;
  await claimBrainRun(db, msRun, null, NOW + 2);
  const ms = { items: [{ number: "1(a)", page: 2, text: "stopwatch", marks: 1 }, { number: "1(b)", page: 2, text: "0.6", marks: 1 }] };
  assert.equal(await savePaperReading(db, bucket, msRun, "doc-ms-1", { content: ms, flags: [], pages: PAGES }, true, NOW + 3), "ok");
  const view = await paperView(db, bucket, (await paperDoc(db, "doc-ms-1"))!);
  assert.ok(view.open.some((f) => f.key === "marks:1:qp"), "question 1: 2 marks in the scheme, 3 in the paper");
});

test("a reading of the wrong kind or without items is refused", async () => {
  const db = testDb();
  const bucket = testBucket();
  seedDoc(db);
  const id = (await startPaperRun(db, "doc-qp-1", { items: [], figures: [] }, "platform-admin", NOW))!;
  await claimBrainRun(db, id, null, NOW);
  assert.equal(await savePaperReading(db, bucket, id, "doc-qp-1", { content: { items: [] } }, true, NOW), "bad");
  const none: PaperContent | null = await loadContent(bucket, "doc-qp-1", "qp");
  assert.equal(none, null);
});

test("blank pages are left out for the AIs and page numbers put back", async () => {
  const { blankPages, keptPages, remapPages } = await import("../../src/lib/brain/paper.ts");
  const pages = ["BLANK PAGE cover never counts", "1 (a) A question [2]", "BLANK PAGE\n© UCLES 2024 0625/42/M/J/24\n3", "BLANK PAGE but Fig. 4.1 shows a real question [2]", "2 (a) Another [2]"];
  assert.deepEqual(blankPages(pages), [3], "only a page that says BLANK PAGE and its footer");
  // Real text from a November 2025 Physics paper: kerned "BLANK P AGE", margin warnings, bar codes, and the last page
  // with the copyright acknowledgements are all left out; a question page never is.
  const real = {"blank": "2\n0625/42/O/N/25\u00a9 UCLES 2025\nBLANK P AGE\n* 0000800000002 *\nDO NOT WRITE IN THIS MARGIN DO NOT WRITE IN THIS MARGIN DO NOT WRITE IN THIS MARGIN DO NOT WRITE IN THIS MARGIN DO NOT WRITE IN THIS MARGIN\nDFD", "ack": "20\n0625/42/O/N/25\u00a9 UCLES 2025\nPermission to reproduce items where third\u2011party owned material protected by copyright is included has been sought and cleared where possible. Every\nreasonable effort has been made by the publisher (UCLES) to trace copyright holders, but if any items requiring clearance have unwittingly been included, the\npublisher will be pleased to make amends at the earliest possible opportunity.\nTo avoid the issue of disclosure of answer\u2011related information to candidates, all copyright acknowledgements are reproduced online in the Cambridge\nAssessment International Education Copyright Acknowledgements Booklet. This is produced for each series of examinations and is freely available to download\nat www .cambridgeinternational.org after the live examination series.\nCambridge Assessment International Education is part of Cambridge Assessment. Cambridge Assessment is the brand name of the University of Cambridge\nLocal Examinations Syndicate (UCLES), which is a department of the University of Cambridge.\nBLANK P AGE\n* 0000800000020 *\nDO NOT WRITE IN THIS MARGIN DO NOT WRITE IN THIS MARGIN DO NOT WRITE IN THIS MARGIN DO NOT WRITE IN THIS MARGIN DO NOT WRITE IN THIS MARGIN\nDFD", "q": "3\n0625/42/O/N/25\u00a9 UCLES 2025 [Turn over\n1 (a) (i) State the difference between a scalar quantity and a vector quantity.\n...........................................................................................................................................\n..................................................................................................................................... [1]\n(i"};
  assert.deepEqual(blankPages(["cover", real.blank, real.q, real.ack]), [2, 4]);
  const kept = keptPages(pages.length, blankPages(pages));
  assert.deepEqual(kept, [1, 2, 4, 5]);
  const c = cleanPaper({ items: [{ number: "1(a)", page: 2, text: "x" }, { number: "2(a)", page: 4, text: "y" }], figures: [{ id: "F1", page: 3, caption: "" }] }, "qp");
  const back = remapPages(c, kept);
  assert.deepEqual(back.items.map((i) => i.page), [2, 5], "page 4 of the slim PDF is the paper's page 5");
  assert.equal(back.figures[0]!.page, 4);
  assert.deepEqual(remapPages(c, []).items.map((i) => i.page), [2, 4], "nothing left out: unchanged");
});

test("items and figures are placed on their real pages by the PDF's text, whatever page the AI gave", () => {
  const c = cleanPaper({ ...READING, items: READING.items.map((i) => ({ ...i, page: 1 })), figures: [{ id: "F1", page: 9, caption: "Fig. 1.1 the ramp" }] }, "qp");
  const placed = placeOnPages(c, PAGES);
  assert.deepEqual(placed.items.map((i) => i.page), [2, 2, 3]);
  assert.equal(placed.figures[0]!.page, 2, "by its label, Fig. 1.1");
  const lost = cleanPaper({ items: [{ number: "1(a)", page: 2, text: "Words printed nowhere in the paper at all." }] }, "qp");
  assert.equal(placeOnPages(lost, PAGES).items[0]!.page, 2, "an item code cannot place keeps its page");
});
