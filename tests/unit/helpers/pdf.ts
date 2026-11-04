// Builds small real PDFs for tests: a first page whose lines are drawn as text, compressed or
// not, with a simple font or a Type0 font (two-byte codes and a ToUnicode map), optionally with
// the page inside an object stream or a form XObject, the way Cambridge's own PDFs are built.
import { deflateSync } from "node:zlib";

type Opts = { compress?: boolean; type0?: boolean; objectStream?: boolean; form?: boolean; letterByLetter?: boolean };

const enc = (s: string) => new TextEncoder().encode(s);
const esc = (s: string) => s.replace(/[\\()]/g, (c) => `\\${c}`);
const hex4 = (n: number) => n.toString(16).padStart(4, "0");

export function makePdf(lines: string[], o: Opts = {}): Uint8Array {
  // Content: one line per Tm, top down; letter by letter draws each character with its own Tm.
  const show = (s: string) => (o.type0 ? `<${[...s].map((c) => hex4(c.charCodeAt(0) + 100)).join("")}> Tj` : `(${esc(s)}) Tj`);
  const ops: string[] = ["BT", "/F1 11 Tf"];
  lines.forEach((l, i) => {
    const y = 780 - i * 16;
    if (o.letterByLetter) [...l].forEach((c, k) => ops.push(`1 0 0 1 ${50 + k * 6} ${y} Tm ${show(c)}`));
    else ops.push(`1 0 0 1 50 ${y} Tm ${show(l)}`);
  });
  ops.push("ET");
  const content = enc(ops.join("\n"));
  const chars = [...new Set(lines.join(""))];
  const cmap = enc(
    "/CIDInit /ProcSet findresource begin 12 dict begin begincmap\n1 begincodespacerange <0000> <FFFF> endcodespacerange\n" +
    `${chars.length} beginbfchar\n${chars.map((c) => `<${hex4(c.charCodeAt(0) + 100)}> <${hex4(c.charCodeAt(0))}>`).join("\n")}\nendbfchar\nendcmap end end`,
  );

  const objs: { body: string; stream?: Uint8Array }[] = [];
  const add = (body: string, stream?: Uint8Array) => (objs.push({ body, stream }), objs.length);
  const streamObj = (extra: string, data: Uint8Array) => {
    const d = o.compress ? new Uint8Array(deflateSync(data)) : data;
    return add(`<< ${extra} /Length ${d.length}${o.compress ? " /Filter /FlateDecode" : ""} >>`, d);
  };
  const cmapId = streamObj("", cmap);
  const fontId = o.type0
    ? add(`<< /Type /Font /Subtype /Type0 /BaseFont /Test /Encoding /Identity-H /ToUnicode ${cmapId} 0 R >>`)
    : add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  const fonts = `/Font << /F1 ${fontId} 0 R >>`;
  let pageContent: number;
  let resources: string;
  if (o.form) {
    const formId = streamObj(`/Type /XObject /Subtype /Form /BBox [0 0 595 842] /Resources << ${fonts} >>`, content);
    pageContent = streamObj("", enc("q /Fm0 Do Q"));
    resources = `<< /XObject << /Fm0 ${formId} 0 R >> >>`;
  } else {
    pageContent = streamObj("", content);
    resources = `<< ${fonts} >>`;
  }
  const pagesId = objs.length + 2;
  const pageBody = `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 595 842] /Resources ${resources} /Contents ${pageContent} 0 R >>`;
  const pagesBody = `<< /Type /Pages /Kids [${pagesId - 1} 0 R] /Count 1 >>`;
  const catalogBody = `<< /Type /Catalog /Pages ${pagesId} 0 R >>`;
  if (o.objectStream) {
    // Page, pages and catalog live compressed inside one object stream.
    const nums = [pagesId - 1, pagesId, pagesId + 1];
    const bodies = [pageBody, pagesBody, catalogBody];
    let off = 0;
    const head = bodies.map((b, i) => { const s = `${nums[i]} ${off}`; off += b.length + 1; return s; }).join(" ") + " ";
    const data = enc(head + bodies.join("\n") + "\n");
    objs.push({ body: "", stream: undefined }, { body: "", stream: undefined }, { body: "", stream: undefined });
    const z = new Uint8Array(deflateSync(data));
    objs.push({ body: `<< /Type /ObjStm /N 3 /First ${head.length} /Length ${z.length} /Filter /FlateDecode >>`, stream: z });
  } else {
    add(pageBody);
    add(pagesBody);
    add(catalogBody);
  }

  const parts: Uint8Array[] = [enc("%PDF-1.7\n%âã\n")];
  objs.forEach((ob, i) => {
    if (!ob.body) return; // lives in the object stream
    parts.push(enc(`${i + 1} 0 obj\n${ob.body}\n`));
    if (ob.stream) parts.push(enc("stream\n"), ob.stream, enc("\nendstream\n"));
    parts.push(enc("endobj\n"));
  });
  parts.push(enc("trailer\n<< >>\n%%EOF\n"));
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let k = 0;
  for (const p of parts) { out.set(p, k); k += p.length; }
  return out;
}
