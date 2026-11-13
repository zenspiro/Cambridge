// Loads a paper reading made in a dev session (owner, 12 Nov 2026: "you are going to read the pdfs and load them in
// to the database, with me reviewing, and at the same time you keep updating the reading engine").
//
// The reading goes through the same steps as the brain script's (scripts/brain/run.ts): the PDF's notated page text
// and outline from Poppler, parts placed on their pages, figures moved to their lead-ins, question numbers and
// opening text put right from the printed page, figures cut from the PDF, every check against the PDF and against
// Gemini's stored reading. Then it is posted to /api/reader/*, where the Worker saves it like the AI's (scored as
// "Read in a dev session", never the AI's own copy).
//
//   node scripts/reader/load.ts <docId> <paper.pdf> <reading.json> [--gemini gemini.json] [--replace] [--dry]
//
// --dry prints what would be saved (flags, fixes, figures) and posts nothing. APP_URL defaults to the live app; its
// READER_TOKEN is added by the session's network proxy. Only for a local test server (localhost) is READER_TOKEN
// read from the environment and sent here.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { constants as zlibConstants, inflateSync } from "node:zlib";
import { allPagesInfo } from "../../src/lib/pdf/firstPage.ts";
import { assignBoxes, fillPhotos, findBoxes, labelBoxes, pageArt, photoArgs, photoSlots, textLines, type Box, type FigureCut, type PageArt } from "../../src/lib/brain/figures.ts";
import { fractionBars, notatedPages, pdfOutline, type Bar, type OutlinePart } from "../../src/lib/brain/notation.ts";
import { autoFixLeads, autoRenumber, blankPages, cleanPaper, figuresToLeads, paperFlags, placeOnPages, type AutoHold, type PaperContent, type PaperKind } from "../../src/lib/brain/paper.ts";

const APP_URL = (process.env.APP_URL ?? "https://cambridge.zenspiroapps.workers.dev").replace(/\/$/, "");
const LOCAL = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(APP_URL);
const args = process.argv.slice(2);
const flag = (name: string) => args.includes(name);
const opt = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const [docId, pdfPath, readingPath] = args.filter((a, i) => !a.startsWith("--") && !(i > 0 && args[i - 1] === "--gemini"));
if (!docId || !pdfPath || !readingPath) {
  console.error("usage: node scripts/reader/load.ts <docId> <paper.pdf> <reading.json> [--gemini gemini.json] [--replace] [--dry]");
  process.exit(2);
}
const dry = flag("--dry");

async function post(path: string, body: Record<string, unknown>): Promise<{ status: number; data: Record<string, unknown> | null }> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (LOCAL && process.env.READER_TOKEN) headers.authorization = `Bearer ${process.env.READER_TOKEN}`;
  for (const wait of [0, 30_000, 60_000, 120_000]) {
    if (wait) await new Promise((r) => setTimeout(r, wait));
    const res = await fetch(APP_URL + path, { method: "POST", headers, body: JSON.stringify(body) }).catch(() => null);
    if (!res) continue;
    if ([502, 503, 504].includes(res.status)) continue;
    const text = await res.text();
    try {
      return { status: res.status, data: JSON.parse(text) as Record<string, unknown> };
    } catch {
      return { status: res.status, data: null };
    }
  }
  return { status: 0, data: null };
}

const run = (cmd: string, a: string[]) => execFileSync(cmd, a, { maxBuffer: 1e8 }).toString();
const bytes = new Uint8Array(readFileSync(pdfPath));
const inflate = async (d: Uint8Array) => new Uint8Array(inflateSync(d, { finishFlush: zlibConstants.Z_SYNC_FLUSH }));
const info = await allPagesInfo(bytes, inflate);
const rawPages = info.map((p) => p.text);
const blank = blankPages(rawPages);
const xml = run("pdftotext", ["-bbox-layout", pdfPath, "-"]);
const pageXml = [...xml.matchAll(/<page [^>]*>[\s\S]*?<\/page>/g)].map((m) => m[0]);
const dir = mkdtempSync(join(tmpdir(), "reader-"));
const svgs = new Map<number, string>();
const bars: Bar[][] = [];
const figs: Box[][] = [];
for (let p = 1; p <= rawPages.length; p++) {
  if (p === 1 || blank.includes(p)) {
    bars.push([]);
    figs.push([]);
    continue;
  }
  const out = join(dir, `p${p}.svg`);
  run("pdftocairo", ["-svg", "-f", String(p), "-l", String(p), pdfPath, out]);
  const svg = readFileSync(out, "utf8");
  svgs.set(p, svg);
  bars.push(fractionBars(svg));
  try {
    const lines = textLines(pageXml[p - 1] ?? "");
    figs.push([...findBoxes(pageArt(svg, p), lines).captions.map((c) => c.box), ...labelBoxes(lines)]);
  } catch {
    figs.push([]);
  }
}
const n = notatedPages(rawPages, xml, bars);
const pages = n.pages;
const outline: OutlinePart[] = pdfOutline(n.words, figs);

// Each photo on a figure page as a small JPEG of its box (Poppler), so a cut figure shows it.
function withPhotos(art: PageArt, page: number): PageArt {
  const data = new Map<number, string>();
  for (const { k, b } of photoSlots(art)) {
    const out = join(dir, `photo-${page}-${k}`);
    try {
      run("pdftoppm", [...photoArgs(page, b), pdfPath!, out]);
      data.set(k, `data:image/jpeg;base64,${readFileSync(`${out}.jpg`).toString("base64")}`);
    } catch {
      // Left out: the figure keeps its drawing.
    }
  }
  return fillPhotos(art, data);
}

const readJson = (p: string | undefined) => (p ? (JSON.parse(readFileSync(p, "utf8")) as unknown) : null);
const mine = readJson(readingPath) as { kind?: unknown } | null;
const kind: PaperKind = mine?.kind === "ms" ? "ms" : "qp";
const read = cleanPaper(mine, kind);
// The paper's total from its cover when the reading leaves it out, so the "parts add up" check runs.
const coverTotal = Number(/total mark for this paper is\s*(\d+)/i.exec((pages[0] ?? "").replace(/\s+/g, " "))?.[1] ?? NaN);
const reading = placeOnPages(read.totalMarks === null && kind === "qp" && Number.isFinite(coverTotal) ? { ...read, totalMarks: coverTotal } : read, pages, outline);
if (!reading.items.length) throw new Error("the reading has no items");
const g = readJson(opt("--gemini"));
const gemini = g ? cleanPaper(g, kind) : null;

// The run: started first, so automatic fixes leave alone what a person settled (its hold).
let jobId = "";
let hold: AutoHold = { fingerprints: [], keys: [], items: [] };
if (!dry) {
  const s = await post("/api/reader/start", { docId, ...(flag("--replace") ? { replace: true } : {}) });
  if (s.status !== 200 || typeof s.data?.jobId !== "string") throw new Error(`start refused: ${s.status} ${JSON.stringify(s.data)}`);
  jobId = s.data.jobId;
  if (s.data.kind !== kind) {
    await post("/api/reader/fail", { jobId });
    throw new Error(`the document is a ${String(s.data.kind)}, the reading a ${kind}`);
  }
  hold = (s.data.hold as AutoHold) ?? hold;
}

try {
  let content: PaperContent = figuresToLeads(reading);
  const n1 = autoRenumber({ content, pages, gemini, outline }, hold);
  content = n1.content;
  const n2 = autoFixLeads({ content, pages, gemini: n1.gemini, outline }, hold);
  content = n2.content;
  const second = n2.gemini;

  // Figures cut from the PDF, as the script does (a box by hand is never replaced).
  const arts = new Map<number, PageArt>();
  const boxes = new Map<string, { box: Box; cut: FigureCut }>();
  for (const page of [...new Set(content.figures.filter((f) => f.cut !== "manual").map((f) => f.page))].sort((a, b) => a - b)) {
    const svg = svgs.get(page) ?? run("pdftocairo", ["-svg", "-f", String(page), "-l", String(page), pdfPath, "-"]);
    const art = withPhotos(pageArt(svg, page), page);
    const lines = textLines(pageXml[page - 1] ?? "");
    const got = assignBoxes(content.figures.filter((f) => f.page === page), findBoxes(art, lines), lines);
    for (const [id, b] of got) if (content.figures.find((f) => f.id === id)?.cut !== "manual") boxes.set(id, b);
    arts.set(page, art);
  }
  content = { ...content, figures: content.figures.map((f) => (boxes.has(f.id) ? { ...f, ...boxes.get(f.id)!, svg: "" } : f)) };

  const flags = paperFlags({ content, pages, gemini: second, outline });
  const fresh = { items: reading.items.map((i) => ({ number: i.number, marks: i.marks })), flags: paperFlags({ content: reading, pages, gemini, outline }) };
  console.log(`${content.items.length} parts, ${content.figures.length} figures (${boxes.size} cut), ${flags.length} flags`);
  for (const f of flags) console.log(`  ${f.colour} ${f.key}: ${f.reason}`);
  for (const r of n1.fixes) console.log(`  renumbered page ${r.page}: ${r.renames.map((x) => `${x.from} to ${x.to}`).join(", ")}`);
  for (const a of n2.fixes) console.log(`  opening text put right: ${a.key}`);
  if (dry) {
    writeFileSync(join(dir, "content.json"), JSON.stringify(content));
    console.log(`dry run: nothing posted (content in ${join(dir, "content.json")})`);
  } else {
    for (const [, art] of arts) {
      const r = await post("/api/reader/figpage", { jobId, art });
      if (r.status !== 200) throw new Error(`figure page refused: ${r.status} ${JSON.stringify(r.data)}`);
    }
    const r = await post("/api/reader/paper", { jobId, content, gemini: second, pages, flags, fresh, ...(n2.fixes.length ? { auto: n2.fixes } : {}), ...(n1.fixes.length ? { renumber: n1.fixes } : {}) });
    if (r.status !== 200) throw new Error(`save refused: ${r.status} ${JSON.stringify(r.data)}`);
    console.log("saved");
  }
} catch (e) {
  if (jobId) await post("/api/reader/fail", { jobId });
  throw e;
} finally {
  if (!dry) rmSync(dir, { recursive: true, force: true });
}
