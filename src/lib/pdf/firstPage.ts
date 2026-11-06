// Reads the text of a PDF's first page, for the front page reader. Small and self-contained: no
// libraries, so the agent (Node built-ins only, GitHub Actions) and the browser (upload page) use
// the same code. The caller passes an `inflate` (zlib in Node, DecompressionStream in a browser).
// It understands what Cambridge's PDFs use: plain and compressed objects, object streams,
// FlateDecode and ASCII85Decode, simple fonts and Type0 fonts with ToUnicode maps. Anything it
// cannot read gives an empty text, never an error: the reader then says "could not read".
// Pure; strip-only TypeScript (no enums or parameter properties).

export type Inflate = (data: Uint8Array) => Promise<Uint8Array>;

type Ref = { ref: number };
type Name = { name: string };
type PdfStr = { str: Uint8Array };
type Val = number | boolean | null | Ref | Name | PdfStr | Val[] | Dict;
type Dict = { dict: Record<string, Val> };
type Obj = { value: Val; stream?: { start: number; end: number } };

const MAX_STREAM = 8 * 1024 * 1024;
const MAX_TEXT = 6000;

const isRef = (v: unknown): v is Ref => typeof v === "object" && v !== null && "ref" in v;
const isName = (v: unknown): v is Name => typeof v === "object" && v !== null && "name" in v;
const isDict = (v: unknown): v is Dict => typeof v === "object" && v !== null && "dict" in v;
const isStr = (v: unknown): v is PdfStr => typeof v === "object" && v !== null && "str" in v;

const WS = new Set([0, 9, 10, 12, 13, 32]);
const DELIM = new Set("()<>[]{}/%".split("").map((c) => c.charCodeAt(0)));

/** A tiny PDF value parser over bytes. */
class Lexer {
  b: Uint8Array;
  i: number;
  constructor(b: Uint8Array, i = 0) {
    this.b = b;
    this.i = i;
  }
  skip() {
    const b = this.b;
    for (;;) {
      while (this.i < b.length && WS.has(b[this.i]!)) this.i++;
      if (b[this.i] === 37) { // % comment
        while (this.i < b.length && b[this.i] !== 10 && b[this.i] !== 13) this.i++;
        continue;
      }
      return;
    }
  }
  word(): string {
    const s = this.i;
    while (this.i < this.b.length && !WS.has(this.b[this.i]!) && !DELIM.has(this.b[this.i]!)) this.i++;
    let out = "";
    for (let k = s; k < this.i; k++) out += String.fromCharCode(this.b[k]!);
    return out;
  }
  /** The next value, or an operator as { op } when reading content streams. */
  value(depth = 0): Val | { op: string } | undefined {
    if (depth > 40) return undefined;
    this.skip();
    const b = this.b;
    if (this.i >= b.length) return undefined;
    const c = b[this.i]!;
    if (c === 47) { // /Name
      this.i++;
      const raw = this.word();
      return { name: raw.replace(/#([0-9a-fA-F]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16))) };
    }
    if (c === 40) return { str: this.literal() };
    if (c === 60 && b[this.i + 1] === 60) {
      this.i += 2;
      const dict: Record<string, Val> = {};
      for (;;) {
        this.skip();
        if (this.i >= b.length) break;
        if (b[this.i] === 62 && b[this.i + 1] === 62) { this.i += 2; break; }
        const k = this.value(depth + 1);
        if (!isName(k)) { this.i++; continue; }
        const v = this.value(depth + 1);
        if (v !== undefined && !(typeof v === "object" && v !== null && "op" in v)) dict[k.name] = v as Val;
      }
      return { dict };
    }
    if (c === 60) return { str: this.hex() };
    if (c === 91) {
      this.i++;
      const arr: Val[] = [];
      for (;;) {
        this.skip();
        if (this.i >= b.length) break;
        if (b[this.i] === 93) { this.i++; break; }
        const v = this.value(depth + 1);
        if (v === undefined) break;
        if (typeof v === "object" && v !== null && "op" in v) {
          if (v.op === "R" && arr.length >= 2 && typeof arr[arr.length - 1] === "number" && typeof arr[arr.length - 2] === "number") {
            arr.pop();
            arr[arr.length - 1] = { ref: arr[arr.length - 1] as number };
          }
          continue;
        }
        arr.push(v);
      }
      return arr;
    }
    if (c === 93 || c === 62 || c === 41 || c === 123 || c === 125) { this.i++; return { op: String.fromCharCode(c) }; }
    const w = this.word();
    if (w === "") { this.i++; return { op: "" }; }
    if (/^[+-]?(\d+\.?\d*|\.\d+)$/.test(w)) {
      // "12 0 R" is a reference.
      const save = this.i;
      if (/^\d+$/.test(w)) {
        this.skip();
        const g = this.word();
        if (/^\d+$/.test(g)) {
          this.skip();
          if (this.b[this.i] === 82 && (this.i + 1 >= this.b.length || WS.has(this.b[this.i + 1]!) || DELIM.has(this.b[this.i + 1]!))) {
            this.i++;
            return { ref: Number(w) };
          }
        }
        this.i = save;
      }
      return Number(w);
    }
    if (w === "true") return true;
    if (w === "false") return false;
    if (w === "null") return null;
    return { op: w };
  }
  literal(): Uint8Array {
    const b = this.b;
    this.i++;
    const out: number[] = [];
    let depth = 1;
    while (this.i < b.length) {
      const c = b[this.i++]!;
      if (c === 92) {
        const n = b[this.i++]!;
        const map: Record<number, number> = { 110: 10, 114: 13, 116: 9, 98: 8, 102: 12, 40: 40, 41: 41, 92: 92 };
        if (n in map) out.push(map[n]!);
        else if (n >= 48 && n <= 55) {
          let v = n - 48;
          for (let k = 0; k < 2 && b[this.i]! >= 48 && b[this.i]! <= 55; k++) v = v * 8 + (b[this.i++]! - 48);
          out.push(v & 255);
        } else if (n === 13) { if (b[this.i] === 10) this.i++; }
        else if (n !== 10) out.push(n);
        continue;
      }
      if (c === 40) depth++;
      if (c === 41 && --depth === 0) break;
      out.push(c);
    }
    return Uint8Array.from(out);
  }
  hex(): Uint8Array {
    const b = this.b;
    this.i++;
    let s = "";
    while (this.i < b.length && b[this.i] !== 62) {
      const ch = String.fromCharCode(b[this.i++]!);
      if (/[0-9a-fA-F]/.test(ch)) s += ch;
    }
    this.i++;
    if (s.length % 2) s += "0";
    const out = new Uint8Array(s.length / 2);
    for (let k = 0; k < out.length; k++) out[k] = parseInt(s.slice(k * 2, k * 2 + 2), 16);
    return out;
  }
}

function latin1(b: Uint8Array, from = 0, to = b.length): string {
  let s = "";
  for (let i = from; i < to; i += 8192) s += String.fromCharCode(...b.subarray(i, Math.min(to, i + 8192)));
  return s;
}

function ascii85(data: Uint8Array): Uint8Array {
  const out: number[] = [];
  let group: number[] = [];
  let i = 0;
  if (data[0] === 60 && data[1] === 126) i = 2; // "<~"
  for (; i < data.length; i++) {
    const c = data[i]!;
    if (c === 126) break; // "~>"
    if (WS.has(c)) continue;
    if (c === 122 && group.length === 0) { out.push(0, 0, 0, 0); continue; }
    if (c < 33 || c > 117) continue;
    group.push(c - 33);
    if (group.length === 5) {
      let v = 0;
      for (const g of group) v = v * 85 + g;
      out.push((v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255);
      group = [];
    }
  }
  if (group.length > 1) {
    const n = group.length;
    while (group.length < 5) group.push(84);
    let v = 0;
    for (const g of group) v = v * 85 + g;
    const bytes = [(v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255];
    out.push(...bytes.slice(0, n - 1));
  }
  return Uint8Array.from(out);
}

class Doc {
  b: Uint8Array;
  objs = new Map<number, Obj>();
  inflate: Inflate;
  constructor(b: Uint8Array, inflate: Inflate) {
    this.b = b;
    this.inflate = inflate;
  }
  scan() {
    const text = latin1(this.b);
    const re = /(\d+)\s+(\d+)\s+obj\b/g;
    for (let m = re.exec(text); m; m = re.exec(text)) {
      const lx = new Lexer(this.b, m.index + m[0].length);
      const value = lx.value();
      if (value === undefined || (typeof value === "object" && value !== null && "op" in value)) continue;
      const obj: Obj = { value: value as Val };
      lx.skip();
      if (text.startsWith("stream", lx.i)) {
        let start = lx.i + 6;
        if (this.b[start] === 13) start++;
        if (this.b[start] === 10) start++;
        const len = isDict(value) ? value.dict.Length : undefined;
        let end = typeof len === "number" && start + len <= this.b.length && text.startsWith("endstream", skipWs(text, start + len)) ? start + len : -1;
        if (end < 0) {
          // Length missing or given as a reference (resolved below). The line break before
          // "endstream" is not part of the data: browsers refuse compressed data with it attached.
          const e = text.indexOf("endstream", start);
          end = e < 0 ? this.b.length : e;
          if (this.b[end - 1] === 10) end--;
          if (this.b[end - 1] === 13) end--;
        }
        obj.stream = { start, end };
        re.lastIndex = end;
      }
      this.objs.set(Number(m[1]), obj);
    }
  }
  /** Streams whose /Length is a reference ("201 0 R"): use the exact length once all objects are known. */
  exactLengths() {
    for (const [, o] of this.objs) {
      if (!o.stream || !isDict(o.value) || !isRef(o.value.dict.Length)) continue;
      const len = this.get(o.value.dict.Length);
      if (typeof len === "number" && len >= 0 && o.stream.start + len <= o.stream.end + 2) o.stream = { start: o.stream.start, end: o.stream.start + len };
    }
  }
  get(v: Val | undefined, depth = 0): Val | undefined {
    if (depth > 20) return undefined;
    return isRef(v) ? this.get(this.objs.get(v.ref)?.value, depth + 1) : v;
  }
  async data(o: Obj): Promise<Uint8Array> {
    if (!o.stream || o.stream.end - o.stream.start > MAX_STREAM) return new Uint8Array();
    let d = this.b.subarray(o.stream.start, o.stream.end);
    const dict = isDict(o.value) ? o.value.dict : {};
    const f = this.get(dict.Filter);
    const filters = (Array.isArray(f) ? f : f ? [f] : []).map((x) => (isName(x) ? x.name : ""));
    for (const name of filters) {
      if (name === "FlateDecode" || name === "Fl") d = await this.inflate(d);
      else if (name === "ASCII85Decode" || name === "A85") d = ascii85(d);
      else return new Uint8Array(); // images and other filters are not text
    }
    return d;
  }
  async objectStreams() {
    for (const [, o] of [...this.objs]) {
      if (!isDict(o.value) || !isName(o.value.dict.Type) || o.value.dict.Type.name !== "ObjStm") continue;
      const n = Number(this.get(o.value.dict.N));
      const first = Number(this.get(o.value.dict.First));
      if (!Number.isInteger(n) || !Number.isInteger(first) || n > 100_000) continue;
      const d = await this.data(o);
      const head = new Lexer(d);
      const pairs: [number, number][] = [];
      for (let k = 0; k < n; k++) {
        const num = head.value();
        const off = head.value();
        if (typeof num !== "number" || typeof off !== "number") break;
        pairs.push([num, off]);
      }
      for (const [num, off] of pairs) {
        if (this.objs.has(num)) continue;
        const v = new Lexer(d, first + off).value();
        if (v !== undefined && !(typeof v === "object" && v !== null && "op" in v)) this.objs.set(num, { value: v as Val });
      }
    }
  }
  firstPage(): Dict | null {
    let catalog: Dict | null = null;
    for (const [, o] of this.objs) {
      if (isDict(o.value) && isName(o.value.dict.Type) && o.value.dict.Type.name === "Catalog") catalog = o.value;
    }
    let node = catalog ? this.get(catalog.dict.Pages) : undefined;
    for (let depth = 0; depth < 30 && isDict(node); depth++) {
      const type = node.dict.Type;
      if (isName(type) && type.name === "Page") return node;
      const kids = this.get(node.dict.Kids);
      if (!Array.isArray(kids) || !kids.length) break;
      node = this.get(kids[0]);
    }
    // No catalog: the lowest numbered page object.
    const pages = [...this.objs.entries()].filter(([, o]) => isDict(o.value) && isName(o.value.dict.Type) && o.value.dict.Type.name === "Page").sort((a, b) => a[0] - b[0]);
    return pages.length ? (pages[0]![1].value as Dict) : null;
  }
  /** Every page in reading order (the page tree, depth first), up to `max`. */
  pages(max: number): Dict[] {
    let catalog: Dict | null = null;
    for (const [, o] of this.objs) {
      if (isDict(o.value) && isName(o.value.dict.Type) && o.value.dict.Type.name === "Catalog") catalog = o.value;
    }
    const out: Dict[] = [];
    const seen = new Set<Val>();
    const visit = (v: Val | undefined, depth: number) => {
      const node = this.get(v);
      if (!isDict(node) || seen.has(node) || depth > 30 || out.length >= max) return;
      seen.add(node);
      const type = node.dict.Type;
      if (isName(type) && type.name === "Page") {
        out.push(node);
        return;
      }
      const kids = this.get(node.dict.Kids);
      if (Array.isArray(kids)) for (const k of kids) visit(k, depth + 1);
    };
    if (catalog) visit(catalog.dict.Pages, 0);
    return out;
  }
  /** A page's resources, inherited from its parents when missing. */
  resources(page: Dict): Record<string, Val> {
    let node: Val | undefined = page;
    for (let depth = 0; depth < 30 && isDict(node); depth++) {
      const r = this.get(node.dict.Resources);
      if (isDict(r)) return r.dict;
      node = this.get(node.dict.Parent);
    }
    return {};
  }
}

const skipWs = (s: string, i: number) => {
  while (i < s.length && " \t\r\n\f\0".includes(s[i]!)) i++;
  return i;
};

/** How a font turns string bytes into text. */
type Font = { width: 1 | 2; map: Map<number, string> | null };

function parseCMap(text: string): { width: 1 | 2; map: Map<number, string> } {
  const map = new Map<number, string>();
  const width: 1 | 2 = /begincodespacerange\s*<([0-9a-fA-F]+)>/.exec(text)?.[1]!.length === 2 ? 1 : 2;
  const uni = (hex: string) => {
    let s = "";
    for (let k = 0; k + 4 <= hex.length; k += 4) s += String.fromCharCode(parseInt(hex.slice(k, k + 4), 16));
    if (hex.length === 2) s = String.fromCharCode(parseInt(hex, 16));
    return s;
  };
  for (const block of text.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
    for (const m of block[1]!.matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]*)>/g)) map.set(parseInt(m[1]!, 16), uni(m[2]!));
  }
  for (const block of text.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
    for (const m of block[1]!.matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>\s*(<[0-9a-fA-F]*>|\[[^\]]*\])/g)) {
      const lo = parseInt(m[1]!, 16);
      const hi = Math.min(parseInt(m[2]!, 16), lo + 65535);
      if (m[3]!.startsWith("[")) {
        const items = [...m[3]!.matchAll(/<([0-9a-fA-F]*)>/g)].map((x) => x[1]!);
        items.forEach((h, k) => lo + k <= hi && map.set(lo + k, uni(h)));
      } else {
        const start = m[3]!.slice(1, -1);
        const base = parseInt(start.slice(-4) || "0", 16);
        const prefix = uni(start.slice(0, -4));
        for (let c = lo; c <= hi; c++) map.set(c, prefix + String.fromCharCode(base + (c - lo)));
      }
    }
  }
  return { width, map };
}

async function loadFont(doc: Doc, v: Val | undefined): Promise<Font> {
  const f = doc.get(v);
  if (!isDict(f)) return { width: 1, map: null };
  const sub = doc.get(f.dict.Subtype);
  const type0 = isName(sub) && sub.name === "Type0";
  const tu = f.dict.ToUnicode;
  const tuObj = isRef(tu) ? doc.objs.get(tu.ref) : undefined;
  if (tuObj?.stream) {
    const cm = parseCMap(latin1(await doc.data(tuObj)));
    // Simple fonts take one byte per character whatever their map says; Type0 (Identity-H) two.
    return { width: type0 ? 2 : 1, map: cm.map };
  }
  return { width: type0 ? 2 : 1, map: null };
}

function decode(font: Font, s: Uint8Array): string {
  let out = "";
  if (font.width === 2) {
    for (let k = 0; k + 1 < s.length; k += 2) {
      const code = (s[k]! << 8) | s[k + 1]!;
      out += font.map?.get(code) ?? "";
    }
    return out;
  }
  for (const c of s) out += font.map?.get(c) ?? (c >= 32 ? String.fromCharCode(c) : "");
  return out;
}

/**
 * Runs a content stream and collects its text. Positions are tracked roughly (text matrix,
 * line moves, an estimated advance per character) so a line break goes where the text moves
 * down and a space where it jumps right, and words drawn letter by letter stay whole.
 */
async function runContent(doc: Doc, data: Uint8Array, res: Record<string, Val>, out: { text: string; max: number }, depth: number) {
  if (depth > 3) return;
  const fontsDict = doc.get(res.Font);
  const xobjects = doc.get(res.XObject);
  const fonts = new Map<string, Font>();
  let font: Font = { width: 1, map: null };
  let size = 1;
  let leading = 0;
  // Text matrix (a b c d e f) and line matrix.
  let tm = [1, 0, 0, 1, 0, 0];
  let lm = [1, 0, 0, 1, 0, 0];
  let penX: number | null = null;
  let penY: number | null = null;
  const stack: (Val | { op: string })[] = [];
  const lx = new Lexer(data);
  const emit = (t: string) => {
    if (out.text.length < out.max) out.text += t;
  };
  const scale = () => Math.max(Math.abs(tm[3]!), Math.abs(tm[0]!), 0.01) * size;
  const show = (t: string) => {
    if (!t) return;
    const h = scale();
    const x = tm[4]!;
    const y = tm[5]!;
    if (penY === null || Math.abs(y - penY) > h * 0.5) {
      if (out.text && !out.text.endsWith("\n")) emit("\n");
    } else if (penX !== null && x - penX > h * 0.2 && !out.text.endsWith(" ")) emit(" ");
    emit(t);
    tm = [tm[0]!, tm[1]!, tm[2]!, tm[3]!, x + t.length * h * 0.5, y];
    penX = tm[4]!;
    penY = y;
  };
  const move = (tx: number, ty: number) => {
    lm = [lm[0]!, lm[1]!, lm[2]!, lm[3]!, lm[4]! + tx * lm[0]! + ty * lm[2]!, lm[5]! + tx * lm[1]! + ty * lm[3]!];
    tm = [...lm];
  };
  for (let guard = 0; guard < 400_000 && out.text.length < out.max; guard++) {
    const t = lx.value();
    if (t === undefined) break;
    if (!(typeof t === "object" && t !== null && "op" in t)) {
      stack.push(t);
      if (stack.length > 64) stack.shift();
      continue;
    }
    const op = t.op;
    const args = stack.splice(0);
    const num = (k: number) => (typeof args[k] === "number" ? (args[k] as number) : 0);
    if (op === "BI") { // inline image: skip to EI
      const s = latin1(data, lx.i, Math.min(data.length, lx.i + MAX_STREAM));
      const e = s.search(/\sEI(\s|$)/);
      lx.i = e < 0 ? data.length : lx.i + e + 3;
      continue;
    }
    if (op === "Tf" && isName(args[0])) {
      const key = args[0].name;
      if (!fonts.has(key)) fonts.set(key, await loadFont(doc, isDict(fontsDict) ? fontsDict.dict[key] : undefined));
      font = fonts.get(key)!;
      size = Math.abs(num(1)) || 1;
    } else if (op === "BT") {
      tm = [1, 0, 0, 1, 0, 0];
      lm = [1, 0, 0, 1, 0, 0];
    } else if (op === "Tm" && args.length >= 6) {
      lm = [num(0), num(1), num(2), num(3), num(4), num(5)];
      tm = [...lm];
    } else if (op === "Td") move(num(0), num(1));
    else if (op === "TD") {
      leading = -num(1);
      move(num(0), num(1));
    } else if (op === "TL") leading = num(0);
    else if (op === "T*") move(0, -leading);
    else if (op === "'" || op === '"') {
      move(0, -leading);
      const s = args[args.length - 1];
      if (isStr(s)) show(decode(font, s.str));
    } else if (op === "Tj" && isStr(args[0])) show(decode(font, args[0].str));
    else if (op === "TJ" && Array.isArray(args[0])) {
      for (const part of args[0]) {
        if (isStr(part)) show(decode(font, part.str));
        else if (typeof part === "number") tm = [tm[0]!, tm[1]!, tm[2]!, tm[3]!, tm[4]! - (part / 1000) * scale(), tm[5]!];
      }
    } else if (op === "Do" && isName(args[0]) && isDict(xobjects)) {
      const ref = xobjects.dict[args[0].name];
      const o = isRef(ref) ? doc.objs.get(ref.ref) : undefined;
      const st = o && isDict(o.value) ? doc.get(o.value.dict.Subtype) : undefined;
      if (o?.stream && isName(st) && st.name === "Form") {
        const r = isDict(o.value) ? doc.get(o.value.dict.Resources) : undefined;
        if (out.text && !out.text.endsWith("\n")) emit("\n");
        await runContent(doc, await doc.data(o), isDict(r) ? r.dict : res, out, depth + 1);
        if (out.text && !out.text.endsWith("\n")) emit("\n");
      }
    }
  }
}

/** Opens a document for reading; null when it is not a readable (unencrypted) PDF. */
async function openDoc(bytes: Uint8Array, inflate: Inflate): Promise<Doc | null> {
  const head = latin1(bytes, 0, Math.min(bytes.length, 1024));
  if (!head.includes("%PDF-")) return null;
  const doc = new Doc(bytes, inflate);
  doc.scan();
  doc.exactLengths();
  if (latin1(bytes, Math.max(0, bytes.length - 4096)).includes("/Encrypt")) return null;
  await doc.objectStreams();
  return doc;
}

const tidy = (t: string) =>
  t
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f\ufffd]/g, "")
    .split("\n").map((l) => l.replace(/\s+/g, " ").trim()).filter(Boolean).join("\n");

/** One page's text, up to `max` characters. */
async function pageText(doc: Doc, page: Dict, max: number): Promise<string> {
  const res = doc.resources(page);
  const contents = doc.get(page.dict.Contents);
  const refs = Array.isArray(page.dict.Contents) ? page.dict.Contents : Array.isArray(contents) ? contents : [page.dict.Contents];
  const parts: Uint8Array[] = [];
  for (const r of refs) {
    const o = isRef(r) ? doc.objs.get(r.ref) : undefined;
    if (o?.stream) parts.push(await doc.data(o));
  }
  const all = new Uint8Array(parts.reduce((n, p) => n + p.length + 1, 0));
  let off = 0;
  for (const p of parts) {
    all.set(p, off);
    off += p.length;
    all[off++] = 10;
  }
  const out = { text: "", max };
  await runContent(doc, all, res, out, 0);
  return tidy(out.text).slice(0, max);
}

/** The text of page 1, tidied: one line per text line, single spaces. Empty when unreadable. */
export async function firstPageText(bytes: Uint8Array, inflate: Inflate): Promise<string> {
  try {
    const doc = await openDoc(bytes, inflate);
    const page = doc?.firstPage();
    return doc && page ? await pageText(doc, page, MAX_TEXT) : "";
  } catch {
    return "";
  }
}

/**
 * The text of every page in order (a syllabus, for the topic tree's word check), up to `maxPages`
 * pages and `maxChars` characters in all. Empty list when unreadable.
 */
export async function allPagesText(bytes: Uint8Array, inflate: Inflate, maxPages = 400, maxChars = 2_000_000): Promise<string[]> {
  try {
    const doc = await openDoc(bytes, inflate);
    if (!doc) return [];
    const out: string[] = [];
    let total = 0;
    for (const page of doc.pages(maxPages)) {
      if (total >= maxChars) break;
      const t = await pageText(doc, page, Math.min(200_000, maxChars - total));
      out.push(t);
      total += t.length;
    }
    return out;
  } catch {
    return [];
  }
}
