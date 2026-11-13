// Figures cut straight from the paper's PDF as SVG, no AI (owner, 7 Nov 2026, after the dry run on Physics, Maths and
// Computer Science papers). The brain script turns each figure page into SVG with Poppler (`pdftocairo -svg`) and its
// text lines with boxes (`pdftotext -bbox-layout`); `pageArt` keeps every drawn element with its box in page points
// (letters as shared glyph outlines, so a γ is the paper's own γ); `findBoxes` finds each figure: above its printed
// label ("Fig. 2.1") when there is one, else every group of drawing on the page with its labels; `assignBoxes` gives
// the reading's figures their boxes; `cropSvg` cuts a box out as a small SVG. The admin can move a box by hand on the
// review screen. Cambridge's own pictures: admin only, never shown to students.
// Pure, strip-only TypeScript: shared by the brain script (GitHub Actions) and the Worker. No Next imports.

export type Box = [number, number, number, number];
/** A drawn element: a letter (glyph outline id at x, y) or a path with its paint. Boxes in page points, y down. */
export type ArtGlyph = { b: Box; u: string; x: number; y: number; f: string };
export type ArtPath = { b: Box; d: string; f?: string; fr?: string; s?: string; sw?: number; lc?: string; lj?: string; da?: string; t?: number[]; w?: 1 };
/** A photo (raster picture) where the page prints it: its box and a JPEG of that box rendered by the script ("" until then). */
export type ArtPhoto = { b: Box; i: string };
export type ArtEl = ArtGlyph | ArtPath | ArtPhoto;
export type PageArt = { v: 1; page: number; w: number; h: number; g: Record<string, string>; e: ArtEl[] };
export type TextLine = { b: Box; text: string; body: boolean };
export type FigureCut = "caption" | "match" | "order" | "manual" | "page" | "";

/** Header band (bar code, page number) and footer band, in points, never part of a figure. */
const TOP = 72;
const BOTTOM = 50;
const MAX_ELEMENTS = 40_000;
const MAX_GLYPHS = 3_000;
const MAX_D = 20_000;
/** Photos (owner, 13 Nov 2026, option A): at most this many per page, each JPEG at most this long as a data URI. */
export const PHOTO = { max: 12, maxChars: 400_000, dpi: 100, quality: 75 };
const PHOTO_RE = /^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/;

const r2 = (n: number) => Math.round(n * 100) / 100;
const num = (s: string) => {
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
};
const D_RE = /^[MLCQHVZmlcqhvz0-9.,\s eE+-]*$/;
const PAINT_RE = /^(none|#[0-9a-f]{6})$/;
const WORD_RE = /^[a-z]{1,12}$/;

/** "rgb(13.7%, 12.1%, 12.5%)" or "#231f20" as "#231f20"; anything else is black. */
function hex(v: string | undefined): string | undefined {
  if (v === undefined) return undefined;
  if (v === "none") return "none";
  const m = v.match(/rgb\(\s*([\d.]+)%\s*,\s*([\d.]+)%\s*,\s*([\d.]+)%\s*\)/);
  if (m) return `#${[m[1], m[2], m[3]].map((x) => Math.round(Math.min(100, num(x!)) * 2.55).toString(16).padStart(2, "0")).join("")}`;
  return /^#[0-9a-fA-F]{6}$/.test(v) ? v.toLowerCase() : "#000000";
}
const white = (c: string | undefined) => c === "#ffffff";

/** Numbers in a path rounded to 0.01 pt (plenty for a picture), so a page's SVG shrinks to about a third. */
const roundD = (d: string) => d.replace(/-?\d+\.\d+(e-?\d+)?/g, (x) => String(r2(Number(x)))).replace(/\s+/g, " ").trim();

const apply = (m: readonly number[], x: number, y: number): [number, number] => [m[0]! * x + m[2]! * y + m[4]!, m[1]! * x + m[3]! * y + m[5]!];

/** The box around a path's points (control points included, so a little generous on curves). */
function pathBox(d: string, m: readonly number[]): Box | null {
  const nums = d.match(/-?\d*\.?\d+(?:e-?\d+)?/g)?.map(Number) ?? [];
  let b: Box | null = null;
  for (let i = 0; i + 1 < nums.length; i += 2) {
    const [x, y] = apply(m, nums[i]!, nums[i + 1]!);
    b = b ? [Math.min(b[0], x), Math.min(b[1], y), Math.max(b[2], x), Math.max(b[3], y)] : [x, y, x, y];
  }
  return b;
}

const attrsOf = (s: string) => Object.fromEntries([...s.matchAll(/([a-zA-Z:-]+)="([^"]*)"/g)].map((a) => [a[1]!, a[2]!]));

/** One page of `pdftocairo -svg` output as its drawn elements. Clip paths are left out; photos keep only their box (`fillPhotos`). */
export function pageArt(svg: string, page: number): PageArt {
  const w = num(svg.match(/<svg[^>]*\bwidth="([\d.]+)/)?.[1] ?? "595");
  const h = num(svg.match(/<svg[^>]*\bheight="([\d.]+)/)?.[1] ?? "842");
  const g: Record<string, string> = {};
  const names = new Map<string, string>();
  const outlines = new Map<string, string>();
  for (const m of svg.matchAll(/<g id="(glyph-[\d-]+)">\s*<path d="([^"]*)"\s*\/>/g)) outlines.set(m[1]!, roundD(m[2]!));
  // Photos: pdftocairo defines each picture once (with its size in pixels) and places it with a <use> and a matrix.
  const sources = new Map<string, [number, number]>();
  for (const m of svg.matchAll(/<image id="(source-\d+)" x="[^"]*" y="[^"]*" width="([\d.]+)" height="([\d.]+)"/g)) sources.set(m[1]!, [num(m[2]!), num(m[3]!)]);
  const at = svg.indexOf("</defs>");
  const body = at >= 0 ? svg.slice(at) : svg;
  const e: ArtEl[] = [];
  let photos = 0;
  let fill = "#000000";
  for (const line of body.split("\n")) {
    if (e.length >= MAX_ELEMENTS) break;
    const gm = line.match(/^<g [^>]*fill="([^"]*)"/);
    if (gm) fill = hex(gm[1]) ?? "#000000";
    const u = line.match(/^<use [^>]*href="#(glyph-[\d-]+)"[^>]*\bx="(-?[\d.]+)"[^>]*\by="(-?[\d.]+)"/);
    if (u) {
      const d = outlines.get(u[1]!);
      if (!d) continue;
      let id = names.get(u[1]!);
      if (!id) {
        if (names.size >= MAX_GLYPHS) continue;
        id = `g${names.size}`;
        names.set(u[1]!, id);
        g[id] = d;
      }
      const x = r2(num(u[2]!)), y = r2(num(u[3]!));
      const b = pathBox(d, [1, 0, 0, 1, x, y]);
      if (b) e.push({ b: b.map(r2) as Box, u: id, x, y, f: fill });
      continue;
    }
    const src = line.match(/^<use [^>]*href="#(source-\d+)"[^>]*transform="matrix\(([^)]*)\)"/);
    if (src) {
      const size = sources.get(src[1]!);
      const t = src[2]!.split(/[\s,]+/).map(num);
      if (!size || t.length !== 6 || photos >= PHOTO.max) continue;
      const corners = [apply(t, 0, 0), apply(t, size[0], 0), apply(t, 0, size[1]), apply(t, size[0], size[1])];
      const b: Box = [Math.min(...corners.map((c) => c[0])), Math.min(...corners.map((c) => c[1])), Math.max(...corners.map((c) => c[0])), Math.max(...corners.map((c) => c[1]))];
      // A picture smaller than 10 pt is a mark or a speck, not a photo.
      if (b[2] - b[0] < 10 || b[3] - b[1] < 10) continue;
      photos++;
      e.push({ b: b.map(r2) as Box, i: "" });
      continue;
    }
    const p = line.match(/^<path ([^>]*)\/>/);
    if (!p) continue;
    const a = attrsOf(p[1]!);
    const d = roundD(a.d ?? "");
    if (!d || d.length > MAX_D || !D_RE.test(d)) continue;
    const t = a.transform?.match(/^matrix\(([^)]*)\)$/)?.[1]?.split(/[\s,]+/).map(num);
    const m = t && t.length === 6 ? t : [1, 0, 0, 1, 0, 0];
    const b = pathBox(d, m);
    if (!b) continue;
    const el: ArtPath = { b: b.map(r2) as Box, d };
    const f = hex(a.fill), s = hex(a.stroke);
    if (f) el.f = f;
    if (a["fill-rule"] === "evenodd") el.fr = "evenodd";
    if (s && s !== "none") el.s = s;
    if (a["stroke-width"]) el.sw = r2(num(a["stroke-width"]));
    if (a["stroke-linecap"] === "round" || a["stroke-linecap"] === "square") el.lc = a["stroke-linecap"];
    if (a["stroke-linejoin"] === "round" || a["stroke-linejoin"] === "bevel") el.lj = a["stroke-linejoin"];
    if (a["stroke-dasharray"] && /^[\d.,\s]+$/.test(a["stroke-dasharray"])) el.da = a["stroke-dasharray"].trim();
    if (t && t.length === 6) el.t = t.map((x) => Math.round(x * 1e5) / 1e5);
    if ((white(s) || !s) && (white(f) || f === "none" || (!f && !s)) && (white(s) || white(f))) el.w = 1;
    e.push(el);
  }
  return { v: 1, page, w: r2(w), h: r2(h), g, e };
}

const isGlyph = (x: ArtEl): x is ArtGlyph => (x as ArtGlyph).u !== undefined;
const isPhoto = (x: ArtEl): x is ArtPhoto => typeof (x as ArtPhoto).i === "string";

/** The photos of a page whose JPEG the script still has to render, with their index in `art.e`. */
export const photoSlots = (art: PageArt) => art.e.flatMap((x, k) => (isPhoto(x) && !x.i ? [{ k, b: x.b }] : []));

/** The page's art with each photo's JPEG (a data URI from the script); a photo left without one is dropped. */
export function fillPhotos(art: PageArt, data: ReadonlyMap<number, string>): PageArt {
  return { ...art, e: art.e.flatMap((x, k): ArtEl[] => (!isPhoto(x) ? [x] : x.i ? [x] : PHOTO_RE.test(data.get(k) ?? "") && data.get(k)!.length <= PHOTO.maxChars ? [{ b: x.b, i: data.get(k)! }] : [])) };
}

/** pdftoppm's arguments for one photo's box as a JPEG (pixels at PHOTO.dpi, from the page's top left). */
export function photoArgs(page: number, b: Box): string[] {
  const k = PHOTO.dpi / 72;
  const px = (n: number) => String(Math.max(0, Math.round(n * k)));
  return ["-jpeg", "-jpegopt", `quality=${PHOTO.quality}`, "-r", String(PHOTO.dpi), "-f", String(page), "-l", String(page), "-x", px(b[0]), "-y", px(b[1]), "-W", px(b[2] - b[0]), "-H", px(b[3] - b[1]), "-singlefile"];
}
const fin = (n: unknown, lo = -5000, hi = 5000) => (typeof n === "number" && Number.isFinite(n) && n >= lo && n <= hi ? n : null);
const box = (v: unknown): Box | null => {
  if (!Array.isArray(v) || v.length !== 4) return null;
  const b = v.map((x) => fin(x));
  return b.every((x) => x !== null) ? (b as Box) : null;
};

/** A page's art from the script (or our own storage) made safe: every value checked, so a cut SVG is safe by construction. */
export function cleanArt(raw: unknown): PageArt | null {
  const o = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : null;
  if (!o || o.v !== 1) return null;
  const page = fin(o.page, 1, 500), w = fin(o.w, 10, 5000), h = fin(o.h, 10, 5000);
  if (page === null || w === null || h === null || !Number.isInteger(page)) return null;
  const g: Record<string, string> = {};
  const gin = o.g && typeof o.g === "object" ? (o.g as Record<string, unknown>) : {};
  for (const [k, d] of Object.entries(gin).slice(0, MAX_GLYPHS)) if (/^g\d{1,4}$/.test(k) && typeof d === "string" && d.length <= MAX_D && D_RE.test(d)) g[k] = d;
  const e: ArtEl[] = [];
  let photos = 0;
  for (const x of (Array.isArray(o.e) ? o.e : []).slice(0, MAX_ELEMENTS)) {
    const r = x && typeof x === "object" ? (x as Record<string, unknown>) : {};
    const b = box(r.b);
    if (!b) continue;
    if (typeof r.i === "string") {
      if (photos < PHOTO.max && r.i.length <= PHOTO.maxChars && PHOTO_RE.test(r.i)) {
        photos++;
        e.push({ b, i: r.i });
      }
      continue;
    }
    if (typeof r.u === "string") {
      const xx = fin(r.x), yy = fin(r.y), f = typeof r.f === "string" && PAINT_RE.test(r.f) ? r.f : "#000000";
      if (g[r.u] !== undefined && xx !== null && yy !== null) e.push({ b, u: r.u, x: xx, y: yy, f });
      continue;
    }
    if (typeof r.d !== "string" || r.d.length > MAX_D || !D_RE.test(r.d)) continue;
    const el: ArtPath = { b, d: r.d };
    if (typeof r.f === "string" && PAINT_RE.test(r.f)) el.f = r.f;
    if (r.fr === "evenodd") el.fr = "evenodd";
    if (typeof r.s === "string" && PAINT_RE.test(r.s)) el.s = r.s;
    const sw = fin(r.sw, 0, 100);
    if (sw !== null) el.sw = sw;
    if (r.lc === "round" || r.lc === "square") el.lc = r.lc;
    if (r.lj === "round" || r.lj === "bevel") el.lj = r.lj;
    if (typeof r.da === "string" && /^[\d.,\s]{1,60}$/.test(r.da)) el.da = r.da;
    if (Array.isArray(r.t) && r.t.length === 6 && r.t.every((n) => fin(n, -1e5, 1e5) !== null)) el.t = r.t as number[];
    if (r.w === 1) el.w = 1;
    e.push(el);
  }
  return { v: 1, page, w, h, g, e };
}

// ---------- Text lines (pdftotext -bbox-layout) ----------

const unxml = (s: string) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, "\"").replace(/&#39;/g, "'").replace(/&amp;/g, "&");

/**
 * A page's text lines with boxes. `body` marks question text, never a figure's label: a paragraph with a long line,
 * a sentence about a figure ("Fig. 2.1 shows"), [marks], or one starting with a part or question number.
 */
export function textLines(xml: string): TextLine[] {
  const out: TextLine[] = [];
  for (const blk of xml.matchAll(/<block [^>]*>([\s\S]*?)<\/block>/g)) {
    const ls: { b: Box; text: string }[] = [];
    for (const m of blk[1]!.matchAll(/<line xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">([\s\S]*?)<\/line>/g)) {
      const words = [...m[5]!.matchAll(/>([^<]*)<\/word>/g)].map((x) => unxml(x[1]!));
      ls.push({ b: [num(m[1]!), num(m[2]!), num(m[3]!), num(m[4]!)], text: words.join(" ") });
    }
    const all = ls.map((l) => l.text).join(" ");
    const body = ls.some((l) => l.text.length > 45) || /Fig(ure)?\.?\s*\d+\.\d+.*\b(shows?|is|in|of|on)\b/i.test(all) || /\[\d+\]/.test(all) || /^\(?[a-z]{1,4}\)\s/.test(all) || /^\d+\s+[A-Z]/.test(all);
    for (const l of ls) out.push({ ...l, body });
  }
  return out;
}

// ---------- Finding figures ----------

const overlaps = (a: Box, b: Box, pad = 0) => a[0] - pad < b[2] && b[0] - pad < a[2] && a[1] - pad < b[3] && b[1] - pad < a[3];
const join = (a: Box, b: Box): Box => [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])];
const inside = (a: Box, b: Box) => a[0] >= b[0] && a[1] >= b[1] && a[2] <= b[2] && a[3] <= b[3];

/** Drawing (not letters, not white masks, not page frame, header or footer) between two heights. */
function drawing(art: PageArt, top: number, bottom: number) {
  return art.e.filter((x): x is ArtPath | ArtPhoto => !isGlyph(x) && !(x as ArtPath).w && x.b[1] >= Math.max(TOP, top) - 2 && x.b[3] <= Math.min(art.h - BOTTOM, bottom) + 2
    && x.b[0] > 20 && x.b[2] < art.w - 20 && x.b[2] - x.b[0] < art.w * 0.9);
}

/** Grows a box by the labels (short text lines, not question text) that touch it. */
function withLabels(b: Box, lines: readonly TextLine[], art: PageArt, top: number, bottom: number, pad: number): Box {
  let out = b;
  let grew = true;
  while (grew) {
    grew = false;
    for (const l of lines) {
      if (l.body || l.b[1] < Math.max(TOP, top) || l.b[3] > Math.min(art.h - BOTTOM, bottom) || inside(l.b, out)) continue;
      if (overlaps(l.b, out, pad)) {
        out = join(out, l.b);
        grew = true;
      }
    }
  }
  return out;
}

function grow(paths: readonly { b: Box }[], gap: number): Box[] {
  const groups: Box[] = [];
  for (const p of paths) {
    let b = p.b;
    for (let i = groups.length - 1; i >= 0; i--) if (overlaps(groups[i]!, b, gap)) { b = join(b, groups[i]!); groups.splice(i, 1); }
    groups.push(b);
  }
  let changed = true;
  while (changed) {
    changed = false;
    for (let i = 0; i < groups.length; i++) for (let j = i + 1; j < groups.length; j++) {
      if (overlaps(groups[i]!, groups[j]!, gap)) { groups[i] = join(groups[i]!, groups[j]!); groups.splice(j, 1); changed = true; j--; }
    }
  }
  return groups;
}

export type Found = { captions: { label: string; box: Box }[]; groups: Box[] };

/**
 * Every figure on a page. With printed labels ("Fig. 2.1" on its own line): the drawing above each label, up to the
 * one before. Without: every group of drawing (lines within 12 pt of each other) with its labels, top to bottom.
 */
export function findBoxes(art: PageArt, lines: readonly TextLine[]): Found {
  const caps = lines.filter((l) => /^Fig(ure)?\.?\s*\d+\.\d+\b/i.test(l.text) && l.text.split(" ").length <= 6 && !/\b(in|of|on|shows?)\b/i.test(l.text.replace(/\(not to scale\)/i, "")))
    .sort((a, b) => a.b[1] - b.b[1]);
  const captions: Found["captions"] = [];
  let prev = 0;
  let rowTop = 0;
  for (const c of caps) {
    const label = c.text.match(/(\d+\.\d+)/)![1]!;
    // Captions side by side on one line (Biology Nov 2025 P62's Fig. 3.2 and 3.3): each takes the drawing in its own
    // column, split halfway between the captions' middles; the line above them all is where every column starts.
    const row = caps.filter((x) => Math.abs(x.b[1] - c.b[1]) < 4).sort((a, b) => a.b[0] - b.b[0]);
    const mid = (x: TextLine) => (x.b[0] + x.b[2]) / 2;
    const k = row.indexOf(c);
    const left = k > 0 ? (mid(row[k - 1]!) + mid(c)) / 2 : -Infinity;
    const right = k < row.length - 1 ? (mid(c) + mid(row[k + 1]!)) / 2 : Infinity;
    if (k > 0) prev = rowTop;
    else rowTop = prev;
    const paths = drawing(art, prev, c.b[1]).filter((p) => (p.b[0] + p.b[2]) / 2 >= left && (p.b[0] + p.b[2]) / 2 < right).sort((a, b) => b.b[3] - a.b[3]);
    if (paths.length) {
      let b = paths[0]!.b;
      let grew = true;
      while (grew) {
        grew = false;
        for (const p of paths) if (!inside(p.b, b) && overlaps(p.b, b, 25)) { b = join(b, p.b); grew = true; }
      }
      // A photo takes its short labels ("heart 75%") but never a sentence: the lines next to it are question text
      // (Biology Mar 2025 P42's Fig. 6.2).
      const onlyPhotos = paths.filter((p) => inside(p.b, b)).every((p) => isPhoto(p));
      const near = onlyPhotos ? lines.filter((l) => !/[.?!:]$/.test(l.text.trim()) && l.text.trim().split(/\s+/).length <= 4) : lines;
      captions.push({ label, box: withLabels(b, near, art, prev, c.b[1] - 1, 14).map(r2) as Box });
    }
    prev = c.b[3];
  }
  const groups = grow(drawing(art, 0, art.h), 12)
    .filter((b) => b[2] - b[0] > 30 && b[3] - b[1] > 20)
    .map((b) => withLabels(b, lines, art, 0, art.h, 10).map(r2) as Box)
    .sort((a, b) => a[1] - b[1]);
  return { captions, groups };
}

/**
 * A figure's labels found by text alone, for a drawing with no box found: the short lines (not question text, no
 * sentence ending) between the last line of question text above a printed label ("Fig. 7.1") and that label. Pure.
 */
export function labelBoxes(lines: readonly TextLine[]): Box[] {
  const sorted = [...lines].sort((a, b) => a.b[1] - b.b[1]);
  const out: Box[] = [];
  sorted.forEach((cap, k) => {
    if (!/^Fig(ure)?\.?\s*\d+\.\d+\b/i.test(cap.text) || cap.text.split(/\s+/).length > 8 || cap.body) return;
    const above = sorted.slice(0, k).filter((l) => l.b[3] <= cap.b[1] + 1);
    const lastBody = Math.max(TOP, ...above.filter((l) => l.body).map((l) => l.b[3]));
    for (const l of above) {
      if (l.body || l.b[1] < lastBody - 1 || /[.?!:]$/.test(l.text.trim()) || /^\(?[a-z]{1,4}\)\s/.test(l.text)) continue;
      out.push(l.b);
    }
  });
  return out;
}

/** The whole printed area of a page (inside the margins), for "Use whole page". */
export const wholePage = (art: Pick<PageArt, "w" | "h">): Box => [30, TOP, r2(art.w - 30), r2(art.h - BOTTOM)];

/** Answer-space words printed beside many drawings and tables ("Working space"): no evidence of which drawing it is. */
const ANSWER_WORDS = new Set(["working", "space", "answer", "show", "your"]);
const wordsOf = (s: string) => new Set(s.toLowerCase().split(/[^a-z0-9]+/).filter((w) => (w.length >= 3 && WORD_RE.test(w) && !ANSWER_WORDS.has(w)) || /^\d+(\.\d+)?$/.test(w)));

/**
 * Boxes for the reading's figures on one page, in their order. A figure whose caption names a printed label takes
 * the box above it; the rest take the drawing groups left over: the one whose labels share most words with the
 * figure's caption and description, else the next in order. A figure with nothing left gets no box (flagged).
 */
export function assignBoxes(figs: readonly { id: string; caption: string; description?: string }[], found: Found, lines: readonly TextLine[]): Map<string, { box: Box; cut: FigureCut }> {
  const out = new Map<string, { box: Box; cut: FigureCut }>();
  const usedCap = new Set<number>();
  for (const f of figs) {
    const label = f.caption.match(/Fig(?:ure)?\.?\s*(\d+\.\d+)/i)?.[1];
    const i = label ? found.captions.findIndex((c, k) => c.label === label && !usedCap.has(k)) : -1;
    if (i >= 0) {
      usedCap.add(i);
      out.set(f.id, { box: found.captions[i]!.box, cut: "caption" });
    }
  }
  const taken = [...usedCap].map((k) => found.captions[k]!.box);
  const free = found.groups.filter((g) => !taken.some((t) => overlaps(g, t)));
  const textIn = (b: Box) => wordsOf(lines.filter((l) => overlaps(l.b, b)).map((l) => l.text).join(" "));
  let from = 0;
  for (const f of figs) {
    if (out.has(f.id)) continue;
    const want = wordsOf(`${f.caption} ${f.description ?? ""}`);
    let best = -1, score = 0;
    for (let k = from; k < free.length; k++) {
      const have = textIn(free[k]!);
      const s = [...want].filter((w) => have.has(w)).length;
      if (s > score) { best = k; score = s; }
    }
    if (best < 0 && from < free.length) best = from;
    if (best < 0) continue;
    out.set(f.id, { box: free[best]!, cut: score > 0 ? "match" : "order" });
    from = best + 1;
  }
  return out;
}

// ---------- Cutting ----------

const pathTag = (p: ArtPath) => {
  const a = [`d="${p.d}"`, `fill="${p.f ?? "#000000"}"`];
  if (p.fr) a.push(`fill-rule="${p.fr}"`);
  if (p.s) a.push(`stroke="${p.s}"`);
  if (p.sw !== undefined) a.push(`stroke-width="${p.sw}"`);
  if (p.lc) a.push(`stroke-linecap="${p.lc}"`);
  if (p.lj) a.push(`stroke-linejoin="${p.lj}"`);
  if (p.da) a.push(`stroke-dasharray="${p.da}"`);
  if (p.t) a.push(`transform="matrix(${p.t.join(" ")})"`);
  return `<path ${a.join(" ")}/>`;
};

/**
 * A box of a page as its own SVG: a white sheet, the letters it uses once each (`<use>` of local outlines), and the
 * drawing that touches the box. `marker` adds a red frame around another box (the adjust view). Built only from
 * cleaned numbers and paint codes, so there is nothing in it to escape.
 */
export function cropSvg(art: PageArt, b: Box, pad = 6, marker?: Box): string {
  const v: Box = [b[0] - pad, b[1] - pad, b[2] + pad, b[3] + pad];
  const used = new Set<string>();
  const parts: string[] = [];
  for (const x of art.e) {
    if (!overlaps(x.b, v)) continue;
    if (isGlyph(x)) {
      used.add(x.u);
      parts.push(`<use href="#${x.u}" x="${x.x}" y="${x.y}" fill="${x.f}"/>`);
    } else if (isPhoto(x)) {
      // Under the drawing, as printed (labels and arrows on a photo stay on top).
      if (x.i) parts.unshift(`<image href="${x.i}" x="${x.b[0]}" y="${x.b[1]}" width="${r2(x.b[2] - x.b[0])}" height="${r2(x.b[3] - x.b[1])}" preserveAspectRatio="none"/>`);
    } else parts.push(pathTag(x));
  }
  const [x, y, w, h] = [r2(v[0]), r2(v[1]), r2(v[2] - v[0]), r2(v[3] - v[1])];
  const defs = [...used].map((u) => `<path id="${u}" d="${art.g[u]}"/>`).join("");
  const frame = marker ? `<rect x="${r2(marker[0])}" y="${r2(marker[1])}" width="${r2(marker[2] - marker[0])}" height="${r2(marker[3] - marker[1])}" fill="none" stroke="#d1242f" stroke-width="2"/>` : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${x} ${y} ${w} ${h}" width="${r2(w * 1.5)}" height="${r2(h * 1.5)}"><rect x="${x}" y="${y}" width="${w}" height="${h}" fill="#ffffff"/><defs>${defs}</defs>${parts.join("")}${frame}</svg>`;
}

/** The whole page as SVG (for drawing a box by hand), with the current box framed. */
export const pageSvg = (art: PageArt, current?: Box | null) => cropSvg(art, [0, 0, art.w, art.h], 0, current ?? undefined);

/** A box from the review screen, checked and kept on the page. */
export function cleanBox(v: unknown, art: Pick<PageArt, "w" | "h">): Box | null {
  const b = box(v);
  if (!b) return null;
  const x0 = Math.max(0, Math.min(b[0], b[2])), x1 = Math.min(art.w, Math.max(b[0], b[2]));
  const y0 = Math.max(0, Math.min(b[1], b[3])), y1 = Math.min(art.h, Math.max(b[1], b[3]));
  return x1 - x0 >= 8 && y1 - y0 >= 8 ? [r2(x0), r2(y0), r2(x1), r2(y1)] : null;
}
