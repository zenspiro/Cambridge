// Storing one Cambridge file: checks, fingerprint, race-safe reservation, storage.
// Shared by manual upload now and the agent later. Takes db and bucket as parameters.
import { LIBRARY } from "../config.ts";
import { getLibrarySettings } from "../settings.ts";
import type { Bucket, Db } from "../db.ts";
import { randomId } from "../auth/crypto.ts";
import { audit } from "../auth/session.ts";
import { parseCambridgeName, storageKey } from "./names.ts";
import * as Q from "./queries.ts";

export type StoreReason =
  | "name" // not a Cambridge file name
  | "year" // outside the library years
  | "size" // empty or too big
  | "not_pdf" // does not start like a PDF
  | "no_syllabus" // no syllabus version for that code and year
  | "same_name" // a file with this name is already stored
  | "same_content" // the same file is stored under another name
  | "storage" // storage write failed (logged with a reference)
  | "no_access"; // a team member without library edit for that subject (owner, 9 Nov 2026)

export type StoreOutcome =
  | { fileName: string; ok: true; id: string }
  | { fileName: string; ok: false; reason: StoreReason };

export type StoreInput = {
  fileName: string;
  bytes: Uint8Array;
  actorId: string;
  origin: "upload" | "agent" | "link";
  jobId?: string | null;
  sourceUrl?: string | null;
  sourceSiteId?: string | null;
  /** The bytes' SHA-256 when the caller has it already (the agent's signed upload); R2 checks it on put. */
  sha256?: string;
};

const PDF_MAGIC = [0x25, 0x50, 0x44, 0x46, 0x2d]; // "%PDF-"

export function looksLikePdf(b: Uint8Array): boolean {
  // The header may sit after a few junk bytes; the PDF spec allows up to 1024.
  const limit = Math.min(b.length - PDF_MAGIC.length, 1024);
  for (let i = 0; i <= limit; i++) {
    if (PDF_MAGIC.every((x, j) => b[i + j] === x)) return true;
  }
  return false;
}

async function sha256HexBytes(b: Uint8Array): Promise<string> {
  const d = new Uint8Array(await crypto.subtle.digest("SHA-256", b as BufferSource));
  return [...d].map((x) => x.toString(16).padStart(2, "0")).join("");
}

export async function storeDocument(db: Db, bucket: Bucket, input: StoreInput, now = Date.now()): Promise<StoreOutcome> {
  const shown = String(input.fileName ?? "").slice(0, 80);
  const fail = (reason: StoreReason): StoreOutcome => ({ fileName: shown, ok: false, reason });

  const p = parseCambridgeName(input.fileName);
  if (!p) return fail("name");
  const range = await getLibrarySettings(db);
  if (p.year < range.fromYear || p.year > range.toYear) return fail("year");
  if (input.bytes.length === 0 || input.bytes.length > LIBRARY.maxFileBytes) return fail("size");
  if (!looksLikePdf(input.bytes)) return fail("not_pdf");

  const syl = await db.prepare(Q.SYLLABUS_FOR_FILE).bind(p.code, p.year, p.session).first<{ id: string }>();
  if (!syl) return fail("no_syllabus");

  const sha = input.sha256 && /^[0-9a-f]{64}$/.test(input.sha256) ? input.sha256 : await sha256HexBytes(input.bytes);
  const key = storageKey(p);
  await db.prepare(Q.DROP_STALE_PENDING).bind(now - 3_600_000).run();
  const reserved = await db
    .prepare(Q.RESERVE_DOCUMENT)
    .bind(
      randomId(), syl.id, p.session, p.year, p.paper, p.variant, p.docType, p.fileName, key, sha,
      input.bytes.length, input.sourceUrl ?? null, input.sourceSiteId ?? null, input.origin,
      input.jobId ?? null, input.actorId, now,
    )
    .first<{ id: string }>();
  if (!reserved) {
    const clash = await db.prepare(Q.FIND_CLASH).bind(p.fileName, sha).first<{ file_name: string }>();
    return fail(clash?.file_name === p.fileName ? "same_name" : "same_content");
  }

  try {
    await bucket.put(key, input.bytes, {
      httpMetadata: { contentType: "application/pdf" },
      customMetadata: { sha256: sha },
      sha256: sha,
    });
  } catch (err) {
    await db.prepare(Q.DROP_PENDING).bind(reserved.id).run();
    throw Object.assign(new Error("source storage write failed"), { cause: err, fileName: p.fileName });
  }
  await db.prepare(Q.MARK_STORED).bind(reserved.id).run();
  await audit(
    db,
    { actorId: input.actorId, action: `source.${input.origin}`, entity: "source_document", entityId: reserved.id },
    now,
  );
  return { fileName: p.fileName, ok: true, id: reserved.id };
}

export type FixResult = "ok_renamed" | "ok_removed" | "gone" | "name" | "year" | "no_syllabus" | "same_name" | "storage";

type DocRow = { id: string; file_name: string; r2_key: string; status: string };

/**
 * Renames a stored file (library check found its first page says it is another file): new
 * row details, the object moved to its new key. The new name must be free and fit the library.
 */
export async function renameDocument(db: Db, bucket: Bucket, id: string, newName: string, actorId: string, now = Date.now()): Promise<FixResult> {
  const row = await db.prepare(`SELECT id, file_name, r2_key, status FROM source_document WHERE id = ?1`).bind(id).first<DocRow>();
  if (!row || row.status !== "stored") return "gone";
  const p = parseCambridgeName(newName);
  if (!p) return "name";
  const range = await getLibrarySettings(db);
  if (p.year < range.fromYear || p.year > range.toYear) return "year";
  const syl = await db.prepare(Q.SYLLABUS_FOR_FILE).bind(p.code, p.year, p.session).first<{ id: string }>();
  if (!syl) return "no_syllabus";
  if (await db.prepare(`SELECT id FROM source_document WHERE file_name = ?1`).bind(p.fileName).first()) return "same_name";
  const obj = await bucket.get(row.r2_key);
  if (!obj) return "storage";
  const bytes = new Uint8Array(await new Response(obj.body).arrayBuffer());
  const key = storageKey(p);
  await bucket.put(key, bytes, { httpMetadata: { contentType: "application/pdf" } });
  await db
    .prepare(`UPDATE source_document SET syllabus_id = ?2, session = ?3, year = ?4, paper = ?5, variant = ?6, doc_type = ?7, file_name = ?8, r2_key = ?9 WHERE id = ?1`)
    .bind(id, syl.id, p.session, p.year, p.paper, p.variant, p.docType, p.fileName, key)
    .run();
  if (key !== row.r2_key) await bucket.delete(row.r2_key);
  await audit(db, { actorId, action: "source.rename", entity: "source_document", entityId: id, detail: { from: row.file_name, to: p.fileName } }, now);
  return "ok_renamed";
}

/** Takes a stored file out of the library (row and object). Audited; the audit row stays. */
export async function removeDocument(db: Db, bucket: Bucket, id: string, actorId: string, now = Date.now()): Promise<FixResult> {
  const row = await db.prepare(`SELECT id, file_name, r2_key, status FROM source_document WHERE id = ?1`).bind(id).first<DocRow>();
  if (!row || row.status !== "stored") return "gone";
  await bucket.delete(row.r2_key);
  await db.prepare(`DELETE FROM source_document WHERE id = ?1`).bind(id).run();
  await audit(db, { actorId, action: "source.remove", entity: "source_document", entityId: id, detail: { file: row.file_name } }, now);
  return "ok_removed";
}
