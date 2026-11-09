// Notation and lead-ins read from where each word sits (owner, 9 Nov 2026). Word boxes below are shaped like Poppler's
// on real Cambridge papers: 0625 June 2024 Paper 41 question 8 (the nuclide ²⁰⁸₈₁Tl, a lead-in, then (a) with its own),
// 0620 Paper 41 (H₂O, CoSO₄) and 0580 Paper 41 (x², km² set in italic pieces).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  applyNotation, bboxWords, leadInProblems, lostNotation, normaliseNotation, notate, notatedPages, notationOn, notationParts, notationPlain,
  pdfOutline, withoutLead, wordsText, type Word,
} from "../../src/lib/brain/notation.ts";
import { cleanPaper, mergeReading, paperFlags, recheckItem, splitLeadIn, structureFlags } from "../../src/lib/brain/paper.ts";

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
