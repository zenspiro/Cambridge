// Reading the papers (Phase 2, step 2b; owner 6 and 7 Nov 2026). A question paper or mark scheme is read by Claude
// into numbered items (questions and parts, or mark scheme answers) with their marks, options and figures (each
// figure described in words; the picture itself is cut from the PDF by code, figures.ts); Gemini reads the same paper
// separately. Code then checks every item against the PDF's own text and the two readings against each other, and
// raises flags for the review screen: red when the wording differs, amber when numbers or marks differ, blue for a
// figure whose box code is not sure of (no printed label) or could not find.
// Pure, strip-only TypeScript: shared by the brain script (GitHub Actions) and the Worker. No Next imports.
import { BRAIN } from "../config.ts";
import { coverage, similarity, squash, textIndex, type TextIndex } from "./topics.ts";
import type { Box, FigureCut } from "./figures.ts";
import { leadInProblems, lostNotation, normaliseNotation, notationPlain, withoutLead, type OutlinePart } from "./notation.ts";

export type PaperKind = "qp" | "ms";
export type PaperOption = { letter: string; text: string };
/** A table printed in a question (owner, 9 Nov 2026: tables as data, not pictures or " | " lines): its label and its
 * rows, the first row (or rows) its headings; an empty cell is one the candidate fills in. */
export type PaperTable = { label: string; rows: string[][] };
export type PaperItem = {
  /** As printed: "1", "1(a)", "3(b)(ii)". */
  number: string;
  /** The page it starts on (1-based). */
  page: number;
  /** Question wording, or for a mark scheme the answer and mark points. */
  text: string;
  marks: number | null;
  /** Multiple choice options A to D. */
  options: PaperOption[];
  /** Answer lines printed under a question part. */
  answerLines: number;
  /** Figures this item shows, by id. */
  figures: string[];
  /** Mark scheme guidance (accept, ignore, allow), word for word. */
  guidance: string;
  /** Tables printed in it, as data. */
  tables: PaperTable[];
};
export type PaperFigure = {
  id: string;
  page: number;
  caption: string;
  /** What it shows in words (labels, values), for the brain: the picture is Cambridge's own. */
  description: string;
  /** Older readings only: a figure the drawing AI redrew. */
  svg: string;
  /** Where the figure is on its page, in PDF points (y down), cut from the PDF; null when not found yet. */
  box: Box | null;
  /** How the box was found: by its printed label, by matching labels, by order, by hand, the whole page. */
  cut: FigureCut;
};
export type PaperContent = { kind: PaperKind; totalMarks: number | null; items: PaperItem[]; figures: PaperFigure[] };

export type FlagKind = "words" | "numbers" | "marks" | "numbering" | "figure" | "agree" | "missing" | "text" | "notation" | "structure";
export type FlagColour = "red" | "amber" | "blue";
export type Flag = {
  /** Stable within a reading: "words:1(a)", "figure:F2". */
  key: string;
  /** The item (or figure id, or "paper") it belongs to. */
  item: string;
  kind: FlagKind;
  colour: FlagColour;
  /** One plain line for the review screen. */
  reason: string;
  /** The PDF's own words for this item, when code could find them ("Use the PDF's version" copies these). */
  pdfText: string;
  /** What was flagged, independent of the item number: an "It's fine" becomes a rule on this for the subject. */
  fingerprint: string;
};

const COLOUR: Record<FlagKind, FlagColour> = {
  words: "red", agree: "red", missing: "red", notation: "red", structure: "red", numbers: "amber", marks: "amber", numbering: "amber", text: "amber", figure: "blue",
};

const NUMBER_RE = /^[0-9]{1,3}(\s?\([a-z]{1,4}\)){0,3}$/;
const FIGURE_ID_RE = /^[A-Za-z0-9_.-]{1,20}$/;
const CUTS: readonly FigureCut[] = ["caption", "match", "order", "manual", "page"];

const str = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/\r\n?/g, "\n").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").trim().slice(0, max) : "");
const int = (v: unknown, min: number, max: number) => (typeof v === "number" && Number.isInteger(v) && v >= min && v <= max ? v : null);
const obj = (v: unknown) => (v && typeof v === "object" ? (v as Record<string, unknown>) : {});

/** "1 (a)(ii)" and "1(a) (ii)" both become "1(a)(ii)". */
export const normNumber = (s: string) => s.replace(/\s+/g, "");

/** An AI's answer made safe: known fields only, capped, numbers in the printed shape. */
export function cleanPaper(raw: unknown, kind: PaperKind): PaperContent {
  const o = obj(raw);
  const figures: PaperFigure[] = (Array.isArray(o.figures) ? o.figures : []).slice(0, BRAIN.maxFigures).flatMap((x): PaperFigure[] => {
    const r = obj(x);
    const id = str(r.id, 20);
    const b = Array.isArray(r.box) && r.box.length === 4 && r.box.every((n) => typeof n === "number" && Number.isFinite(n) && n >= -50 && n <= 5000) ? (r.box as Box) : null;
    const cut = CUTS.find((c) => c === r.cut) ?? "";
    return FIGURE_ID_RE.test(id) ? [{
      id, page: int(r.page, 1, 500) ?? 1, caption: str(r.caption, 300), description: str(r.description, 1_000),
      svg: cleanSvg(str(r.svg, BRAIN.maxSvgBytes * 2)), box: b && b[2] > b[0] && b[3] > b[1] ? b : null, cut: b ? cut : "",
    }] : [];
  });
  const figureIds = new Set(figures.map((f) => f.id));
  const items: PaperItem[] = (Array.isArray(o.items) ? o.items : []).slice(0, BRAIN.maxPaperItems).flatMap((x): PaperItem[] => {
    const r = obj(x);
    const number = normNumber(str(r.number, 24));
    if (!NUMBER_RE.test(number)) return [];
    const options = (Array.isArray(r.options) ? r.options : []).slice(0, BRAIN.maxOptions).flatMap((y): PaperOption[] => {
      const q = obj(y);
      const letter = str(q.letter, 2).toUpperCase();
      return /^[A-H]$/.test(letter) ? [{ letter, text: normaliseNotation(str(q.text, 600)) }] : [];
    });
    const tables = (Array.isArray(r.tables) ? r.tables : []).slice(0, BRAIN.maxTables).flatMap((y): PaperTable[] => {
      const t = obj(y);
      const rows = (Array.isArray(t.rows) ? t.rows : []).slice(0, BRAIN.maxTableRows).flatMap((row): string[][] =>
        Array.isArray(row) ? [row.slice(0, BRAIN.maxTableCols).map((c) => normaliseNotation(str(c, 300)))] : []);
      return rows.length ? [{ label: str(t.label, 80), rows }] : [];
    });
    const figs = (Array.isArray(r.figures) ? r.figures : []).map((f) => str(f, 20)).filter((f) => FIGURE_ID_RE.test(f)).slice(0, 10);
    return [{
      number,
      page: int(r.page, 1, 500) ?? 1,
      text: normaliseNotation(str(r.text, BRAIN.maxItemText)),
      marks: int(r.marks, 0, 200),
      options,
      answerLines: int(r.answerLines, 0, 40) ?? 0,
      figures: figs,
      guidance: normaliseNotation(str(r.guidance, 2_000)),
      tables,
    }];
  });
  // Figures named by an item but not drawn still get an entry (flagged "not drawn yet").
  for (const it of items) for (const f of it.figures) if (!figures.some((x) => x.id === f)) figures.push({ id: f, page: it.page, caption: "", description: "", svg: "", box: null, cut: "" });
  return { kind, totalMarks: int(o.totalMarks, 1, 1_000), items, figures: figures.slice(0, BRAIN.maxFigures) };
}

// ---------- Figures: our own drawing, as safe SVG ----------

const SVG_TAGS = new Set(["svg", "g", "path", "line", "polyline", "polygon", "rect", "circle", "ellipse", "text", "tspan", "defs", "marker", "title", "desc"]);
const SVG_ATTRS = new Set([
  "xmlns", "version", "viewbox", "width", "height", "preserveaspectratio", "id", "transform", "d", "x", "y", "x1", "y1", "x2", "y2",
  "cx", "cy", "r", "rx", "ry", "points", "fill", "stroke", "stroke-width", "stroke-dasharray", "stroke-linecap", "stroke-linejoin",
  "opacity", "fill-opacity", "stroke-opacity", "font-size", "font-family", "font-weight", "font-style", "text-anchor",
  "dominant-baseline", "marker-end", "marker-start", "markerwidth", "markerheight", "refx", "refy", "orient", "dx", "dy",
]);
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const unesc = (s: string) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, "\"").replace(/&#39;/g, "'").replace(/&amp;/g, "&");

/**
 * An AI-drawn SVG rebuilt from an allowlist: drawing elements and presentation attributes only, every value and text
 * escaped again, no scripts, styles, links, foreign content or outside references. It is also only ever shown through
 * an <img> (which never runs scripts). Returns "" when nothing usable is left.
 */
export function cleanSvg(input: string): string {
  if (!input || input.length > BRAIN.maxSvgBytes * 2) return "";
  let s = input
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, "")
    .replace(/<[!?][^>]*>/g, "")
    .replace(/<(script|style|foreignObject|iframe|object|embed|image|use|a)\b[\s\S]*?<\/\1\s*>/gi, "");
  const out: string[] = [];
  const re = /<(\/?)([a-zA-Z][a-zA-Z0-9-]*)([^>]*?)(\/?)>|([^<]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s)) !== null) {
    if (m[5] !== undefined) {
      if (out.length) out.push(esc(unesc(m[5])));
      continue;
    }
    const tag = m[2]!.toLowerCase();
    if (!SVG_TAGS.has(tag)) continue;
    if (m[1]) {
      out.push(`</${tag}>`);
      continue;
    }
    const attrs: string[] = [];
    const ar = /([a-zA-Z][a-zA-Z0-9:-]*)\s*=\s*("([^"]*)"|'([^']*)')/g;
    let a: RegExpExecArray | null;
    while ((a = ar.exec(m[3] ?? "")) !== null) {
      const name = a[1]!.toLowerCase();
      const value = unesc(a[3] ?? a[4] ?? "");
      if (!SVG_ATTRS.has(name) || value.length > 20_000) continue;
      if (/url\s*\(/i.test(value) && !/^url\(#[A-Za-z0-9_-]{1,40}\)$/.test(value.trim())) continue;
      if (/javascript:|data:|expression\s*\(|[<>]/i.test(value)) continue;
      if (name === "xmlns" && value !== "http://www.w3.org/2000/svg") continue;
      attrs.push(` ${name === "viewbox" ? "viewBox" : name === "preserveaspectratio" ? "preserveAspectRatio" : name === "markerwidth" ? "markerWidth" : name === "markerheight" ? "markerHeight" : name === "refx" ? "refX" : name === "refy" ? "refY" : name}="${esc(value)}"`);
    }
    if (tag === "svg" && !attrs.some((x) => x.startsWith(" xmlns="))) attrs.unshift(` xmlns="http://www.w3.org/2000/svg"`);
    out.push(`<${tag}${attrs.join("")}${m[4] ? "/" : ""}>`);
  }
  s = out.join("");
  if (!s.startsWith("<svg") || s.length > BRAIN.maxSvgBytes) return "";
  return s;
}

// ---------- Checks and flags ----------

/** A short stable fingerprint (FNV-1a, hex). */
export function fingerprint(...parts: string[]): string {
  let h = 0x811c9dc5;
  for (const ch of parts.join("|")) {
    h ^= ch.codePointAt(0)!;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

/** Everything of an item that must be in the PDF: its wording and its options. */
export const itemWording = (it: Pick<PaperItem, "text" | "options"> & { tables?: PaperTable[] }) =>
  [it.text, ...it.options.map((o) => o.text), ...(it.tables ?? []).flatMap((t) => [t.label, ...t.rows.flat()])].filter(Boolean).join(" ");

/** A question or part that has parts of its own in the reading: its item holds only its lead-in (no marks). */
export const isLeadIn = (items: readonly Pick<PaperItem, "number">[], number: string) => items.some((x) => x.number.startsWith(`${number}(`));

/** The pages an item is printed on: its own and the next (a part can run over). */
const itemPages = (pages: readonly string[], page: number) => pages.slice(Math.max(0, page - 1), page + 1);

/** The notation flag for an item, or null: notation printed on its pages that the reading has flat. */
function notationFlag(it: PaperItem, pages: readonly string[]): { reason: string; what: string; pdfText: string } | null {
  const near = itemPages(pages, it.page);
  const lost = lostNotation(itemWording(it), near);
  if (!lost) return null;
  const inText = lostNotation(it.text, near);
  return {
    reason: lost.marked.startsWith("\\frac{")
      ? `The paper prints the fraction ${notationPlain(lost.marked)} here; the reading has "${lost.flat}", which reads differently.`
      : `The paper prints ${notationPlain(lost.marked)} here; the reading has it flat ("${lost.flat}").`,
    what: `${lost.marked}|${lost.flat}`,
    pdfText: inText ? inText.repaired : "",
  };
}

/**
 * A power of ten or a unit written flat, as the PDF's text layer gives it ("× 10–2", "10 5", "cm3", "m / s2"), which
 * the word check cannot see (it compares letters and digits only). Returns the first one found, else "". Pure.
 */
export function lostSuperscript(s: string): string {
  const m = /×\s*10\s*[–\-−]?\s*\d+/.exec(s) ?? /\b(?:c?m|mm|km)[23]\b/.exec(s) ?? /\/\s*s2\b/.exec(s);
  return m ? m[0] : "";
}

/** Mostly a formula: maths signs, powers or brackets in it (its text-layer copy is scrambled, so words decide). */
export const isFormula = (s: string) => /[=×÷+−√π²³⁰¹⁴-⁹⁻()/^<>≤≥]/.test(s) && /\d|[a-z]\b/i.test(s);

const numbersIn = (s: string) => [...new Set(s.match(/\d+(?:\.\d+)?/g) ?? [])];

/** The PDF's numbers, as printed ("3.5", "120"), for the numbers check. */
export function pdfNumbers(pages: readonly string[]): Set<string> {
  return new Set(pages.join(" ").match(/\d+(?:\.\d+)?/g) ?? []);
}

/**
 * The PDF's own words closest to an item's wording, from the page it is on (else the whole paper), so "Use the PDF's
 * version" can copy them. Empty when nothing is close enough.
 */
export function pdfVersion(it: PaperItem, pages: readonly string[]): string {
  const source = (pages[it.page - 1] && squash(pages[it.page - 1]!).length > 20 ? pages[it.page - 1]! : pages.join(" ")).replace(/\s+/g, " ");
  const words = source.split(" ").filter(Boolean).slice(0, 6_000);
  const want = it.text.replace(/\s+/g, " ").trim();
  const wantWords = want.split(" ");
  const n = wantWords.length;
  if (!want || n > 400 || !words.length) return "";
  const first = squash(wantWords[0] ?? "");
  const last = squash(wantWords[n - 1] ?? "");
  // Start where the item's first word is printed (else anywhere); end where its last word is, when it is.
  const starts = words.map((w, i) => (squash(w) === first ? i : -1)).filter((i) => i >= 0);
  let best = { score: 0, text: "" };
  for (const i of starts.length ? starts : words.map((_, k) => k)) {
    for (let len = Math.max(1, n - 3); len <= n + 3 && i + len <= words.length; len++) {
      const text = words.slice(i, i + len).join(" ");
      const score = similarity(text, want) + (last && squash(words[i + len - 1]!) === last ? 0.05 : 0);
      if (score > best.score) best = { score, text };
    }
  }
  return best.score >= 0.6 ? best.text : "";
}

export type CheckInput = {
  content: PaperContent;
  pages: readonly string[];
  /** Gemini's reading of the same paper, when it read it. */
  gemini: PaperContent | null;
  /** The paper's own questions and parts from where its words sit (`pdfOutline`), when Poppler read it. */
  outline?: readonly OutlinePart[];
};

/**
 * Every flag on a reading. Words: each item's wording must be found in the PDF text (as for the topic tree). Numbers:
 * every number an item uses must be printed in the PDF. Marks: each part's [marks] must be printed, and the parts
 * must add up to the paper's total. Numbering: no item twice. Figures: each one we drew is checked by eye (blue).
 * Agreement: where Gemini read an item differently, missed one or found one we lack, unless the PDF text settles it.
 */
export function paperFlags({ content, pages, gemini, outline }: CheckInput): Flag[] {
  const flags: Flag[] = [];
  const idx: TextIndex = textIndex(pages);
  const textOk = idx.chars >= BRAIN.minPaperTextChars;
  const nums = pdfNumbers(pages);
  const raw = pages.join(" ");
  const add = (kind: FlagKind, item: string, reason: string, what: string, pdfText = "", keyExtra = "") =>
    flags.push({ key: `${kind}:${item}${keyExtra}`, item, kind, colour: COLOUR[kind], reason, pdfText, fingerprint: fingerprint(kind, squash(what), reason) });
  // Formulas reach the PDF's text layer scrambled ("(x + 7)(2x − 3)" can come out as "()() xx72 3"), so a wording
  // that fails the run check passes when its real words (four letters or more) are all printed; a part that is almost
  // all formula, with too few words to judge, is left to Gemini's reading of the page picture.
  const words = (s: string) => (s.normalize("NFKD").toLowerCase().match(/[a-z]{4,}/g) ?? []);
  const found = (s: string) => {
    if (coverage(idx, s) >= BRAIN.minWordCover) return true;
    const w = words(s);
    if (w.length < 3) return isFormula(s) && w.every((x) => idx.text.includes(x));
    return w.filter((x) => idx.text.includes(x)).length / w.length >= BRAIN.minWordCover;
  };

  if (!textOk) add("text", "paper", "The PDF's text could not be read (a scan?), so wording and numbers were not checked against it.", "unreadable");
  const seen = new Set<string>();
  for (const it of content.items) {
    if (seen.has(it.number)) add("numbering", it.number, `Question ${it.number} appears twice.`, it.number + itemWording(it), "", `#${content.items.indexOf(it)}`);
    seen.add(it.number);
    if (textOk) {
      const wording = itemWording(it);
      if (squash(wording) && !found(wording)) add("words", it.number, "Wording not found in the PDF.", wording, pdfVersion(it, pages));
      for (const x of numbersIn(wording)) {
        if (!nums.has(x)) {
          add("numbers", it.number, `The number ${x} is not printed in the PDF.`, `${x}|${wording}`, "", `:${x}`);
          break;
        }
      }
      const nf = notationFlag(it, pages);
      if (nf) add("notation", it.number, nf.reason, nf.what, nf.pdfText);
      const lost = nf ? "" : lostSuperscript(wording);
      if (lost) add("numbers", it.number, `"${lost}" looks like a power or unit that lost its superscript (10⁻², cm³).`, `${lost}|${wording}`, "", ":sup");
      if (content.kind === "qp" && it.marks !== null && it.marks > 0 && !raw.includes(`[${it.marks}]`) && !raw.includes(`[Total: ${it.marks}]`)) {
        add("marks", it.number, `[${it.marks}] is not printed in the PDF.`, `${it.marks}|${wording}`);
      }
    }
  }
  if (content.kind === "qp" && outline?.length) for (const f of structureFlags(content.items, outline)) flags.push(f);
  // A table written as text lines with " | " (older readings): it belongs in the part's tables.
  for (const it of content.items) {
    if (it.text.split("\n").filter((l) => (l.match(/\|/g) ?? []).length >= 1).length >= 2) {
      add("structure", it.number, "A table is written as text lines with \"|\". Read it again to keep it as a table.", `table|${it.text}`, "", ":table");
    }
  }
  if (content.totalMarks !== null) {
    const sum = content.items.reduce((a, it) => a + (it.marks ?? 0), 0);
    if (sum > 0 && sum !== content.totalMarks) add("marks", "paper", `The parts add up to ${sum} marks, but the paper's total is ${content.totalMarks}.`, `${sum}/${content.totalMarks}`);
    if (textOk && !nums.has(String(content.totalMarks))) add("numbers", "paper", `The total of ${content.totalMarks} marks is not printed in the PDF.`, `total ${content.totalMarks}`);
  }
  for (const f of content.figures) {
    const flag = figureFlag(f);
    if (flag) add("figure", f.id, flag.reason, flag.what);
  }
  if (gemini) {
    const theirs = new Map(gemini.items.map((g) => [g.number, g]));
    const ours = new Set(content.items.map((i) => i.number));
    for (const it of content.items) {
      const g = theirs.get(it.number);
      if (!g) continue;
      const mine = itemWording(it);
      const other = itemWording(g);
      if (similarity(mine, other) < BRAIN.sameText) {
        const settled = textOk && found(mine) && !found(other);
        if (!settled) add("agree", it.number, "Claude and Gemini read this differently.", `${mine}|${other}`, textOk && found(other) ? g.text : "");
      }
      if (it.marks !== null && g.marks !== null && it.marks !== g.marks) add("marks", it.number, `Gemini reads ${g.marks} marks here, we have ${it.marks}.`, `${it.marks}|${g.marks}|${mine}`, "", ":gemini");
    }
    for (const g of gemini.items) {
      if (!ours.has(g.number)) add("missing", g.number, `Gemini found question ${g.number}; our reading does not have it.`, itemWording(g), textOk && found(itemWording(g)) ? g.text : "");
    }
  }
  return flags;
}

/** Flags a mark scheme raises against its question paper: the marks per question must match. */
export function marksAgainstPaper(ms: Pick<PaperContent, "items"> | { items: readonly { number: string; marks: number | null }[] }, qp: Pick<PaperContent, "items">): Flag[] {
  const top = (n: string) => n.match(/^\d+/)?.[0] ?? n;
  const sum = (c: { items: readonly { number: string; marks: number | null }[] }) => {
    const m = new Map<string, number>();
    for (const it of c.items) if (it.marks !== null) m.set(top(it.number), (m.get(top(it.number)) ?? 0) + it.marks);
    return m;
  };
  const a = sum(ms);
  const b = sum(qp);
  const flags: Flag[] = [];
  for (const [q, marks] of a) {
    const want = b.get(q);
    if (want !== undefined && want !== marks) {
      const reason = `Question ${q} carries ${marks} marks in the mark scheme, ${want} in the question paper.`;
      flags.push({ key: `marks:${q}:qp`, item: q, kind: "marks", colour: "amber", reason, pdfText: "", fingerprint: fingerprint("marks", `${q}:${marks}:${want}`, reason) });
    }
  }
  return flags;
}

/**
 * Lead-ins (owner, 9 Nov 2026): a question or part whose printed opening text (before its first part) the reading has
 * joined to that first part, or left out. Keyed by the first part, with the lead-in's own words for the fix.
 */
export function structureFlags(items: readonly PaperItem[], outline: readonly OutlinePart[]): Flag[] {
  return leadInProblems(items, outline).map((p) => {
    const sub = p.child.slice(p.number.length).match(/^\([a-z]+\)/)?.[0] ?? "";
    const reason = p.merged
      ? `Question ${p.number}'s opening text is joined to ${p.child}. In the paper it comes before ${sub}, as its own text.`
      : `Question ${p.number} has opening text in the paper (before ${sub}) that the reading leaves out.`;
    return { key: `structure:${p.child}:${p.number}`, item: p.child, kind: "structure" as const, colour: "red" as const, reason, pdfText: p.lead, fingerprint: fingerprint("structure", squash(p.lead), p.merged ? "merged" : "lost") };
  });
}

/** A lead-in put where the paper has it: its own item before the first part, and taken out of that part's text. */
export function splitLeadIn(c: PaperContent, child: string, number: string, lead: string): PaperContent | null {
  const at = c.items.findIndex((x) => x.number === child);
  if (at < 0 || c.items.some((x) => x.number === number) || !child.startsWith(`${number}(`)) return null;
  const first = c.items[at]!;
  const own: PaperItem = { number, page: first.page, text: normaliseNotation(str(lead, BRAIN.maxItemText)), marks: null, options: [], answerLines: 0, figures: [], guidance: "", tables: [] };
  const items = [...c.items];
  items.splice(at, 1, own, { ...first, text: withoutLead(first.text, lead) || first.text });
  return { ...c, items };
}

/** Flags still open: not settled by the admin ("It's fine", "Looks right") and not ruled out for the subject. */
/**
 * A figure's blue flag, or null when its box needs no look: cut above its printed label ("Fig. 2.1"), drawn by hand
 * or the whole page. A box found without a label, an older AI drawing, or no box at all is flagged.
 */
export function figureFlag(f: PaperFigure): { reason: string; what: string } | null {
  if (f.box) {
    if (f.cut === "match" || f.cut === "order") return { reason: `Figure ${f.id} has no printed label, so it was cut out by where it sits on page ${f.page}. Check its box.`, what: `cut:${f.id}:${f.page}:${f.box.join(",")}` };
    return null;
  }
  if (f.svg) return { reason: `Figure ${f.id}: an older AI drawing. Compare it with the PDF, or draw its box on the page.`, what: f.svg };
  return { reason: `Figure ${f.id} could not be found on page ${f.page}. Draw its box on the page.`, what: `none:${f.id}:${f.page}:${f.caption}` };
}

export type ScoreColour = "green" | "amber" | "red";
export type PaperScore = { items: number; clean: number; red: number; pct: number; colour: ScoreColour; estimated: boolean };

/**
 * Read accuracy (owner, 7 Nov 2026): parts with no flag of their own over all parts, from the first full reading.
 * Figure boxes (the cutter, not the AI) and whole-paper flags do not count against a part. Green at BRAIN.scoreGreen%
 * with no red flag; red under BRAIN.scoreAmber% or with any red (wording) flag; amber between. Pure.
 */
export function scoreColour(pct: number, red: number): ScoreColour {
  if (red > 0 || pct < BRAIN.scoreAmber) return "red";
  return pct >= BRAIN.scoreGreen ? "green" : "amber";
}

export function paperScore(items: number, flags: readonly Pick<Flag, "item" | "kind" | "colour">[], estimated = false): PaperScore | null {
  if (items <= 0) return null;
  const flagged = new Set(flags.filter((f) => f.kind !== "figure" && f.item !== "paper").map((f) => f.item));
  const clean = Math.max(0, items - flagged.size);
  const red = flags.filter((f) => f.colour === "red" && f.kind !== "figure").length;
  const pct = Math.floor((clean / items) * 100);
  return { items, clean, red, pct, colour: scoreColour(pct, red), estimated };
}

/** The stored first-read numbers as a score; null when not stored yet. */
export function storedScore(items: number | null, clean: number | null, red: number | null): PaperScore | null {
  if (items === null || clean === null || red === null || items <= 0) return null;
  const pct = Math.floor((clean / items) * 100);
  return { items, clean, red, pct, colour: scoreColour(pct, red), estimated: false };
}

export function openFlags(flags: readonly Flag[], dismissed: ReadonlySet<string>, rules: ReadonlySet<string>): Flag[] {
  return flags.filter((f) => !dismissed.has(f.fingerprint) && !rules.has(f.fingerprint));
}

/**
 * A new reading merged with what was there (owner: every run skips what is confirmed). `only` given: just those items
 * (and figures) are taken from the new reading. Otherwise items without open flags are kept as they were and the rest
 * come from the new reading, in the new reading's order; items only the old one had stay.
 */
export function mergeReading(old: PaperContent | null, fresh: PaperContent, open: ReadonlySet<string>, only?: { items: readonly string[]; figures: readonly string[] }): PaperContent {
  if (!old) return fresh;
  const oldItems = new Map(old.items.map((i) => [i.number, i]));
  // Reading a part again brings its lead-ins in too when the old reading had none (they were joined to the part).
  if (only) {
    const asked = only.items;
    const extra = fresh.items.filter((x) => !oldItems.has(x.number) && asked.some((n) => n.startsWith(`${x.number}(`))).map((x) => x.number);
    if (extra.length) only = { ...only, items: [...asked, ...extra] };
  }
  const keepOld = (n: string) => (only ? !only.items.includes(n) : !open.has(n));
  const items: PaperItem[] = [];
  const done = new Set<string>();
  for (const it of only ? old.items : fresh.items) {
    const o = oldItems.get(it.number);
    const f = fresh.items.find((x) => x.number === it.number);
    items.push(o && keepOld(it.number) ? o : f ?? it);
    done.add(it.number);
  }
  for (const it of only ? fresh.items.filter((x) => only!.items.includes(x.number)) : old.items) {
    if (done.has(it.number)) continue;
    // A new lead-in goes before its first part, not at the end.
    const before = items.findIndex((x) => x.number.startsWith(`${it.number}(`));
    if (before >= 0) items.splice(before, 0, it);
    else items.push(it);
    done.add(it.number);
  }
  const figIds = new Set([...old.figures.map((f) => f.id), ...fresh.figures.map((f) => f.id)]);
  const figures: PaperFigure[] = [];
  for (const id of figIds) {
    const o = old.figures.find((f) => f.id === id);
    const f = fresh.figures.find((x) => x.id === id);
    // A box drawn by hand is never replaced; a new reading's words come in, its box is cut again by the script.
    if (o && f && o.cut === "manual") {
      figures.push({ ...o, caption: f.caption || o.caption, description: f.description || o.description });
      continue;
    }
    const takeFresh = only ? only.figures.includes(id) || only.items.some((n) => fresh.items.find((x) => x.number === n)?.figures.includes(id)) : !o || (!o.box && !o.svg) || open.has(id);
    figures.push(takeFresh && f ? f : o ?? f!);
  }
  return { kind: fresh.kind, totalMarks: fresh.totalMarks ?? old.totalMarks, items, figures };
}

/**
 * After the admin changes one item (the PDF's version, or their own wording): its wording, number and marks flags are
 * worked out again from the pages around it only (quick enough for the Worker), and a Gemini difference is settled
 * when the new wording is in the PDF. Other items' flags stay as they were.
 */
export function recheckItem(c: PaperContent, flags: readonly Flag[], number: string, pages: readonly string[]): Flag[] {
  const it = c.items.find((x) => x.number === number);
  if (!it) return [...flags];
  const near = pages.slice(Math.max(0, it.page - 2), it.page + 1);
  const pageIdx = textIndex(near.length ? near : pages);
  const allText = pages.join(" ");
  const readable = squash(allText).length >= BRAIN.minPaperTextChars;
  const nums = pdfNumbers(pages);
  const wording = itemWording(it);
  const w = wording.normalize("NFKD").toLowerCase().match(/[a-z]{4,}/g) ?? [];
  const found = !readable || coverage(pageIdx, wording) >= BRAIN.minWordCover
    || (w.length >= 3 ? w.filter((x) => pageIdx.text.includes(x)).length / w.length >= BRAIN.minWordCover : isFormula(wording) && w.every((x) => pageIdx.text.includes(x)));
  // A lead-in flag is settled once the question has its own item (its key ends with that question's number).
  const settled = (f: Flag) => f.kind === "structure" && c.items.some((x) => x.number === f.key.split(":").at(-1));
  const kept = flags.filter((f) => !settled(f) && (f.item !== number || !(f.kind === "words" || f.kind === "numbers" || f.kind === "notation" || (f.kind === "marks" && !f.key.endsWith(":gemini")) || (f.kind === "agree" && found))));
  const add = (kind: FlagKind, reason: string, what: string, keyExtra = "", pdfText = "") =>
    kept.push({ key: `${kind}:${number}${keyExtra}`, item: number, kind, colour: COLOUR[kind], reason, pdfText, fingerprint: fingerprint(kind, squash(what), reason) });
  if (readable) {
    if (!found) add("words", "Your wording is not found in the PDF either.", wording);
    const nf = notationFlag(it, pages);
    if (nf) add("notation", nf.reason, nf.what, "", nf.pdfText);
    const missing = numbersIn(wording).find((x) => !nums.has(x));
    if (missing) add("numbers", `The number ${missing} is not printed in the PDF.`, `${missing}|${wording}`, `:${missing}`);
    if (c.kind === "qp" && it.marks !== null && it.marks > 0 && !allText.includes(`[${it.marks}]`) && !allText.includes(`[Total: ${it.marks}]`)) {
      add("marks", `[${it.marks}] is not printed in the PDF.`, `${it.marks}|${wording}`);
    }
  }
  return kept;
}

/** The admin's own wording for one item (checked against the PDF by the next recheck). */
export function editItem(c: PaperContent, number: string, text: string, marks: number | null): PaperContent {
  return { ...c, items: c.items.map((it) => (it.number === number ? { ...it, text: str(text, BRAIN.maxItemText), marks } : it)) };
}

/** Pages of a reading, in order, with their items: what the review screen lays out like the paper. */
export function itemsByPage(c: PaperContent): { page: number; items: PaperItem[] }[] {
  const m = new Map<number, PaperItem[]>();
  for (const it of c.items) m.set(it.page, [...(m.get(it.page) ?? []), it]);
  return [...m.entries()].sort((a, b) => a[0] - b[0]).map(([page, items]) => ({ page, items }));
}

// ---------- Pages sent to the AIs (owner, 7 Nov 2026: do not pay to read blank pages) ----------

/**
 * Pages printed "BLANK PAGE" with nothing to answer on them, 1-based: Cambridge prints the words (often kerned as
 * "BLANK P AGE") with only boilerplate around them (page number, paper code, copyright line, "DO NOT WRITE IN THIS
 * MARGIN", bar codes, and on the last page the copyright acknowledgements). A page with marks ("[2]"), a figure or
 * answer lines is never left out, and neither is the cover (it carries the total marks). Only the printed capitals
 * count (owner, 8 Nov 2026: a mark scheme's rules saying "blank page seen" had pages left out). Pure.
 */
export function blankPages(pages: readonly string[]): number[] {
  const out: number[] = [];
  pages.forEach((text, i) => {
    // Cambridge prints it in capitals; "blank page seen" or "Blank pages will be..." in a mark scheme's rules is text.
    if (i === 0 || !/B\s*L\s*A\s*N\s*K\s*P\s*A\s*G\s*E/.test(text)) return;
    if (/\[\s*\d+\s*\]/.test(text) || /\bFig\.\s*\d/i.test(text) || /\.{8,}/.test(text) || /\btable\s*\d+\.\d/i.test(text)) return;
    out.push(i + 1);
  });
  return out;
}

/** The pages to send, in order (original page numbers), leaving out `skip`. */
export const keptPages = (count: number, skip: readonly number[]) => Array.from({ length: count }, (_, i) => i + 1).filter((p) => !skip.includes(p));

/**
 * A reading of a slimmed PDF put back on the paper's own page numbers: page n of the slim PDF is `kept[n - 1]`. Pure.
 */
export function remapPages(c: PaperContent, kept: readonly number[]): PaperContent {
  if (!kept.length) return c;
  const map = (p: number) => kept[Math.min(Math.max(p, 1), kept.length) - 1] ?? p;
  return { ...c, items: c.items.map((i) => ({ ...i, page: map(i.page) })), figures: c.figures.map((f) => ({ ...f, page: map(f.page) })) };
}

/**
 * Puts every item and figure on its real page by the PDF's own text, whatever page number the AI gave (it may count
 * the pages it was sent, or use the numbers printed on them). An item goes to the page that best holds its question
 * line (its last line that is not an answer label like "momentum ="); a figure to the first page that prints its
 * label ("Fig. 2.1") where a question or figure is. Items code cannot place keep `fallback`'s page. Pure.
 */
export function placeOnPages(c: PaperContent, pages: readonly string[]): PaperContent {
  const idx = pages.map((p) => textIndex([p]));
  if (idx.reduce((a, x) => a + x.chars, 0) < BRAIN.minPaperTextChars) return c;
  const best = (wording: string) => {
    if (squash(wording).length < 12) return 0;
    let page = 0;
    let score = 0;
    idx.forEach((x, i) => {
      const s = coverage(x, wording);
      if (s > score) {
        score = s;
        page = i + 1;
      }
    });
    return score >= 0.8 ? page : 0;
  };
  const items = c.items.map((it) => {
    const lines = it.text.split("\n").map((l) => l.trim()).filter((l) => l && !/=\s*\.*\s*\S{0,6}$/.test(l) && squash(l).length >= 12);
    const page = best(lines.at(-1) ?? it.text) || best(it.text);
    return page ? { ...it, page } : it;
  });
  const figures = c.figures.map((f) => {
    if (f.cut === "manual" || f.cut === "page") return f;
    const label = /Fig\.?\s*(\d+\.\d+)/i.exec(f.caption)?.[1];
    // No printed label (Maths, Computer Science): the page of the first part that shows it, placed by its text.
    if (!label) {
      const first = items.find((it) => it.figures.includes(f.id));
      return first && first.page !== f.page ? { ...f, page: first.page, box: null, cut: "" as const } : f;
    }
    const re = new RegExp(`Fig\\.?\\s*${label.replace(".", "\\.")}(?!\\d)`, "i");
    const i = pages.findIndex((p) => re.test(p));
    return i >= 0 && i + 1 !== f.page ? { ...f, page: i + 1, box: null, cut: "" as const } : f;
  });
  return { ...c, items, figures };
}

// ---------- Text instead of pictures where a page has no figure (owner, 7 Nov 2026: dry-run optimisation) ----------

/** What the PDF reader saw on a page besides its text (`allPagesInfo`): path segments drawn (drawings, tables). */
export type PageDrawn = { paths: number; images?: number };

const CODE_LINE = /^(?:\d{2}\s+\S|(?:OUTPUT|INPUT|IF|THEN|ELSE|ENDIF|WHILE|ENDWHILE|REPEAT|UNTIL|FOR|NEXT|DECLARE|CONSTANT|PROCEDURE|ENDPROCEDURE|FUNCTION|ENDFUNCTION|RETURN|CASE|OTHERWISE|ENDCASE|CALL|OPENFILE|READFILE|WRITEFILE|CLOSEFILE)\b)/;

/**
 * Pages whose text cannot stand in for a picture of them, 1-based (owner, 7 Nov 2026; tuned on real Physics, Maths and
 * Computer Science papers):
 * - a printed figure label ("Fig. 2.1");
 * - drawings or tables: clearly more path segments than the page furniture (the plainest inner page);
 * - formulas: the text layer scatters fractions, powers and symbols into short fragments ("3 Gm n", "5", "2=") and
 *   even maps "×" to "#", so three or more fragment lines mean the page is read as a picture;
 * - program code: indentation and arrows ("←") are lost, so numbered lines or pseudocode keywords do the same;
 * - almost no text and no [marks] (probably a picture page).
 * Blank pages and the cover are never pictures. Pure.
 */
export function picturePages(pages: readonly string[], blank: readonly number[], drawn: readonly PageDrawn[] = [], notated?: readonly string[]): number[] {
  // Page furniture (corner marks, bar codes) is the same on every page: the plainest inner page shows how much it is.
  const inner = drawn.slice(1).map((d) => d.paths);
  const furniture = inner.length ? Math.min(...inner) : 0;
  return pages.flatMap((text, i) => {
    const p = i + 1;
    if (p === 1 || blank.includes(p)) return [];
    const lines = aiPageText(text).split("\n").map((l) => l.trim()).filter(Boolean);
    const code = lines.filter((l) => CODE_LINE.test(l)).length;
    const paths = drawn[i]?.paths ?? 0;
    if (/\bFig\.?\s*\d+\.\d+/i.test(text)) return [p];
    if (drawn.length && paths > furniture + 8) return [p];
    if ((drawn[i]?.images ?? 0) > Math.min(...drawn.slice(1).map((d) => d.images ?? 0))) return [p];
    if (code >= 4) return [p];
    // Formulas: the scattered pieces our reader leaves. With the page rebuilt from where its words sit (fractions as
    // \frac, powers as ^{}), a page whose pieces are all put back goes as text (owner, 9 Nov 2026).
    if (scattered(text) && !rebuiltClean(notated?.[i])) return [p];
    return squash(aiPageText(text)).length < 80 && !/\[\s*\d+\s*\]/.test(text) ? [p] : [];
  });
}

/** A page whose formulas came out of the text layer in pieces: short fragment lines or scrambled ones. */
function scattered(text: string): boolean {
  const all = text.split("\n").slice(1).map((l) => l.trim()).filter(Boolean);
  // Formula fragments: short lines that are not a mark, a part label like "(a)" or a row of dots...
  const fragments = all.filter((l) => l.length <= 4 && !/^\[\s*\d+\s*\]$/.test(l) && !/^\([a-z]{1,4}\)$/.test(l) && !/^\.+$/.test(l)).length;
  // ...and the scrambled pieces a formula leaves: empty brackets "()", letters run into numbers "xx72", "yx xx31".
  const garbled = all.filter((l) => /\(\s*\)/.test(l) || /\b[a-z]{1,3}\d{2,}\b/.test(l) || /\b[a-z]{2}\s[a-z]{2}\d/.test(l)).length;
  return fragments >= 2 || garbled >= 1;
}

/**
 * A page rebuilt from where its words sit that can stand in for its picture: its fractions were found (\frac), and
 * nothing is left in pieces: no fragment lines (page number aside), no scrambled runs, no stray letter against a
 * fraction (a tall bracket the text layer reads as "f" or "p"). Pure.
 */
function rebuiltClean(text: string | undefined): boolean {
  if (!text || !text.includes("\\frac{")) return false;
  const body = text.split("\n").slice(1).join("\n");
  return !scattered(`x\n${body}`) && !/[A-Za-z]\\frac\{|\}[A-Za-z]\^\{[−+-]\}|\}[a-z](?![a-z])/.test(body);
}

/** A page's text as Claude gets it: the margin warnings, bar codes and footers that Cambridge prints on every page left out. */
export function aiPageText(text: string): string {
  return text
    .split("\n")
    .map((l) => l.replace(/(DO NOT WRITE IN THIS MARGIN\s*)+/g, "").trim())
    // Answer lines are rows of dots: one short marker each is enough (a page of them was 4,000 characters).
    .map((l) => l.replace(/\.{6,}/g, "[line]"))
    .filter((l) => l && !/^\*\s*\d{6,}\s*\*$/.test(l) && !/^[A-Z]{2,4}$/.test(l) && !/^\d{1,2}$/.test(l) && !/^\d{4}\/\d{2}\/[A-Z/]+\/\d{2}\s*©\s*UCLES\s*\d{4}/.test(l))
    .join("\n");
}

/** The text pages laid out for Claude, each under a marker with the paper's own page number. */
export function textPagesBlock(pages: readonly string[], textPages: readonly number[]): string {
  return textPages.map((p) => `=== Page ${p} ===\n${aiPageText(pages[p - 1] ?? "")}`).join("\n\n");
}
