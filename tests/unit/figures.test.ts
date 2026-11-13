// Figures cut from the PDF (owner, 7 Nov 2026). The page below is made up in the shape Poppler writes (pdftocairo
// -svg, pdftotext -bbox-layout); no Cambridge artwork is kept in the repo.
import { test } from "node:test";
import assert from "node:assert/strict";
import { assignBoxes, cleanArt, cleanBox, cropSvg, fillPhotos, findBoxes, labelBoxes, pageArt, pageSvg, photoArgs, photoSlots, textLines, wholePage } from "../../src/lib/brain/figures.ts";
import { cleanPaper, figureFlag, figureHome, paperFlags, placeOnPages } from "../../src/lib/brain/paper.ts";
import { applyFix, figurePageSvg, figureSvg, handFixed, loadContent, paperDoc, paperView, saveArt, savePaperReading } from "../../src/lib/brain/paperRead.ts";
import { claimBrainRun, startBatchRun, startPaperRun } from "../../src/lib/brain/runs.ts";
import { testBucket, testDb } from "./helpers/d1.ts";

const NOW = 1_780_000_000_000;
const INK = `fill="rgb(13.729858%, 12.159729%, 12.548828%)" fill-opacity="1"`;
const stroke = (d: string, t = "") => `<path fill="none" stroke-width="1" stroke="rgb(13.729858%, 12.159729%, 12.548828%)" stroke-opacity="1" d="${d}"${t ? ` transform="${t}"` : ""}/>`;
const use = (g: string, x: number, y: number) => `<use xlink:href="#${g}" x="${x}" y="${y}"/>`;

/** A page: a bar code at the top, a question sentence, a circle with a label above "Fig. 2.1", and below it a
 * second, unlabelled drawing (a triangle) with its own label "45 mm". */
const SVG = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="595.27559" height="841.88976" viewBox="0 0 595.27559 841.88976">
<defs>
<g>
<g id="glyph-0-0">
<path d="M 0.5 -7 L 5.123456 -7 L 5 0 L 0.5 0 Z"/>
</g>
<g id="glyph-0-1">
<path d="M 0 -7 L 4 -7 L 4 0 Z"/>
</g>
</g>
<clipPath id="clip-0"><path d="M 0 0 L 595 0 L 595 842 L 0 842 Z"/></clipPath>
</defs>
${stroke("M 300 30 L 300 60 M 310 30 L 310 60")}
<g ${INK}>
${use("glyph-0-0", 100, 110)}
${use("glyph-0-1", 106, 110)}
</g>
${stroke("M 200 -200 C 200 -150 300 -150 300 -200 C 300 -250 200 -250 200 -200 Z", "matrix(1, 0, 0, -1, 0, 0)")}
<path fill="none" stroke-width="2" stroke="rgb(100%, 100%, 100%)" d="M 210 160 L 290 160"/>
<g ${INK}>
${use("glyph-0-0", 306, 180)}
</g>
${stroke("M 150 420 L 250 420 L 200 480 Z")}
<g ${INK}>
${use("glyph-0-1", 260, 440)}
</g>
<image width="10" height="10" xlink:href="data:image/png;base64,AAAA"/>
</svg>`;

const word = (t: string, x0: number, y0: number, x1: number, y1: number) => `<word xMin="${x0}" yMin="${y0}" xMax="${x1}" yMax="${y1}">${t}</word>`;
const line = (x0: number, y0: number, x1: number, y1: number, words: string) => `<line xMin="${x0}" yMin="${y0}" xMax="${x1}" yMax="${y1}">${words}</line>`;
const block = (lines: string) => `<block xMin="0" yMin="0" xMax="1" yMax="1">${lines}</block>`;
const XML = `<doc><page width="595" height="842"><flow>
${block(line(280, 62, 320, 70, word("5", 280, 62, 290, 70)))}
${block(line(60, 100, 540, 112, word("(b)", 60, 100, 75, 112) + word("Fig.", 80, 100, 100, 112) + word("2.1", 102, 100, 115, 112) + word("shows a car as it travels round a circular racing track.", 118, 100, 540, 112)))}
${block(line(306, 172, 346, 182, word("track", 306, 172, 346, 182)))}
${block(line(230, 300, 275, 312, word("Fig.", 230, 300, 250, 312) + word("2.1", 252, 300, 275, 312)))}
${block(line(258, 432, 290, 442, word("45", 258, 432, 270, 442) + word("mm", 272, 432, 290, 442)))}
</flow></page></doc>`;

test("a page's drawing: letters once each as outlines, paths with their boxes, colours as codes, masks marked", () => {
  const art = pageArt(SVG, 5);
  assert.equal(art.page, 5);
  assert.equal(art.w, 595.28);
  assert.deepEqual(Object.keys(art.g), ["g0", "g1"], "glyph ids renamed short, each kept once");
  assert.equal(art.g.g0, "M 0.5 -7 L 5.12 -7 L 5 0 L 0.5 0 Z", "numbers rounded to 0.01 pt");
  const circle = art.e.find((e) => "d" in e && e.d.startsWith("M 200 -200"))!;
  assert.deepEqual(circle.b, [200, 150, 300, 250], "the transform is applied to the box (y flipped)");
  assert.ok(art.e.some((e) => "w" in e && e.w === 1), "a white line is a mask");
  assert.equal((art.e.find((e) => "u" in e) as { f: string }).f, "#231f20");
  assert.ok(!JSON.stringify(art).includes("image"), "pictures are left out");
});

test("a page's drawing from the script is checked value by value", () => {
  const art = pageArt(SVG, 5);
  assert.deepEqual(cleanArt(JSON.parse(JSON.stringify(art))), art);
  const evil = {
    ...art,
    g: { ...art.g, g9: "M 0 0\"/><script>alert(1)</script>", bad: "M 0 0" },
    e: [...art.e, { b: [0, 0, 1, 1], d: "M 0 0 L 1 1", f: "url(https://evil)" }, { b: [0, 0, 1, 1], d: "javascript:x" }, { b: [0, 0, 1, 1], u: "g9", x: 0, y: 0, f: "#000000" }],
  };
  const clean = cleanArt(evil)!;
  assert.equal(clean.g.g9, undefined);
  assert.equal(clean.g.bad, undefined);
  assert.ok(!JSON.stringify(clean).includes("evil") && !JSON.stringify(clean).includes("javascript"));
  assert.equal(clean.e.length, art.e.length + 1, "a path with a bad paint keeps black; a bad path and an unknown letter go");
  assert.equal(cleanArt({ v: 2 }), null);
  assert.equal(cleanArt({ ...art, page: 0 }), null);
});

test("text lines: question text is body, a figure's label is not", () => {
  const lines = textLines(XML);
  assert.equal(lines.length, 5);
  assert.equal(lines.find((l) => l.text.startsWith("(b)"))!.body, true);
  assert.equal(lines.find((l) => l.text === "track")!.body, false);
  assert.equal(lines.find((l) => l.text === "Fig. 2.1")!.body, false);
});

test("finding figures: above a printed label without the bar code or the question; groups without labels", () => {
  const art = pageArt(SVG, 5);
  const lines = textLines(XML);
  const found = findBoxes(art, lines);
  assert.equal(found.captions.length, 1);
  const cap = found.captions[0]!;
  assert.equal(cap.label, "2.1");
  assert.ok(cap.box[1] >= 140 && cap.box[3] <= 300, `the circle and its label, not the question line or bar code: ${cap.box}`);
  assert.ok(cap.box[2] >= 346, "the label 'track' beside it is inside");
  assert.equal(found.groups.length, 2, "the circle and the triangle are separate drawings");
  const tri = found.groups[1]!;
  assert.ok(tri[2] >= 290, "the triangle's label is inside its box");

  const got = assignBoxes([
    { id: "F1", caption: "Fig. 2.1 a car on a track" },
    { id: "F2", caption: "triangle", description: "A triangle with a side of 45 mm." },
  ], found, lines);
  assert.deepEqual(got.get("F1"), { box: cap.box, cut: "caption" });
  assert.deepEqual(got.get("F2"), { box: tri, cut: "match" }, "matched by its label");
  const none = assignBoxes([{ id: "F3", caption: "Fig. 7.1" }, { id: "F4", caption: "" }, { id: "F5", caption: "" }], { captions: [], groups: [tri] }, lines);
  assert.deepEqual(none.get("F3"), { box: tri, cut: "order" }, "no label on the page: taken in order");
  assert.equal(none.has("F5"), false, "nothing left: no box (flagged)");
});

test("a box cut as its own SVG: only what touches it, letters as local outlines, nothing else", () => {
  const art = pageArt(SVG, 5);
  const found = findBoxes(art, textLines(XML));
  const svg = cropSvg(art, found.captions[0]!.box);
  assert.match(svg, /^<svg xmlns="http:\/\/www.w3.org\/2000\/svg" viewBox="[\d. ]+" width="[\d.]+" height="[\d.]+"><rect /);
  assert.ok(svg.includes('<path id="g0"'), "the letter used in the box");
  assert.ok(!svg.includes('<path id="g1"'), "letters outside are not");
  assert.ok(!svg.includes("M 150 420"), "the triangle below is not");
  assert.ok(!/script|href="(?!#g)|xlink|image|style/.test(svg));
  const page = pageSvg(art, found.captions[0]!.box);
  assert.ok(page.includes('viewBox="0 0 595.28 841.89"'));
  assert.ok(page.includes('stroke="#d1242f"'), "the current box is framed");
  assert.deepEqual(cleanBox([500, 900, -20, 100], art), [0, 100, 500, 841.89], "corners sorted and kept on the page");
  assert.equal(cleanBox([1, 1, 3, 3], art), null, "too small");
  assert.equal(cleanBox(["1", 2, 3, 4], art), null);
  assert.deepEqual(wholePage(art), [30, 72, 565.28, 791.89]);
});

test("figure flags: a labelled cut or a box by hand needs no look; a cut by position, an old drawing or none does", () => {
  const base = { id: "F1", page: 5, caption: "", description: "", svg: "", box: [1, 2, 3, 4] as [number, number, number, number] };
  assert.equal(figureFlag({ ...base, cut: "caption" }), null);
  assert.equal(figureFlag({ ...base, cut: "manual" }), null);
  assert.equal(figureFlag({ ...base, cut: "page" }), null);
  assert.match(figureFlag({ ...base, cut: "order" })!.reason, /Check its box/);
  assert.match(figureFlag({ ...base, box: null, cut: "" })!.reason, /could not be found/);
  assert.match(figureFlag({ ...base, box: null, cut: "", svg: "<svg/>" })!.reason, /older AI drawing/);
  const c = cleanPaper({ items: [{ number: "1", page: 5, text: "x", marks: null, options: [], answerLines: 0, figures: ["F1"], guidance: "" }], figures: [{ ...base, cut: "caption", box: [1, 2, 3, "x"] }] }, "qp");
  assert.equal(c.figures[0]!.box, null, "a bad box is dropped");
  assert.equal(c.figures[0]!.cut, "");
  // A figure without a printed label goes to the page of its first part; a box drawn by hand stays put.
  const pages = [`cover ${"Instructions for candidates. ".repeat(20)}`, "", "", "", "1 A triangle has sides of 3 cm and 4 cm. Work out the length of the third side."];
  const placed = placeOnPages({ kind: "qp", totalMarks: null, items: [{ ...c.items[0]!, text: "A triangle has sides of 3 cm and 4 cm. Work out the length of the third side." }], figures: [{ ...base, page: 2, cut: "order" }, { ...base, id: "F2", page: 2, cut: "manual" }] }, pages);
  assert.equal(placed.figures[0]!.page, 5);
  assert.equal(placed.figures[0]!.box, null, "moved: cut again");
  assert.equal(placed.figures[1]!.page, 2, "drawn by hand: kept");
  assert.equal(paperFlags({ content: { ...c, figures: [{ ...base, cut: "caption" }] }, pages, gemini: null }).some((f) => f.kind === "figure"), false);
});

test("figures stored, served cut, and a box drawn by hand saved and undone", async () => {
  const db = testDb();
  const bucket = testBucket();
  db.raw.exec(`INSERT INTO source_document (id, syllabus_id, session, year, paper, variant, doc_type, file_name, r2_key, sha256, size_bytes, origin, status, acquired_at)
               VALUES ('doc-qp-fig', '0625-2023', 's', 2024, 4, 2, 'qp', '0625_s24_qp_42.pdf', 'k', 'sha', 100000, 'upload', 'stored', ${NOW})`);
  const id = (await startPaperRun(db, "doc-qp-fig", { items: [], figures: [] }, "platform-admin", NOW))!;
  await claimBrainRun(db, id, null, NOW + 1);
  const art = pageArt(SVG, 5);
  assert.equal(await saveArt(bucket, "doc-qp-fig", JSON.parse(JSON.stringify(art))), "ok");
  assert.equal(await saveArt(bucket, "doc-qp-fig", { v: 1 }), "bad");
  const content = cleanPaper({
    items: [{ number: "2(b)", page: 5, text: "Fig. 2.1 shows a car as it travels round a circular racing track.", marks: 2, options: [], answerLines: 2, figures: ["F1"], guidance: "" }],
    figures: [{ id: "F1", page: 5, caption: "Fig. 2.1", description: "a circular track", box: [190, 140, 370, 300], cut: "order" }],
  }, "qp");
  const flags = paperFlags({ content, pages: ["", "", "", "", "Fig. 2.1 shows a car as it travels round a circular racing track. [2]"], gemini: null });
  assert.equal(await savePaperReading(db, bucket, id, "doc-qp-fig", { content, flags, pages: [] }, true, NOW + 5), "ok");
  const svg = (await figureSvg(bucket, "doc-qp-fig", "qp", "F1"))!;
  assert.ok(svg.startsWith("<svg") && svg.includes("M 200 -200"), "cut from the stored page");
  assert.ok((await figurePageSvg(bucket, "doc-qp-fig", "qp", "F1"))!.includes("#d1242f"));
  assert.equal(await figureSvg(bucket, "doc-qp-fig", "qp", "F9"), null);

  const doc = (await paperDoc(db, "doc-qp-fig"))!;
  let view = await paperView(db, bucket, doc);
  assert.ok(view.open.some((f) => f.kind === "figure" && f.item === "F1"), "cut by position: flagged");
  assert.equal(await applyFix(db, bucket, doc, "box", { item: "F1", box: "nonsense" }, "platform-admin", NOW + 10), "bad");
  assert.equal(await applyFix(db, bucket, doc, "box", { item: "F9", box: "1,2,30,40" }, "platform-admin", NOW + 10), "bad");
  assert.equal(await applyFix(db, bucket, doc, "box", { item: "F1", box: "150,400,280,490" }, "platform-admin", NOW + 10), "ok_fixed");
  let fig = (await loadContent(bucket, "doc-qp-fig", "qp"))!.figures[0]!;
  assert.deepEqual(fig.box, [150, 400, 280, 490]);
  assert.equal(fig.cut, "manual");
  view = await paperView(db, bucket, doc);
  assert.equal(view.open.some((f) => f.kind === "figure"), false, "a box by hand clears the flag");
  assert.ok((await figureSvg(bucket, "doc-qp-fig", "qp", "F1"))!.includes("M 150 420"), "now the triangle");

  const undo = view.fixes.find((f) => f.action === "edit" && f.item === "F1")!;
  assert.equal(await applyFix(db, bucket, doc, "undo", { fix: undo.id }, "platform-admin", NOW + 20), "ok_undone");
  fig = (await loadContent(bucket, "doc-qp-fig", "qp"))!.figures[0]!;
  assert.deepEqual(fig.box, [190, 140, 370, 300], "Undo puts the old box back");
  assert.ok((await paperView(db, bucket, doc)).open.some((f) => f.kind === "figure"), "and its flag");
  assert.equal(await applyFix(db, bucket, doc, "box", { item: "F1", box: "whole" }, "platform-admin", NOW + 30), "ok_fixed");
  assert.equal((await loadContent(bucket, "doc-qp-fig", "qp"))!.figures[0]!.cut, "page");
});

test("a figure is shown once, on the first part that lists it (Nov 2025 Paper 42, the graph in 1(b) and 1(c))", () => {
  const home = figureHome([{ number: "1(a)", figures: [] }, { number: "1(b)", figures: ["F1"] }, { number: "1(c)", figures: ["F1", "F2"] }]);
  assert.equal(home.get("F1"), "1(b)");
  assert.equal(home.get("F2"), "1(c)");
});

test("a figure taken off a part, or deleted, by hand on any part; Undo brings each back", async () => {
  const db = testDb();
  const bucket = testBucket();
  db.raw.exec(`INSERT INTO source_document (id, syllabus_id, session, year, paper, variant, doc_type, file_name, r2_key, sha256, size_bytes, origin, status, acquired_at)
               VALUES ('doc-qp-del', '0625-2023', 'w', 2025, 4, 2, 'qp', '0625_w25_qp_42.pdf', 'k', 'sha', 100000, 'upload', 'stored', ${NOW})`);
  const id = (await startPaperRun(db, "doc-qp-del", { items: [], figures: [] }, "platform-admin", NOW))!;
  await claimBrainRun(db, id, null, NOW + 1);
  const content = cleanPaper({
    items: [
      { number: "1(b)", page: 3, text: "Plot a graph of l against m.", marks: 4, options: [], answerLines: 0, figures: ["F1"], guidance: "" },
      { number: "1(c)", page: 3, text: "Use your graph to determine the length l_0 of the spring with no load on it.", marks: 1, options: [], answerLines: 1, figures: ["F1"], guidance: "" },
    ],
    figures: [{ id: "F1", page: 3, caption: "", description: "graph grid", box: [190, 140, 370, 300], cut: "match" }],
  }, "qp");
  assert.equal(content.items[1]!.text, "Use your graph to determine the length l_{0} of the spring with no load on it.", "l_0 is a subscript");
  assert.equal(await savePaperReading(db, bucket, id, "doc-qp-del", { content, flags: [], pages: [] }, true, NOW + 5), "ok");
  const doc = (await paperDoc(db, "doc-qp-del"))!;

  assert.equal(await applyFix(db, bucket, doc, "unfigure", { item: "1(c)", figure: "F9" }, "platform-admin", NOW + 10), "bad");
  assert.equal(await applyFix(db, bucket, doc, "unfigure", { item: "1(c)", figure: "F1" }, "platform-admin", NOW + 10), "ok_fixed");
  let c = (await loadContent(bucket, "doc-qp-del", "qp"))!;
  assert.deepEqual(c.items.map((x) => x.figures), [["F1"], []]);
  let view = await paperView(db, bucket, doc);
  const off = view.fixes[0]!;
  assert.equal(off.item, "1(c)");
  assert.equal(off.what, "Took figure F1 off this part");
  assert.equal(await applyFix(db, bucket, doc, "undo", { fix: off.id }, "platform-admin", NOW + 20), "ok_undone");
  assert.deepEqual((await loadContent(bucket, "doc-qp-del", "qp"))!.items.map((x) => x.figures), [["F1"], ["F1"]], "back on 1(c)");

  assert.equal(await applyFix(db, bucket, doc, "delfigure", { item: "1(b)", figure: "F1" }, "platform-admin", NOW + 30), "ok_fixed");
  c = (await loadContent(bucket, "doc-qp-del", "qp"))!;
  assert.equal(c.figures.length, 0);
  assert.deepEqual(c.items.map((x) => x.figures), [[], []], "off every part");
  view = await paperView(db, bucket, doc);
  const del = view.fixes[0]!;
  assert.equal(del.item, "1(b)");
  assert.equal(del.what, "Deleted figure F1");
  assert.equal(await applyFix(db, bucket, doc, "undo", { fix: del.id }, "platform-admin", NOW + 40), "ok_undone");
  c = (await loadContent(bucket, "doc-qp-del", "qp"))!;
  assert.equal(c.figures[0]!.id, "F1");
  assert.deepEqual(c.figures[0]!.box, [190, 140, 370, 300]);
  assert.deepEqual(c.items.map((x) => x.figures), [["F1"], ["F1"]], "back where it was");

  // Add a figure (owner, 12 Nov 2026): taken off 1(c), then put back on it by hand; Undo takes it off again.
  await applyFix(db, bucket, doc, "unfigure", { item: "1(c)", figure: "F1" }, "platform-admin", NOW + 50);
  assert.equal(await applyFix(db, bucket, doc, "addfigure", { item: "1(c)", figure: "F9" }, "platform-admin", NOW + 60), "bad", "only a figure of this paper");
  assert.equal(await applyFix(db, bucket, doc, "addfigure", { item: "1(b)", figure: "F1" }, "platform-admin", NOW + 60), "bad", "not twice on a part");
  assert.equal(await applyFix(db, bucket, doc, "addfigure", { item: "1(c)", figure: "F1" }, "platform-admin", NOW + 60), "ok_fixed");
  assert.deepEqual((await loadContent(bucket, "doc-qp-del", "qp"))!.items.map((x) => x.figures), [["F1"], ["F1"]]);
  view = await paperView(db, bucket, doc);
  const add = view.fixes[0]!;
  assert.equal(add.what, "Added figure F1 to this part");
  assert.equal(await applyFix(db, bucket, doc, "undo", { fix: add.id }, "platform-admin", NOW + 70), "ok_undone");
  assert.deepEqual((await loadContent(bucket, "doc-qp-del", "qp"))!.items.map((x) => x.figures), [["F1"], []]);
});

test("the AI's own copy for the benchmark: kept from a whole reading of a paper nobody fixed; a read for the score touches nothing else", async () => {
  const db = testDb();
  const bucket = testBucket();
  db.raw.exec(`INSERT INTO source_document (id, syllabus_id, session, year, paper, variant, doc_type, file_name, r2_key, sha256, size_bytes, origin, status, acquired_at)
               VALUES ('doc-qp-aicopy', '0625-2023', 'w', 2025, 4, 2, 'qp', '0625_w25_qp_42.pdf', 'k', 'sha', 100000, 'upload', 'stored', ${NOW})`);
  const item = (text: string) => ({ number: "1(a)", page: 2, text, marks: 2, options: [], answerLines: 1, figures: [], guidance: "" });
  const read = async (text: string, at: number, shadow = false) => {
    const run = (await startBatchRun(db, ["doc-qp-aicopy"], "0625 benchmark papers", "platform-admin", at, false, shadow))!;
    await claimBrainRun(db, run, null, at + 1);
    return savePaperReading(db, bucket, run, "doc-qp-aicopy", { content: cleanPaper({ items: [item(text)], figures: [] }, "qp"), flags: [], pages: [], models: { claude: "claude-haiku-5-5", gemini: "gemini-3.6-flash" } }, true, at + 2, true, { full: true, shadow });
  };
  const ai = async () => {
    const o = await bucket.get("papers/doc-qp-aicopy/ai.json");
    return o ? (JSON.parse(await new Response(o.body).text()) as { content: { items: { text: string }[] }; claude: string }) : undefined;
  };
  assert.equal(await read("State the AI's words.", NOW), "ok");
  assert.equal((await ai())?.content.items[0]?.text, "State the AI's words.");
  assert.equal((await ai())?.claude, "claude-haiku-5-5");
  // A person fixes the words: the copy keeps the AI's.
  const doc = (await paperDoc(db, "doc-qp-aicopy"))!;
  assert.equal(await handFixed(db, "doc-qp-aicopy"), false);
  assert.equal(await applyFix(db, bucket, doc, "edit", { item: "1(a)", text: "State the fixed words.", marks: "2" }, "platform-admin", NOW + 10), "ok_fixed");
  assert.equal(await handFixed(db, "doc-qp-aicopy"), true);
  assert.equal((await ai())?.content.items[0]?.text, "State the AI's words.");
  // A normal reading again (merged with the fix) leaves the copy alone.
  await read("State the fixed words.", NOW + 20);
  assert.equal((await ai())?.content.items[0]?.text, "State the AI's words.");
  // Read again for the score: only the copy changes; the reading people see keeps the fix, with no new revision.
  const before = await db.prepare(`SELECT revision, read_at FROM paper_read WHERE doc_id = 'doc-qp-aicopy'`).bind().first<{ revision: number; read_at: number }>();
  assert.equal(await read("State the new AI words.", NOW + 30, true), "ok");
  assert.equal((await ai())?.content.items[0]?.text, "State the new AI words.");
  assert.equal((await loadContent(bucket, "doc-qp-aicopy", "qp"))!.items[0]!.text, "State the fixed words.");
  assert.deepEqual(await db.prepare(`SELECT revision, read_at FROM paper_read WHERE doc_id = 'doc-qp-aicopy'`).bind().first(), before);
});

test("a figure's labels by text alone: short lines between the question text and its printed label (Mar 2025 Paper 42, Fig. 7.1)", () => {
  const xml = `<doc><page width="595" height="842"><flow>
${block(line(72, 62, 421, 76, word("(a)", 72, 62, 85, 76) + word("Fig.", 95, 62, 110, 76) + word("7.1 is a scale drawing of light waves approaching a narrow slit.", 112, 62, 421, 76)))}
${block(line(150, 110, 291, 126, word("SCALE", 150, 110, 190, 126) + word("1.0 cm", 193, 110, 230, 126)))}
${block(line(165, 187, 219, 201, word("direction", 165, 187, 200, 201) + word("of", 203, 187, 219, 201)))}
${block(line(72, 300, 300, 314, word("Use", 72, 300, 90, 314) + word("the sheet provided.", 93, 300, 300, 314)))}
${block(line(279, 498, 317, 512, word("Fig.", 279, 498, 295, 512) + word("7.1", 297, 498, 317, 512)))}
${block(line(118, 524, 362, 538, word("Name", 118, 524, 150, 538) + word("the wave effect.", 153, 524, 362, 538)))}
</flow></page></doc>`;
  const boxes = labelBoxes(textLines(xml));
  assert.deepEqual(boxes, [[150, 110, 291, 126], [165, 187, 219, 201]], "the labels, not the question, a sentence or the text after the label");
});

test("question numbers put right by the checks are listed under Changes, and Undo gives each part its old number", async () => {
  const db = testDb();
  const bucket = testBucket();
  db.raw.exec(`INSERT INTO source_document (id, syllabus_id, session, year, paper, variant, doc_type, file_name, r2_key, sha256, size_bytes, origin, status, acquired_at)
               VALUES ('doc-qp-renum', '0625-2023', 's', 2024, 4, 2, 'qp', '0625_s24_qp_42.pdf', 'k', 'sha', 100000, 'upload', 'stored', ${NOW})`);
  const id = (await startPaperRun(db, "doc-qp-renum", { items: [], figures: [] }, "platform-admin", NOW))!;
  await claimBrainRun(db, id, null, NOW + 1);
  const part = (number: string, marks: number | null) => ({ number, page: 8, text: `Words of ${number}.`, marks, options: [], answerLines: 0, figures: [], guidance: "" });
  const content = cleanPaper({ items: [part("2(d)", null), part("2(d)(i)", 2)], figures: [] }, "qp");
  const was = [{ ...part("7(d)", null), text: "Words of 2(d)." }, { ...part("7(d)(i)", 2), text: "Words of 2(d)(i)." }];
  const renumber = [{ key: "structure:p8:numbers", page: 8, renames: [{ from: "7(d)", to: "2(d)" }, { from: "7(d)(i)", to: "2(d)(i)" }], before: was, flags: [] }];
  assert.equal(await savePaperReading(db, bucket, id, "doc-qp-renum", { content, flags: [], pages: [], renumber }, true, NOW + 5), "ok");
  const doc = (await paperDoc(db, "doc-qp-renum"))!;
  const view = await paperView(db, bucket, doc);
  const fix = view.fixes[0]!;
  assert.equal(fix.what, "Question numbers put right from the printed page (page 8)");
  assert.equal(fix.who, "Automatic fix");
  assert.deepEqual([fix.before, fix.after], ["7(d), 7(d)(i)", "2(d), 2(d)(i)"]);
  assert.equal(await handFixed(db, "doc-qp-renum"), false, "an automatic fix is not a hand fix (the AI's copy is still kept)");
  assert.equal(await applyFix(db, bucket, doc, "undo", { fix: fix.id }, "platform-admin", NOW + 10), "ok_undone");
  assert.deepEqual((await loadContent(bucket, "doc-qp-renum", "qp"))!.items.map((x) => x.number), ["7(d)", "7(d)(i)"]);
  // A renumbering the script cannot back up (a part not on that page) is not recorded.
  const id2 = (await startPaperRun(db, "doc-qp-renum", { items: [], figures: [] }, "platform-admin", NOW + 20))!;
  await claimBrainRun(db, id2, null, NOW + 21);
  const bad = [{ ...renumber[0]!, page: 9, key: "structure:p9:numbers" }];
  assert.equal(await savePaperReading(db, bucket, id2, "doc-qp-renum", { content, flags: [], pages: [], renumber: bad }, true, NOW + 25), "ok");
  assert.equal((await paperView(db, bucket, doc)).fixes.filter((f) => f.what.startsWith("Question numbers")).length, 1);
});

test("an unlabelled figure is not matched to another drawing by answer-space words (Nov 2023 0478 Paper 22, page 9)", () => {
  const found = { captions: [], groups: [[84, 192, 556, 446], [101, 500, 492, 715]] as [number, number, number, number][] };
  const lines = [{ text: "A B C Z", b: [84, 200, 556, 440] as [number, number, number, number], body: false }, { text: "A B C Working space Z", b: [101, 503, 480, 525] as [number, number, number, number], body: false }];
  const got = assignBoxes([{ id: "F2", caption: "", description: "Space to draw the logic circuit, inputs A, B, C on the left and output Z on the right" }], found, lines as never);
  assert.deepEqual(got.get("F2"), { box: [84, 192, 556, 446], cut: "order" }, "the first drawing on the page, by order");
});

test("photos: placed from pdftocairo's <use>, filled with a JPEG, kept safe, cut under the drawing", () => {
  // Biology Mar 2025 P42 page 17: Fig. 6.2 is a photograph (a raster picture), which the drawing alone never showed.
  const svg = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="595" height="842"><defs>`,
    `<image id="source-5" x="0" y="0" width="1181" height="796" xlink:href="data:image/png;base64,AAAA"/>`,
    `</defs>`,
    `<use xlink:href="#source-5" transform="matrix(0.24,0,0,0.24,155.77,308.9)"/>`,
    `<path fill="none" stroke-width="1" stroke="rgb(0%, 0%, 0%)" d="M 160 320 L 200 330 "/>`,
    `</svg>`,
  ].join("\n");
  const art = pageArt(svg, 17);
  const slots = photoSlots(art);
  assert.equal(slots.length, 1);
  assert.deepEqual(slots[0]!.b, [155.77, 308.9, 439.21, 499.94]);
  assert.deepEqual(photoArgs(17, [72, 144, 144, 216]).slice(-9), ["-x", "100", "-y", "200", "-W", "100", "-H", "100", "-singlefile"]);
  const jpeg = "data:image/jpeg;base64,/9j/4AAQSkZJRg==";
  const filled = fillPhotos(art, new Map([[slots[0]!.k, jpeg]]));
  // Only a JPEG data URI of a sane size survives the clean; anything else is dropped.
  const clean = cleanArt(JSON.parse(JSON.stringify(filled)))!;
  assert.equal(clean.e.filter((x) => "i" in x).length, 1);
  assert.equal(cleanArt({ ...filled, e: [{ b: [0, 0, 10, 10], i: "javascript:alert(1)" }] })!.e.length, 0);
  assert.equal(cleanArt({ ...filled, e: [{ b: [0, 0, 10, 10], i: "data:image/svg+xml;base64,PHN2Zz4=" }] })!.e.length, 0);
  // A photo left without its JPEG is dropped rather than kept empty.
  assert.equal(fillPhotos(art, new Map()).e.some((x) => "i" in x), false);
  // The cut shows the photo first, then the drawing over it.
  const cut = cropSvg(clean, [150, 300, 445, 505]);
  assert.ok(cut.indexOf("<image href=\"data:image/jpeg") < cut.indexOf("<path"), cut.slice(0, 400));
  // A caption above which only a photo sits gets the photo's box, not the question's sentences beside it.
  const lines = textLines(`<page><flow><block xMin="92" yMin="270" xMax="420" yMax="282"><line xMin="92" yMin="270" xMax="420" yMax="282"><word xMin="92" yMin="270" xMax="420" yMax="282">Shearwater birds feed on fish in the ocean.</word></line></block></flow><flow><block xMin="270" yMin="505" xMax="320" yMax="517"><line xMin="270" yMin="505" xMax="320" yMax="517"><word xMin="270" yMin="505" xMax="295" yMax="517">Fig.</word><word xMin="297" yMin="505" xMax="320" yMax="517">6.2</word></line></block></flow></page>`);
  const photoOnly = { ...clean, e: clean.e.filter((x) => "i" in x) };
  assert.deepEqual(findBoxes(photoOnly, lines).captions[0]?.box, [155.77, 308.9, 439.21, 499.94]);
});
