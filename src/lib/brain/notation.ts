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
export type Word = { b: WBox; t: string; first: boolean };

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
    if (h(x) <= 0 || x.t.length > 8 || (x.t.match(/[A-Za-z]/g) ?? []).length > 3) return;
    let best: { j: number; gap: number; kind: "sup" | "sub"; side: "pre" | "post" } | null = null;
    words.forEach((base, j) => {
      if (j === i || /^\.+$/.test(base.t)) return;
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
      tokens.push({ pieces: [...pre.map((p) => p.w.t), baseText], marked: preMarks + baseText, prefix: true });
    }
    if (post.length) {
      const baseText = /[A-Za-z0-9]+$/.exec(w.t)?.[0] ?? w.t.slice(-1);
      tokens.push({ pieces: [baseText, ...post.map((p) => p.w.t)], marked: baseText + postMarks });
    }
  });
  return { words: out, tokens };
}

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
      line += gap < 1 && gap > -2 ? w.t : ` ${w.t}`;
    }
    prev = w;
  }
  if (line) out.push(line);
  return out.join("\n");
}

/**
 * Every page's text with its notation. From Poppler's words when it read every page (it also reads the maths fonts
 * our own reader cannot: "y = x^{2} + 7x − 18"), else our reader's pages patched with what Poppler placed. Pure.
 */
export function notatedPages(pages: readonly string[], xml: string): { pages: string[]; found: number; words: Word[][]; from: "poppler" | "patched" } {
  const boxes = bboxWords(xml);
  let found = 0;
  const words: Word[][] = [];
  const tokens: Notation[][] = [];
  for (const b of boxes) {
    const n = notate(b);
    words.push(n.words);
    tokens.push(n.tokens);
    found += n.tokens.length;
  }
  const chars = (ps: readonly string[]) => ps.join("").replace(/\s/g, "").length;
  const fromWords = words.map((w) => wordsText(w));
  if (boxes.length === pages.length && chars(fromWords) >= chars(pages) * 0.8) return { pages: fromWords, found, words, from: "poppler" };
  return { pages: pages.map((p, i) => applyNotation(p, tokens[i] ?? [])), found, words, from: "patched" };
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
  return out;
}

/** Notation written for plain text (a flag's reason, a toast): Unicode where it has the characters, else as marked. */
export function notationPlain(s: string): string {
  return s.replace(/([\^_])\{([^{}]{0,40})\}/g, (m, k: string, t: string) => {
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
  }
  return first ? { ...first, repaired } : null;
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
  pages.forEach((words, pi) => {
    const page = pi + 1;
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
    if ((p.text.match(/[A-Za-z]{2,}/g) ?? []).length < 3) continue;
    const child = items.find((i) => i.number.startsWith(`${p.number}(`));
    if (!child) continue;
    const mine = new Set(realWords(child.text));
    const shared = lead.filter((x) => mine.has(x)).length;
    out.push({ number: p.number, child: child.number, lead: p.text, merged: lead.length > 0 && shared >= Math.min(4, lead.length) && shared / lead.length >= 0.4 });
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
