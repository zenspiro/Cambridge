// Notation and the paper's own structure, read from where each word sits on the page (owner, 9 Nov 2026: "it's the
// AI's job to put things exactly as they are"). The PDF's text layer flattens superscripts and subscripts (the nuclide
// ²⁰⁸₈₁Tl comes out as "208 81Tl", H₂O as "H2O", 10⁻¹⁰ as "10–10"), so neither the AI reading the text nor our checks
// could see them. Poppler (`pdftotext -bbox-layout`) gives every word's box: a word clearly smaller than the word it
// touches, raised or lowered against it, is a superscript or subscript. Code writes it in one markup, ^{...} and _{...}
// ("^{208}_{81}Tl", "H_{2}O", "10^{−10}", "cm^{3}"), patches the page text with it before anything reaches the AI, and
// the checks then flag a reading that has it flat. The same boxes give the paper's own outline: question numbers in
// the margin, part labels (a), (i) at the start of a line, and the text between them, so a question's lead-in (the text
// before its first part) is known and a reading that merges it into the first part is flagged.
// Pure, strip-only TypeScript: shared by the brain script (GitHub Actions) and the Worker. No Next imports.

export type WBox = [number, number, number, number];
/** One word as Poppler places it: its box (PDF points, y down), its text, whether it starts a line. */
export type Word = { b: WBox; t: string; first: boolean; /** A fraction's bar height: the line it sits on. */ axis?: number };

const num = (s: string) => {
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
};
const unxml = (s: string) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, "\"").replace(/&apos;/g, "'").replace(/&#39;/g, "'").replace(/&amp;/g, "&");

/** `pdftotext -bbox-layout` output (one or more pages) as each page's words in reading order. */
export function bboxWords(xml: string): Word[][] {
  const pages: Word[][] = [];
  for (const pg of xml.matchAll(/<page [^>]*>([\s\S]*?)<\/page>/g)) {
    const words: Word[] = [];
    for (const ln of pg[1]!.matchAll(/<line [^>]*>([\s\S]*?)<\/line>/g)) {
      let first = true;
      for (const w of ln[1]!.matchAll(/<word xMin="([\d.-]+)" yMin="([\d.-]+)" xMax="([\d.-]+)" yMax="([\d.-]+)">([^<]*)<\/word>/g)) {
        const t = unxml(w[5]!).trim();
        if (!t || words.length >= 20_000) continue;
        const b: WBox = [num(w[1]!), num(w[2]!), num(w[3]!), num(w[4]!)];
        // Some papers set a label and its text with a tab ("1\tName", "(a)\tconvert"): Poppler gives one word, split it
        // with each part's share of the width.
        const parts = t.split(/\s+/);
        let x = b[0];
        const per = (b[2] - b[0]) / Math.max(1, parts.join(" ").length);
        for (const part of parts) {
          const w2 = part.length * per;
          words.push({ b: [x, b[1], parts.length > 1 ? x + w2 : b[2], b[3]], t: part, first });
          x += w2 + per * 3;
          first = false;
        }
      }
    }
    pages.push(words);
  }
  return pages;
}

// ---------- Superscripts and subscripts ----------

/** One superscript or subscript found on a page: its words as the text layer gives them, and the marked form. */
export type Notation = { pieces: string[]; marked: string; prefix?: boolean };

const h = (w: Word) => w.b[3] - w.b[1];
const mid = (w: Word) => (w.b[1] + w.b[3]) / 2;
const MINUS = /[–\-−]/g;
/** How close (points) a superscript sits to the letter it belongs to. */
const TOUCH = 1.6;

/**
 * Which words are superscripts or subscripts: smaller than a word they touch (under 82% of its height), overlapping it
 * in height and raised or lowered against it by more than an eighth of its height. Each belongs to the word it touches,
 * found by position (not reading order, which tables and equations scramble): the one before ("s" in m/s², "H" in
 * H₂O, ")" in (NO₃)₂) or, when that is an opening bracket or nothing, the one after (Tl in ²⁰⁸₈₁Tl, the mass and atomic
 * numbers stacked before it). Pure.
 */
export function notate(words: readonly Word[]): { words: Word[]; tokens: Notation[] } {
  type Piece = { at: number; kind: "sup" | "sub"; side: "pre" | "post"; w: Word };
  const pieces = new Map<number, Piece[]>();
  const taken = new Set<number>();
  const kindOf = (x: Word, base: Word): "sup" | "sub" | null => {
    if (h(x) >= h(base) * 0.82 || !(x.b[1] < base.b[3] && x.b[3] > base.b[1])) return null;
    const d = mid(x) - mid(base);
    return d < -h(base) / 8 ? "sup" : d > h(base) / 8 ? "sub" : null;
  };
  words.forEach((x, i) => {
    // A superscript is short: digits, signs, a letter or two ("max", "™"); a smaller-font label is not one.
    const frac = x.t.startsWith("\\frac{");
    if (h(x) <= 0 || (!frac && (x.t.length > 8 || (x.t.match(/[A-Za-z]/g) ?? []).length > 3))) return;
    let best: { j: number; gap: number; kind: "sup" | "sub"; side: "pre" | "post" } | null = null;
    words.forEach((base, j) => {
      // A fraction is never the base of a superscript (its box is two lines tall, so its neighbours look lowered).
      if (j === i || /^\.+$/.test(base.t) || base.t.startsWith("\\frac{")) return;
      const post = x.b[0] - base.b[2];
      const pre = base.b[0] - x.b[2];
      const side = post <= TOUCH && post >= -TOUCH * 2 && /[A-Za-z0-9)\]]$/.test(base.t) ? "post"
        : pre <= TOUCH && pre >= -TOUCH * 2 && /^[A-Za-z]/.test(base.t) ? "pre" : null;
      if (!side) return;
      const kind = kindOf(x, base);
      if (!kind) return;
      const gap = Math.abs(side === "post" ? post : pre) + (side === "pre" ? 0.5 : 0);
      if (!best || gap < best.gap) best = { j, gap, kind, side };
    });
    if (!best) return;
    const b = best as { j: number; gap: number; kind: "sup" | "sub"; side: "pre" | "post" };
    taken.add(i);
    pieces.set(b.j, [...(pieces.get(b.j) ?? []), { at: i, kind: b.kind, side: b.side, w: x }]);
  });
  // Digits set one by one ("9" "0" over "3" "8" before Sr): a small word touching a piece, on the same level, joins it.
  for (let added = true; added;) {
    added = false;
    words.forEach((x, i) => {
      if (taken.has(i) || pieces.has(i) || h(x) <= 0 || x.t.length > 8) return;
      for (const [j, ps] of pieces) {
        const base = words[j]!;
        const p = ps.find((q) => (Math.abs(x.b[2] - q.w.b[0]) <= TOUCH || Math.abs(q.w.b[2] - x.b[0]) <= TOUCH) && Math.abs(mid(x) - mid(q.w)) <= h(q.w) / 4);
        if (!p || kindOf(x, base) !== p.kind) continue;
        taken.add(i);
        ps.push({ at: i, kind: p.kind, side: p.side, w: x });
        added = true;
        return;
      }
    });
  }
  // A word taken as a superscript cannot carry its own (that would be a chain): its pieces go back to plain words.
  for (const i of taken) {
    const own = pieces.get(i);
    if (own) {
      pieces.delete(i);
      for (const p of own) taken.delete(p.at);
    }
  }
  const out: Word[] = [];
  const tokens: Notation[] = [];
  words.forEach((w, i) => {
    if (taken.has(i)) return;
    const ps = pieces.get(i);
    if (!ps) return void out.push(w);
    const byX = (a: Piece, b: Piece) => a.w.b[0] - b.w.b[0] || a.w.b[1] - b.w.b[1];
    const pre = ps.filter((p) => p.side === "pre").sort(byX);
    const post = ps.filter((p) => p.side === "post").sort(byX);
    const preMarks = joinMarks([...pre].sort((a, b) => (a.kind === b.kind ? byX(a, b) : a.kind === "sup" ? -1 : 1)).map((p) => ({ kind: p.kind, t: p.w.t })));
    const postMarks = joinMarks(post.map((p) => ({ kind: p.kind, t: p.w.t })));
    const all = [w, ...ps.map((p) => p.w)];
    const box: WBox = [Math.min(...all.map((x) => x.b[0])), Math.min(...all.map((x) => x.b[1])), Math.max(...all.map((x) => x.b[2])), Math.max(...all.map((x) => x.b[3]))];
    out.push({ b: box, t: preMarks + w.t + postMarks, first: w.first || pre.some((p) => p.w.first) });
    if (pre.length) {
      const baseText = /^[A-Za-z0-9]+/.exec(w.t)?.[0] ?? w.t;
      tokens.push({ pieces: [...segments(preMarks), baseText], marked: preMarks + baseText, prefix: true });
    }
    if (post.length) {
      const baseText = /[A-Za-z0-9]+$/.exec(w.t)?.[0] ?? w.t.slice(-1);
      tokens.push({ pieces: [baseText, ...segments(postMarks)], marked: baseText + postMarks });
    }
  });
  return { words: out, tokens };
}

/** The texts of a markup run in order ("^{90}_{38}" is "90", "38"), as the flat text has them. */
const segments = (marks: string) => [...marks.matchAll(/[\^_]\{([^{}]*)\}/g)].map((m) => m[1]!);

/** Pieces in order as markup; neighbours of the same kind join ("–" "10" is ^{−10}); minus signs are U+2212. */
function joinMarks(parts: readonly { kind: "sup" | "sub"; t: string }[]): string {
  const merged: { kind: "sup" | "sub"; t: string }[] = [];
  for (const p of parts) {
    const last = merged.at(-1);
    if (last && last.kind === p.kind) last.t += p.t;
    else merged.push({ ...p });
  }
  return merged.map((p) => `${p.kind === "sup" ? "^" : "_"}{${p.t.replace(MINUS, "−")}}`).join("");
}

const escRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/**
 * The flat form of a notation as a pattern: its pieces with any spacing, any dash for a minus, the base not inside a
 * longer word, a number not running on. A nuclide's pieces may come in any order around its symbol ("37Cl17").
 */
function flatPattern(pieces: readonly string[], prefix = false): RegExp {
  const one = (ps: readonly string[]) => {
    const body = ps.map((p) => escRe(p.replace(MINUS, "−")).replace(/−/g, "[–\\-−]")).join("\\s*");
    const lead = /^[A-Za-z0-9]/.test(ps[0] ?? "") ? "(?<![A-Za-z0-9^_{])" : "";
    const last = ps.at(-1) ?? "";
    const tail = /\d$/.test(last) ? "(?![\\d.]\\d|\\d)" : /[a-z]$/.test(last) ? "(?![a-z])" : "";
    return lead + body + tail;
  };
  if (!prefix || pieces.length < 2) return new RegExp(one(pieces), "g");
  const base = pieces.at(-1)!;
  const marks = pieces.slice(0, -1);
  const orders = [marks, [...marks].reverse()].flatMap((m) => [[...m, base], [m[0]!, base, ...m.slice(1)], [base, ...m]]);
  return new RegExp([...new Set(orders.map((o) => one(o)))].map((x) => `(?:${x})`).join("|"), "g");
}

/**
 * A page's text (from our own reader) with the notation Poppler found written in: each token's flat form is replaced
 * where it is printed, in reading order. A token code cannot place is left out (the text stays as it was). Pure.
 */
export function applyNotation(text: string, tokens: readonly Notation[]): string {
  let s = text;
  let at = 0;
  for (const t of tokens) {
    const re = flatPattern(t.pieces, t.prefix);
    re.lastIndex = at;
    let m = re.exec(s);
    if (!m) {
      re.lastIndex = 0;
      m = re.exec(s);
    }
    if (!m) continue;
    s = s.slice(0, m.index) + t.marked + s.slice(m.index + m[0].length);
    at = m.index + t.marked.length;
  }
  return s;
}

/**
 * A page's words as lines of text, in Poppler's reading order: a word that starts a line starts a new one, and words
 * that touch (an italic "k" and "m" in km, a formula's pieces) join without a space. Pure.
 */
export function wordsText(words: readonly Word[], lines = true): string {
  const out: string[] = [];
  let line = "";
  let prev: Word | null = null;
  for (const w of words) {
    if (!prev || (lines && w.first)) {
      if (line) out.push(line);
      line = w.t;
    } else {
      const gap = w.b[0] - prev.b[2];
      // A whole number right before a fraction is a mixed number (43⅓): written together.
      const mixed = /\d$/.test(prev.t) && w.t.startsWith("\\frac{") && gap < 4;
      line += (gap < 1 && gap > -2) || mixed ? w.t : ` ${w.t}`;
    }
    prev = w;
  }
  if (line) out.push(line);
  return out.join("\n");
}

/**
 * Fractions put back on the line they sit on: Poppler gives a fraction's numerator and denominator their own lines, so
 * the merged fraction starts a line of its own ("¼" above "C = xy²"). Lines whose words are centred on a fraction's bar
 * join its line, in order across the page ("C = ¼xy²", "4/(x − 1) − 3/(2x + 5)"). Pure.
 */
export function joinFractionLines(words: readonly Word[]): Word[] {
  if (!words.some((w) => w.axis !== undefined)) return [...words];
  const lines: Word[][] = [];
  for (const w of words) {
    if (w.first || !lines.length) lines.push([w]);
    else lines.at(-1)!.push(w);
  }
  const axisOf = (l: readonly Word[]) => l.find((w) => w.axis !== undefined)?.axis;
  const midOf = (l: readonly Word[]) => {
    const ms = l.filter((w) => w.axis === undefined).map(mid).sort((a, b) => a - b);
    return ms.length ? ms[Math.floor(ms.length / 2)]! : axisOf(l)!;
  };
  const near = (a: readonly Word[], b: readonly Word[]) => {
    const top = Math.max(Math.min(...a.map((w) => w.b[1])), Math.min(...b.map((w) => w.b[1])));
    const bottom = Math.min(Math.max(...a.map((w) => w.b[3])), Math.max(...b.map((w) => w.b[3])));
    return bottom > top;
  };
  const out: Word[][] = [];
  const used = new Set<number>();
  lines.forEach((l, i) => {
    if (used.has(i)) return;
    let group = [...l];
    for (let changed = true; changed;) {
      changed = false;
      const ax = axisOf(group);
      lines.forEach((m, j) => {
        if (j === i || used.has(j) || !near(group, m)) return;
        const mx = axisOf(m);
        const fits = ax !== undefined ? Math.abs(midOf(m) - ax) <= 6 || (mx !== undefined && Math.abs(mx - ax) <= 3)
          : mx !== undefined && Math.abs(midOf(group) - mx) <= 6;
        if (!fits) return;
        group = [...group, ...m];
        used.add(j);
        changed = true;
      });
    }
    used.add(i);
    out.push(group.sort((a, b) => a.b[0] - b.b[0]).map((w, k) => ({ ...w, first: k === 0 })));
  });
  return out.flat();
}

/**
 * Every page's text with its notation. From Poppler's words when it read every page (it also reads the maths fonts
 * our own reader cannot: "y = x^{2} + 7x − 18"), else our reader's pages patched with what Poppler placed. Pure.
 */
export function notatedPages(pages: readonly string[], xml: string, bars: readonly (readonly Bar[])[] = []): { pages: string[]; found: number; fractions: number; words: Word[][]; from: "poppler" | "patched" } {
  const boxes = bboxWords(xml);
  let found = 0;
  let fracs = 0;
  const words: Word[][] = [];
  const tokens: Notation[][] = [];
  for (const [i, raw] of boxes.entries()) {
    // Fractions first: a mixed number's small stacked digits (1¾) are a fraction, not a superscript and subscript.
    const f = fractions(raw, bars[i] ?? []);
    fracs += f.count;
    const n = notate(f.words);
    n.words = joinFractionLines(n.words);
    words.push(n.words);
    tokens.push(n.tokens);
    found += n.tokens.length;
  }
  const chars = (ps: readonly string[]) => ps.join("").replace(/\s/g, "").length;
  const fromWords = words.map((w) => wordsText(w));
  if (boxes.length === pages.length && chars(fromWords) >= chars(pages) * 0.8) return { pages: fromWords, found, fractions: fracs, words, from: "poppler" };
  return { pages: pages.map((p, i) => applyNotation(p, tokens[i] ?? [])), found, fractions: fracs, words, from: "patched" };
}

const SUP: Record<string, string> = { "0": "⁰", "1": "¹", "2": "²", "3": "³", "4": "⁴", "5": "⁵", "6": "⁶", "7": "⁷", "8": "⁸", "9": "⁹", "+": "⁺", "−": "⁻", "=": "⁼", "(": "⁽", ")": "⁾", n: "ⁿ", i: "ⁱ" };
const SUB: Record<string, string> = { "0": "₀", "1": "₁", "2": "₂", "3": "₃", "4": "₄", "5": "₅", "6": "₆", "7": "₇", "8": "₈", "9": "₉", "+": "₊", "−": "₋", "=": "₌", "(": "₍", ")": "₎" };
const FROM_SUP = Object.fromEntries(Object.entries(SUP).map(([k, v]) => [v, k]));
const FROM_SUB = Object.fromEntries(Object.entries(SUB).map(([k, v]) => [v, k]));

/**
 * An AI's notation in our one markup: Unicode superscripts and subscripts (²⁰⁸, ₈₁, ⁻²) become ^{...} and _{...},
 * "x^2" and "10^-3" get their braces, and a minus inside the braces is U+2212. Program code is left alone (its "_"
 * is part of a name). Pure.
 */
export function normaliseNotation(s: string): string {
  if (!s) return s;
  let out = s.replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹⁺⁻⁼⁽⁾ⁿⁱ]+/g, (m) => `^{${[...m].map((c) => FROM_SUP[c] ?? c).join("")}}`);
  out = out.replace(/[₀₁₂₃₄₅₆₇₈₉₊₋₌₍₎]+/g, (m) => `_{${[...m].map((c) => FROM_SUB[c] ?? c).join("")}}`);
  out = out.replace(/\^([–\-−]?\d+(?:\.\d+)?|[a-z])(?![\w{])/g, "^{$1}");
  out = out.replace(/([\^_])\{([^{}]{0,40})\}/g, (_m, k: string, t: string) => `${k}{${t.replace(MINUS, "−")}}`);
  // Fractions in one markup too: ¾ is \frac{3}{4}.
  out = out.replace(/[¼½¾⅐⅑⅒⅓⅔⅕⅖⅗⅘⅙⅚⅛⅜⅝⅞]/g, (c) => VULGAR[c] ?? c);
  return out;
}

const VULGAR: Record<string, string> = Object.fromEntries(
  ([["¼", 1, 4], ["½", 1, 2], ["¾", 3, 4], ["⅐", 1, 7], ["⅑", 1, 9], ["⅒", 1, 10], ["⅓", 1, 3], ["⅔", 2, 3], ["⅕", 1, 5], ["⅖", 2, 5], ["⅗", 3, 5], ["⅘", 4, 5], ["⅙", 1, 6], ["⅚", 5, 6], ["⅛", 1, 8], ["⅜", 3, 8], ["⅝", 5, 8], ["⅞", 7, 8]] as const)
    .map(([c, a, b]) => [c, `\\frac{${a}}{${b}}`]),
);

/** The group in braces starting at `open` (the "{"), with braces inside it balanced; null when it never closes. */
function group(s: string, open: number): { text: string; end: number } | null {
  if (s[open] !== "{") return null;
  let depth = 0;
  for (let i = open; i < s.length && i < open + 2_000; i++) {
    if (s[i] === "{") depth++;
    else if (s[i] === "}" && --depth === 0) return { text: s.slice(open + 1, i), end: i + 1 };
  }
  return null;
}

/** Every \frac{...}{...} in a text, outermost first, with its numerator and denominator. Pure. */
export function fractionsIn(s: string): { marked: string; num: string; den: string; at: number }[] {
  const out: { marked: string; num: string; den: string; at: number }[] = [];
  let i = s.indexOf("\\frac{");
  while (i >= 0 && out.length < 200) {
    const n = group(s, i + 5);
    const d = n ? group(s, n.end) : null;
    if (n && d) {
      out.push({ marked: s.slice(i, d.end), num: n.text, den: d.text, at: i });
      i = s.indexOf("\\frac{", d.end);
    } else i = s.indexOf("\\frac{", i + 6);
  }
  return out;
}

/** A fraction written on one line: a/b, with brackets round a part that is more than one term. */
const atom = (x: string) => /^(?:\d+(?:\.\d+)?|[A-Za-z])(?:[\^_]\{[^{}]*\})*$/.test(x.replace(/\s+/g, ""));
export const linearFraction = (num: string, den: string) => `${atom(num) ? num : `(${num})`}/${atom(den) ? den : `(${den})`}`;

/** Notation written for plain text (a flag's reason, a toast): Unicode where it has the characters, else as marked. */
export function notationPlain(s: string): string {
  let out = s;
  // Fractions inside out: the innermost has no "\frac" in its parts.
  for (let k = 0; k < 20 && out.includes("\\frac{"); k++) {
    const inner = fractionsIn(out).flatMap(function flat(f): { marked: string; num: string; den: string; at: number }[] {
      const deeper = [...fractionsIn(f.num), ...fractionsIn(f.den)];
      return deeper.length ? deeper.flatMap(flat) : [f];
    });
    if (!inner.length) break;
    out = out.replace(inner[0]!.marked, linearFraction(inner[0]!.num, inner[0]!.den));
  }
  return out.replace(/([\^_])\{([^{}]{0,40})\}/g, (m, k: string, t: string) => {
    const map = k === "^" ? SUP : SUB;
    return [...t].every((c) => map[c]) ? [...t].map((c) => map[c]).join("") : m;
  });
}

/** Text in pieces for the review screen: plain runs, superscripts and subscripts (shown as <sup> and <sub>). Pure. */
export function notationParts(s: string): { kind: "text" | "sup" | "sub"; text: string }[] {
  const out: { kind: "text" | "sup" | "sub"; text: string }[] = [];
  let last = 0;
  for (const m of s.matchAll(/([\^_])\{([^{}]{0,40})\}/g)) {
    if (m.index! > last) out.push({ kind: "text", text: s.slice(last, m.index) });
    out.push({ kind: m[1] === "^" ? "sup" : "sub", text: m[2]! });
    last = m.index! + m[0].length;
  }
  if (last < s.length) out.push({ kind: "text", text: s.slice(last) });
  return out;
}

export type NotationNode =
  | { kind: "text"; text: string }
  | { kind: "sup" | "sub"; children: NotationNode[] }
  | { kind: "frac"; num: NotationNode[]; den: NotationNode[] };

/** Text with our markup as a tree for the review screen: superscripts, subscripts and fractions, nested. Pure. */
export function notationTree(s: string, depth = 0): NotationNode[] {
  const out: NotationNode[] = [];
  let text = "";
  const flush = () => {
    if (text) out.push({ kind: "text", text });
    text = "";
  };
  for (let i = 0; i < s.length;) {
    if (depth < 6 && s.startsWith("\\frac{", i)) {
      const n = group(s, i + 5);
      const d = n ? group(s, n.end) : null;
      if (n && d) {
        flush();
        out.push({ kind: "frac", num: notationTree(n.text, depth + 1), den: notationTree(d.text, depth + 1) });
        i = d.end;
        continue;
      }
    }
    if (depth < 6 && (s[i] === "^" || s[i] === "_") && s[i + 1] === "{") {
      const g = group(s, i + 1);
      if (g) {
        flush();
        out.push({ kind: s[i] === "^" ? "sup" : "sub", children: notationTree(g.text, depth + 1) });
        i = g.end;
        continue;
      }
    }
    text += s[i];
    i++;
  }
  flush();
  return out;
}

/** The notation printed on a marked page: each one's marked form and its pieces (for the flat pattern). Pure. */
export function notationOn(page: string): Notation[] {
  const seen = new Set<string>();
  const out: Notation[] = [];
  for (const m of page.matchAll(/((?:[\^_]\{[^{}]{1,40}\})+)([A-Za-z]{1,3})(?![A-Za-z0-9])|([A-Za-z0-9)\]]{1,12})((?:[\^_]\{[^{}]{1,40}\})+)/g)) {
    const marked = m[0];
    if (seen.has(marked)) continue;
    seen.add(marked);
    const marks = [...(m[1] ?? m[4]!).matchAll(/[\^_]\{([^{}]+)\}/g)].map((x) => x[1]!);
    const pieces = m[1] ? [...marks, m[2]!] : [m[3]!, ...marks];
    // A nuclide's numbers are printed top then bottom; flat text has them in that order too.
    out.push({ pieces, marked, prefix: !!m[1] });
  }
  return out;
}

const bare = (s: string) => s.replace(/\s+/g, "").replace(MINUS, "−");

/**
 * Notation printed on the item's pages that the reading has flat: the marked form is not in the wording, but its flat
 * form is ("208 81 Tl" where the paper prints ²⁰⁸₈₁Tl). Returns the first one with the wording repaired, else null.
 */
export function lostNotation(wording: string, pages: readonly string[]): { marked: string; flat: string; repaired: string } | null {
  const w = normaliseNotation(wording);
  const have = bare(w);
  let first: { marked: string; flat: string } | null = null;
  let repaired = w;
  for (const p of pages) {
    for (const t of notationOn(p)) {
      if (have.includes(bare(t.marked))) continue;
      const m = flatPattern(t.pieces, t.prefix).exec(repaired);
      if (!m) continue;
      first ??= { marked: t.marked, flat: m[0] };
      repaired = repaired.replace(flatPattern(t.pieces, t.prefix), t.marked);
    }
    // Fractions: the markup, or a/b with brackets where they are needed, are both exact; the parts run together
    // without them ("4/x − 1" for 4 over x − 1) change the meaning.
    for (const f of fractionsIn(p)) {
      if (have.includes(bare(f.marked)) || bare(repaired).includes(bare(linearFraction(f.num, f.den)))) continue;
      const chars = (x: string) => [...bare(x)].map((c) => (c === "−" ? "[–\\-−]" : escRe(c))).join("\\s*");
      if (/\\frac/.test(f.num + f.den) || !bare(f.num) || !bare(f.den)) continue;
      const re = new RegExp(`(?<![A-Za-z0-9.{])${chars(f.num)}\\s*/?\\s*${chars(f.den)}(?![0-9.])`);
      const m = re.exec(repaired);
      if (!m) continue;
      first ??= { marked: f.marked, flat: m[0] };
      repaired = repaired.replace(re, f.marked);
    }
  }
  return first ? { ...first, repaired } : null;
}

// ---------- Fractions (owner, 9 Nov 2026: "can we do something about fractions") ----------

/** A fraction bar: a short thin filled strip on the page (table rules and underlines are stroked lines). */
export type Bar = WBox;

/** The fraction bars on a page from Poppler's SVG of it (`pdftocairo -svg`): filled, under 1.2 pt thick, 3 to 220 pt long. */
export function fractionBars(svg: string): Bar[] {
  const out: Bar[] = [];
  const at = svg.indexOf("</defs>");
  for (const m of (at >= 0 ? svg.slice(at) : svg).matchAll(/<path ([^>]*?)\/>/g)) {
    const a = Object.fromEntries([...m[1]!.matchAll(/([a-zA-Z:-]+)="([^"]*)"/g)].map((x) => [x[1]!, x[2]!]));
    if (!a.d || (a.stroke && a.stroke !== "none") || a.fill === "none" || /rgb\(100%, ?100%, ?100%\)|#fff/i.test(a.fill ?? "")) continue;
    const nums = a.d.match(/-?\d*\.?\d+(?:e-?\d+)?/g)?.map(Number) ?? [];
    if (nums.length < 6 || nums.length > 12 || /[CQcq]/.test(a.d)) continue;
    const t = a.transform?.match(/^matrix\(([^)]*)\)$/)?.[1]?.split(/[\s,]+/).map(Number);
    const mm = t && t.length === 6 ? t : [1, 0, 0, 1, 0, 0];
    const xs: number[] = [], ys: number[] = [];
    for (let i = 0; i + 1 < nums.length; i += 2) {
      xs.push(mm[0]! * nums[i]! + mm[2]! * nums[i + 1]! + mm[4]!);
      ys.push(mm[1]! * nums[i]! + mm[3]! * nums[i + 1]! + mm[5]!);
    }
    const b: Bar = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
    const w = b[2] - b[0], th = b[3] - b[1];
    if (th > 0.05 && th <= 1.2 && w >= 3 && w <= 220 && b[1] > 50 && b[3] < 800) out.push(b);
    if (out.length >= 400) break;
  }
  return out;
}

/**
 * Words stacked over a fraction bar become one word, \frac{numerator}{denominator}: the words just above the bar and
 * just below it, inside its length, both there, and together as wide as half the bar (a table rule over a row of
 * cells is stroked, and its cells are not tight to it). Shortest bars first, so a fraction inside a fraction is read
 * first. Each part keeps its superscripts and subscripts. Pure.
 */
export function fractions(words: readonly Word[], bars: readonly Bar[]): { words: Word[]; count: number } {
  let list = words.map((w, i) => ({ ...w, at: i }));
  let count = 0;
  for (const bar of [...bars].sort((a, b) => a[2] - a[0] - (b[2] - b[0]))) {
    const y = (bar[1] + bar[3]) / 2;
    const inside = (w: Word) => (w.b[0] + w.b[2]) / 2 >= bar[0] - 1 && (w.b[0] + w.b[2]) / 2 <= bar[2] + 1 && w.b[0] >= bar[0] - 4 && w.b[2] <= bar[2] + 4;
    const above = list.filter((w) => inside(w) && mid(w) < y && w.b[3] >= y - 4.5 && w.b[3] <= y + 4);
    const below = list.filter((w) => inside(w) && mid(w) > y && w.b[1] <= y + 4.5 && w.b[1] >= y - 4);
    if (!above.length || !below.length) continue;
    // A part's own superscripts and subscripts sit higher or lower than the rest (y⁸ over 16x¹⁶): words touching it go
    // with it.
    const grow = (part: typeof above, side: "above" | "below") => {
      for (let added = true; added;) {
        added = false;
        for (const w of list) {
          if (part.includes(w) || above.includes(w) || below.includes(w) || !inside(w)) continue;
          if ((side === "above" ? mid(w) >= y : mid(w) <= y)) continue;
          if (part.some((p) => w.b[1] < p.b[3] && w.b[3] > p.b[1] && (Math.abs(w.b[0] - p.b[2]) <= TOUCH || Math.abs(p.b[0] - w.b[2]) <= TOUCH))) {
            part.push(w);
            added = true;
          }
        }
      }
    };
    grow(above, "above");
    grow(below, "below");
    // An underlined word ("and" underlined in a mark scheme) has running text either side of it at the same height;
    // a fraction's top and bottom stand alone.
    const inLine = (part: typeof above) => list.some((w) => !part.includes(w) && !inside(w) && Math.abs(mid(w) - mid(part[0]!)) < 2
      && (Math.abs(w.b[0] - Math.max(...part.map((p) => p.b[2]))) < 6 || Math.abs(Math.min(...part.map((p) => p.b[0])) - w.b[2]) < 6));
    if (inLine(above) || inLine(below)) continue;
    const all = [...above, ...below];
    const span = Math.max(...all.map((w) => w.b[2])) - Math.min(...all.map((w) => w.b[0]));
    if (span < (bar[2] - bar[0]) * 0.5) continue;
    const part = (ws: typeof above) => wordsText(notate([...ws].sort((a, b) => a.b[0] - b.b[0])).words, false);
    const used = new Set(all.map((w) => w.at));
    const first = Math.min(...all.map((w) => w.at));
    const box: WBox = [Math.min(bar[0], ...all.map((w) => w.b[0])), Math.min(...all.map((w) => w.b[1])), Math.max(bar[2], ...all.map((w) => w.b[2])), Math.max(...all.map((w) => w.b[3]))];
    const merged = { b: box, t: `\\frac{${part(above)}}{${part(below)}}`, first: list.find((w) => w.at === first)!.first, at: first, axis: y };
    list = list.flatMap((w) => (w.at === first ? [merged] : used.has(w.at) ? [] : [w]));
    count++;
  }
  return { words: list.map(({ at: _at, ...w }) => w), count };
}

// ---------- The paper's own outline: questions, parts and their lead-ins ----------

/** A label on the paper and the text printed after it, up to the next label. */
export type OutlinePart = { number: string; page: number; text: string };
type Building = OutlinePart & { words: Word[] };

const ROMAN = ["i", "ii", "iii", "iv", "v", "vi", "vii", "viii", "ix", "x", "xi", "xii"];
/** Header (page number, bar code) and footer (copyright, paper code) bands, in points. */
const TOP_BAND = 55;
const FOOT_BAND = 785;

/**
 * A page's words in printed order: lines from top to bottom (words whose bottoms are within 3 pt share a line), each
 * line left to right, the first word of each line marked. The text layer's own order can differ (a question number
 * written after the page's text). Pure.
 */
export function visualLines(words: readonly Word[]): Word[] {
  const sorted = [...words].sort((a, b) => a.b[3] - b.b[3] || a.b[0] - b.b[0]);
  const lines: Word[][] = [];
  for (const w of sorted) {
    const line = lines.at(-1);
    if (line && Math.abs(w.b[3] - line[0]!.b[3]) <= 3) line.push(w);
    else lines.push([w]);
  }
  return lines.flatMap((l) => l.sort((a, b) => a.b[0] - b.b[0]).map((w, k) => ({ ...w, first: k === 0 })));
}

/**
 * The paper's questions and parts as printed: a question number alone at the left margin (the next number in turn),
 * a part letter "(a)" or numeral "(i)" at the start of a line (the next in turn; "(i)" after "(h)" is a letter only when
 * it lines up with the letters), and the words after each label up to the next one. Answer lines, [marks], the header
 * and footer are left out. Questions numbers that do not follow on (page numbers, values) are text. Pure.
 */
export function pdfOutline(pages: readonly (readonly Word[])[]): OutlinePart[] {
  const out: Building[] = [];
  let q = 0;
  let letter = "";
  let letterX = -1;
  let roman = 0;
  let cur: Building | null = null;
  const start = (number: string, page: number) => {
    cur = { number, page, text: "", words: [] };
    out.push(cur);
  };
  pages.forEach((raw, pi) => {
    const page = pi + 1;
    // As printed, top to bottom (owner, 9 Nov 2026: Nov 2025 P42 stores the "2" of question 2 after its page's text).
    // The margin warnings, header and footer are left out first, so they never start a line.
    const words = visualLines(raw.filter((w) => !(w.b[1] < TOP_BAND || w.b[3] > FOOT_BAND || w.b[0] < 30 || w.b[2] > 565)));
    let prevLabelLine = -1;
    words.forEach((w, wi) => {
      if (w.b[1] < TOP_BAND || w.b[3] > FOOT_BAND || w.b[0] < 30 || w.b[2] > 565) return;
      const t = w.t;
      const lineStart = w.first || prevLabelLine === wi - 1;
      // The first question may be any number (a paper read from part way, or a cover without one); then they follow on.
      const qn = Number(t);
      if (lineStart && /^\d{1,2}$/.test(t) && w.b[0] < 62 && page > 1 && qn > q && (q === 0 || qn <= q + 3)) {
        q = qn;
        letter = "";
        letterX = -1;
        roman = 0;
        start(String(q), page);
        prevLabelLine = wi;
        return;
      }
      const lab = /^\(([a-z]{1,4})\)$/.exec(t);
      if (q && lab && lineStart && w.b[0] < 160) {
        const l = lab[1]!;
        const nextLetter = letter ? String.fromCharCode(letter.charCodeAt(0) + 1) : "a";
        const nextRoman = ROMAN[roman] ?? "";
        const asLetter = l === nextLetter && (l !== "i" || letterX < 0 || Math.abs(w.b[0] - letterX) < 8);
        if (asLetter && !(l === nextRoman && letter && w.b[0] > letterX + 8)) {
          letter = l;
          letterX = w.b[0];
          roman = 0;
          start(`${q}(${l})`, page);
          prevLabelLine = wi;
          return;
        }
        if (l === nextRoman && letter) {
          roman++;
          start(`${q}(${letter})(${l})`, page);
          prevLabelLine = wi;
          return;
        }
      }
      if (!cur) return;
      if (/^\.{3,}/.test(t) || /^\[\d+\]$/.test(t) || /^\[Total:?$/.test(t) || /^\d+\]$/.test(t)) return;
      (cur as Building).words.push(w);
    });
  });
  return out.map((p) => ({ number: p.number, page: p.page, text: wordsText(p.words, false).replace(/\.{3,}/g, " ").replace(/\s+/g, " ").trim() }));
}

/** Letters, digits and signs only, markup and spacing gone ("C = \frac{1}{4} xy^{2}" and "C = 1/4 xy2" both "C=14xy2"). */
const flatText = (s: string) => notationPlain(s).normalize("NFKD").replace(/[^A-Za-z0-9=+×÷]/g, "").replace(/[⁰-⁹]/g, "");
const realWords = (s: string) => (s.normalize("NFKD").toLowerCase().match(/[a-z]{4,}/g) ?? []);

/**
 * Lead-ins the reading has lost or merged (question papers): a question or part whose printed text before its first
 * sub-part has three words or more, while the reading has no item of its own for it. Merged: its words are in the
 * first sub-part's text. Lost: they are nowhere in that part. Pure.
 */
export function leadInProblems(items: readonly { number: string; text: string }[], outline: readonly OutlinePart[]): { number: string; child: string; lead: string; merged: boolean }[] {
  if (outline.filter((p) => !p.number.includes("(")).length < 2) return [];
  const have = new Set(items.map((i) => i.number));
  const out: { number: string; child: string; lead: string; merged: boolean }[] = [];
  for (const p of outline) {
    const hasChildren = outline.some((x) => x.number.startsWith(`${p.number}(`));
    if (!hasChildren || have.has(p.number)) continue;
    const lead = realWords(p.text);
    // A lead-in is three words or more, or a formula ("C = \frac{1}{4}xy^{2}" before (a)(i)).
    const formula = /=/.test(p.text) && flatText(p.text).length >= 4;
    if ((p.text.match(/[A-Za-z]{2,}/g) ?? []).length < 3 && !formula) continue;
    const child = items.find((i) => i.number.startsWith(`${p.number}(`));
    if (!child) continue;
    const mine = new Set(realWords(child.text));
    const shared = lead.filter((x) => mine.has(x)).length;
    const merged = (lead.length > 0 && shared >= Math.min(4, lead.length) && shared / lead.length >= 0.4) || (formula && flatText(child.text).includes(flatText(p.text)));
    out.push({ number: p.number, child: child.number, lead: p.text, merged });
  }
  return out;
}

/**
 * A first sub-part's text without the lead-in merged into it: its leading sentences (or lines) whose words are the
 * lead-in's are dropped. Pure.
 */
export function withoutLead(text: string, lead: string): string {
  const leadWords = new Set(realWords(lead));
  const parts = text.split(/(?<=[.?!:])\s+|\n+/);
  let k = 0;
  while (k < parts.length - 1) {
    const w = realWords(parts[k]!);
    if (w.length && w.filter((x) => leadWords.has(x)).length / w.length >= 0.7) k++;
    else if (!w.length) k++;
    else break;
  }
  return parts.slice(k).join(" ").trim();
}
