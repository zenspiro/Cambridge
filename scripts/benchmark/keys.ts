// Drafts the benchmark's answer keys from the papers' own PDFs (docs/benchmark.md). Run in a dev session with Poppler:
//   node scripts/benchmark/keys.ts <folder of PDFs named like 0625_w25_qp_42.pdf> [--force]
// Writes benchmark/keys/<file>.json: part numbers and printed [marks], opening text, which part names each figure and
// table first, notation in our markup; never the paper's wording. A key already marked "checked" is kept unless
// --force. Anything the code cannot settle goes in `unsure` for a person to look at.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { inflateSync, constants } from "node:zlib";
import { allPagesInfo } from "../../src/lib/pdf/firstPage.ts";
import { blankPages } from "../../src/lib/brain/paper.ts";
import { fractionBars, notatedPages, pdfOutline, type Bar, type OutlinePart } from "../../src/lib/brain/notation.ts";
import { findBoxes, labelBoxes, pageArt, textLines, type Box } from "../../src/lib/brain/figures.ts";
import { BENCHMARK, type BenchKey } from "../../src/lib/brain/benchmark.ts";

const dir = process.argv[2];
const force = process.argv.includes("--force");
if (!dir) {
  console.error("usage: node scripts/benchmark/keys.ts <folder of PDFs> [--force]");
  process.exit(2);
}
const OUT = new URL("../../benchmark/keys/", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const inflate = async (d: Uint8Array) => new Uint8Array(inflateSync(d, { finishFlush: constants.Z_SYNC_FLUSH }));

/** The paper as the reading script sees it: notated words and the outline (the same steps as scripts/brain/run.ts). */
async function outlineOf(pdf: string): Promise<{ outline: OutlinePart[]; cover: string }> {
  const info = await allPagesInfo(new Uint8Array(readFileSync(pdf)), inflate);
  const raw = info.map((p) => p.text);
  const blank = blankPages(raw);
  const xml = execFileSync("pdftotext", ["-bbox-layout", pdf, "-"], { maxBuffer: 1e8 }).toString();
  const pageXml = [...xml.matchAll(/<page [^>]*>[\s\S]*?<\/page>/g)].map((m) => m[0]);
  const bars: Bar[][] = [];
  const figs: Box[][] = [];
  for (let p = 1; p <= raw.length; p++) {
    if (p === 1 || blank.includes(p)) {
      bars.push([]);
      figs.push([]);
      continue;
    }
    const svg = execFileSync("pdftocairo", ["-svg", "-f", String(p), "-l", String(p), pdf, "-"], { maxBuffer: 1e8 }).toString();
    bars.push(fractionBars(svg));
    try {
      const lines = textLines(pageXml[p - 1] ?? "");
      figs.push([...findBoxes(pageArt(svg, p), lines).captions.map((c) => c.box), ...labelBoxes(lines)]);
    } catch {
      figs.push([]);
    }
  }
  const n = notatedPages(raw, xml, bars);
  return { outline: pdfOutline(n.words, figs), cover: raw[0] ?? "" };
}

const realWords = (s: string) => s.normalize("NFKD").toLowerCase().match(/[a-z]{4,}/g) ?? [];
/** Each piece of notation in a part's text with what it is attached to: "10^{−2}", "^{90}_{38}Sr", "\\frac{2}{x − 2}". */
function notationTokens(text: string): string[] {
  const out: string[] = [];
  const group = (at: number) => {
    // A balanced {...} starting at `at`; its end, or -1.
    let depth = 0;
    for (let i = at; i < text.length; i++) {
      if (text[i] === "{") depth++;
      else if (text[i] === "}" && --depth === 0) return i + 1;
    }
    return -1;
  };
  for (let i = 0; i < text.length; i++) {
    const frac = text.startsWith("\\frac{", i);
    if (!frac && !((text[i] === "^" || text[i] === "_") && text[i + 1] === "{")) continue;
    let start = i;
    if (!frac) while (start > 0 && !/[\s^_{}]/.test(text[start - 1]!)) start--;
    let end = frac ? group(i + 5) : group(i + 1);
    if (end > 0 && frac) end = text[end] === "{" ? group(end) : -1;
    // Stacked scripts and the symbol after a stack ("^{90}_{38}Sr") belong to the same piece.
    while (end > 0 && (text[end] === "^" || text[end] === "_") && text[end + 1] === "{") end = group(end + 1);
    if (end < 0) continue;
    if (start === i && !frac) while (end < text.length && /[A-Za-z]/.test(text[end]!)) end++;
    out.push(text.slice(start, end));
    i = end - 1;
  }
  return out;
}

// Only notation the reader gets right every time goes in a key (checked by eye on the Maths and Chemistry drafts: the
// text layer turns π into "rr" and × into "#", stacks vectors, and splits fractional powers like 125^{2/3}).
const ATOM = /^(\d+(\.\d+)?|\d*[a-z]{1,2})$/i;
const SIDE = /^\s*(\d+(\.\d+)?|\d*[a-z]{1,2})(\s*[+\-−]\s*(\d+(\.\d+)?|\d*[a-z]{1,2}))*\s*$/i;
const RELIABLE = [
  /^(mm|cm|dm|km|m|s|kg|g)\^\{[23]\}$/, // units
  /^10\^\{−?\d{1,2}\}$/, // standard form
  /^\d*(\(?([A-Z][a-z]?(_\{\d{1,2}\})?)+\)?(_\{\d{1,2}\})?)+$/, // formulas: H_{2}O, Fe_{3}O_{4}, (NH_{4})_{2}
  /^\d*[A-Z][a-z]?(_\{\d\})?\^\{\d?[+−]\}$/, // ions: Cr^{3+}, Rb^{+}
  /^\^\{\d{1,3}\}(_\{\d{1,3}\})?[A-Z][a-z]?$/, // nuclides: ^{34}S, ^{90}_{38}Sr
  /^\d*[a-z]?\^\{−?\d\}$/, // simple powers: x^{2}, 3x^{2}, 2^{5}, p^{−1}
  /^[A-Z]_\{[a-z0-9]\}$/, // E_{a}, L_{1}
];
/** The token when its form is one the reader gets right, else null. */
function reliable(token: string, after: string): string | null {
  if (/[#`=]|rr/.test(token)) return null;
  // A power followed by lone digits is a fractional power read in pieces ("125^{2} 5 2" is 125^{2/3}).
  if (/\^\{[^}]*\}$/.test(token) && /^\s+\d\b/.test(after)) return null;
  if (/\d\^\{1\}$/.test(token)) return null; // 36^{1/2} read as 36^{1}
  const frac = /^\\frac\{([^{}]*)\}\{([^{}]*)\}$/.exec(token);
  if (frac) return SIDE.test(frac[1]!) && SIDE.test(frac[2]!) && ATOM.test(frac[1]!.trim().split(/\s+/)[0]!) ? token : null;
  return RELIABLE.some((r) => r.test(token)) ? token : null;
}

function draftQp(file: string, outline: OutlinePart[], cover: string): BenchKey {
  const unsure: string[] = [];
  const paper = Number(file.split("_")[3]![0]);
  const code = file.slice(0, 4);
  const mcq = ["0610", "0620", "0625"].includes(code) && paper <= 2;
  const hasKids = (n: string) => outline.some((x) => x.number.startsWith(`${n}(`));
  const parts = outline.filter((x) => !hasKids(x.number) || x.marks).map((x) => ({ n: x.number, marks: x.marks ?? null }));
  if (!mcq) for (const p of parts) if (p.marks == null) unsure.push(`${p.n}: no printed [marks] found`);
  const leads = outline.filter((x) => hasKids(x.number) && (realWords(x.text).length >= 3 || (/=/.test(x.text) && x.text.length >= 4))).map((x) => x.number);
  // Question numbers follow on from 1.
  const qs = [...new Set(outline.map((x) => Number(x.number.split("(")[0])))];
  qs.forEach((q, i) => {
    if (q !== i + 1) unsure.push(`question ${q} follows ${qs[i - 1] ?? "the start"}`);
  });
  if (mcq && qs.length !== 40) unsure.push(`multiple choice with ${qs.length} questions, not 40`);
  const naming = (label: string) => outline.filter((x) => new RegExp(`\\b${label.replace(/\./g, "\\.").replace(" ", "\\s*")}(?![0-9])`).test(x.text)).map((x) => x.number).slice(0, 2);
  const labels = (re: RegExp) => [...new Set(outline.flatMap((x) => [...x.text.matchAll(re)].map((m) => m[0].replace(/\s+/g, " "))))];
  // A figure described between parts ("Fig. 1.4 is a diagram ..." after 1(a)(i), then "(ii) Measure ... in Fig. 1.4")
  // may fairly sit on either: the first part naming it, or the next one.
  const holders = (label: string) => {
    const [part, next] = naming(label);
    return { label, part: part!, ...(next ? { also: [next] } : {}) };
  };
  const figures = labels(/\bFig\.\s*\d+\.\d+/g).map(holders);
  const tables = labels(/\bTable\s*\d+\.\d+/g).map(holders);
  const notation: BenchKey["notation"] = [];
  for (const x of outline) {
    const seen = new Set<string>();
    let from = 0;
    // The last part runs on into the reference pages at the back ("Notes for use in qualitative analysis", the
    // Periodic Table), which no reading keeps as the part's text.
    const text = x.text.split(/Notes for use in qualitative analysis|The Periodic Table of Elements/)[0]!;
    for (const raw of notationTokens(text)) {
      const at = text.indexOf(raw, from);
      from = at + raw.length;
      let token = reliable(raw.replace(/^[(\[]+/, ""), text.slice(from));
      // A lettered label (R_{1}, A_{2}) may be only a diagram's label, which no reading keeps as text: kept when the
      // question's words name it too (it is printed twice in the part).
      if (token && /^[A-Z]_\{[a-z0-9]\}$/.test(token) && text.split(token).length < 3) token = null;
      // A unit after "/" is an axis or column heading ("distance / 10^{25} m"), often inside a graph no reading keeps.
      if (token && /\/\s*$/.test(text.slice(0, at))) token = null;
      if (!token || seen.has(token) || seen.size >= 6) continue;
      seen.add(token);
      notation.push({ part: x.number, token });
    }
  }
  const printed = Number(/total mark for this paper is\s*(\d+)/i.exec(cover.replace(/\s+/g, " "))?.[1] ?? NaN);
  // Multiple choice: one mark a question, none printed.
  const sum = mcq ? parts.length : parts.reduce((a, p) => a + (p.marks ?? 0), 0);
  let total: number | null = Number.isFinite(printed) ? printed : null;
  if (total == null) unsure.push("the cover's total mark was not found");
  else if (sum !== total) {
    if (sum > total) unsure.push(`parts add up to ${sum}, the cover says ${total}: a choice of questions, or a part read twice`);
    else unsure.push(`parts add up to ${sum}, the cover says ${total}: marks missed`);
    total = null;
  }
  return { file, kind: "qp", total, mcq, parts, leads, figures, tables, notation, unsure, status: "draft" };
}

/** A mark scheme's key: its question paper's parts and marks (the set always has the pair). */
function draftMs(file: string, qp: BenchKey): BenchKey {
  return { file, kind: "ms", total: qp.total, mcq: qp.mcq, parts: qp.parts.map((p) => ({ ...p })), leads: [], figures: [], tables: [], notation: [], unsure: qp.unsure.filter((u) => /marks|total/.test(u)), status: "draft" };
}

const keys = new Map<string, BenchKey>();
for (const p of BENCHMARK.filter((x) => x.file.includes("_qp_"))) {
  const at = join(OUT, `${p.file}.json`);
  const old = existsSync(at) ? (JSON.parse(readFileSync(at, "utf8")) as BenchKey) : null;
  if (old?.status === "checked" && !force) {
    keys.set(p.file, old);
    continue;
  }
  const pdf = join(dir, `${p.file}.pdf`);
  if (!existsSync(pdf)) {
    console.error(`missing ${pdf}`);
    continue;
  }
  const { outline, cover } = await outlineOf(pdf);
  const key = draftQp(p.file, outline, cover);
  keys.set(p.file, key);
  writeFileSync(at, `${JSON.stringify(key, null, 1)}\n`);
  console.log(`${p.file}: ${key.parts.length} parts, ${key.leads.length} opening texts, ${key.figures.length} figures, ${key.tables.length} tables, ${key.notation.length} notation, ${key.unsure.length} unsure`);
}
for (const p of BENCHMARK.filter((x) => x.file.includes("_ms_"))) {
  const at = join(OUT, `${p.file}.json`);
  const old = existsSync(at) ? (JSON.parse(readFileSync(at, "utf8")) as BenchKey) : null;
  if (old?.status === "checked" && !force) continue;
  const qp = keys.get(p.file.replace("_ms_", "_qp_"));
  if (!qp) {
    console.error(`${p.file}: its question paper has no key`);
    continue;
  }
  writeFileSync(at, `${JSON.stringify(draftMs(p.file, qp), null, 1)}\n`);
  console.log(`${p.file}: from ${qp.file}`);
}
