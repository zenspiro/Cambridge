import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { inflateSync, constants } from "node:zlib";
import { firstPageText } from "../../src/lib/pdf/firstPage.ts";
import { readCover } from "../../src/lib/library/cover.ts";
import { makePdf } from "./helpers/pdf.ts";

const inflate = async (d: Uint8Array) => new Uint8Array(inflateSync(d, { finishFlush: constants.Z_SYNC_FLUSH }));
const CODES = ["0625", "0620", "0478"];
const COVER = ["Cambridge IGCSE", "PHYSICS 0625/42", "Paper 4 Theory (Extended) May/June 2024", "MARK SCHEME", "Maximum Mark: 80"];

test("first page text: plain, compressed, Type0 with ToUnicode, object streams, forms, letter by letter", async () => {
  for (const o of [{}, { compress: true }, { compress: true, type0: true }, { compress: true, objectStream: true }, { compress: true, form: true, type0: true }, { letterByLetter: true, compress: true }]) {
    const text = await firstPageText(makePdf(COVER, o), inflate);
    assert.equal(text, COVER.join("\n"), JSON.stringify(o));
  }
});

/** Like Chrome's DecompressionStream: refuses stray bytes after the compressed data; nothing then. */
const strict = async (d: Uint8Array) => {
  try {
    return new Uint8Array(await new Response(new Blob([d as BlobPart]).stream().pipeThrough(new DecompressionStream("deflate"))).arrayBuffer());
  } catch {
    return new Uint8Array();
  }
};

test("first page text: a line break before endstream, lengths as references (owner's 1524 file)", async () => {
  const junk = new Uint8Array([...(await import("node:zlib")).deflateSync(Buffer.from("x")), 13, 10]);
  assert.equal((await strict(junk)).length, 0, "the strict reader refuses stray bytes, like Chrome");
  for (const o of [{ compress: true, crlf: true }, { compress: true, crlf: true, lengthRef: true }, { compress: true, lengthRef: true, type0: true }]) {
    assert.equal(await firstPageText(makePdf(COVER, o), strict), COVER.join("\n"), JSON.stringify(o));
  }
});

test("first page text: junk, encrypted or empty files give no text, never an error", async () => {
  assert.equal(await firstPageText(new TextEncoder().encode("not a pdf"), inflate), "");
  assert.equal(await firstPageText(new Uint8Array(), inflate), "");
  const enc = new TextEncoder().encode("%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\ntrailer << /Encrypt 5 0 R >>\n%%EOF");
  assert.equal(await firstPageText(enc, inflate), "");
  const broken = makePdf(COVER, { compress: true }).slice(0, 300);
  assert.equal(typeof (await firstPageText(broken, inflate)), "string");
});

test("covers of real Cambridge files give their names", () => {
  const covers = JSON.parse(readFileSync(new URL("./fixtures/covers.json", import.meta.url), "utf8")) as Record<string, string>;
  const expect: Record<string, string> = {
    "june-2024-examiner-report": "0625_s24_er.pdf",
    "june-2024-mark-scheme-paper-11": "0625_s24_ms_11.pdf",
    "june-2024-question-paper-11": "0625_s24_qp_11.pdf",
    "june-2024-question-paper-51": "0625_s24_qp_51.pdf",
    "june-2024-confidential-instructions-paper-51": "0625_s24_ci_51.pdf",
    "2023-specimen-paper-2": "0625_y23_sp_2.pdf",
    "2023-specimen-paper-1-mark-scheme": "0625_y23_sm_1.pdf",
    "2023-specimen-paper-5-confidential-instructions": "0625_y23_ci_5.pdf",
    "2023-2025-syllabus": "0625_y23_sy.pdf",
    "2023-2025-syllabus-update": "0625_y23_su.pdf",
    "2023-2025-grade-descriptions": "0625_y23_gd.pdf",
  };
  for (const [k, name] of Object.entries(expect)) assert.equal(readCover(covers[k]!, CODES).name, name, k);
});

test("covers: other sessions, inserts, grade thresholds; unsure covers say what is missing", () => {
  assert.equal(readCover("CHEMISTRY 0620/32\nPaper 3 Theory (Core) October/November 2023\nINSERT", CODES).name, "0620_w23_in_32.pdf");
  assert.equal(readCover("PHYSICS 0625/22\nPaper 2 February/March 2025\nYou must answer on the question paper.", CODES).name, "0625_m25_qp_22.pdf");
  assert.equal(readCover("Grade threshold table\nCambridge IGCSE Physics (0625) November 2024", CODES).name, "0625_w24_gt.pdf");
  const noVariant = readCover("PHYSICS\nMay/June 2024\nMARK SCHEME", CODES);
  assert.equal(noVariant.name, null);
  assert.match(noVariant.why, /no syllabus code, paper number/);
  assert.equal(readCover("Physics 2024 notes\nTopic 3: forces 1524/12", CODES).code, null, "years and unknown numbers are never codes");
  const notes = readCover("Topic questions on forces", CODES);
  assert.equal(notes.cambridge, false);
  assert.deepEqual(readCover("", CODES), { name: null, code: null, year: null, why: "the first page has no text (perhaps a scan)", cambridge: false, empty: true });
});

test("library check fixes: rename moves the file and its row, remove takes it out, both audited", async () => {
  const { testDb, testBucket } = await import("./helpers/d1.ts");
  const { storeDocument, renameDocument, removeDocument } = await import("../../src/lib/library/store.ts");
  const db = testDb();
  const b = testBucket();
  const bytes = makePdf(["PHYSICS 0625/43", "May/June 2024", "MARK SCHEME"], { compress: true });
  const s = await storeDocument(db, b, { fileName: "0625_s24_qp_42.pdf", bytes, actorId: "a", origin: "upload" });
  assert.ok(s.ok);
  const id = (s as { id: string }).id;
  assert.equal(await renameDocument(db, b, id, "0625_s30_ms_43.pdf", "a"), "year");
  assert.equal(await renameDocument(db, b, id, "nonsense.pdf", "a"), "name");
  assert.equal(await renameDocument(db, b, id, "0625_s24_ms_43.pdf", "a"), "ok_renamed");
  const row = await db.prepare(`SELECT file_name, doc_type, paper, variant, r2_key FROM source_document WHERE id = ?1`).bind(id).first<Record<string, unknown>>();
  assert.deepEqual({ ...row }, { file_name: "0625_s24_ms_43.pdf", doc_type: "ms", paper: 4, variant: 3, r2_key: "0625/2024/s/0625_s24_ms_43.pdf" });
  assert.deepEqual([...b.objects.keys()], ["0625/2024/s/0625_s24_ms_43.pdf"]);
  const other = await storeDocument(db, b, { fileName: "0625_s24_qp_41.pdf", bytes: makePdf(["x"]), actorId: "a", origin: "upload" });
  assert.equal(await renameDocument(db, b, (other as { id: string }).id, "0625_s24_ms_43.pdf", "a"), "same_name");
  assert.equal(await removeDocument(db, b, id, "a"), "ok_removed");
  assert.equal(await removeDocument(db, b, id, "a"), "gone");
  assert.equal(b.objects.has("0625/2024/s/0625_s24_ms_43.pdf"), false);
  const audits = await db.prepare(`SELECT action FROM audit_log WHERE action IN ('source.rename', 'source.remove')`).bind().all<{ action: string }>();
  assert.equal(audits.results.length, 2);
});

test("library check summary and run choices", async () => {
  const { checkSummary } = await import("../../src/lib/agent/runSummary.ts");
  const { checkRunParams } = await import("../../src/lib/agent/runs.ts");
  assert.equal(checkSummary({ subject: "IGCSE Physics (0625)", files: 12, matched: 10, mismatched: 1, unreadable: 1 }),
    "Library check for IGCSE Physics (0625): read the first page of 12 stored files. 10 files match their name. 1 file could not be checked (no readable first page, or an unusual layout). 1 file says on the first page that it is another file; rename or remove it below.");
  const lib = { fromYear: 2022, toYear: 2026, lastSession: "w" } as never;
  assert.equal(checkRunParams({ code: "0625", years: [2024], sessions: ["s"], mode: "check" }, lib, ["0625"])?.mode, "check");
  assert.equal(checkRunParams({ code: "0625", years: [2024], sessions: ["s"], mode: "wipe" }, lib, ["0625"]), null);
});
