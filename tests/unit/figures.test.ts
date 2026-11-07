// Figures cut from the PDF (owner, 7 Nov 2026). The page below is made up in the shape Poppler writes (pdftocairo
// -svg, pdftotext -bbox-layout); no Cambridge artwork is kept in the repo.
import { test } from "node:test";
import assert from "node:assert/strict";
import { assignBoxes, cleanArt, cleanBox, cropSvg, findBoxes, pageArt, pageSvg, textLines, wholePage } from "../../src/lib/brain/figures.ts";
import { cleanPaper, figureFlag, paperFlags, placeOnPages } from "../../src/lib/brain/paper.ts";
import { applyFix, figurePageSvg, figureSvg, loadContent, paperDoc, paperView, saveArt, savePaperReading } from "../../src/lib/brain/paperRead.ts";
import { claimBrainRun, startPaperRun } from "../../src/lib/brain/runs.ts";
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
