// Notation and lead-ins read from where each word sits (owner, 9 Nov 2026). Word boxes below are shaped like Poppler's
// on real Cambridge papers: 0625 June 2024 Paper 41 question 8 (the nuclide ²⁰⁸₈₁Tl, a lead-in, then (a) with its own),
// 0620 Paper 41 (H₂O, CoSO₄) and 0580 Paper 41 (x², km² set in italic pieces).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  fractionBars, fractions, fractionsIn, joinFractionLines, linearFraction, notationTree,
  applyNotation, bboxWords, leadInProblems, lostNotation, normaliseNotation, notate, notatedPages, notationOn, notationParts, notationPlain,
  isCaptionLine, joinDropCaps, leadExtra, pdfOutline, unknownStops, stripLead, withoutLead, wordsText, type Word,
} from "../../src/lib/brain/notation.ts";
import { autoFixLeads, cleanPaper, figuresToLeads, fillLead, pipeRows, isSplitFlag, mergeReading, missingFromOutline, paperFlags, recheckItem, splitLeadIn, structureFlags } from "../../src/lib/brain/paper.ts";

type W = [number, number, number, number, string];
/** Poppler's -bbox-layout shape: pages of lines of words. */
const xml = (pages: W[][][]) =>
  `<doc>${pages.map((lines) => `<page width="595" height="842"><flow><block>${lines.map((l) => `<line xMin="0" yMin="0" xMax="0" yMax="0">${l.map(([a, b, c, d, t]) => `<word xMin="${a}" yMin="${b}" xMax="${c}" yMax="${d}">${t.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</word>`).join("")}</line>`).join("")}</block></flow></page>`).join("")}</doc>`;

// Page 13 of 0625/41 June 2024, as Poppler places it.
const Q8: W[][] = [
  [[291.5, 35.7, 303.8, 51.4, "13"]],
  [[49.6, 67.3, 55.7, 83.0, "8"]],
  [[72.3, 67.8, 91.2, 82.5, "The"], [94.3, 67.8, 129.8, 82.5, "isotope"], [132.8, 67.8, 192.7, 82.5, "thallium-208"], [195.8, 67.8, 199.5, 82.5, "("], [200.0, 66.3, 213.3, 77.0, "208"]],
  [[204.4, 74.3, 213.3, 85.0, "81"], [213.3, 67.8, 223.1, 82.5, "Tl"], [224.5, 67.8, 228.2, 82.5, ")"], [231.2, 67.8, 239.2, 82.5, "is"], [242.2, 67.8, 298.5, 82.5, "radioactive."], [301.5, 67.8, 307.6, 82.5, "It"], [310.7, 67.8, 345.5, 82.5, "decays"], [348.6, 67.8, 360.2, 82.5, "by"], [363.3, 69.8, 404.6, 82.2, "β-decay."]],
  [[72.3, 93.3, 85.7, 109.0, "(a)"], [95.0, 93.8, 158.5, 108.5, "Thallium-208"], [161.6, 93.8, 196.4, 108.5, "decays"], [199.5, 93.8, 208.7, 108.5, "to"], [211.7, 93.8, 224.0, 108.5, "an"], [227.0, 93.8, 262.5, 108.5, "isotope"], [265.5, 93.8, 274.7, 108.5, "of"], [277.8, 93.8, 298.6, 108.5, "lead"], [301.6, 93.8, 325.5, 108.5, "(Pb)."]],
  [[95.9, 119.3, 106.3, 135.0, "(i)"]],
  [[117.6, 119.8, 164.7, 134.5, "Complete"], [167.8, 119.8, 183.1, 134.5, "the"], [186.1, 119.8, 228.3, 134.5, "equation"], [231.4, 119.8, 244.2, 134.5, "for"], [247.3, 119.8, 264.4, 134.5, "this"], [267.4, 119.8, 299.1, 134.5, "decay."]],
  [[533.4, 179.8, 545.7, 194.5, "[3]"]],
  [[92.9, 205.3, 106.3, 221.0, "(ii)"], [117.6, 205.8, 160.0, 220.5, "Explain"], [163.0, 205.8, 190.0, 220.5, "why"], [193.0, 205.8, 230.0, 220.5, "this"], [233.0, 205.8, 300.0, 220.5, "γ-emission"], [303.0, 205.8, 330.0, 220.5, "does"], [333.0, 205.8, 350.0, 220.5, "not"], [353.0, 205.8, 390.0, 220.5, "affect"], [393.0, 205.8, 410.0, 220.5, "the"], [413.0, 205.8, 450.0, 220.5, "numbers."]],
  [[270.1, 797.0, 325.2, 807.6, "0625/41/M/J/24"]],
];

test("superscripts and subscripts are read from the word boxes: a nuclide, m/s², H₂O, a minus power", () => {
  const nuclide = notate(bboxWords(xml([Q8]))[0]!);
  assert.ok(nuclide.words.some((w) => w.t === "^{208}_{81}Tl"));
  assert.deepEqual(nuclide.tokens.map((t) => t.marked), ["^{208}_{81}Tl"]);
  const line = (ws: W[]) => notate(bboxWords(xml([[ws]]))[0]!);
  assert.equal(wordsText(line([[100, 470.2, 125, 483.5, "m"], [128, 470.2, 131, 483.5, "/"], [384.1, 470.2, 389.1, 483.5, "s"], [389.1, 469.2, 393.3, 479.2, "2"]]).words), "m / s^{2}");
  assert.equal(wordsText(line([[385.2, 504.7, 393.2, 519.7, "H"], [393.2, 512.2, 396.7, 521.0, "2"], [396.7, 504.7, 405.3, 519.7, "O"]]).words), "H_{2}O");
  assert.equal(wordsText(line([[347.4, 471.6, 359.7, 486.2, "10"], [359.7, 470.5, 373.4, 481.4, "–10"], [376.5, 471.6, 384.0, 486.2, "C."]]).words), "10^{−10} C.");
  // Italic pieces that touch join without a space: "k" "m" "2" is km².
  assert.equal(wordsText(line([[506.1, 250.0, 511.9, 265.1, "k"], [511.9, 250.0, 520.8, 265.1, "m"], [521.4, 248.3, 525.4, 258.9, "2"]]).words), "km^{2}");
  // A smaller label beside a word (a table key) is not a superscript: same middle, or too long.
  assert.equal(wordsText(line([[100, 100, 130, 115, "atomic"], [133, 101, 160, 112, "number"]]).words), "atomic number");
});

test("the notation is written into our reader's page text where it is printed, and stays in order", () => {
  const tokens = notate(bboxWords(xml([Q8]))[0]!).tokens;
  const page = "8 The isotope thallium-208 (\n208\n81Tl ) is radioactive. It decays by β-decay.";
  assert.equal(applyNotation(page, tokens), "8 The isotope thallium-208 (\n^{208}_{81}Tl ) is radioactive. It decays by β-decay.");
  // "37Cl17": a nuclide's numbers in another order around its symbol.
  assert.equal(applyNotation("atom 37Cl17 here", [{ pieces: ["37", "17", "Cl"], marked: "^{37}_{17}Cl", prefix: true }]), "atom ^{37}_{17}Cl here");
  // Never inside a longer word or number: "s2" in "hours2x" stays, "108" in "1080" stays.
  assert.equal(applyNotation("hours2x 1080", [{ pieces: ["s", "2"], marked: "s^{2}" }, { pieces: ["10", "8"], marked: "10^{8}" }]), "hours2x 1080");
  // Whole pages: Poppler's words when it read every page, else our reader patched.
  const n = notatedPages(["13 8 The isotope thallium-208 ( 208 81Tl ) is radioactive. It decays by β-decay. (a) Thallium-208 decays to an isotope of lead (Pb). (i) Complete the equation for this decay. [3] (ii) Explain why this γ-emission does not affect the numbers. 0625/41/M/J/24"], xml([Q8]));
  assert.equal(n.from, "poppler");
  assert.match(n.pages[0]!, /\(\s\^\{208\}_\{81\}Tl \) is radioactive/);
  const patched = notatedPages(["8 thallium-208 ( 208 81Tl )", "page two"], xml([Q8]));
  assert.equal(patched.from, "patched");
  assert.equal(patched.pages[0], "8 thallium-208 ( ^{208}_{81}Tl )");
});

test("an AI's notation in one markup; shown as text and as pieces for the review screen", () => {
  assert.equal(normaliseNotation("²⁰⁸₈₁Tl, 5.8 × 10⁻² kg, cm³, x^2, 10^-3, H₂O"), "^{208}_{81}Tl, 5.8 × 10^{−2} kg, cm^{3}, x^{2}, 10^{−3}, H_{2}O");
  assert.equal(normaliseNotation("total_marks ← 0"), "total_marks ← 0");
  // A bare subscript (Nov 2025 Paper 42 1(c): l₀ written "l_0"); names in code are left alone.
  assert.equal(normaliseNotation("the length l_0 of the spring. l_0 = cm, v_1 and T_12"), "the length l_{0} of the spring. l_{0} = cm, v_{1} and T_{12}");
  assert.equal(normaliseNotation("x_pos ← my_1 + a_b2 + l_{0}"), "x_pos ← my_1 + a_b2 + l_{0}");
  assert.equal(notationPlain("^{208}_{81}Tl and v_{max}"), "²⁰⁸₈₁Tl and v_{max}");
  assert.deepEqual(notationParts("H_{2}O"), [{ kind: "text", text: "H" }, { kind: "sub", text: "2" }, { kind: "text", text: "O" }]);
  assert.deepEqual(notationOn("( ^{208}_{81}Tl ) and 3.0 × 10^{8} m / s").map((t) => t.marked), ["^{208}_{81}Tl", "10^{8}"]);
});

test("a reading with notation flat is flagged red, with the repaired wording to copy", () => {
  const pages = ["cover page of the paper with its instructions, ".repeat(14), "8 The isotope thallium-208 ( ^{208}_{81}Tl ) is radioactive. The speed of light is 3.0 × 10^{8} m / s."];
  const lost = lostNotation("The isotope thallium-208 (20881Tl) is radioactive.", pages);
  assert.equal(lost?.marked, "^{208}_{81}Tl");
  assert.equal(lost?.repaired, "The isotope thallium-208 (^{208}_{81}Tl) is radioactive.");
  assert.equal(lostNotation("The isotope thallium-208 (²⁰⁸₈₁Tl) is radioactive.", pages), null);
  assert.equal(lostNotation("The speed of light is 3.0 × 108 m / s.", pages)?.marked, "10^{8}");
  const c = cleanPaper({ totalMarks: null, items: [{ number: "8", page: 2, text: "The isotope thallium-208 ( 208 81 Tl ) is radioactive.", marks: null }] }, "qp");
  const flags = paperFlags({ content: c, pages, gemini: null });
  const f = flags.find((x) => x.kind === "notation");
  assert.equal(f?.colour, "red");
  assert.match(f!.reason, /²⁰⁸₈₁Tl/);
  assert.equal(f!.pdfText, "The isotope thallium-208 ( ^{208}_{81}Tl ) is radioactive.");
  // Fixed by the admin: the recheck clears it.
  const fixed = { ...c, items: [{ ...c.items[0]!, text: f!.pdfText }] };
  assert.equal(recheckItem(fixed, flags, "8", pages).filter((x) => x.kind === "notation").length, 0);
});

test("the paper's outline: question numbers, part letters and numerals, and the text between them", () => {
  // Page 1 (the cover) never starts a question.
  const words = bboxWords(xml([[[[49.6, 300, 55.7, 315, "1"], [60, 300, 90, 315, "Answer"]]], Q8])).map((p) => notate(p).words);
  const o = pdfOutline(words);
  assert.deepEqual(o.map((p) => p.number), ["8", "8(a)", "8(a)(i)", "8(a)(ii)"]);
  assert.equal(o[0]!.text, "The isotope thallium-208 (^{208}_{81}Tl ) is radioactive. It decays by β-decay.");
  assert.equal(o[1]!.text, "Thallium-208 decays to an isotope of lead (Pb).");
  assert.equal(o[2]!.text, "Complete the equation for this decay.");
  // "(i)" after "(h)" is a letter when it lines up with the letters, a numeral when it is indented.
  const lab = (x: number, t: string, y: number): W[] => [[x, y, x + 12, y + 14, t], [x + 20, y, x + 60, y + 14, "words"], [x + 63, y, x + 90, y + 14, "here"]];
  const letters: W[][] = [[[49.6, 60, 55.7, 75, "1"]], ...["a", "b", "c", "d", "e", "f", "g", "h", "i"].map((l, k) => lab(72, `(${l})`, 80 + k * 30))];
  letters.push(lab(95, "(i)", 380));
  assert.deepEqual(pdfOutline(bboxWords(xml([[], letters]))).map((p) => p.number).slice(-3), ["1(h)", "1(i)", "1(i)(i)"]);
});

const OUTLINE = [
  { number: "7", page: 12, text: "Many organic compounds contain carbon and hydrogen only." },
  { number: "7(a)", page: 12, text: "" },
  { number: "7(a)(i)", page: 12, text: "Organic compound A has the following composition by mass." },
  { number: "8", page: 13, text: "The isotope thallium-208 ( ^{208}_{81}Tl ) is radioactive. It decays by β-decay." },
  { number: "8(a)", page: 13, text: "Thallium-208 decays to an isotope of lead (Pb)." },
  { number: "8(a)(i)", page: 13, text: "Complete the equation for this decay." },
  { number: "8(a)(ii)", page: 13, text: "Explain why this γ-emission does not affect the numbers." },
];

test("lead-ins joined to the first part, or left out, are flagged; a reading with them as their own items is not", () => {
  const merged = [
    { number: "7(a)(i)", text: "Organic compound A has the following composition by mass." },
    { number: "8(a)(i)", text: "The isotope thallium-208 (^{208}_{81}Tl) is radioactive. It decays by β-decay. Thallium-208 decays to an isotope of lead (Pb). Complete the equation for this decay." },
    { number: "8(a)(ii)", text: "Explain why this γ-emission does not affect the numbers." },
  ];
  const p = leadInProblems(merged, OUTLINE);
  assert.deepEqual(p.map((x) => [x.number, x.child, x.merged]), [["7", "7(a)(i)", false], ["8", "8(a)(i)", true], ["8(a)", "8(a)(i)", true]]);
  const good = [{ number: "7", text: "Many organic compounds contain carbon and hydrogen only." }, merged[0]!, { number: "8", text: OUTLINE[3]!.text }, { number: "8(a)", text: OUTLINE[4]!.text }, { number: "8(a)(i)", text: "Complete the equation for this decay." }, merged[2]!];
  assert.deepEqual(leadInProblems(good, OUTLINE), []);
  // An outline with fewer than two questions (not a Cambridge layout) is not trusted.
  assert.deepEqual(leadInProblems(merged, OUTLINE.slice(3, 4)), []);
});

test("Give it its own part: the lead-in becomes an item before its first part, taken out of that part", () => {
  const c = cleanPaper({ totalMarks: null, items: [
    { number: "8(a)(i)", page: 13, text: "The isotope thallium-208 (^{208}_{81}Tl) is radioactive. It decays by β-decay. Thallium-208 decays to an isotope of lead (Pb). Complete the equation for this decay.", marks: 3 },
    { number: "8(a)(ii)", page: 13, text: "Explain why this γ-emission does not affect the numbers.", marks: 1 },
  ] }, "qp");
  const flags = structureFlags(c.items, OUTLINE);
  assert.deepEqual(flags.map((f) => f.key), ["structure:8(a)(i):8", "structure:8(a)(i):8(a)"]);
  assert.ok(flags.every((f) => f.colour === "red"));
  const once = splitLeadIn(c, "8(a)(i)", "8", flags[0]!.pdfText)!;
  const twice = splitLeadIn(once, "8(a)(i)", "8(a)", flags[1]!.pdfText)!;
  assert.deepEqual(twice.items.map((i) => [i.number, i.marks]), [["8", null], ["8(a)", null], ["8(a)(i)", 3], ["8(a)(ii)", 1]]);
  assert.equal(twice.items[2]!.text, "Complete the equation for this decay.");
  assert.equal(splitLeadIn(twice, "8(a)(i)", "8", "again"), null);
  assert.equal(withoutLead("Many organic compounds contain carbon and hydrogen only. Compound A has this composition.", OUTLINE[0]!.text), "Compound A has this composition.");
  // Re-reading the part brings the new reading's lead-ins in, before the part.
  const fresh = cleanPaper({ items: [{ number: "8", page: 13, text: "lead 8" }, { number: "8(a)", page: 13, text: "lead 8a" }, { number: "8(a)(i)", page: 13, text: "Complete the equation for this decay.", marks: 3 }] }, "qp");
  const merged = mergeReading(c, fresh, new Set(), { items: ["8(a)(i)"], figures: [] });
  assert.deepEqual(merged.items.map((i) => i.number), ["8", "8(a)", "8(a)(i)", "8(a)(ii)"]);
});

test("tables are kept as data: rows of cells, blanks to fill in, checked against the PDF like wording", () => {
  const c = cleanPaper({ items: [{ number: "2", page: 3, text: "Complete Table 2.1.", tables: [{ label: "Table 2.1", rows: [["atom or ion", "number of protons", "number of electrons"], ["^{37}_{17}Cl", "17", ""], ["Cu²⁺", "", "27"]] }, "junk"] }] }, "qp");
  assert.deepEqual(c.items[0]!.tables, [{ label: "Table 2.1", rows: [["atom or ion", "number of protons", "number of electrons"], ["^{37}_{17}Cl", "17", ""], ["Cu^{2+}", "", "27"]] }]);
  const pages = ["cover page of the paper with its instructions, ".repeat(14), "", "2 Complete Table 2.1. Table 2.1 atom or ion number of protons number of electrons ^{37}_{17}Cl 17 Cu^{2+} 27"];
  assert.equal(paperFlags({ content: { ...c, totalMarks: null }, pages, gemini: null }).filter((f) => f.kind === "words").length, 0);
  const wrong = cleanPaper({ items: [{ number: "2", page: 3, text: "Complete Table 2.1.", tables: [{ label: "Table 2.1", rows: [["mass of the sample in kilograms", "temperature rise in degrees"]] }] }] }, "qp");
  assert.equal(paperFlags({ content: { ...wrong, totalMarks: null }, pages, gemini: null }).filter((f) => f.kind === "words").length, 1);
});

test("word boxes split a tab-joined label from its text", () => {
  const w: Word[] = bboxWords(xml([[[[49.7, 58.8, 100.3, 74.5, "1\tName"], [103.4, 58.9, 118.6, 73.9, "the"]]]]))[0]!;
  assert.deepEqual(w.map((x) => [x.t, x.first]), [["1", true], ["Name", false], ["the", false]]);
});

test("the fix repairs every flat notation in the part, and a table written with \"|\" is flagged", () => {
  const pages = ["cover page of the paper with its instructions, ".repeat(14), "(ii) In an experiment, 1.405 g of CoSO_{4}•xH_{2}O is heated. [M_{r}: CoSO_{4}, 155; H_{2}O, 18]"];
  const lost = lostNotation("1.405 g of CoSO4•xH2O is heated. [Mr: CoSO4, 155; H2O, 18]", pages);
  assert.equal(lost?.repaired, "1.405 g of CoSO_{4}•xH_{2}O is heated. [M_{r}: CoSO_{4}, 155; H_{2}O, 18]");
  const c = cleanPaper({ items: [{ number: "2", page: 2, text: "Complete the table.\natom | protons\nCl | 17" }] }, "qp");
  const f = paperFlags({ content: { ...c, totalMarks: null }, pages, gemini: null }).find((x) => x.key === "structure:2:table");
  assert.equal(f?.colour, "red");
});

test("after a lead-in is split off, the part's notation flag still offers the repaired wording", () => {
  const pages = ["cover page of the paper with its instructions, ".repeat(14), "8 The isotope thallium-208 ( ^{208}_{81}Tl ) is radioactive. (a) (i) Complete the equation for this decay. ^{208}_{81}Tl"];
  const c = cleanPaper({ items: [{ number: "8(a)(i)", page: 2, text: "The isotope thallium-208 (208 81Tl) is radioactive. Complete the equation for this decay. 208 81Tl", marks: 3 }] }, "qp");
  const flags = paperFlags({ content: { ...c, totalMarks: null }, pages, gemini: null });
  const split = splitLeadIn({ ...c, totalMarks: null }, "8(a)(i)", "8", "The isotope thallium-208 (^{208}_{81}Tl) is radioactive.")!;
  const after = recheckItem(split, flags, "8(a)(i)", pages).find((f) => f.kind === "notation");
  assert.equal(after?.pdfText, "Complete the equation for this decay. ^{208}_{81}Tl");
});


// 0580 June 2024 Paper 41, page 6: "(b) Write as a single fraction" 4/(x − 1) − 3/(2x + 5), and "3 (a) C = ¼xy²".
const P6: W[][] = [
  [[49.6, 67.7, 55.4, 83.1, "3"]],
  [[140.3, 61.9, 146.0, 77.0, "1"]],
  [[117.9, 67.8, 125.6, 83.1, "C"], [128.8, 70.2, 136.6, 81.7, "="], [147.8, 67.8, 158.0, 83.1, "xy"], [158.5, 66.3, 162.6, 76.9, "2"]],
  [[140.3, 74.2, 146.0, 89.3, "4"]],
  [[72.3, 67.7, 85.7, 83.1, "(a)"]],
  [[274.1, 334.9, 279.9, 350.0, "4"], [312.7, 334.9, 318.5, 350.0, "3"]],
  [[291.1, 343.2, 298.9, 354.7, "-"]],
  [[266.3, 347.0, 271.4, 362.3, "x"], [273.0, 349.5, 280.8, 361.0, "-"], [282.4, 347.2, 288.1, 362.3, "1"], [301.8, 347.2, 307.6, 362.3, "2"], [307.6, 347.0, 312.7, 362.3, "x"], [314.2, 349.5, 322.0, 361.0, "+"], [323.6, 347.2, 329.3, 362.3, "5"]],
];
const P6_SVG = `<svg><defs></defs><g fill="rgb(13.7%, 12.2%, 12.5%)">
<path fill-rule="nonzero" fill="rgb(13.7%, 12.2%, 12.5%)" d="M 139.56 76.68 L 146.43 76.68 L 146.43 76.18 L 139.56 76.18 Z M 139.56 76.68 "/>
<path fill-rule="nonzero" fill="rgb(13.7%, 12.2%, 12.5%)" d="M 265.05 349.35 L 288.33 349.35 L 288.33 348.85 L 265.05 348.85 Z M 265.05 349.35 "/>
<path fill-rule="nonzero" fill="rgb(13.7%, 12.2%, 12.5%)" d="M 300.88 349.35 L 329.5 349.35 L 329.5 348.85 L 300.88 348.85 Z M 300.88 349.35 "/>
<path fill="none" stroke-width="0.3" stroke="rgb(13.7%, 12.2%, 12.5%)" d="M 0 0 L 82.36 0 " transform="matrix(1, 0, 0, 1, 94.8, 86.1)"/>
</g></svg>`;

test("fraction bars are the thin filled strips on a page, not stroked table rules", () => {
  const bars = fractionBars(P6_SVG);
  assert.equal(bars.length, 3);
  assert.deepEqual(bars[1]!.map((x) => Math.round(x)), [265, 349, 288, 349]);
});

test("words stacked over a bar become a fraction, put back on the line it sits on", () => {
  const raw = bboxWords(xml([P6]))[0]!;
  const f = fractions(raw, fractionBars(P6_SVG));
  assert.equal(f.count, 3);
  const text = wordsText(joinFractionLines(notate(f.words).words));
  assert.equal(text, "3 (a) C = \\frac{1}{4} xy^{2}\n\\frac{4}{x - 1} - \\frac{3}{2x + 5}");
  // Through the whole page: Poppler's text with fractions, and the count.
  const n = notatedPages(["3 (a) C = 1 xy2 4 4 3 - x - 1 2x + 5 and more text on the page"], xml([P6]), [fractionBars(P6_SVG)]);
  assert.equal(n.fractions, 3);
  assert.match(n.pages[0]!, /C = \\frac\{1\}\{4\} xy\^\{2\}/);
  // A part's own superscript sits higher than the rest (y⁸ over 16x¹⁶) and still belongs to it.
  const y8: W[] = [[151.2, 91.9, 156.3, 107.2, "y"], [156.9, 90.4, 160.9, 101.0, "8"], [143.0, 109.1, 154.5, 124.2, "16"], [154.5, 108.9, 159.6, 124.2, "x"], [160.1, 107.4, 168.2, 118.0, "16"]];
  const g = fractions(bboxWords(xml([[y8]]))[0]!, [[142.25, 108.21, 168.56, 108.71]]);
  assert.equal(g.words[0]!.t, "\\frac{y^{8}}{16x^{16}}");
  // A mixed number: the whole number and the fraction go together.
  const mixed: W[] = [[100, 300, 112, 315, "43"], [113, 294, 117, 305, "1"], [113, 307, 117, 318, "3"], [120, 300, 128, 315, "%"]];
  assert.equal(wordsText(fractions(bboxWords(xml([[mixed]]))[0]!, [[112.8, 305.6, 117.4, 306.1]]).words), "43\\frac{1}{3} %");
});

test("fractions in the markup: Unicode fractions, plain text, the display tree", () => {
  assert.equal(normaliseNotation("43⅓ % and ¾"), "43\\frac{1}{3} % and \\frac{3}{4}");
  assert.deepEqual(fractionsIn("a \\frac{\\frac{1}{2}}{x + 1} b").map((f) => [f.num, f.den]), [["\\frac{1}{2}", "x + 1"]]);
  assert.equal(linearFraction("4", "x − 1"), "4/(x − 1)");
  assert.equal(notationPlain("\\frac{y^{8}}{16x^{16}} and \\frac{\\frac{1}{2}}{3}"), "y⁸/(16x¹⁶) and (1/2)/3");
  assert.deepEqual(notationTree("C = \\frac{1}{4}xy^{2}"), [
    { kind: "text", text: "C = " },
    { kind: "frac", num: [{ kind: "text", text: "1" }], den: [{ kind: "text", text: "4" }] },
    { kind: "text", text: "xy" },
    { kind: "sup", children: [{ kind: "text", text: "2" }] },
  ]);
});

test("a fraction read with its parts run together is flagged; the markup and a/b with brackets are not", () => {
  const pages = ["cover page of the paper with its instructions, ".repeat(14), "(b) Write as a single fraction in its simplest form. \\frac{4}{x - 1} - \\frac{3}{2x + 5}"];
  const lost = lostNotation("Write as a single fraction in its simplest form. 4/x − 1 − 3/(2x + 5)", pages);
  assert.equal(lost?.marked, "\\frac{4}{x - 1}");
  assert.equal(lost?.repaired, "Write as a single fraction in its simplest form. \\frac{4}{x - 1} − 3/(2x + 5)");
  assert.equal(lostNotation("Write as a single fraction. \\frac{4}{x − 1} − \\frac{3}{2x + 5}", pages), null);
  assert.equal(lostNotation("Write as a single fraction. 4/(x − 1) − 3/(2x + 5)", pages), null);
  const c = cleanPaper({ items: [{ number: "3(b)", page: 2, text: "Write as a single fraction in its simplest form. 4 x − 1 − 3/(2x + 5)", marks: 3 }] }, "qp");
  const f = paperFlags({ content: { ...c, totalMarks: null }, pages, gemini: null }).find((x) => x.kind === "notation");
  assert.match(f!.reason, /the fraction 4\/\(x - 1\)/);
});

test("a nuclide set digit by digit (Mar 2025 Paper 42, question 9) is read whole", () => {
  const sr: W[] = [[287.29, 87.14, 291.88, 97.86, "9"], [292.17, 87.14, 296.76, 97.86, "0"], [297.06, 88.37, 308.06, 102.67, "Sr"], [287.59, 94.83, 292.17, 105.56, "3"], [292.47, 94.83, 297.06, 105.56, "8"]];
  const n = notate(bboxWords(xml([[sr]]))[0]!);
  assert.deepEqual(n.words.map((w) => w.t), ["^{90}_{38}Sr"]);
  assert.deepEqual(n.tokens[0]!.pieces, ["90", "38", "Sr"]);
  assert.equal(applyNotation("notation for strontium-90 is:\n90 Sr\n38", n.tokens), "notation for strontium-90 is:\n^{90}_{38}Sr");
});

test("an underlined word in a mark scheme is not a fraction", () => {
  const ws: W[] = [[281.6, 233.9, 315.8, 244.2, "square"], [319.5, 233.9, 337.7, 244.2, "and"], [341.1, 233.9, 377.7, 244.2, "precise"], [320, 243.5, 336, 253.8, "data"], [339, 243.5, 380, 253.8, "values"]];
  assert.equal(fractions(bboxWords(xml([[ws]]))[0]!, [[319.4, 242.4, 337.8, 243.2]]).count, 0);
});

test("the outline reads each page as printed, even when the text layer stores a question number after its text", () => {
  // Nov 2025 Paper 42 page 4: "(a) A truck ..." comes first in the text layer, the "2" in the margin last.
  const p4: W[][] = [
    [[72.3, 62.2, 85.7, 76.5, "(a)"], [95.0, 62.2, 120.0, 76.5, "A"], [123, 62.2, 160, 76.5, "truck"], [163, 62.2, 200, 76.5, "moves."]],
    [[93.9, 100, 106, 114, "(i)"], [117, 100, 170, 114, "Calculate"], [173, 100, 220, 114, "the"], [223, 100, 270, 114, "force."]],
    [[49.6, 62.2, 55.4, 76.5, "2"]],
  ];
  const p3: W[][] = [[[49.6, 62.2, 55.4, 76.5, "1"], [72.3, 62.2, 85.7, 76.5, "(a)"], [95, 62.2, 150, 76.5, "State"], [153, 62.2, 190, 76.5, "this"], [193, 62.2, 230, 76.5, "now."]]];
  const o = pdfOutline(bboxWords(xml([[], p3, p4])));
  assert.deepEqual(o.map((x) => [x.number, x.text]), [["1", ""], ["1(a)", "State this now."], ["2", ""], ["2(a)", "A truck moves."], ["2(a)(i)", "Calculate the force."]]);
});

test("a lead-in is question text only: a figure's labels and its printed label are left out (Mar 2025 Paper 42, question 2)", () => {
  const p4: W[][] = [
    [[49.6, 62, 55.4, 76, "2"], [72.3, 62, 110, 76, "Trolley"], [113, 62, 125, 76, "A"], [128, 62, 160, 76, "moves."]],
    [[72.3, 88, 90, 102, "Fig."], [93, 88, 110, 102, "2.1"], [113, 88, 145, 102, "shows"], [148, 88, 170, 102, "trolley"], [173, 88, 185, 102, "A."]],
    [[184, 120, 230, 134, "direction"], [233, 120, 245, 134, "of"], [248, 120, 290, 134, "motion"]],
    [[262, 220, 270, 234, "A"], [600, 220, 610, 234, "B"]],
    [[517, 300, 560, 314, "bench"]],
    // A short sentence just above the drawing stays, even inside its box.
    [[72.3, 330, 100, 344, "Use"], [103, 330, 120, 344, "the"], [123, 330, 160, 344, "sheet"], [163, 330, 200, 344, "provided."]],
    [[385, 480, 405, 494, "Fig."], [408, 480, 425, 494, "2.1"], [428, 480, 460, 494, "(not"], [463, 480, 490, 494, "drawn"], [493, 480, 505, 494, "to"], [508, 480, 540, 494, "scale)"]],
    [[72.3, 520, 85.7, 534, "(a)"], [95, 520, 130, 534, "State"], [133, 520, 170, 534, "the"], [173, 520, 230, 534, "momentum."]],
  ];
  const words = bboxWords(xml([[], p4]));
  const figure: [number, number, number, number] = [60, 110, 565, 470];
  const before = pdfOutline(words).find((x) => x.number === "2")!.text;
  assert.match(before, /direction of motion/, "without the figure's box its labels are read as text");
  const lead = pdfOutline(words, [[], [figure]]).find((x) => x.number === "2")!.text;
  assert.equal(lead, "Trolley A moves. Fig. 2.1 shows trolley A. Use the sheet provided.");
  assert.equal(isCaptionLine("Fig. 2.1 (not drawn to scale)"), true);
  assert.equal(isCaptionLine("Fig. 2.1 shows trolley A."), false);
  // A lead-in item with the labels read into it: the extra words, numbers included; none once it reads as printed.
  assert.deepEqual(leadExtra(`${lead} direction of motion A B bench Fig. 2.1 (not drawn to scale)`, lead).slice(0, 3), ["direction", "of", "motion"]);
  assert.ok(leadExtra("Fig. 1.1 shows a force-extension graph for a spring. 5000 4000 force / N", "Fig. 1.1 shows a force-extension graph for a spring.").includes("5000"));
  assert.deepEqual(leadExtra(lead, lead), []);
});

test("a figure printed in a lead-in goes on the lead-in, not its first part; a lead-in with a figure's words is flagged", () => {
  const c = cleanPaper({
    items: [
      { number: "2", page: 4, text: "Trolley A moves. Fig. 2.1 shows trolley A. direction of motion bench Fig. 2.1 (not drawn to scale)", marks: null, figures: [] },
      { number: "2(a)", page: 4, text: "State the momentum.", marks: 1, figures: ["F2"] },
      { number: "2(b)", page: 4, text: "Calculate the mass.", marks: 3, figures: ["F2"] },
      { number: "3(a)", page: 5, text: "Fig. 3.1 shows a heater. State the region.", marks: 1, figures: ["F3"] },
    ],
    figures: [{ id: "F2", page: 4, caption: "Fig. 2.1", description: "" }, { id: "F3", page: 5, caption: "Fig. 3.1 heater", description: "" }],
  }, "qp");
  const moved = figuresToLeads(c);
  assert.deepEqual(moved.items.map((i) => [i.number, i.figures]), [["2", ["F2"]], ["2(a)", []], ["2(b)", []], ["3(a)", ["F3"]]], "only a lead-in that says Fig. 2.1 takes it");
  // Splitting a lead-in off its first part takes the figure with it.
  const split = splitLeadIn(c, "3(a)", "3", "Fig. 3.1 shows a heater.")!;
  assert.deepEqual(split.items.filter((i) => i.number.startsWith("3")).map((i) => [i.number, i.figures]), [["3", ["F3"]], ["3(a)", []]]);
  const outline = [
    { number: "2", page: 4, text: "Trolley A moves. Fig. 2.1 shows trolley A." },
    { number: "2(a)", page: 4, text: "State the momentum." },
    { number: "2(b)", page: 4, text: "Calculate the mass." },
    { number: "3", page: 5, text: "Fig. 3.1 shows a heater." },
    { number: "3(a)", page: 5, text: "State the region." },
  ];
  const flag = structureFlags(moved.items, outline).find((f) => f.key === "structure:2:lead")!;
  assert.ok(flag && flag.item === "2" && flag.pdfText === "Trolley A moves. Fig. 2.1 shows trolley A.");
  assert.equal(isSplitFlag(flag), false, "its fix is the paper's words, not a split");
  assert.equal(isSplitFlag({ kind: "structure", key: "structure:3(a):3" }), true);
  // Once the lead-in reads as printed, the flag is settled.
  const fixed = { ...moved, items: moved.items.map((i) => (i.number === "2" ? { ...i, text: flag.pdfText } : i)) };
  assert.ok(!recheckItem(fixed, [flag], "2", ["Trolley A moves. Fig. 2.1 shows trolley A."]).some((f) => f.key === flag.key));
  assert.ok(recheckItem(moved, [flag], "2", ["Trolley A moves. Fig. 2.1 shows trolley A."]).some((f) => f.key === flag.key), "still flagged while the labels are there");
});

test("a lead-in is cut from a part only where the part starts with exactly its words", () => {
  const lead = "Fig. 6.1 shows an object O. Fig. 6.1 is drawn to full scale.";
  assert.equal(stripLead("Fig. 6.1 shows an object O. Fig. 6.1 is drawn to full scale. On Fig. 6.1, label the axis.", lead), "On Fig. 6.1, label the axis.", "never at the full stop of \"Fig.\"");
  assert.equal(stripLead("1 In this experiment, you will test a spring. (a) Hang a mass.", "In this experiment, you will test a spring.", ["(a)"]), "Hang a mass.", "a printed number before it and the part's own label after it go");
  assert.equal(stripLead("The other lamp is 800 Ω. Calculate the current.", "The other lamp is 800 Ω."), "Calculate the current.", "a closing sign goes with the lead-in");
  assert.equal(stripLead("A student uses a spring. Fig. 6.1 shows an object O.", lead), null, "not at the start: nothing is cut");
  assert.equal(stripLead("Fig. 6.1 shows an object Q. Fig. 6.1 is drawn to full scale. Label it.", lead), null, "a different letter: nothing is cut");
});

test("opening text is put right without a click only when every check agrees, and never where a person decided", () => {
  const pages = ["", "", "8 A rod hangs in a field. Fig. 8.1 shows the rod. (a) State the direction of the force. [2] (b) State the effect. [1] 9 Strontium-90 is radioactive. (a) (i) Explain what isotopes are. [1] (ii) Give a use. [1]"];
  const outline = [
    { number: "8", page: 3, text: "A rod hangs in a field. Fig. 8.1 shows the rod." },
    { number: "8(a)", page: 3, text: "State the direction of the force." },
    { number: "8(b)", page: 3, text: "State the effect." },
    { number: "9", page: 3, text: "Strontium-90 is radioactive." },
    { number: "9(a)", page: 3, text: "" },
    { number: "9(a)(i)", page: 3, text: "Explain what isotopes are." },
    { number: "9(a)(ii)", page: 3, text: "Give a use." },
  ];
  const reading = (t8: string) => cleanPaper({
    items: [
      { number: "8(a)", page: 3, text: t8, marks: 2, figures: ["F1"] },
      { number: "8(b)", page: 3, text: "State the effect.", marks: 1 },
      { number: "9(a)(i)", page: 3, text: "Strontium-90 is radioactive. Explain what isotopes are.", marks: 1 },
      { number: "9(a)(ii)", page: 3, text: "Give a use.", marks: 1 },
    ],
    figures: [{ id: "F1", page: 3, caption: "Fig. 8.1", description: "" }],
  }, "qp");
  const content = reading("A rod hangs in a field. Fig. 8.1 shows the rod. State the direction of the force.");
  const none = { fingerprints: [], keys: [], items: [] };
  const r = autoFixLeads({ content, pages, gemini: content, outline }, none);
  assert.deepEqual(r.fixes.map((f) => [f.key, f.lead]), [["structure:8(a):8", "8"], ["structure:9(a)(i):9", "9"]]);
  assert.deepEqual(r.content.items.map((i) => [i.number, i.text, i.figures]), [
    ["8", "A rod hangs in a field. Fig. 8.1 shows the rod.", ["F1"]],
    ["8(a)", "State the direction of the force.", []],
    ["8(b)", "State the effect.", []],
    ["9", "Strontium-90 is radioactive.", []],
    ["9(a)(i)", "Explain what isotopes are.", []],
    ["9(a)(ii)", "Give a use.", []],
  ], "each lead-in its own part, the parts keep the rest word for word, the figure with its lead-in");
  assert.deepEqual(r.gemini?.items.map((i) => i.number), r.content.items.map((i) => i.number), "Gemini's reading gets the same split");
  assert.ok(r.fixes.every((f) => f.flags.length === 1 && f.flags[0]!.key === f.key), "each fix keeps the one flag it settled, for Undo");
  // Left alone: a part edited by hand, a flag settled with It's fine, a fix a person undid.
  assert.equal(autoFixLeads({ content, pages, gemini: content, outline }, { ...none, items: ["8(a)", "9(a)(i)"] }).fixes.length, 0);
  const fps = paperFlags({ content, pages, gemini: content, outline }).filter((f) => f.kind === "structure").map((f) => f.fingerprint);
  assert.equal(autoFixLeads({ content, pages, gemini: content, outline }, { ...none, fingerprints: fps }).fixes.length, 0);
  assert.deepEqual(autoFixLeads({ content, pages, gemini: content, outline }, { ...none, keys: ["structure:8(a):8"] }).fixes.map((f) => f.key), ["structure:9(a)(i):9"]);
  // The lead-in written differently in the part (not its exact words): left for a person, nothing cut.
  const reworded = reading("A rod is hanging in a field and Fig. 8.1 shows the rod. State the direction of the force.");
  const r2 = autoFixLeads({ content: reworded, pages, gemini: reworded, outline }, none);
  assert.ok(!r2.fixes.some((f) => f.key === "structure:8(a):8"));
  assert.equal(r2.content.items.find((i) => i.number === "8(a)")!.text, reworded.items[0]!.text);
  // A mark scheme, or a paper without an outline, is never touched.
  assert.equal(autoFixLeads({ content, pages, gemini: content, outline: [] }, none).fixes.length, 0);
});

test("page furniture's invisible comma over the margin is never a superscript, so the question number stays (Jun 2024 0620 Paper 42)", () => {
  const p5: W[][] = [
    [[37.1, 63.3, 93.4, 69.8, ",\u0001\u0001\u0002"]],
    [[49.6, 69.4, 55.7, 83.7, "3"], [70.8, 69.4, 89.8, 83.7, "The"], [92.9, 69.4, 127.7, 83.7, "symbol"], [130.8, 69.4, 173, 83.7, "equation."]],
  ];
  const words = bboxWords(xml([[], p5])).map((p) => notate(p).words);
  assert.deepEqual(pdfOutline(words).map((p) => p.number), ["3"]);
});

// Question numbers put right from the printed page (owner, 12 Nov 2026), shaped like the benchmark's 0610 Jun 2024
// Paper 42, where Claude read page 8's 2(d) as "7(d)" while Gemini and the printed labels had 2(d).
test("a page's parts get the numbers printed beside them when they line up one to one with the marks", async () => {
  const { autoRenumber } = await import("../../src/lib/brain/paper.ts");
  const { unrename } = await import("../../src/lib/brain/paperRead.ts");
  const pages = ["", "2 Plants make sugar. (a) Name the gas. [1]", "(b) State a use. [2] (d) Leaves are thin. (i) Explain why. [2] (ii) Name the cells. [1]"];
  const outline = [
    { number: "2", page: 2, text: "Plants make sugar." },
    { number: "2(a)", page: 2, text: "Name the gas.", marks: 1 },
    { number: "2(b)", page: 3, text: "State a use.", marks: 2 },
    { number: "2(d)", page: 3, text: "Leaves are thin." },
    { number: "2(d)(i)", page: 3, text: "Explain why.", marks: 2 },
    { number: "2(d)(ii)", page: 3, text: "Name the cells.", marks: 1 },
  ];
  const read = (d: string) => cleanPaper({
    items: [
      { number: "2", page: 2, text: "Plants make sugar.", marks: null },
      { number: "2(a)", page: 2, text: "Name the gas.", marks: 1 },
      { number: "2(b)", page: 3, text: "State a use.", marks: 2 },
      { number: d, page: 3, text: "Leaves are thin.", marks: null },
      { number: `${d}(i)`, page: 3, text: "Explain why.", marks: 2 },
      { number: `${d}(ii)`, page: 3, text: "Name the cells.", marks: 1 },
    ],
    figures: [],
  }, "qp");
  const none = { fingerprints: [], keys: [], items: [] };
  const content = read("7(d)");
  const r = autoRenumber({ content, pages, gemini: read("2(d)"), outline }, none);
  assert.deepEqual(r.content.items.map((i) => i.number), ["2", "2(a)", "2(b)", "2(d)", "2(d)(i)", "2(d)(ii)"]);
  assert.deepEqual(r.fixes.map((f) => [f.key, f.renames.map((x) => `${x.from}>${x.to}`).join(" ")]), [["structure:p3:numbers", "7(d)(i)>2(d)(i) 7(d)(ii)>2(d)(ii) 7(d)>2(d)"]]);
  assert.ok(r.fixes[0]!.flags.some((f) => f.kind === "missing"), "the flags it settled are kept for Undo");
  // Claude alone (no Gemini): the printed labels alone are enough.
  assert.equal(autoRenumber({ content, pages, gemini: null, outline }, none).fixes.length, 1);
  // Left alone: marks that do not line up, a part fixed by hand, a fix a person undid, a mark scheme.
  const off = { ...content, items: content.items.map((i) => (i.number === "7(d)(i)" ? { ...i, marks: 3 } : i)) };
  assert.equal(autoRenumber({ content: off, pages, gemini: null, outline }, none).fixes.length, 0, "marks differ: not the printed parts");
  assert.equal(autoRenumber({ content, pages, gemini: null, outline }, { ...none, items: ["7(d)(i)"] }).fixes.length, 0);
  assert.equal(autoRenumber({ content, pages, gemini: null, outline }, { ...none, keys: ["structure:p3:numbers"] }).fixes.length, 0);
  assert.equal(autoRenumber({ content: { ...content, kind: "ms" }, pages, gemini: null, outline }, none).fixes.length, 0);
  // A number already used elsewhere is never given twice.
  const taken = { ...content, items: [...content.items, { ...content.items[0]!, number: "2(d)", page: 2, marks: 4 }] };
  assert.equal(autoRenumber({ content: taken, pages, gemini: null, outline }, none).fixes.filter((f) => f.page === 3).length, 0);
  // Undo: every part gets its old number back.
  const back = unrename(r.content, 3, r.fixes[0]!.renames, r.fixes[0]!.before);
  assert.deepEqual(back?.items.map((i) => i.number), content.items.map((i) => i.number));
});

// A third level under a numeral (owner, 12 Nov 2026), placed like Nov 2024 0580 Paper 42 page 10: parts at 72 pt,
// numerals at 92 to 95 pt, their letters at 118 pt.
test("the outline reads letters set under a numeral as a third level, and the next part after them", () => {
  const page: W[][] = [
    [[291.5, 35.7, 303.8, 51.4, "10"]],
    [[49.6, 61.7, 55.7, 77.4, "5"], [72.3, 61.7, 85.7, 77.4, "(a)"], [95.0, 61.7, 140.0, 77.4, "Distances"], [143.0, 61.7, 180.0, 77.4, "travelled."]],
    [[95.5, 391.7, 106.3, 407.4, "(i)"], [117.6, 391.7, 140.0, 407.4, "Use"], [143.0, 391.7, 170.0, 407.4, "the"], [173.0, 391.7, 210.0, 407.4, "diagram."]],
    [[117.7, 417.7, 131.0, 433.4, "(a)"], [140.0, 417.7, 160.0, 433.4, "the"], [163.0, 417.7, 200.0, 433.4, "median"], [533.4, 417.7, 545.7, 433.4, "[1]"]],
    [[117.7, 469.7, 131.0, 485.4, "(b)"], [140.0, 469.7, 160.0, 485.4, "the"], [163.0, 469.7, 200.0, 485.4, "range"], [533.4, 469.7, 545.7, 485.4, "[2]"]],
    [[92.3, 521.7, 106.3, 537.4, "(ii)"], [117.6, 521.7, 150.0, 537.4, "Find"], [153.0, 521.7, 190.0, 537.4, "it."], [533.4, 521.7, 545.7, 537.4, "[2]"]],
    [[72.3, 612.7, 85.7, 628.4, "(b)"], [95.0, 612.7, 140.0, 628.4, "Calculate"], [143.0, 612.7, 180.0, 628.4, "speed."], [533.4, 612.7, 545.7, 628.4, "[3]"]],
  ];
  const o = pdfOutline(bboxWords(xml([[], page])));
  assert.deepEqual(o.map((p) => [p.number, p.marks ?? null]), [
    ["5", null], ["5(a)", null], ["5(a)(i)", null], ["5(a)(i)(a)", 1], ["5(a)(i)(b)", 2], ["5(a)(ii)", 2], ["5(b)", 3],
  ]);
});

test("a printed part the reading leaves out is flagged, only when the printed marks add up to the total", () => {
  const item = (number: string, marks: number | null) => ({ number, page: 2, text: "x", marks, options: [], answerLines: 1, figures: [], guidance: "", tables: [] });
  const outline = [
    { number: "1", page: 2, text: "Gases." },
    { number: "1(a)", page: 2, text: "Name a gas.", marks: 1 },
    { number: "1(b)", page: 2, text: "Write the equation.", marks: 2 },
  ];
  const content = { kind: "qp" as const, totalMarks: null, items: [item("1", null), item("1(a)", 1)] };
  const cover = ["The total mark for this paper is 3."];
  assert.deepEqual(missingFromOutline(content, outline, cover).map((f) => [f.key, f.colour]), [["missing:1(b)", "red"]]);
  // The outline misread (its marks do not make the total): nothing raised.
  assert.deepEqual(missingFromOutline(content, outline, ["The total mark for this paper is 40."]), []);
  assert.deepEqual(missingFromOutline({ ...content, items: [...content.items, item("1(b)", 2)] }, outline, cover), []);
  assert.deepEqual(missingFromOutline({ ...content, kind: "ms" }, outline, cover), []);
  // A part with marks under a number the paper never prints (Haiku's "3(lead)").
  const extra = { ...content, items: [...content.items, item("1(b)", 2), item("1(c)", 1)] };
  assert.deepEqual(missingFromOutline(extra, outline, cover).map((f) => [f.key, f.colour]), [["numbering:1(c):printed", "amber"]]);
});

test("a part label first on its line is kept even inside a figure's box", () => {
  // Jun 2025 Geography P42: Fig. 1.3's box began at the line holding only "(i)", so 1(d)(i) and (ii) were lost.
  const p: W[][] = [
    [[49.6, 88, 55.7, 102, "1"], [72.3, 88, 110, 102, "Students"], [113, 88, 160, 102, "measured."]],
    [[72.3, 120, 85.7, 134, "(a)"], [95, 120, 130, 134, "Plot"], [133, 120, 170, 134, "results."]],
    [[95.9, 400, 106.3, 414, "(i)"]],
    [[118, 416, 150, 430, "Plot"], [153, 416, 180, 430, "day"], [183, 416, 190, 430, "7"], [193, 416, 210, 430, "on"], [213, 416, 240, 430, "Fig."], [243, 416, 260, 430, "1.3."]],
    [[300, 500, 320, 514, "1005"]],
    [[72.3, 720, 85.7, 734, "(ii)"], [118, 720, 150, 734, "What"], [153, 720, 200, 734, "conclusion?"]],
  ];
  const figure: [number, number, number, number] = [92, 400, 503, 697];
  assert.deepEqual(pdfOutline(bboxWords(xml([[], p])), [[], [figure]]).map((o) => o.number), ["1", "1(a)", "1(a)(i)", "1(a)(ii)"]);
});

test("column vectors: one markup, a tree node, and no false flat power from a base", () => {
  // Gemini writes LaTeX; Claude \binom. Both end as \binom (Maths Mar 2024 P42 7(a)).
  assert.equal(normaliseNotation("\\mathbf{p} = \\begin{pmatrix} 8 \\\\ -5 \\end{pmatrix} \\quad \\mathbf{q}"), "p = \\binom{8}{−5}   q");
  assert.deepEqual(notationTree("p = \\binom{8}{−5}"), [{ kind: "text", text: "p = " }, { kind: "vec", top: [{ kind: "text", text: "8" }], bottom: [{ kind: "text", text: "−5" }] }]);
  // A page printing h(x) = 2^{x} does not make "2x^{3}" a flat power: there "2x" is the base of x^{3}.
  assert.equal(lostNotation("y = 2x^{3} + 6x^{2} − 2.5", ["h(x) = 2^{x}"]), null);
  assert.equal(lostNotation("h(x) = 2x", ["h(x) = 2^{x}"])?.marked, "2^{x}");
});

test("an opening text without the paper's figure sentences gets them back, nothing else", () => {
  // Biology Nov 2023 P32: Haiku left 1(a) empty and dropped "Fig. 6.1 is a diagram ..." from 6(a).
  assert.equal(fillLead("", "Fig. 1.1 is a diagram of the digestive system."), "Fig. 1.1 is a diagram of the digestive system.");
  assert.equal(fillLead("The arrows show the direction of water movement.", "Fig. 6.1 is a diagram showing the pathway of water into a plant. The arrows show the direction of water movement."),
    "Fig. 6.1 is a diagram showing the pathway of water into a plant. The arrows show the direction of water movement.");
  // A table's or diagram's words are never copied in, nor a sentence that does not start with the figure.
  assert.equal(fillLead("This flowchart represents an algorithm.", "This flowchart represents an algorithm. START INPUT Code OUTPUT"), null);
  assert.equal(fillLead("H_{2}S is formed.", "H_{2}S is formed. 2HCl(aq) + Na_{2}S(aq) 2NaCl(aq) Fig. 8.1 shows the volume."), null);
  assert.equal(fillLead("Fig. 1.1 shows a cell.", "Fig. 1.1 shows a cell."), null);
});

test("a \"which row\" question written with | becomes a table and plain options", () => {
  // Gemini on Physics Mar 2025 P22 question 2.
  const opts = ["a | b", "c | d", "e | f", "g | h"].map((text, k) => ({ letter: "ABCD"[k]!, text }));
  const r = pipeRows("Which row defines speed and velocity? speed | velocity", opts)!;
  assert.equal(r.text, "Which row defines speed and velocity?");
  assert.deepEqual(r.table.rows, [["", "speed", "velocity"], ["A", "a", "b"], ["B", "c", "d"], ["C", "e", "f"], ["D", "g", "h"]]);
  assert.deepEqual(r.options.map((o) => o.text), ["a; b", "c; d", "e; f", "g; h"]);
  // Options that are not all cells, or a text with no headings: the question is kept, only the table is built.
  assert.equal(pipeRows("Which is right?", ["one", "two", "three", "four"].map((text, k) => ({ letter: "ABCD"[k]!, text }))), null);
  assert.equal(pipeRows("Which row is right?", opts)!.text, "Which row is right?");
});

test("Gemini's split of an opening text the paper prints whole raises no flag; a formula still does", () => {
  // Physics Nov 2023 P32 question 9: "Fig. 9.2 shows ..." is printed before "(a) (i)", Gemini moved it to a 9(a).
  const it = (number: string, text: string, marks: number | null = null) => ({ number, page: 2, text, marks, options: [], answerLines: 0, figures: [], guidance: "", tables: [] });
  const ours = { kind: "qp" as const, totalMarks: null, figures: [], items: [it("9", "Fig. 9.1 shows a water heater. Fig. 9.2 shows the safety label for the heater."), it("9(a)(i)", "Explain the label.", 1)] };
  const gem = { ...ours, items: [it("9", "Fig. 9.1 shows a water heater."), it("9(a)", "Fig. 9.2 shows the safety label for the heater."), it("9(a)(i)", "Explain the label.", 1)] };
  const pages = ["cover", "9 Fig. 9.1 shows a water heater. Fig. 9.2 shows the safety label for the heater. (a) (i) Explain the label. [1]"];
  const outline = [{ number: "9", page: 2, text: "Fig. 9.1 shows a water heater. Fig. 9.2 shows the safety label for the heater." }, { number: "9(a)", page: 2, text: "" }, { number: "9(a)(i)", page: 2, text: "Explain the label.", marks: 1 }];
  const keys = paperFlags({ content: ours, pages, gemini: gem, outline }).map((f) => f.key);
  assert.ok(!keys.includes("agree:9") && !keys.includes("missing:9(a)"), keys.join(" "));
  // A formula opening text has no words to settle it: 1/x^{2} against 1/x stays flagged.
  const f1 = { ...ours, items: [it("11", "f(x) = \\frac{1}{x^{2}}, x ≠ 0"), it("11(a)", "Find f(2).", 1)] };
  const g1 = { ...ours, items: [it("11", "f(x) = \\frac{1}{x}, x ≠ 0"), it("11(a)", "Find f(2).", 1)] };
  const o1 = [{ number: "11", page: 2, text: "f (x) = , x ! 0 \\frac{1}{x}" }, { number: "11(a)", page: 2, text: "Find f(2).", marks: 1 }];
  assert.ok(paperFlags({ content: f1, pages: ["cover", "11 f (x) = 1 x , x ! 0 (a) Find f(2). [1]"], gemini: g1, outline: o1 }).some((f) => f.key === "agree:11"));
});

test("LaTeX symbols become the printed characters; vector names one markup", () => {
  // Gemini on Maths Jun 2025 P22: \sin, \le, \sqrt, \propto, \pi; Claude: sin, ≤, √, ∝, π.
  assert.equal(normaliseNotation("Solve 2 \\sin x - 1 = 0 for 0° \\le x \\le 360°."), "Solve 2 sin x - 1 = 0 for 0° ≤ x ≤ 360°.");
  assert.equal(normaliseNotation("(5 - \\sqrt{2})(1 + 3\\sqrt{2})"), "(5 - √2)(1 + 3√2)");
  assert.equal(normaliseNotation("y \\propto \\frac{1}{\\sqrt{x}}, \\sqrt{x+1}, \\tan(x), \\pi"), "y ∝ \\frac{1}{√x}, √(x+1), tan(x), π");
  assert.equal(normaliseNotation("\\overrightarrow{AB} = \\vec{AC}"), "\\vec{AB} = \\vec{AC}");
  assert.deepEqual(notationTree("\\vec{AB}"), [{ kind: "arrow", children: [{ kind: "text", text: "AB" }] }]);
  // Words that only start like a command are left alone.
  assert.equal(normaliseNotation("\\left \\index"), "\\left \\index");
});

test("cube roots as printed; a fraction's flat form running into a power is not that fraction", () => {
  // Maths Mar 2025 P12 4(b): \sqrt[3]{27}. Maths Nov 2023 P42 11(d): 3x^{3} on the page that prints h(x) = 3/x.
  assert.equal(normaliseNotation("\\sqrt[3]{27} and \\sqrt[3]{x+1}"), "∛27 and ∛(x+1)");
  assert.equal(lostNotation("gf(x) = 3x^{3} + ax^{2}", ["h (x) = \\frac{3}{x}"]), null);
  assert.equal(lostNotation("h(x) = 3x, x ≠ 0", ["h (x) = \\frac{3}{x}"])?.marked, "\\frac{3}{x}");
});

test("a capital set apart from the rest of its word is joined; separate letters are not", () => {
  // Chemistry Nov 2023 P62: "redict" then a lone "P" touching it on the left.
  const w = (x0: number, x1: number, t: string, y = 684) => ({ b: [x0, y, x1, y + 15] as [number, number, number, number], t, first: false });
  assert.deepEqual(joinDropCaps([w(120.8, 147.7, "redict"), w(113.5, 120.8, "P")]).map((x) => x.t), ["Predict"]);
  // A real word "A" before "metal" (a space apart), X^{R}X^{r}'s "X" and "r", the dice labels: left alone.
  assert.deepEqual(joinDropCaps([w(80.8, 107.6, "metal"), w(71, 78.3, "A")]).map((x) => x.t), ["metal", "A"]);
  assert.deepEqual(joinDropCaps([w(100, 106, "X"), w(106, 109, "r")]).map((x) => x.t), ["X", "r"]);
});

test("agreement: ours settled when printed and holding all of Gemini's words, unless choices are missing or repeated", () => {
  // Physics Jun 2025 P42 10(a)(ii): ours keeps the answer line's label "surface temperature = ... °C", Gemini drops it.
  const it = (number: string, text: string, options: { letter: string; text: string }[] = []) => ({ number, page: 2, text, marks: 1, options, answerLines: 1, figures: [], guidance: "", tables: [] });
  const pages = ["cover " + "Answer all questions in the spaces provided on the question paper. ".repeat(20), "10 (a) (ii) Calculate the surface temperature of planet D in °C. surface temperature = °C [1] 1 Tick one box. Abstraction means A testing the solution. B writing a program. C defining sub-systems. [1]"];
  const read = (items: ReturnType<typeof it>[]) => ({ kind: "qp" as const, totalMarks: null, figures: [], items });
  const flags = (ours: ReturnType<typeof it>, theirs: ReturnType<typeof it>) => paperFlags({ content: read([ours]), pages, gemini: read([theirs]) }).map((f) => f.key);
  assert.ok(!flags(it("10(a)(ii)", "Calculate the surface temperature of planet D in °C.\nsurface temperature = ... °C"), it("10(a)(ii)", "Calculate the surface temperature of planet D in °C.")).includes("agree:10(a)(ii)"));
  // 0478 Jun 2025 P22 question 1: ours repeats its choices inside the text; still flagged.
  const opts = [{ letter: "A", text: "testing the solution." }, { letter: "B", text: "writing a program." }, { letter: "C", text: "defining sub-systems." }];
  assert.ok(flags(it("1", "Tick one box. Abstraction means A testing the solution. B writing a program. C defining sub-systems.", opts), it("1", "Tick one box. Abstraction means", opts)).includes("agree:1"));
});

test("a full stop the font sends as U+FFFD, and table cells never run into a fraction", () => {
  // Maths Jun 2024 P32: "1.2 m" came out as "1�2 m", sentences ended in �, answer dots were rows of it.
  assert.equal(unknownStops("area is 1�2 m�\n���� [1]"), "area is 1.2 m.\n.... [1]");
  assert.equal(unknownStops("a � b"), "a � b");
});
